/**
 * TARA Matrix™ — inbox-analisis.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inbox Inteligente (v0.4) — Zona 3: el Motor de Decisiones. Analiza un hilo
 * completo (historial + ficha del cliente) con una llamada de IA separada
 * del motor conversacional — mismo patrón ya probado por
 * asistente-consultas.js y Modo Operador (operador-engine.js): nunca toca
 * el Core congelado por ADR-005, nunca bloquea la respuesta en vivo al
 * cliente.
 *
 * Deliberadamente asíncrono y con debounce (programarAnalisis): correr esto
 * en cada mensaje individual de cada conversación de cada empresa
 * multiplicaría el costo de OpenAI sin necesidad — se agrupa la actividad
 * de un hilo y se analiza una sola vez después de un período de silencio.
 *
 * @module modules/inbox-analisis
 */

'use strict';

const { obtenerHistorial } = require('./conversaciones');
const { obtenerFichaCliente } = require('./crm-ui');

const MODELO_DEFAULT = 'gpt-4o-mini';
const DEBOUNCE_MS_DEFAULT = 60 * 1000;

const SYSTEM_PROMPT = [
  'Eres el Motor de Decisiones de TARA — analizas una conversación completa de un negocio con un cliente',
  'y piensas como lo haría el mejor gerente comercial de ese negocio: qué está pasando, qué tan urgente es,',
  'y qué debería hacer el equipo humano a continuación.',
  'Básate ÚNICAMENTE en la conversación y el contexto del cliente que se te da — nunca inventes datos,',
  'cifras, productos o promesas que no aparezcan explícitamente ahí.',
  'Responde SIEMPRE en este formato JSON exacto, sin texto fuera del JSON:',
  '{"resumen": "1-2 oraciones de qué quiere el cliente y en qué va",',
  ' "intencion": "una frase corta",',
  ' "sentimiento": "Positivo"|"Neutral"|"Negativo",',
  ' "probabilidad_compra": 0-100 (entero),',
  ' "urgencia": "baja"|"media"|"alta",',
  ' "riesgos": ["riesgo 1", ...] (vacío si no hay ninguno real),',
  ' "recomendaciones": ["recomendación breve y accionable", ...],',
  ' "proxima_accion": "la única acción más importante a seguir, en una frase",',
  ' "tareas_sugeridas": ["tarea breve", ...] (vacío si no hace falta ninguna)}',
  'Si la conversación es demasiado corta para saber algo con certeza, dilo con honestidad dentro de',
  '"resumen" en vez de inventar — probabilidad_compra puede ser baja y riesgos/recomendaciones pueden ir vacíos.',
].join(' ');

function _armarContexto({ hilo, cliente, historial, citas, oportunidades }) {
  const partes = [
    `Canal: ${hilo?.canal || 'desconocido'} — Estado del hilo: ${hilo?.estado || 'abierta'} — Prioridad actual: ${hilo?.prioridad || 'normal'}`,
    `Cliente: ${cliente?.nombre || 'Sin nombre'}${cliente?.empresa ? ` (${cliente.empresa})` : ''} — Etapa: ${cliente?.estado || 'Nuevo'}`,
    oportunidades?.length
      ? `Oportunidades registradas: ${oportunidades.map(o => `${o.estado}${o.presupuesto_confirmado ? ` ($${o.presupuesto_confirmado})` : ''}`).join(', ')}`
      : 'Sin oportunidades registradas todavía.',
    citas?.length ? `Citas: ${citas.map(c => `${c.estado} (${c.inicio})`).join(', ')}` : null,
    `Conversación completa:\n${
      historial?.length
        ? historial.map(m => `${m.de === 'cliente' ? 'Cliente' : 'Negocio'}: ${m.texto}`).join('\n')
        : '(sin mensajes todavía)'
    }`,
  ];
  return partes.filter(Boolean).join('\n\n');
}

