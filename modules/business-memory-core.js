/**
 * TARA Matrix™ — business-memory-core.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Business Memory Core (BMC) — Memory Engine Capa 3, completada (ver
 * docs/constitution/v3-constitution.md Artículo 13 y
 * docs/constitution/diferenciadores-producto-v1.md). Memoria empresarial
 * permanente y evolutiva, categorizada, con ciclo de vida completo:
 * propuesto → confirmado | rechazado | obsoleto.
 *
 * Principio rector (no negociable, pedido explícito de la fundadora): toda
 * escritura nace como 'propuesto', sin excepción de origen. Ninguna propuesta
 * influye ninguna recomendación hasta que un humano la confirma en un
 * segundo paso, deliberado y separado, vía Modo Operador — eso protege el
 * activo más valioso de TARA de contaminarse con inferencias incorrectas.
 *
 * Reglas de integridad (Fase 2, dobles barreras — código Y constraints de
 * base de datos, migración 078):
 *   - confianza < 60 nunca se propone.
 *   - evidencia.resumen vacío nunca se propone.
 *   - toda transición de estado es un UPDATE atómico filtrado por
 *     id + company_id + estado de origen, verificando que se modificó
 *     exactamente una fila (evita condiciones de carrera, doble
 *     confirmación, y fuga entre empresas).
 *   - todo intento de transición, exitoso o no, queda auditado en
 *     decision_logs (fire-and-forget, nunca bloquea el flujo).
 *
 * Regla de costo/latencia: escribir en BMC cuesta una llamada de IA (o es un
 * acto humano). Leer de BMC nunca cuesta una — resumenParaCliente() y
 * obtenerResumenEjecutivo() son lectura pura de SQL.
 *
 * @module modules/business-memory-core
 */

'use strict';

const MODELO_DEFAULT = 'gpt-4o-mini';
const CONFIANZA_MINIMA = 60;

const CATEGORIAS = [
  'cliente_importante', 'patron_compra', 'temporada', 'riesgo',
  'habito_operativo', 'rendimiento_empleado', 'error_recurrente',
  'oportunidad', 'preferencia', 'objetivo', 'aprendizaje_general',
];

// 'manual' se renombró a 'modo_operador' (Fase 2, ajuste de Alina): la tool
// la ejecuta el motor de IA de Modo Operador, aunque haya una persona
// detrás — quién autorizó la acción se guarda aparte (propuesto_por/resuelto_por).
const ORIGENES = ['inbox_analisis', 'modo_operador', 'business_intelligence'];

const ESTADOS_REFORZABLES = ['propuesto', 'confirmado'];

const SYSTEM_PROMPT_RESUMEN = [
  'Eres el sintetizador de la memoria empresarial de un negocio — recibes una lista de aprendizajes',
  'ya confirmados por un humano (no inventes ninguno nuevo, no agregues nada que no esté en la lista)',
  'y produces un resumen ejecutivo vivo del negocio.',
  'Responde SIEMPRE en este formato JSON exacto, sin texto fuera del JSON:',
  '{"resumen": "3-5 oraciones, en español, que sinteticen el estado del negocio a partir de estos aprendizajes",',
  ' "highlights": ["punto accionable 1", "punto accionable 2", ...] (máximo 5, los más importantes ahora mismo)}',
  'Menciona el nivel de confianza cuando sea relevante para matizar una afirmación (ej. "probablemente", "con alta certeza").',
].join(' ');

/**
 * Deriva la etiqueta de confianza (Alina, Fase 2): <60 no debería existir
 * (bloqueado antes de llegar aquí), 60-79 baja, 80-94 sólida, 95-100 alta.
 *
 * @param {number} confianza
 * @returns {'baja'|'solida'|'alta'|null} null si confianza está fuera de rango
 */
function nivelConfianza(confianza) {
  if (!Number.isFinite(confianza) || confianza < CONFIANZA_MINIMA || confianza > 100) return null;
  if (confianza >= 95) return 'alta';
  if (confianza >= 80) return 'solida';
  return 'baja';
}

