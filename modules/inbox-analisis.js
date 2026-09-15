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
const { resumenParaCliente } = require('./business-memory-core');

const MODELO_DEFAULT = 'gpt-4o-mini';
const DEBOUNCE_MS_DEFAULT = 60 * 1000;

const SYSTEM_PROMPT = [
  'Eres el Motor de Decisiones de TARA — analizas una conversación completa de un negocio con un cliente',
  'y piensas como lo haría el mejor gerente comercial de ese negocio: qué está pasando, qué tan urgente es,',
  'y qué debería hacer el equipo humano a continuación. También eres el coach del asesor que atendió (o está',
  'atendiendo) esta conversación — evalúas su desempeño como lo haría un gerente comercial experimentado',
  'dando retroalimentación directa y útil, nunca genérica.',
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
  ' "tareas_sugeridas": ["tarea breve", ...] (vacío si no hace falta ninguna),',
  ' "aciertos_asesor": ["qué hizo bien el asesor humano en esta conversación", ...] (vacío si el asesor',
  '   todavía no ha participado o no hay nada real que destacar — nunca inventes un acierto para rellenar),',
  ' "errores_asesor": ["qué hizo mal o pudo hacer mejor: preguntas innecesarias o repetidas, datos que no',
  '   recolectó, promesas sin confirmar, tono, lentitud, etc.", ...] (vacío si no hay ninguno real),',
  ' "respuesta_recomendada": "el siguiente mensaje que el asesor debería enviar ahora, listo para copiar y',
  '   pegar tal cual — null si la conversación ya está cerrada/resuelta y no aplica un siguiente mensaje"}',
  'Si la conversación es demasiado corta para saber algo con certeza, dilo con honestidad dentro de',
  '"resumen" en vez de inventar — probabilidad_compra puede ser baja y riesgos/recomendaciones/aciertos_asesor/',
  'errores_asesor pueden ir vacíos y respuesta_recomendada puede ir null.',
].join(' ');

function _armarContexto({ hilo, cliente, historial, citas, oportunidades, memoriaEmpresarial }) {
  const partes = [
    `Canal: ${hilo?.canal || 'desconocido'} — Estado del hilo: ${hilo?.estado || 'abierta'} — Prioridad actual: ${hilo?.prioridad || 'normal'}`,
    `Cliente: ${cliente?.nombre || 'Sin nombre'}${cliente?.empresa ? ` (${cliente.empresa})` : ''} — Etapa: ${cliente?.estado || 'Nuevo'}`,
    oportunidades?.length
      ? `Oportunidades registradas: ${oportunidades.map(o => `${o.estado}${o.presupuesto_confirmado ? ` ($${o.presupuesto_confirmado})` : ''}`).join(', ')}`
      : 'Sin oportunidades registradas todavía.',
    citas?.length ? `Citas: ${citas.map(c => `${c.estado} (${c.inicio})`).join(', ')}` : null,
    // Business Memory Core (BMC) — solo aprendizajes ya CONFIRMADOS por un
    // humano (nunca propuestas pendientes); es contexto de negocio permanente,
    // no de esta sola conversación. Cada línea trae su % de confianza para
    // que el análisis pese distinto un hecho al 95% que uno al 60%.
    memoriaEmpresarial ? `Memoria empresarial confirmada:\n${memoriaEmpresarial}` : null,
    `Conversación completa:\n${
      historial?.length
        ? historial.map(m => `${m.de === 'cliente' ? 'Cliente' : 'Negocio'}: ${m.texto}`).join('\n')
        : '(sin mensajes todavía)'
    }`,
  ];
  return partes.filter(Boolean).join('\n\n');
}

async function _llamarIAyNormalizar(openaiClient, contexto, modelo) {
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

  return _normalizar(analisisCrudo);
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
    aciertos_asesor:     Array.isArray(analisis?.aciertos_asesor) ? analisis.aciertos_asesor.filter(a => typeof a === 'string') : [],
    errores_asesor:      Array.isArray(analisis?.errores_asesor) ? analisis.errores_asesor.filter(e => typeof e === 'string') : [],
    respuesta_recomendada: typeof analisis?.respuesta_recomendada === 'string' ? analisis.respuesta_recomendada : null,
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
  const [historial, ficha, memoriaEmpresarial] = await Promise.all([
    obtenerHistorial(supabase, company_id, cliente_id),
    obtenerFichaCliente(supabase, company_id, cliente_id).catch(() => null),
    resumenParaCliente(supabase, company_id, cliente_id).catch(() => ''),
  ]);

  const contexto = _armarContexto({
    hilo, cliente: ficha?.cliente, historial, citas: ficha?.citas, oportunidades: ficha?.oportunidades, memoriaEmpresarial,
  });

  const analisis = await _llamarIAyNormalizar(openaiClient, contexto, modelo);

  const { error } = await supabase.from('analisis_hilo').upsert(
    { hilo_id, ...analisis, generado_at: new Date().toISOString() },
    { onConflict: 'hilo_id' }
  );
  if (error) throw new Error(`inbox-analisis.analizarHilo: ${error.message}`);

  return analisis;
}