function _normalizar(analisis) {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
  return {
    resumen:             typeof analisis?.resumen === 'string' ? analisis.resumen : null,
    intencion:           typeof analisis?.intencion === 'string' ? analisis.intencion : null,
    sentimiento:         ['Positivo', 'Neutral', 'Negativo'].includes(analisis?.sentimiento) ? analisis.sentimiento : 'Neutral',
    probabilidad_compra: clamp(Math.round(analisis?.probabilidad_compra), 0, 100),
    urgencia:            ['baja', 'media', 'alta'].includes(analisis?.urgencia) ? analisis.urgencia : 'baja',
    riesgos:             Array.isArray(analisis?.riesgos) ? analisis.riesgos.filter(r => typeof r === 'string') : [],
    recomendaciones:     Array.isArray(analisis?.recomendaciones) ? analisis.recomendaciones.filter(r => typeof r === 'string') : [],
    proxima_accion:      typeof analisis?.proxima_accion === 'string' ? analisis.proxima_accion : null,
    tareas_sugeridas:     Array.isArray(analisis?.tareas_sugeridas) ? analisis.tareas_sugeridas.filter(t => typeof t === 'string') : [],
  };
}

/**
 * Analiza un hilo completo y guarda (upsert) el resultado en `analisis_hilo`.
 *
 * @param {Object} opciones
 * @param {import('@supabase/supabase-js').SupabaseClient} opciones.supabase
 * @param {{chat: {completions: {create: Function}}}} opciones.openaiClient - inyectado, no importado directo (testeable sin mocks de módulo)
 * @param {string} opciones.company_id
 * @param {string} opciones.hilo_id
 * @param {number|string} opciones.cliente_id
 * @param {Object} [opciones.hilo] - fila de hilos ya cargada, para no volver a consultarla
 * @param {string} [opciones.modelo]
 * @returns {Promise<Object>} el análisis normalizado guardado
 */
async function analizarHilo({ supabase, openaiClient, company_id, hilo_id, cliente_id, hilo, modelo = MODELO_DEFAULT }) {
  const [historial, ficha] = await Promise.all([
    obtenerHistorial(supabase, company_id, cliente_id),
    obtenerFichaCliente(supabase, company_id, cliente_id).catch(() => null),
  ]);

  const contexto = _armarContexto({
    hilo, cliente: ficha?.cliente, historial, citas: ficha?.citas, oportunidades: ficha?.oportunidades,
  });

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contexto },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  let analisisCrudo = {};
  try { analisisCrudo = JSON.parse(respuesta.choices[0].message.content); } catch { /* queda con defaults */ }

  const analisis = _normalizar(analisisCrudo);

  const { error } = await supabase.from('analisis_hilo').upsert(
    { hilo_id, ...analisis, generado_at: new Date().toISOString() },
    { onConflict: 'hilo_id' }
  );
  if (error) throw new Error(`inbox-analisis.analizarHilo: ${error.message}`);

  return analisis;
}

// ── Debounce (en memoria, un solo proceso — igual criterio que enqueueForPhone en server.js) ──

const _timersPorHilo = new Map();

/**
 * Programa (o reprograma, si ya había una pendiente) el análisis de un hilo
 * tras `debounceMs` de silencio — evita correr una llamada de IA por cada
 * mensaje individual.
 *
 * @param {string} hiloId
 * @param {() => Promise<void>} ejecutar
 * @param {number} [debounceMs]
 */
function programarAnalisis(hiloId, ejecutar, debounceMs = DEBOUNCE_MS_DEFAULT) {
  if (_timersPorHilo.has(hiloId)) clearTimeout(_timersPorHilo.get(hiloId));

  const timer = setTimeout(() => {
    _timersPorHilo.delete(hiloId);
    ejecutar().catch(e => console.error(`inbox-analisis: error analizando hilo ${hiloId}:`, e.message));
  }, debounceMs);

  // No debe mantener el proceso vivo solo por este timer (irrelevante en
  // Render, pero correcto para scripts/tests que corren y terminan).
  if (typeof timer.unref === 'function') timer.unref();

  _timersPorHilo.set(hiloId, timer);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} hilo_id
 * @returns {Promise<Object|null>} null si todavía no se ha analizado este hilo
 */
async function obtenerAnalisisHilo(supabase, hilo_id) {
  const { data, error } = await supabase.from('analisis_hilo').select('*').eq('hilo_id', hilo_id).maybeSingle();
  if (error) throw new Error(`inbox-analisis.obtenerAnalisisHilo: ${error.message}`);
  return data;
}

module.exports = { analizarHilo, programarAnalisis, obtenerAnalisisHilo, SYSTEM_PROMPT, DEBOUNCE_MS_DEFAULT };
