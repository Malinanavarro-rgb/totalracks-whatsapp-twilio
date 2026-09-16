/**
 * TARA Matrix™ — documentos-proveedor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Especialista Solar, Fase 6 — Ingesta de documentos de proveedor (Alina,
 * 2026-09-16): el equipo sube un PDF/imagen de ficha técnica real desde el
 * panel; TARA propone un borrador de specs vía IA — mismo patrón
 * anti-alucinación que modules/recibo-cfe.js ("nunca inventes, si no está
 * claro devuelve null"). El borrador NUNCA se auto-publica: queda en
 * `datos_extraidos` hasta que un humano lo confirme y, si aplica, lo
 * enlace a un producto real (confirmarDocumento). El archivo real vive en
 * Storage (bucket privado) — `archivo_url` guarda solo el path, nunca una
 * URL, mismo criterio que modules/inbox-adjuntos.js.
 *
 * Alcance de esta fase: PDF/imagen de ficha técnica únicamente — ingesta de
 * Excel/listas de precios queda fuera (parseo distinto, fase futura).
 *
 * @module modules/documentos-proveedor
 */

'use strict';

const { randomUUID } = require('crypto');

const BUCKET = 'documentos-proveedor';
const MODELO_VISION_DEFAULT = 'gpt-4o-mini';
const MODELO_TEXTO_DEFAULT = 'gpt-4o-mini';
const MIN_CARACTERES_PDF_LEGIBLE = 30; // mismo umbral que recibo-cfe.js — PDF escaneado sin capa de texto

const EXTENSIONES_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const SYSTEM_PROMPT = [
  'Eres un extractor de fichas técnicas de equipo de energía solar (paneles, inversores,',
  'microinversores, baterías, estructuras) para un proveedor mexicano.',
  '',
  'Te muestro un documento (ficha técnica en PDF o foto) que el equipo comercial subió.',
  '',
  'Primero determina si es realmente una ficha técnica de un equipo solar. Si NO lo es, o no',
  'puedes leerlo con claridad suficiente, responde "es_ficha_tecnica": false y el resto en null.',
  '',
  'Si SÍ es una ficha técnica, extrae ÚNICAMENTE lo que esté impreso con claridad — nunca',
  'inventes, nunca calcules ni asumas un valor que no esté explícito en el documento. Si un dato',
  'no aparece, su campo debe ir null — un campo faltante es preferible a uno adivinado.',
  '',
  'Responde ÚNICAMENTE JSON, sin texto antes ni después, con esta forma exacta:',
  '{',
  '  "es_ficha_tecnica": true o false,',
  '  "marca": "tal cual aparece impreso" o null,',
  '  "modelo": "tal cual aparece impreso" o null,',
  '  "tipo": "panel_solar" | "inversor" | "microinversor" | "bateria" | "estructura" | "cable" | null,',
  '  "specs": { ...pares clave-valor de especificaciones eléctricas/físicas explícitas, con las',
  '    unidades tal cual aparecen impresas (ej. "potencia_w": 550, "voltaje_max_entrada_v": 600) },',
  '  "garantia": "texto de garantía tal cual aparece" o null',
  '}',
].join('\n');

function extensionDeMime(mimeType) {
  if (EXTENSIONES_POR_MIME[mimeType]) return EXTENSIONES_POR_MIME[mimeType];
  const subtipo = (mimeType || '').split('/')[1] || 'bin';
  return subtipo.split(';')[0];
}

function _parsearJsonSeguro(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return { es_ficha_tecnica: false };
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
    max_tokens: 800,
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

  if (texto.length < MIN_CARACTERES_PDF_LEGIBLE) {
    return { es_ficha_tecnica: false, _motivo: 'pdf_sin_texto_legible' };
  }

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: texto },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 800,
  });

  return _parsearJsonSeguro(respuesta.choices?.[0]?.message?.content || '');
}

/**
 * Extrae los datos crudos de una ficha técnica — por visión si es imagen,
 * leyendo el texto si es un PDF con capa de texto real. Nunca lanza por un
 * documento no legible o que no sea una ficha técnica.
 *
 * @param {import('openai').OpenAI} openaiClient
 * @param {{buffer: Buffer, mimeType?: string, modelo?: string}} datos
 * @returns {Promise<Object>} forma cruda del SYSTEM_PROMPT
 */
async function extraerFichaTecnica(openaiClient, { buffer, mimeType, modelo }) {
  const familia = (mimeType || '').split('/')[0];

  if (familia === 'image') {
    return _extraerViaVision(openaiClient, buffer, mimeType, modelo || MODELO_VISION_DEFAULT);
  }
  if (mimeType === 'application/pdf') {
    return _extraerViaTextoPDF(openaiClient, buffer, modelo || MODELO_TEXTO_DEFAULT);
  }
  return { es_ficha_tecnica: false, _motivo: 'tipo_de_archivo_no_soportado' };
}

/**
 * Sube el binario al bucket privado y crea la fila en `documentos_proveedor`
 * — sin extraer todavía (eso es procesarDocumento, un paso aparte para que
 * la subida nunca espere a una llamada de IA).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - service_role (bucket privado)
 * @returns {Promise<Object>} la fila creada
 */
