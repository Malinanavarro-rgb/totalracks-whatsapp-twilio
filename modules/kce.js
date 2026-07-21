/**
 * TARA Matrix™ — kce.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Knowledge Consolidation Engine (KCE) — Fase 3A del Business Memory Core.
 * Analiza la memoria empresarial buscando refuerzos, posibles duplicados,
 * contradicciones y obsolescencia — pero NUNCA los aplica solo.
 *
 * Principio rector (no negociable, pedido explícito de la fundadora): "el KCE
 * no podrá confirmar, rechazar, fusionar, marcar obsoleto ni modificar memoria
 * confirmada — solo podrá proponer." Ni siquiera el refuerzo se aplica
 * automáticamente en esta fase: cada corrida escribe únicamente en
 * `kce_ejecuciones`/`kce_alertas`, jamás en `memoria_empresarial`. Aplicar una
 * propuesta es siempre un segundo paso, deliberado, de un humano vía Modo
 * Operador (aplicarRefuerzo/fusionarAprendizajes/resolverAlerta).
 *
 * Solo bajo demanda: no hay cron en esta fase (Fase 3B, decisión posterior,
 * condicionada a varias corridas manuales consistentes).
 *
 * @module modules/kce
 */

'use strict';

const { ESTADOS_REFORZABLES } = require('./business-memory-core');

const MODELO_DEFAULT = 'gpt-4o-mini';
const UMBRAL_DIAS_OBSOLESCENCIA = 90;
const TAMANO_MAXIMO_GRUPO = 20; // límite práctico por llamada de IA

const PESOS_KNOWLEDGE_SCORE = { cantidad: 0.30, calidadEvidencia: 0.25, frecuencia: 0.20, ausenciaContradicciones: 0.15, estabilidad: 0.10 };

const SYSTEM_PROMPT_KCE = [
  'Eres el motor de consolidación de conocimiento de un negocio (Knowledge Consolidation Engine).',
  'Recibes una lista de aprendizajes YA registrados, de la misma categoría (y del mismo cliente si aplica).',
  'Tu único trabajo es compararlos entre sí, con extrema prudencia, y clasificar cada par relevante:',
  '"mismo" — son el mismo aprendizaje real, solo redactado distinto (>=90% de coincidencia real, considerando',
  'texto, evidencia y contexto operativo, nunca solo el texto) → se sugerirá reforzar el más antiguo/sólido.',
  '"similar" — parecidos pero no idénticos, podrían ser el mismo o podrían ser cosas distintas (60-89%) → posible duplicado.',
  '"contradice" — afirman cosas opuestas sobre el mismo tema (ej. "vende más martes" vs "vende más viernes").',
  '"ninguna" — sin relación real, no lo incluyas en la respuesta.',
  'Sé conservador: ante la duda entre "mismo" y "similar", usa "similar". Ante la duda entre "similar" y "ninguna", usa "ninguna".',
  'Nunca inventes evidencia — tu justificación debe basarse solo en lo que se te dio.',
  'Responde SIEMPRE en este formato JSON exacto, sin texto fuera del JSON:',
  '{"comparaciones": [{"id_a": "...", "id_b": "...", "relacion": "mismo"|"similar"|"contradice", "similitud_pct": 0-100,',
  ' "confianza_propuesta": 0-100, "justificacion": "explica con evidencia concreta por qué", "incremento_sugerido": 1-15 (solo si relacion="mismo")}]}',
  'Si ninguna comparación es relevante, responde {"comparaciones": []}.',
].join(' ');

function _formatearAprendizaje(a) {
  return `id=${a.id} | titulo="${a.titulo}" | detalle="${a.detalle}" | evidencia="${a.evidencia?.resumen || ''}" | confianza=${a.confianza}% | veces_confirmado=${a.veces_confirmado} | creado=${a.created_at}`;
}

async function _compararGrupo(openaiClient, grupo, modelo) {
  const contexto = grupo.map(_formatearAprendizaje).join('\n');
  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_KCE },
      { role: 'user', content: contexto },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  let crudo = {};
  try { crudo = JSON.parse(respuesta.choices[0].message.content); } catch { /* queda con defaults */ }
  if (!Array.isArray(crudo.comparaciones)) return [];

  const idsValidos = new Set(grupo.map(a => a.id));
  return crudo.comparaciones.filter(c =>
    ['mismo', 'similar', 'contradice'].includes(c.relacion) && idsValidos.has(c.id_a) && idsValidos.has(c.id_b) && c.id_a !== c.id_b
  );
}