/**
 * Auditoría fire-and-forget en `decision_logs` — se llama en cada intento de
 * escritura/transición, exitoso o no (pedido explícito de Alina: también se
 * auditan los intentos inválidos/rechazados, sin datos sensibles). Nunca
 * lanza ni bloquea el flujo si el insert falla.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{company_id: string, tipo_accion: string, exito: boolean, parametros?: Object, detalle?: string|null}} datos
 */
async function _auditar(supabase, { company_id, tipo_accion, exito, parametros = {}, detalle = null }) {
  try {
    await supabase.from('decision_logs').insert([{
      company_id, tipo: 'accion',
      payload: { tipo_accion, exito, parametros, detalle },
    }]);
  } catch {
    // Silencio seguro (mismo principio que AuditLogger) — la auditoría nunca tumba el flujo.
  }
}

/**
 * Registra un aprendizaje nuevo — SIEMPRE nace como 'propuesto', sin
 * excepción de `origen`. Rechaza (antes de tocar la base de datos) confianza
 * insuficiente o evidencia vacía. Si ya existe un aprendizaje activo
 * `propuesto`/`confirmado` con el mismo título (misma empresa+categoría+
 * cliente), lo refuerza (`veces_confirmado += 1`) en vez de duplicarlo —
 * pero un aprendizaje `obsoleto` NUNCA se reactiva silenciosamente: se crea
 * una propuesta nueva, con una advertencia de que contradice historia.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.company_id
 * @param {string} datos.categoria
 * @param {string} datos.titulo
 * @param {string} datos.detalle
 * @param {string} datos.origen
 * @param {{resumen: string, [k:string]: *}} datos.evidencia - `resumen` no vacío es obligatorio
 * @param {number} datos.confianza - 60-100, menor se rechaza
 * @param {number|string} [datos.cliente_id]
 * @param {string} [datos.vigente_hasta]
 * @param {string} [datos.propuesto_por] - usuario que originó la propuesta (si vino de Modo Operador)
 * @returns {Promise<Object>} la fila (nueva o reforzada), con `advertencia` (string|null) si contradice un aprendizaje obsoleto
 */
