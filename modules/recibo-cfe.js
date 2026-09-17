/**
 * TARA Matrix™ — recibo-cfe.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracción estructurada de recibos de CFE (Alina, 2026-08-10) — cuando un
 * prospecto de paneles solares envía una foto o PDF de su recibo, TARA debe
 * usar esos datos en vez de volver a preguntarlos.
 *
 * Deliberadamente separado de modules/adjuntos-ia.js: ese módulo describe
 * CUALQUIER imagen en 1-3 oraciones genéricas para cualquier giro de
 * negocio (nunca extrae números). Este módulo es específico de paneles
 * solares — solo se invoca cuando hay una sesión activa del workflow
 * "Cotización directa — ingeniería solar" (trigger_value
 * 'solicitud_cotizacion'), igual que modules/cotizacion-adjuntos.js ya
 * verifica para asociar el archivo.
 *
 * Integración con lo existente, sin flujo paralelo: los datos extraídos se
 * guardan con WorkflowEngine.preSalvarDatosExtraidos() — el MISMO método
 * público que el Core (congelado, ADR-005) ya usa para auto-avanzar nodos
 * ya respondidos. No se reimplementa esa lógica; se reutiliza tal cual.
 *
 * @module modules/recibo-cfe
 */

'use strict';

const { WorkflowEngine } = require('./workflow-engine');

const MODELO_VISION_DEFAULT = 'gpt-4o-mini';
const MODELO_TEXTO_DEFAULT = 'gpt-4o-mini';
const MIN_CARACTERES_PDF_LEGIBLE = 30; // PDF escaneado (solo imagen, sin texto real) da un string casi vacío

const SYSTEM_PROMPT = [
  'Eres un extractor de datos de recibos de CFE (Comisión Federal de Electricidad, México).',
  'Te muestro un documento que un prospecto de paneles solares envió por WhatsApp.',
  '',
  'Primero determina si es realmente un recibo de CFE. Si NO lo es, o no puedes leerlo con',
  'claridad suficiente, responde con "es_recibo_cfe": false y el resto de los campos en null.',
  '',
  'Si SÍ es un recibo de CFE, extrae ÚNICAMENTE lo que esté impreso con claridad — nunca',
  'inventes, nunca calcules ni asumas un valor que no esté explícito en el documento.',
  '',
  'Responde ÚNICAMENTE JSON, sin texto antes ni después, con esta forma exacta:',
  '{',
  '  "es_recibo_cfe": true o false,',
  '  "importe_total": número (el total a pagar) o null,',
  '  "consumo_kwh": número (el consumo del periodo facturado, en kWh) o null,',
  '  "periodo_inicio": "YYYY-MM-DD" o null,',
  '  "periodo_fin": "YYYY-MM-DD" o null,',
  '  "tarifa": "código de tarifa tal cual aparece impreso (ej. \'1\', \'1A\', \'PDBT\')" o null,',
  '  "consumo_historico_kwh": [números por periodo anterior, MÁS RECIENTE PRIMERO] o null',
  '}',
  'Si el recibo no muestra una gráfica o tabla de consumo histórico, "consumo_historico_kwh" debe ser null — nunca lo inventes a partir de un solo periodo.',
].join('\n');

function _parsearJsonSeguro(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return { es_recibo_cfe: false };
  }
}