function _detectarObsolescencia(lista) {
  const ahora = Date.now();
  const alertas = [];
  for (const a of lista) {
    if (a.estado !== 'confirmado') continue;
    const diasSinRefuerzo = Math.floor((ahora - new Date(a.updated_at).getTime()) / (1000 * 60 * 60 * 24));
    if (diasSinRefuerzo >= UMBRAL_DIAS_OBSOLESCENCIA) {
      alertas.push({
        tipo: 'posible_obsoleto',
        aprendizaje_id_a: a.id,
        aprendizaje_id_b: null,
        confianza_propuesta: Math.min(95, 60 + Math.floor((diasSinRefuerzo - UMBRAL_DIAS_OBSOLESCENCIA) / 10)),
        incremento_sugerido: null,
        similitud_pct: null,
        justificacion: `No se ha reforzado en ${diasSinRefuerzo} días — la última actualización fue el ${a.updated_at}.`,
      });
    }
  }
  return alertas;
}

/**
 * Ejecuta el Knowledge Consolidation Engine para una empresa — SIEMPRE bajo
 * demanda, nunca programado. Solo escribe en kce_ejecuciones/kce_alertas;
 * memoria_empresarial nunca se toca en esta función.
 *
 * @param {Object} opciones
 * @param {import('@supabase/supabase-js').SupabaseClient} opciones.supabase
 * @param {{chat: {completions: {create: Function}}}} opciones.openaiClient
 * @param {string} opciones.company_id
 * @param {string} opciones.usuario_id - operador que solicitó la corrida (trazabilidad, nunca se auto-ejecuta)
 * @param {string} [opciones.modelo]
 * @returns {Promise<{ejecucion: Object, alertas: Object[], reporteTexto: string}>}
 */