async function registrarAprendizaje(supabase, datos) {
  const {
    company_id, categoria, titulo, detalle, origen,
    cliente_id = null, evidencia, confianza, vigente_hasta = null, propuesto_por = null,
  } = datos;

  if (!company_id || !categoria || !titulo || !detalle || !origen) {
    throw new Error('business-memory-core.registrarAprendizaje: company_id, categoria, titulo, detalle y origen son requeridos');
  }
  if (!CATEGORIAS.includes(categoria)) {
    throw new Error(`business-memory-core.registrarAprendizaje: categoria inválida "${categoria}"`);
  }
  if (!ORIGENES.includes(origen)) {
    throw new Error(`business-memory-core.registrarAprendizaje: origen inválido "${origen}"`);
  }
  if (!evidencia?.resumen || !evidencia.resumen.trim()) {
    await _auditar(supabase, { company_id, tipo_accion: 'bmc_registrar_aprendizaje', exito: false, parametros: { categoria, titulo }, detalle: 'evidencia.resumen vacío' });
    throw new Error('business-memory-core.registrarAprendizaje: evidencia.resumen es obligatorio — TARA no propone sin explicar en qué se basa');
  }
  if (!Number.isFinite(confianza) || confianza < CONFIANZA_MINIMA || confianza > 100) {
    await _auditar(supabase, { company_id, tipo_accion: 'bmc_registrar_aprendizaje', exito: false, parametros: { categoria, titulo, confianza }, detalle: `confianza insuficiente (mínimo ${CONFIANZA_MINIMA})` });
    throw new Error(`business-memory-core.registrarAprendizaje: confianza debe ser ${CONFIANZA_MINIMA}-100 (recibido: ${confianza})`);
  }

  let query = supabase
    .from('memoria_empresarial')
    .select('*')
    .eq('company_id', company_id)
    .eq('categoria', categoria)
    .eq('titulo', titulo)
    .eq('activo', true);
  query = cliente_id ? query.eq('cliente_id', cliente_id) : query.is('cliente_id', null);

  const { data: coincidencias, error: errBuscar } = await query;
  if (errBuscar) throw new Error(`business-memory-core.registrarAprendizaje: ${errBuscar.message}`);

  const reforzable = (coincidencias || []).find(f => ESTADOS_REFORZABLES.includes(f.estado));
  if (reforzable) {
    const { data: reforzado, error: errReforzar } = await supabase
      .from('memoria_empresarial')
      .update({
        veces_confirmado: reforzable.veces_confirmado + 1,
        detalle, evidencia,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reforzable.id)
      .select()
      .single();
    if (errReforzar) throw new Error(`business-memory-core.registrarAprendizaje: ${errReforzar.message}`);
    await _auditar(supabase, { company_id, tipo_accion: 'bmc_registrar_aprendizaje', exito: true, parametros: { categoria, titulo, reforzado: true } });
    return { ...reforzado, advertencia: null };
  }

  // Un aprendizaje 'obsoleto' con el mismo título nunca se reactiva en
  // silencio — se crea una propuesta nueva, pero se avisa del conflicto
  // histórico (ajuste explícito de Alina).
  const obsoletoConflicto = (coincidencias || []).find(f => f.estado === 'obsoleto');

  const { data: nuevo, error: errCrear } = await supabase
    .from('memoria_empresarial')
    .insert([{
      company_id, categoria, cliente_id, titulo, detalle, evidencia, confianza,
      estado: 'propuesto', origen, vigente_hasta, propuesto_por,
    }])
    .select()
    .single();
  if (errCrear) throw new Error(`business-memory-core.registrarAprendizaje: ${errCrear.message}`);

  await _auditar(supabase, { company_id, tipo_accion: 'bmc_registrar_aprendizaje', exito: true, parametros: { categoria, titulo, reforzado: false } });

  return {
    ...nuevo,
    advertencia: obsoletoConflicto
      ? `Contradice un aprendizaje histórico marcado como obsoleto (id: ${obsoletoConflicto.id}, razón: ${obsoletoConflicto.razon_rechazo || 'sin razón registrada'}).`
      : null,
  };
}

/**
 * Transición atómica de estado — UPDATE con el estado de origen en el WHERE,
 * verificando que se modificó exactamente una fila. Esto es lo que evita
 * dobles confirmaciones, condiciones de carrera y cambios sobre registros de
 * otra empresa: si otra petición ya resolvió la fila, o el id/company_id no
 * coincide, el UPDATE afecta 0 filas y se trata como error explícito — nunca
 * se asume éxito. Audita el intento, exitoso o no.
 *
 * @private
 */
async function _transicionarEstado(supabase, { company_id, aprendizaje_id, estadoOrigen, estadoDestino, usuario_id, razon_rechazo, tipo_accion }) {
  const cambios = {
    estado: estadoDestino,
    resuelto_por: usuario_id,
    resuelto_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (razon_rechazo !== undefined) cambios.razon_rechazo = razon_rechazo;

  const { data, error } = await supabase
    .from('memoria_empresarial')
    .update(cambios)
    .eq('id', aprendizaje_id)
    .eq('company_id', company_id)
    .eq('estado', estadoOrigen)
    .select()
    .single();

  if (error || !data) {
    await _auditar(supabase, {
      company_id, tipo_accion, exito: false,
      parametros: { aprendizaje_id, estadoOrigen, estadoDestino },
      detalle: 'la transición no aplicó a ninguna fila (id inexistente, empresa incorrecta, o estado distinto del esperado)',
    });
    throw new Error(`business-memory-core.${tipo_accion}: no se pudo aplicar la transición — el aprendizaje no existe, no pertenece a esta empresa, o no está en estado "${estadoOrigen}"`);
  }

  await _auditar(supabase, { company_id, tipo_accion, exito: true, parametros: { aprendizaje_id } });
  return data;
}

/**
 * Confirma una propuesta — el único camino a `estado='confirmado'`. El
 * caller (server.js/Modo Operador) es responsable de que `usuario_id`
 * tenga rol gerencial (hoy: toda la ruta /api/operador/preguntar ya está
 * gateada a esGerencial).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} aprendizaje_id
 * @param {string} usuario_id
 * @returns {Promise<Object>}
 */
async function confirmarAprendizaje(supabase, company_id, aprendizaje_id, usuario_id) {
  return _transicionarEstado(supabase, {
    company_id, aprendizaje_id, estadoOrigen: 'propuesto', estadoDestino: 'confirmado',
    usuario_id, tipo_accion: 'bmc_confirmar_aprendizaje',
  });
}

/**
 * Rechaza una propuesta — `razon` es obligatoria y se conserva para
 * auditoría (nunca se borra físicamente el registro).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} aprendizaje_id
 * @param {string} usuario_id
 * @param {string} razon
 * @returns {Promise<Object>}
 */
async function rechazarAprendizaje(supabase, company_id, aprendizaje_id, usuario_id, razon) {
  if (!razon || !razon.trim()) {
    await _auditar(supabase, { company_id, tipo_accion: 'bmc_rechazar_aprendizaje', exito: false, parametros: { aprendizaje_id }, detalle: 'razon vacía' });
    throw new Error('business-memory-core.rechazarAprendizaje: razon es requerida');
  }
  return _transicionarEstado(supabase, {
    company_id, aprendizaje_id, estadoOrigen: 'propuesto', estadoDestino: 'rechazado',
    usuario_id, razon_rechazo: razon, tipo_accion: 'bmc_rechazar_aprendizaje',
  });
}

/**
 * Marca como obsoleto un aprendizaje que fue cierto y dejó de serlo — solo
 * aplica sobre algo ya `confirmado` (no tiene sentido volver obsoleto algo
 * que nunca se confirmó).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} aprendizaje_id
 * @param {string} usuario_id
 * @param {string} [razon]
 * @returns {Promise<Object>}
 */
async function marcarObsoleto(supabase, company_id, aprendizaje_id, usuario_id, razon = null) {
  return _transicionarEstado(supabase, {
    company_id, aprendizaje_id, estadoOrigen: 'confirmado', estadoDestino: 'obsoleto',
    usuario_id, razon_rechazo: razon, tipo_accion: 'bmc_marcar_obsoleto',
  });
}

/**
 * Lista propuestas pendientes de revisión humana — para que Modo Operador
 * pueda mostrárselas a un gerencial.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<Object[]>}
 */
async function listarPropuestasPendientes(supabase, company_id) {
  const { data, error } = await supabase
    .from('memoria_empresarial')
    .select('*')
    .eq('company_id', company_id)
    .eq('estado', 'propuesto')
    .eq('activo', true)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`business-memory-core.listarPropuestasPendientes: ${error.message}`);
  return data || [];
}

/**
 * Lectura pura (sin IA) de los aprendizajes CONFIRMADOS relevantes para un
 * cliente — los suyos propios + los de la empresa que no son de un cliente
 * en particular. Formateado como texto, listo para inyectar en cualquier
 * prompt (Panel Inteligente, Modo Operador, y a futuro el Core).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {number|string} cliente_id
 * @returns {Promise<string>} cadena vacía si no hay nada confirmado todavía
 */
async function resumenParaCliente(supabase, company_id, cliente_id) {
  const { data, error } = await supabase
    .from('memoria_empresarial')
    .select('titulo, detalle, confianza, categoria')
    .eq('company_id', company_id)
    .eq('estado', 'confirmado')
    .eq('activo', true)
    .or(`cliente_id.eq.${cliente_id},cliente_id.is.null`)
    .order('confianza', { ascending: false });

  if (error) throw new Error(`business-memory-core.resumenParaCliente: ${error.message}`);
  if (!data || data.length === 0) return '';

  return data.map(a => `- [${a.categoria}] ${a.titulo} (confianza: ${a.confianza}%) — ${a.detalle}`).join('\n');
}

/**
 * Regenera `resumen_ejecutivo_negocio` a partir de los aprendizajes
 * CONFIRMADOS de una empresa — la única función de este módulo que llama a
 * OpenAI. Nunca lee `propuesto`; una propuesta jamás se filtra al resumen
 * ejecutivo, ni siquiera indirectamente.
 *
 * @param {Object} opciones
 * @param {import('@supabase/supabase-js').SupabaseClient} opciones.supabase
 * @param {{chat: {completions: {create: Function}}}} opciones.openaiClient
 * @param {string} opciones.company_id
 * @param {string} [opciones.modelo]
 * @returns {Promise<Object>} { resumen, highlights, generado_at }
 */
async function generarResumenEjecutivo({ supabase, openaiClient, company_id, modelo = MODELO_DEFAULT }) {
  const { data: aprendizajes, error: errListar } = await supabase
    .from('memoria_empresarial')
    .select('titulo, detalle, confianza, categoria, cliente_id')
    .eq('company_id', company_id)
    .eq('estado', 'confirmado')
    .eq('activo', true)
    .order('confianza', { ascending: false });
  if (errListar) throw new Error(`business-memory-core.generarResumenEjecutivo: ${errListar.message}`);

  if (!aprendizajes || aprendizajes.length === 0) {
    const vacio = { resumen: 'Todavía no hay aprendizajes confirmados para este negocio.', highlights: [] };
    const { error: errUpsertVacio } = await supabase.from('resumen_ejecutivo_negocio').upsert(
      { company_id, ...vacio, generado_at: new Date().toISOString() }, { onConflict: 'company_id' }
    );
    if (errUpsertVacio) throw new Error(`business-memory-core.generarResumenEjecutivo: ${errUpsertVacio.message}`);
    return vacio;
  }

  const contexto = aprendizajes.map(a => `[${a.categoria}] ${a.titulo} (confianza: ${a.confianza}%) — ${a.detalle}`).join('\n');

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_RESUMEN },
      { role: 'user', content: contexto },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  let crudo = {};
  try { crudo = JSON.parse(respuesta.choices[0].message.content); } catch { /* queda con defaults */ }

  const resultado = {
    resumen: typeof crudo.resumen === 'string' && crudo.resumen ? crudo.resumen : 'Sin resumen disponible.',
    highlights: Array.isArray(crudo.highlights) ? crudo.highlights.filter(h => typeof h === 'string').slice(0, 5) : [],
  };

  const { error: errUpsert } = await supabase.from('resumen_ejecutivo_negocio').upsert(
    { company_id, ...resultado, generado_at: new Date().toISOString() }, { onConflict: 'company_id' }
  );
  if (errUpsert) throw new Error(`business-memory-core.generarResumenEjecutivo: ${errUpsert.message}`);

  return resultado;
}

/**
 * Lectura pura (sin IA) del resumen ejecutivo ya sintetizado.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<Object|null>} null si todavía no se ha generado ninguno
 */
async function obtenerResumenEjecutivo(supabase, company_id) {
  const { data, error } = await supabase
    .from('resumen_ejecutivo_negocio')
    .select('*')
    .eq('company_id', company_id)
    .maybeSingle();

  if (error) throw new Error(`business-memory-core.obtenerResumenEjecutivo: ${error.message}`);
  return data;
}

module.exports = {
  CATEGORIAS, ORIGENES, CONFIANZA_MINIMA, ESTADOS_REFORZABLES,
  nivelConfianza,
  registrarAprendizaje, confirmarAprendizaje, rechazarAprendizaje, marcarObsoleto,
  listarPropuestasPendientes, resumenParaCliente, generarResumenEjecutivo, obtenerResumenEjecutivo,
};