async function _extraerViaVision(openaiClient, buffer, mimeType, modelo) {
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`;

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 500,
  });

  return _parsearJsonSeguro(respuesta.choices?.[0]?.message?.content || '');
}

async function _extraerViaTextoPDF(openaiClient, buffer, modelo) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let texto = '';
  try {
    const resultado = await parser.getText();
    texto = (resultado.text || '').trim();
  } finally {
    await parser.destroy();
  }

  // PDF escaneado (imagen sin capa de texto) — no hay nada que leer aquí.
  // No se intenta OCR; se marca como no legible y el caller pide una foto.
  if (texto.length < MIN_CARACTERES_PDF_LEGIBLE) {
    return { es_recibo_cfe: false, _motivo: 'pdf_sin_texto_legible' };
  }

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: texto },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 500,
  });

  return _parsearJsonSeguro(respuesta.choices?.[0]?.message?.content || '');
}

/**
 * Extrae los datos crudos de un recibo de CFE — por visión si es imagen,
 * leyendo el texto si es un PDF con capa de texto real. Nunca lanza por un
 * documento no legible o que no sea un recibo — devuelve
 * `{ es_recibo_cfe: false }` en ese caso (el caller decide qué hacer).
 *
 * @param {import('openai').OpenAI} openaiClient
 * @param {Object} datos
 * @param {Buffer} datos.buffer
 * @param {string} [datos.mimeType]
 * @param {string} [datos.modelo]
 * @returns {Promise<Object>} forma cruda del SYSTEM_PROMPT — ver arriba
 */
async function extraerDatosReciboCFE(openaiClient, { buffer, mimeType, modelo }) {
  const familia = (mimeType || '').split('/')[0];

  if (familia === 'image') {
    return _extraerViaVision(openaiClient, buffer, mimeType, modelo || MODELO_VISION_DEFAULT);
  }
  if (mimeType === 'application/pdf') {
    return _extraerViaTextoPDF(openaiClient, buffer, modelo || MODELO_TEXTO_DEFAULT);
  }
  return { es_recibo_cfe: false, _motivo: 'tipo_de_archivo_no_soportado' };
}

function _diasEntrePeriodo(inicio, fin) {
  if (!inicio || !fin) return null;
  const dIni = new Date(inicio);
  const dFin = new Date(fin);
  if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFin.getTime())) return null;
  const dias = (dFin - dIni) / (1000 * 60 * 60 * 24);
  return dias > 0 ? dias : null;
}

/**
 * Normaliza los datos crudos del recibo a lo que espera el motor —
 * `mapearCapturedFieldsAInfoTecnica()` (modules/cotizaciones.js) espera
 * valores MENSUALES, y el recibo casi siempre es bimestral. Se usa el
 * periodo real facturado (periodo_inicio/fin) para calcular el factor
 * exacto a mensual — nunca se asume "÷ 2" a ciegas (decisión explícita de
 * Alina, 2026-08-10).
 *
 * `importePromedioRecibo` se normaliza con EL MISMO factor que el consumo
 * — si no, el costo efectivo por kWh que usa calcularAhorro()
 * (importeRecibo / consumoFacturadoKwh) saldría duplicado, porque
 * consumoFacturadoKwh ya viene mensualizado y el importe se quedaría
 * bimestral sin querer.
 *
 * @param {Object} datosCrudos - forma de extraerDatosReciboCFE()
 * @returns {{esRecibo: boolean, consumoMensualKwh: number|null, importePromedioRecibo: number|null, tarifa: string|null, periodoDias: number|null, historialConsumoKwh: number[]|null}}
 */
function normalizarDatosRecibo(datosCrudos = {}) {
  if (!datosCrudos.es_recibo_cfe) {
    return { esRecibo: false, consumoMensualKwh: null, importePromedioRecibo: null, tarifa: null, periodoDias: null, historialConsumoKwh: null };
  }

  const periodoDias = _diasEntrePeriodo(datosCrudos.periodo_inicio, datosCrudos.periodo_fin);
  const factorAMensual = periodoDias ? 30 / periodoDias : null;

  const consumoMensualKwh = (datosCrudos.consumo_kwh != null && factorAMensual != null)
    ? Math.round(datosCrudos.consumo_kwh * factorAMensual)
    : null;
  const importePromedioRecibo = (datosCrudos.importe_total != null && factorAMensual != null)
    ? Math.round(datosCrudos.importe_total * factorAMensual * 100) / 100
    : null;

  // El recibo típicamente muestra bimestres (2 meses c/u) — se expande a
  // mensual (÷2, duplicado) para que el motor pueda usar el método más
  // preciso (historial_12_meses) en vez de la estimación simple
  // (mensual × 12) — ver calcularConsumoAnual() en el motor. Con menos de
  // 6 periodos reales no se arma el arreglo — mejor no usarlo que rellenar
  // con valores repetidos o inventados.
  let historialConsumoKwh = null;
  const historico = Array.isArray(datosCrudos.consumo_historico_kwh)
    ? datosCrudos.consumo_historico_kwh.filter(v => typeof v === 'number' && Number.isFinite(v))
    : [];
  if (historico.length >= 6) {
    historialConsumoKwh = historico.slice(0, 6).flatMap(bimestral => [bimestral / 2, bimestral / 2]);
  }

  return {
    esRecibo: true,
    consumoMensualKwh,
    importePromedioRecibo,
    tarifa: datosCrudos.tarifa || null,
    periodoDias,
    historialConsumoKwh,
  };
}

/**
 * Orquestador — se llama desde server.js cuando llega un adjunto (imagen o
 * PDF) y hay chance de que sea un recibo de CFE. Solo actúa si el cliente
 * tiene una sesión ACTIVA del workflow "Cotización directa — ingeniería
 * solar" (trigger_value 'solicitud_cotizacion') — mismo guard que ya usa
 * modules/cotizacion-adjuntos.js::asociarSiHaySesionDeCotizacionActiva,
 * para no procesar recibos fuera de ese flujo (ej. durante "Calificación +
 * visita técnica", que no usa estos campos).
 *
 * Guarda los datos con WorkflowEngine.preSalvarDatosExtraidos() — nunca
 * pisa un valor que el cliente ya haya confirmado por conversación (ese
 * método ya protege eso). Nunca lanza — un recibo no reconocible degrada a
 * `{ aplico: false }` y el flujo normal de adjuntos-ia.js sigue su curso.
 *
 * @param {import('openai').OpenAI} openaiClient
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {Buffer} datos.buffer
 * @param {string} datos.mimeType
 * @param {string} datos.companyId
 * @param {number} datos.clienteId
 * @returns {Promise<{aplico: boolean, motivo?: string, camposGuardados?: string[], datos?: Object}>}
 */
async function procesarReciboCFE(openaiClient, supabase, { buffer, mimeType, companyId, clienteId }) {
  if (!companyId || !clienteId) return { aplico: false, motivo: 'faltan_datos_de_contexto' };

  const { data: sesion } = await supabase
    .from('workflow_sessions')
    .select('id, workflow_id')
    .eq('company_id', companyId)
    .eq('cliente_id', clienteId)
    .eq('status', 'activo')
    .maybeSingle();

  if (!sesion) return { aplico: false, motivo: 'sin_sesion_activa' };

  const { data: workflow } = await supabase
    .from('workflows')
    .select('trigger_value')
    .eq('id', sesion.workflow_id)
    .maybeSingle();

  if (workflow?.trigger_value !== 'solicitud_cotizacion') {
    return { aplico: false, motivo: 'workflow_activo_no_es_cotizacion_directa' };
  }

  const datosCrudos = await extraerDatosReciboCFE(openaiClient, { buffer, mimeType });
  if (!datosCrudos.es_recibo_cfe) {
    return { aplico: false, motivo: datosCrudos._motivo || 'no_es_recibo_cfe_o_no_legible' };
  }

  const normalizado = normalizarDatosRecibo(datosCrudos);

  const paraGuardar = {};
  if (normalizado.consumoMensualKwh != null) paraGuardar.consumo_mensual_kwh = normalizado.consumoMensualKwh;
  if (normalizado.importePromedioRecibo != null) paraGuardar.importe_promedio_recibo = normalizado.importePromedioRecibo;
  if (normalizado.historialConsumoKwh != null) paraGuardar.historial_consumo_kwh = normalizado.historialConsumoKwh;

  if (Object.keys(paraGuardar).length === 0) {
    return { aplico: false, motivo: 'recibo_reconocido_pero_sin_datos_suficientemente_claros' };
  }

  const workflowEngine = new WorkflowEngine(supabase);
  await workflowEngine.preSalvarDatosExtraidos(sesion.id, paraGuardar);

  return { aplico: true, camposGuardados: Object.keys(paraGuardar), datos: normalizado };
}

module.exports = {
  extraerDatosReciboCFE,
  normalizarDatosRecibo,
  procesarReciboCFE,
  SYSTEM_PROMPT,
};