async function subirDocumento(supabase, { company_id, proveedor, tipo_documento, buffer, mimeType, nombre_archivo, subido_por }) {
  if (!company_id) throw new Error('documentos-proveedor.subirDocumento: company_id requerido');
  if (!buffer?.length) throw new Error('documentos-proveedor.subirDocumento: archivo vacío o faltante');

  const path = `${company_id}/${randomUUID()}.${extensionDeMime(mimeType)}`;

  const { error: errorSubida } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (errorSubida) throw new Error(`documentos-proveedor.subirDocumento: ${errorSubida.message}`);

  const { data, error } = await supabase.from('documentos_proveedor').insert({
    company_id, proveedor: proveedor || null, tipo_documento: tipo_documento || 'ficha_tecnica',
    archivo_url: path, nombre_archivo: nombre_archivo || null, subido_por: subido_por || null,
  }).select().single();
  if (error) throw new Error(`documentos-proveedor.subirDocumento: ${error.message}`);

  return data;
}

/**
 * Corre la extracción sobre un documento ya subido y guarda el borrador en
 * `datos_extraidos` + `procesado_en` — nunca toca `productos`.
 *
 * @returns {Promise<Object>} la fila actualizada
 */
async function procesarDocumento(openaiClient, supabase, companyId, documentoId) {
  const { data: documento, error: errorDoc } = await supabase
    .from('documentos_proveedor').select('*').eq('id', documentoId).eq('company_id', companyId).maybeSingle();
  if (errorDoc) throw new Error(`documentos-proveedor.procesarDocumento: ${errorDoc.message}`);
  if (!documento) throw new Error('documentos-proveedor.procesarDocumento: documento no encontrado');

  const { data: archivo, error: errorDescarga } = await supabase.storage.from(BUCKET).download(documento.archivo_url);
  if (errorDescarga) throw new Error(`documentos-proveedor.procesarDocumento: ${errorDescarga.message}`);

  const buffer = Buffer.from(await archivo.arrayBuffer());
  const mimeType = archivo.type || undefined;
  const datosExtraidos = await extraerFichaTecnica(openaiClient, { buffer, mimeType });

  const { data, error } = await supabase.from('documentos_proveedor')
    .update({ datos_extraidos: datosExtraidos, procesado_en: new Date().toISOString() })
    .eq('id', documentoId).eq('company_id', companyId).select().maybeSingle();
  if (error) throw new Error(`documentos-proveedor.procesarDocumento: ${error.message}`);

  return data;
}

async function listarDocumentos(supabase, companyId, filtros = {}) {
  let query = supabase.from('documentos_proveedor').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (filtros.tipo_documento) query = query.eq('tipo_documento', filtros.tipo_documento);
  if (filtros.sin_confirmar) query = query.is('confirmado_en', null);

  const { data, error } = await query;
  if (error) throw new Error(`documentos-proveedor.listarDocumentos: ${error.message}`);
  return data || [];
}

/**
 * Confirma un documento ya procesado — marca `confirmado_por`/`confirmado_en`
 * y, si se da `producto_id`, MEZCLA las specs extraídas hacia ese producto
 * real (mismo criterio anti-regresión que scripts/nort-energy-catalogo-soles.js:
 * las specs ya existentes del producto siempre ganan sobre las nuevas, y
 * `ficha_tecnica_completa` nunca baja de true a false — solo sube a true si
 * el humano lo marca explícitamente con `esFichaCompleta`).
 *
 * @returns {Promise<Object>} la fila de documentos_proveedor actualizada
 */
async function confirmarDocumento(supabase, companyId, documentoId, { producto_id, usuario_id, esFichaCompleta = false } = {}) {
  const { data: documento, error: errorDoc } = await supabase
    .from('documentos_proveedor').select('*').eq('id', documentoId).eq('company_id', companyId).maybeSingle();
  if (errorDoc) throw new Error(`documentos-proveedor.confirmarDocumento: ${errorDoc.message}`);
  if (!documento) throw new Error('documentos-proveedor.confirmarDocumento: documento no encontrado');
  if (!documento.datos_extraidos) throw new Error('documentos-proveedor.confirmarDocumento: este documento todavía no ha sido procesado');

  if (producto_id) {
    const { data: producto, error: errorProducto } = await supabase
      .from('productos').select('*').eq('id', producto_id).eq('company_id', companyId).maybeSingle();
    if (errorProducto) throw new Error(`documentos-proveedor.confirmarDocumento: ${errorProducto.message}`);
    if (!producto) throw new Error('documentos-proveedor.confirmarDocumento: producto no encontrado');

    const specsNuevas = documento.datos_extraidos.specs || {};
    const cambios = {
      specs: { ...specsNuevas, ...(producto.specs || {}) }, // producto ya existente gana
      ficha_tecnica_completa: producto.ficha_tecnica_completa || esFichaCompleta,
    };
    const { error: errorUpdate } = await supabase.from('productos').update(cambios).eq('id', producto_id);
    if (errorUpdate) throw new Error(`documentos-proveedor.confirmarDocumento: ${errorUpdate.message}`);
  }

  const { data, error } = await supabase.from('documentos_proveedor')
    .update({ confirmado_por: usuario_id || null, confirmado_en: new Date().toISOString(), producto_id: producto_id || documento.producto_id || null })
    .eq('id', documentoId).eq('company_id', companyId).select().maybeSingle();
  if (error) throw new Error(`documentos-proveedor.confirmarDocumento: ${error.message}`);

  return data;
}

async function generarUrlFirmadaDocumento(supabase, path, segundos = 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
  if (error) throw new Error(`documentos-proveedor.generarUrlFirmadaDocumento: ${error.message}`);
  return data.signedUrl;
}

module.exports = {
  BUCKET,
  extensionDeMime,
  extraerFichaTecnica,
  subirDocumento,
  procesarDocumento,
  listarDocumentos,
  confirmarDocumento,
  generarUrlFirmadaDocumento,
  SYSTEM_PROMPT,
};