function _armarContextoDesdeTexto({ texto, notaEquipo }) {
  const partes = [
    'Conversación pegada manualmente por el equipo — no proviene de un hilo real de hilos/mensajes,',
    'así que no hay ficha de cliente, citas ni oportunidades del CRM disponibles: analiza únicamente',
    'con lo que aparece en el texto.',
    notaEquipo ? `Contexto adicional dado por quien pegó la conversación: ${notaEquipo}` : null,
    `Conversación completa:\n${texto}`,
  ];
  return partes.filter(Boolean).join('\n\n');
}

/**
 * Variante de `analizarHilo` para una conversación pegada manualmente (no
 * ligada a un hilo real en `hilos`/`mensajes`) — mismo prompt, mismo motor,
 * sin lookups de CRM y sin persistir en `analisis_hilo` (no hay `hilo_id`
 * real al que asociar el resultado; el llamador decide qué hacer con él).
 *
 * @param {Object} opciones
 * @param {{chat: {completions: {create: Function}}}} opciones.openaiClient
 * @param {string} opciones.texto - la conversación pegada, tal cual
 * @param {string} [opciones.notaEquipo] - contexto adicional opcional (p.ej. "es un cliente de Nort Energy interesado en 6kW")
 * @param {string} [opciones.modelo]
 * @returns {Promise<Object>} el análisis normalizado (mismo shape que analizarHilo, sin persistir)
 */
async function analizarConversacionPegada({ openaiClient, texto, notaEquipo, modelo = MODELO_DEFAULT }) {
  if (!texto || !texto.trim()) throw new Error('inbox-analisis.analizarConversacionPegada: texto requerido');

  const contexto = _armarContextoDesdeTexto({ texto, notaEquipo });

  return _llamarIAyNormalizar(openaiClient, contexto, modelo);
}

// ── "Ayúdame a cerrar" — Sales Coach con foco en una oportunidad del CRM ────

// Etiquetas de los campos de calificación solar (migración 103) — genérico a
// propósito: en una empresa no-solar todos estos vienen null y se omiten,
// mismo criterio que oportunidades.tipo_rack conviviendo con otras industrias.
const _ETIQUETAS_CAMPOS_OPORTUNIDAD = [
  ['tipo_propiedad', 'Tipo de propiedad'],
  ['ciudad', 'Ciudad'],
  ['colonia', 'Colonia'],
  ['direccion', 'Dirección'],
  ['propiedad_propia', 'Propiedad propia'],
  ['consumo_mensual_kwh', 'Consumo mensual (kWh)'],
  ['importe_promedio_recibo', 'Importe promedio del recibo'],
  ['tarifa_cfe', 'Tarifa CFE'],
  ['tipo_alimentacion', 'Tipo de alimentación'],
  ['voltaje_sitio', 'Voltaje del sitio'],
  ['pct_cobertura_deseado', '% de cobertura deseado'],
  ['paneles_estimados', 'Paneles estimados'],
  ['kwp_estimado', 'kWp estimado'],
  ['fecha_visita', 'Fecha de visita'],
  ['estado_visita', 'Estado de la visita'],
  ['siguiente_accion', 'Siguiente acción registrada'],
];

function _formatearOportunidadParaCierre(oportunidad) {
  const base = [
    `Descripción: ${oportunidad.descripcion || oportunidad.tipo_rack || 'Sin descripción'}`,
    `Estado: ${oportunidad.estado || 'Nuevo'}`,
    oportunidad.presupuesto_estimado ? `Presupuesto estimado: $${oportunidad.presupuesto_estimado}` : null,
    oportunidad.presupuesto_confirmado ? `Presupuesto confirmado: $${oportunidad.presupuesto_confirmado}` : null,
    oportunidad.proxima_accion ? `Próxima acción ya registrada: ${oportunidad.proxima_accion}` : null,
  ];
  const detalle = _ETIQUETAS_CAMPOS_OPORTUNIDAD
    .filter(([campo]) => oportunidad[campo] !== null && oportunidad[campo] !== undefined && oportunidad[campo] !== '')
    .map(([campo, etiqueta]) => `${etiqueta}: ${oportunidad[campo]}`);
  return [...base.filter(Boolean), ...detalle].join('\n');
}