async function ejecutarKCE({ supabase, openaiClient, company_id, usuario_id, modelo = MODELO_DEFAULT }) {
  if (!company_id || !usuario_id) {
    throw new Error('kce.ejecutarKCE: company_id y usuario_id son requeridos — el KCE nunca corre sin que un operador lo solicite');
  }

  const iniciado_at = new Date();

  const { data: aprendizajes, error: errListar } = await supabase
    .from('memoria_empresarial')
    .select('*')
    .eq('company_id', company_id)
    .eq('activo', true)
    .in('estado', ['propuesto', 'confirmado']);
  if (errListar) throw new Error(`kce.ejecutarKCE: ${errListar.message}`);

  const lista = aprendizajes || [];

  const grupos = new Map();
  for (const a of lista) {
    const clave = `${a.categoria}::${a.cliente_id || 'sin_cliente'}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(a);
  }

  const porId = new Map(lista.map(a => [a.id, a]));
  const alertasNuevas = [];

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const comparaciones = await _compararGrupo(openaiClient, grupo.slice(0, TAMANO_MAXIMO_GRUPO), modelo);

    for (const c of comparaciones) {
      if (c.relacion === 'mismo') {
        alertasNuevas.push({
          tipo: 'refuerzo_sugerido',
          aprendizaje_id_a: c.id_a,
          aprendizaje_id_b: c.id_b,
          confianza_propuesta: Math.max(0, Math.min(100, Math.round(c.confianza_propuesta) || 90)),
          incremento_sugerido: Math.max(1, Math.min(15, Math.round(c.incremento_sugerido) || 5)),
          similitud_pct: Math.max(0, Math.min(100, Math.round(c.similitud_pct) || 90)),
          justificacion: typeof c.justificacion === 'string' && c.justificacion ? c.justificacion : 'Coincidencia detectada por el KCE.',
        });
      } else if (c.relacion === 'similar') {
        alertasNuevas.push({
          tipo: 'posible_duplicado',
          aprendizaje_id_a: c.id_a,
          aprendizaje_id_b: c.id_b,
          confianza_propuesta: Math.max(0, Math.min(100, Math.round(c.confianza_propuesta) || 70)),
          incremento_sugerido: null,
          similitud_pct: Math.max(0, Math.min(100, Math.round(c.similitud_pct) || 70)),
          justificacion: typeof c.justificacion === 'string' && c.justificacion ? c.justificacion : 'Posible duplicado detectado por el KCE.',
        });
      } else if (c.relacion === 'contradice') {
        alertasNuevas.push({
          tipo: 'contradiccion',
          aprendizaje_id_a: c.id_a,
          aprendizaje_id_b: c.id_b,
          confianza_propuesta: Math.max(0, Math.min(100, Math.round(c.confianza_propuesta) || 80)),
          incremento_sugerido: null,
          similitud_pct: null,
          justificacion: typeof c.justificacion === 'string' && c.justificacion ? c.justificacion : 'Posible contradicción detectada por el KCE.',
        });
      }
    }
  }

  alertasNuevas.push(..._detectarObsolescencia(lista));

  const contadores = {
    refuerzos_sugeridos: alertasNuevas.filter(a => a.tipo === 'refuerzo_sugerido').length,
    alertas_duplicado: alertasNuevas.filter(a => a.tipo === 'posible_duplicado').length,
    alertas_contradiccion: alertasNuevas.filter(a => a.tipo === 'contradiccion').length,
    alertas_obsolescencia: alertasNuevas.filter(a => a.tipo === 'posible_obsoleto').length,
  };

  const confianza_global = alertasNuevas.length === 0
    ? 100
    : Math.round(alertasNuevas.reduce((s, a) => s + a.confianza_propuesta, 0) / alertasNuevas.length);

  const finalizado_at = new Date();

  const { data: ejecucion, error: errEjecucion } = await supabase
    .from('kce_ejecuciones')
    .insert([{
      company_id,
      iniciado_at: iniciado_at.toISOString(),
      finalizado_at: finalizado_at.toISOString(),
      duracion_ms: finalizado_at.getTime() - iniciado_at.getTime(),
      aprendizajes_analizados: lista.length,
      ...contadores,
      cambios_aplicados: 0, // el KCE nunca aplica nada solo, en esta fase
      confianza_global,
      ejecutado_por: usuario_id,
      reporte: { grupos_analizados: grupos.size },
    }])
    .select()
    .single();
  if (errEjecucion) throw new Error(`kce.ejecutarKCE: ${errEjecucion.message}`);

  let alertasGuardadas = [];
  if (alertasNuevas.length > 0) {
    const { data: insertadas, error: errAlertas } = await supabase
      .from('kce_alertas')
      .insert(alertasNuevas.map(a => ({ ...a, company_id, ejecucion_id: ejecucion.id })))
      .select();
    if (errAlertas) throw new Error(`kce.ejecutarKCE: ${errAlertas.message}`);
    alertasGuardadas = insertadas || [];
  }

  return { ejecucion, alertas: alertasGuardadas, reporteTexto: generarReporteTexto(ejecucion) };
}

/**
 * Formatea el "Resumen Ejecutivo de Consolidación" en texto plano, listo para
 * mostrarse en Modo Operador o guardarse como referencia.
 *
 * @param {Object} ejecucion - fila de kce_ejecuciones
 * @param {string} [nombreEmpresa]
 * @returns {string}
 */
function generarReporteTexto(ejecucion, nombreEmpresa) {
  const accionesPendientes = ejecucion.refuerzos_sugeridos + ejecucion.alertas_duplicado + ejecucion.alertas_contradiccion + ejecucion.alertas_obsolescencia;
  const lineas = ['Knowledge Consolidation Report', ''];
  if (nombreEmpresa) lineas.push(`Empresa: ${nombreEmpresa}`, '');
  lineas.push(
    `Analizados: ${ejecucion.aprendizajes_analizados} aprendizajes`,
    `Refuerzos sugeridos: ${ejecucion.refuerzos_sugeridos}`,
    `Posibles duplicados: ${ejecucion.alertas_duplicado}`,
    `Posibles contradicciones: ${ejecucion.alertas_contradiccion}`,
    `Posibles obsoletos: ${ejecucion.alertas_obsolescencia}`,
    `Cambios aplicados: ${ejecucion.cambios_aplicados}`,
    `Acciones pendientes: ${accionesPendientes}`,
    `Nivel de confianza global: ${ejecucion.confianza_global}%`,
  );
  return lineas.join('\n');
}

/**
 * Lista alertas pendientes de revisión humana.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<Object[]>}
 */
async function listarAlertasPendientes(supabase, company_id) {
  const { data, error } = await supabase
    .from('kce_alertas')
    .select('*')
    .eq('company_id', company_id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`kce.listarAlertasPendientes: ${error.message}`);
  return data || [];
}

/**
 * Aplica un refuerzo sugerido — el ÚNICO camino para que una propuesta de
 * refuerzo del KCE llegue a memoria_empresarial. Requiere que el aprendizaje
 * siga en un estado reforzable (pudo haber cambiado desde que el KCE corrió).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} alerta_id
 * @param {string} usuario_id
 * @returns {Promise<Object>} el aprendizaje actualizado
 */
async function aplicarRefuerzo(supabase, company_id, alerta_id, usuario_id) {
  const { data: alerta, error: errAlerta } = await supabase
    .from('kce_alertas').select('*').eq('id', alerta_id).eq('company_id', company_id).eq('tipo', 'refuerzo_sugerido').eq('estado', 'pendiente').maybeSingle();
  if (errAlerta) throw new Error(`kce.aplicarRefuerzo: ${errAlerta.message}`);
  if (!alerta) throw new Error('kce.aplicarRefuerzo: la alerta no existe, no pertenece a esta empresa, ya fue revisada, o no es un refuerzo sugerido');

  const { data: aprendizaje, error: errBuscar } = await supabase
    .from('memoria_empresarial').select('*').eq('id', alerta.aprendizaje_id_a).eq('company_id', company_id).eq('activo', true).maybeSingle();
  if (errBuscar) throw new Error(`kce.aplicarRefuerzo: ${errBuscar.message}`);
  if (!aprendizaje || !ESTADOS_REFORZABLES.includes(aprendizaje.estado)) {
    throw new Error('kce.aplicarRefuerzo: el aprendizaje ya no está en un estado reforzable (pudo cambiar desde que el KCE corrió)');
  }

  const nuevaConfianza = Math.min(100, aprendizaje.confianza + alerta.incremento_sugerido);
  const { data: actualizado, error: errUpdate } = await supabase
    .from('memoria_empresarial')
    .update({ confianza: nuevaConfianza, veces_confirmado: aprendizaje.veces_confirmado + 1, updated_at: new Date().toISOString() })
    .eq('id', aprendizaje.id).eq('company_id', company_id)
    .select().single();
  if (errUpdate) throw new Error(`kce.aplicarRefuerzo: ${errUpdate.message}`);

  await supabase.from('kce_alertas').update({
    estado: 'aplicada', accion_tomada: `confianza ${aprendizaje.confianza}% → ${nuevaConfianza}%`, revisada_por: usuario_id, revisada_at: new Date().toISOString(),
  }).eq('id', alerta_id);

  return actualizado;
}

/**
 * Fusiona dos aprendizajes por decisión humana — el descartado pasa a
 * `rechazado` (nunca se borra físicamente), el conservado no se toca. A
 * diferencia de business-memory-core.js::rechazarAprendizaje (que solo opera
 * sobre 'propuesto'), esto acepta descartar un 'confirmado' también, porque
 * una fusión puede involucrar dos aprendizajes ya confirmados.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} id_conservar
 * @param {string} id_descartar
 * @param {string} usuario_id
 * @param {string} razon
 * @param {string} [alerta_id] - si la fusión resuelve una alerta de posible_duplicado
 * @returns {Promise<Object>} el aprendizaje descartado, ya rechazado
 */
async function fusionarAprendizajes(supabase, company_id, id_conservar, id_descartar, usuario_id, razon, alerta_id) {
  if (!razon || !razon.trim()) throw new Error('kce.fusionarAprendizajes: razon es requerida');
  if (id_conservar === id_descartar) throw new Error('kce.fusionarAprendizajes: id_conservar e id_descartar no pueden ser el mismo');

  const { data: descartado, error } = await supabase
    .from('memoria_empresarial')
    .update({ estado: 'rechazado', razon_rechazo: `Fusionado con ${id_conservar}: ${razon}`, resuelto_por: usuario_id, resuelto_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id_descartar).eq('company_id', company_id).eq('activo', true).in('estado', ['propuesto', 'confirmado'])
    .select().single();
  if (error || !descartado) throw new Error('kce.fusionarAprendizajes: no se pudo descartar — el id no existe, no pertenece a esta empresa, o ya no está en un estado válido');

  if (alerta_id) {
    await supabase.from('kce_alertas').update({
      estado: 'aplicada', accion_tomada: `fusionado: se conservó ${id_conservar}, se descartó ${id_descartar}`, revisada_por: usuario_id, revisada_at: new Date().toISOString(),
    }).eq('id', alerta_id).eq('company_id', company_id);
  }

  return descartado;
}

/**
 * Cierra una alerta (contradicción/obsolescencia/duplicado) sin que el KCE
 * mismo ejecute ninguna acción sobre memoria_empresarial — el humano ya actuó
 * (o decidió no actuar) usando las tools correspondientes de Fase 2, y esto
 * solo deja constancia de esa decisión.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} alerta_id
 * @param {string} usuario_id
 * @param {string} accion_tomada
 * @param {string} [razon]
 * @returns {Promise<Object>}
 */
async function resolverAlerta(supabase, company_id, alerta_id, usuario_id, accion_tomada, razon) {
  if (!accion_tomada || !accion_tomada.trim()) throw new Error('kce.resolverAlerta: accion_tomada es requerida');

  const { data, error } = await supabase
    .from('kce_alertas')
    .update({ estado: 'aplicada', accion_tomada: razon ? `${accion_tomada}: ${razon}` : accion_tomada, revisada_por: usuario_id, revisada_at: new Date().toISOString() })
    .eq('id', alerta_id).eq('company_id', company_id).eq('estado', 'pendiente')
    .select().single();
  if (error || !data) throw new Error('kce.resolverAlerta: la alerta no existe, no pertenece a esta empresa, o ya fue revisada');
  return data;
}

/**
 * Knowledge Maturity Score — fórmula determinística, SIN llamada a IA (para
 * que sea estable, explicable y comparable en el tiempo; un cliente ve este
 * número, tiene que poder justificarse con una fórmula, no con "la IA dijo").
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<{score: number, desglose: Object}>}
 */
async function calcularKnowledgeScore(supabase, company_id) {
  const { data: todos, error } = await supabase
    .from('memoria_empresarial').select('estado, confianza, updated_at').eq('company_id', company_id).eq('activo', true);
  if (error) throw new Error(`kce.calcularKnowledgeScore: ${error.message}`);

  const filas = todos || [];
  const confirmados = filas.filter(f => f.estado === 'confirmado');
  const rechazados = filas.filter(f => f.estado === 'rechazado');
  const propuestos = filas.filter(f => f.estado === 'propuesto');

  const cantidad = confirmados.length === 0 ? 0 : Math.min(100, Math.round((Math.log10(confirmados.length + 1) / Math.log10(51)) * 100));
  const calidadEvidencia = confirmados.length === 0 ? 0 : Math.round(confirmados.reduce((s, f) => s + f.confianza, 0) / confirmados.length);

  const hace90 = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const actualizadosRecientes = confirmados.filter(f => new Date(f.updated_at).getTime() >= hace90).length;
  const frecuencia = confirmados.length === 0 ? 0 : Math.round((actualizadosRecientes / confirmados.length) * 100);

  const { count: contradiccionesPendientes, error: errCont } = await supabase
    .from('kce_alertas').select('id', { count: 'exact', head: true })
    .eq('company_id', company_id).eq('tipo', 'contradiccion').eq('estado', 'pendiente');
  if (errCont) throw new Error(`kce.calcularKnowledgeScore: ${errCont.message}`);
  const ausenciaContradicciones = Math.max(0, 100 - (contradiccionesPendientes || 0) * 20);

  const totalHistorico = confirmados.length + rechazados.length + propuestos.length;
  const estabilidad = totalHistorico === 0 ? 100 : Math.round((1 - rechazados.length / totalHistorico) * 100);

  const desglose = { cantidad, calidadEvidencia, frecuencia, ausenciaContradicciones, estabilidad, pesos: PESOS_KNOWLEDGE_SCORE };
  const score = Math.round(
    cantidad * PESOS_KNOWLEDGE_SCORE.cantidad +
    calidadEvidencia * PESOS_KNOWLEDGE_SCORE.calidadEvidencia +
    frecuencia * PESOS_KNOWLEDGE_SCORE.frecuencia +
    ausenciaContradicciones * PESOS_KNOWLEDGE_SCORE.ausenciaContradicciones +
    estabilidad * PESOS_KNOWLEDGE_SCORE.estabilidad
  );

  return { score, desglose };
}

module.exports = {
  ejecutarKCE, generarReporteTexto, listarAlertasPendientes,
  aplicarRefuerzo, fusionarAprendizajes, resolverAlerta,
  calcularKnowledgeScore,
  UMBRAL_DIAS_OBSOLESCENCIA, PESOS_KNOWLEDGE_SCORE,
};
