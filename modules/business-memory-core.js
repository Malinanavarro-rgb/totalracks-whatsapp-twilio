/**
 * TARA Matrix™ — business-memory-core.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Business Memory Core (BMC) — Memory Engine Capa 3, completada (ver
 * docs/constitution/v3-constitution.md Artículo 13 y
 * docs/constitution/diferenciadores-producto-v1.md). Memoria empresarial
 * permanente y evolutiva, categorizada, con ciclo de vida propuesta→confirmado.
 *
 * Principio rector (no negociable, pedido explícito de la fundadora): toda
 * escritura nace como 'propuesta', sin excepción de origen (IA o humana).
 * Ninguna propuesta influye ninguna recomendación hasta que un humano la
 * confirma en un segundo paso, deliberado y separado — eso protege el activo
 * más valioso de TARA de contaminarse con inferencias incorrectas.
 *
 * Regla de costo/latencia: escribir en BMC cuesta una llamada de IA (o es un
 * acto humano). Leer de BMC nunca cuesta una — resumenParaCliente() y
 * obtenerResumenEjecutivo() son lectura pura de SQL, para que puedan usarse
 * en cualquier camino sensible a latencia sin agregar una llamada a OpenAI.
 *
 * @module modules/business-memory-core
 */

'use strict';

const MODELO_DEFAULT = 'gpt-4o-mini';

const CATEGORIAS = [
  'cliente_importante', 'patron_compra', 'temporada', 'riesgo',
  'habito_operativo', 'rendimiento_empleado', 'error_recurrente',
  'oportunidad', 'preferencia', 'objetivo', 'aprendizaje_general',
];

const ORIGENES = ['inbox_analisis', 'operador', 'business_intelligence', 'manual'];

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
 * Registra un aprendizaje nuevo — SIEMPRE nace como 'propuesta', sin
 * excepción de `origen` (incluyendo 'manual'). Si ya existe un aprendizaje
 * activo muy similar (misma empresa+categoría+cliente+título), lo refuerza
 * (`veces_confirmado += 1`) en vez de duplicarlo — pero el refuerzo de una
 * propuesta sigue siendo una propuesta; nunca se auto-confirma por
 * repetición.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.company_id
 * @param {string} datos.categoria
 * @param {string} datos.titulo
 * @param {string} datos.detalle
 * @param {string} datos.origen
 * @param {number|string} [datos.cliente_id]
 * @param {Object} [datos.evidencia]
 * @param {number} [datos.confianza]
 * @param {string} [datos.vigente_hasta]
 * @param {string} [datos.propuesto_por] - usuario que lo escribió, solo si origen='manual'
 * @returns {Promise<Object>} la fila (nueva o reforzada) de `memoria_empresarial`
 */
async function registrarAprendizaje(supabase, datos) {
  const {
    company_id, categoria, titulo, detalle, origen,
    cliente_id = null, evidencia = {}, confianza = 50, vigente_hasta = null, propuesto_por = null,
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

  let query = supabase
    .from('memoria_empresarial')
    .select('*')
    .eq('company_id', company_id)
    .eq('categoria', categoria)
    .eq('titulo', titulo)
    .eq('activo', true);
  query = cliente_id ? query.eq('cliente_id', cliente_id) : query.is('cliente_id', null);

  const { data: existente, error: errBuscar } = await query.maybeSingle();
  if (errBuscar) throw new Error(`business-memory-core.registrarAprendizaje: ${errBuscar.message}`);

  if (existente) {
    const { data: reforzado, error: errReforzar } = await supabase
      .from('memoria_empresarial')
      .update({
        veces_confirmado: existente.veces_confirmado + 1,
        detalle, evidencia,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existente.id)
      .select()
      .single();
    if (errReforzar) throw new Error(`business-memory-core.registrarAprendizaje: ${errReforzar.message}`);
    return reforzado;
  }

  const { data: nuevo, error: errCrear } = await supabase
    .from('memoria_empresarial')
    .insert([{
      company_id, categoria, cliente_id, titulo, detalle, evidencia, confianza,
      estado: 'propuesta', origen, vigente_hasta, propuesto_por,
    }])
    .select()
    .single();
  if (errCrear) throw new Error(`business-memory-core.registrarAprendizaje: ${errCrear.message}`);
  return nuevo;
}

/**
 * Confirma o rechaza una propuesta — el único camino a `estado='confirmado'`.
 * El caller (server.js/Modo Operador) es responsable de verificar que
 * `usuario_id` tiene un rol gerencial antes de invocar esto.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} aprendizaje_id
 * @param {'confirmado'|'rechazada'} decision
 * @param {string} usuario_id
 * @returns {Promise<Object>}
 */
async function resolverPropuesta(supabase, company_id, aprendizaje_id, decision, usuario_id) {
  if (!['confirmado', 'rechazada'].includes(decision)) {
    throw new Error(`business-memory-core.resolverPropuesta: decision inválida "${decision}"`);
  }

  const { data, error } = await supabase
    .from('memoria_empresarial')
    .update({
      estado: decision,
      confirmado_por: usuario_id,
      confirmado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', aprendizaje_id)
    .eq('company_id', company_id)
    .eq('estado', 'propuesta')
    .select()
    .single();

  if (error) throw new Error(`business-memory-core.resolverPropuesta: ${error.message}`);
  return data;
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
    .eq('estado', 'propuesta')
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
 * OpenAI. Nunca lee `propuesta`; una propuesta jamás se filtra al resumen
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
  CATEGORIAS, ORIGENES,
  registrarAprendizaje, resolverPropuesta, listarPropuestasPendientes,
  resumenParaCliente, generarResumenEjecutivo, obtenerResumenEjecutivo,
};