function _armarContextoCierre({ oportunidad, cliente, cotizaciones, historial, memoriaEmpresarial }) {
  const partes = [
    'El equipo pidió ayuda específicamente para CERRAR esta oportunidad — en "recomendaciones",',
    '"proxima_accion" y sobre todo "respuesta_recomendada", prioriza exactamente qué decir o hacer para',
    'avanzarla a la siguiente etapa o cerrarla ya, no un diagnóstico general de la cuenta.',
    `Cliente: ${cliente?.nombre || 'Sin nombre'}${cliente?.empresa ? ` (${cliente.empresa})` : ''}`,
    `Oportunidad a cerrar:\n${_formatearOportunidadParaCierre(oportunidad)}`,
    cotizaciones?.length
      ? `Cotizaciones de esta oportunidad: ${cotizaciones.map(c => `${c.estado}${c.total ? ` ($${c.total})` : ''}${c.folio ? ` — folio ${c.folio}` : ''}`).join(', ')}`
      : 'Sin cotizaciones formales todavía para esta oportunidad.',
    memoriaEmpresarial ? `Memoria empresarial confirmada:\n${memoriaEmpresarial}` : null,
    `Conversación con el cliente:\n${
      historial?.length
        ? historial.map(m => `${m.de === 'cliente' ? 'Cliente' : 'Negocio'}: ${m.texto}`).join('\n')
        : '(sin conversación registrada — analiza solo con los datos de la oportunidad)'
    }`,
  ];
  return partes.filter(Boolean).join('\n\n');
}

/**
 * Variante de Sales Coach con foco en una oportunidad específica del CRM —
 * mismo motor y schema de salida, pero el prompt le pide al modelo priorizar
 * "cómo cerrar esta venta" en vez de un diagnóstico general del hilo. No
 * persiste (igual criterio que `analizarConversacionPegada`): es una consulta
 * bajo demanda desde el botón "Ayúdame a cerrar", no un análisis recurrente.
 *
 * @param {Object} opciones
 * @param {import('@supabase/supabase-js').SupabaseClient} opciones.supabase
 * @param {{chat: {completions: {create: Function}}}} opciones.openaiClient
 * @param {string} opciones.company_id
 * @param {number|string} opciones.oportunidad_id
 * @param {string} [opciones.modelo]
 * @returns {Promise<Object>} el análisis normalizado (mismo shape que analizarHilo, sin persistir)
 */
async function analizarOportunidadParaCierre({ supabase, openaiClient, company_id, oportunidad_id, modelo = MODELO_DEFAULT }) {
  const { data: oportunidad, error: errorOportunidad } = await supabase
    .from('oportunidades').select('*').eq('id', oportunidad_id).eq('company_id', company_id).maybeSingle();
  if (errorOportunidad) throw new Error(`inbox-analisis.analizarOportunidadParaCierre: ${errorOportunidad.message}`);
  if (!oportunidad) throw new Error('inbox-analisis.analizarOportunidadParaCierre: oportunidad no encontrada');

  const [ficha, cotizacionesResultado, historial, memoriaEmpresarial] = await Promise.all([
    oportunidad.cliente_id ? obtenerFichaCliente(supabase, company_id, oportunidad.cliente_id).catch(() => null) : Promise.resolve(null),
    supabase.from('cotizaciones').select('*').eq('oportunidad_id', oportunidad_id),
    oportunidad.cliente_id ? obtenerHistorial(supabase, company_id, oportunidad.cliente_id) : Promise.resolve([]),
    oportunidad.cliente_id ? resumenParaCliente(supabase, company_id, oportunidad.cliente_id).catch(() => '') : Promise.resolve(''),
  ]);

  const contexto = _armarContextoCierre({
    oportunidad, cliente: ficha?.cliente, cotizaciones: cotizacionesResultado?.data, historial, memoriaEmpresarial,
  });

  return _llamarIAyNormalizar(openaiClient, contexto, modelo);
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

module.exports = {
  analizarHilo, analizarConversacionPegada, analizarOportunidadParaCierre,
  programarAnalisis, obtenerAnalisisHilo, SYSTEM_PROMPT, DEBOUNCE_MS_DEFAULT,
};
