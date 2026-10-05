/**
 * TARA Matrix™ — adjuntos-ia.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inbox Inteligente (v0.4+) — comprensión real de adjuntos: transcribe audio
 * (Whisper) y describe imágenes (visión de GPT-4o-mini) para que TARA deje de
 * responder con el placeholder genérico ("no puedo escuchar/ver esto") y en
 * vez de eso entienda de verdad lo que la clienta envió.
 *
 * Deliberadamente vive en la capa de plataforma, NO en el Core: el resultado
 * de este módulo sustituye `message.content` ANTES de llamar a
 * orchestrator.procesarMensaje() (server.js) — el Core sigue recibiendo texto
 * plano como si la clienta lo hubiera escrito, cero cambios a
 * ContextBuilder/PromptBuilder/AIEngine (ADR-005, Constitución Art. 15).
 *
 * @module modules/adjuntos-ia
 */

'use strict';

const { toFile } = require('openai');

const MODELO_TRANSCRIPCION_DEFAULT = 'whisper-1';
const MODELO_VISION_DEFAULT = 'gpt-4o-mini';
const MODELO_DOCUMENTO_DEFAULT = 'gpt-4o-mini';
// Mismo umbral que modules/recibo-cfe.js y modules/documentos-proveedor.js —
// por debajo de esto, el PDF es casi con certeza un escaneo sin capa de
// texto real (pdf-parse no hace OCR). Alcance de esta fase: PDF únicamente
// — Word/Excel quedan fuera, mismo criterio que documentos-proveedor.js.
const MIN_CARACTERES_PDF_LEGIBLE = 30;

const PROMPT_VISION = [
  'Eres los ojos de un asistente de negocio por WhatsApp — un cliente acaba de enviar esta imagen.',
  'Describe en 1-3 oraciones, en español, qué se ve y por qué podría importarle al negocio',
  '(ej. una prenda, un comprobante de pago, una dirección o mapa, una captura de pantalla, una referencia de diseño o color).',
  'Sé concreto y útil para que un asesor humano o una IA de ventas puedan responder bien — nunca inventes detalles que no se vean con claridad.',
].join(' ');

const PROMPT_DOCUMENTO = [
  'Eres los ojos de un asistente de negocio por WhatsApp — un cliente acaba de enviar un documento PDF.',
  'Te paso el texto ya extraído del documento (no la imagen). Resume en 1-3 oraciones, en español, de qué',
  'trata y por qué podría importarle al negocio (ej. un contrato, una identificación, una factura, un comprobante,',
  'una ficha técnica, una cotización de otro proveedor). Sé concreto y útil para que un asesor humano o una IA',
  'de ventas puedan responder bien — nunca inventes datos que no estén en el texto.',
].join(' ');

/**
 * Transcribe un audio de WhatsApp (voz) a texto real.
 *
 * @param {import('openai').OpenAI} openaiClient
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @param {string} [modelo]
 * @returns {Promise<string>} la transcripción, tal cual — sin envoltorio, para que se lea como si la clienta lo hubiera escrito
 */
async function transcribirAudio(openaiClient, buffer, mimeType, modelo = MODELO_TRANSCRIPCION_DEFAULT) {
  const extension = (mimeType || '').split('/')[1]?.split(';')[0] || 'ogg';
  const archivo = await toFile(buffer, `audio.${extension}`, { type: mimeType || 'audio/ogg' });
  const respuesta = await openaiClient.audio.transcriptions.create({ file: archivo, model: modelo });
  return (respuesta.text || '').trim();
}

/**
 * Describe una imagen de WhatsApp con visión real (no OCR ciego — interpreta
 * el contenido para que TARA pueda responder con contexto).
 *
 * @param {import('openai').OpenAI} openaiClient
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @param {string} [modelo]
 * @returns {Promise<string>} descripción en español, envuelta en frase de contexto ("La clienta envió una imagen: …")
 */
async function describirImagen(openaiClient, buffer, mimeType, modelo = MODELO_VISION_DEFAULT) {
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`;

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: PROMPT_VISION },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] },
    ],
    max_tokens: 200,
  });

  const descripcion = (respuesta.choices?.[0]?.message?.content || '').trim();
  return descripcion ? `La clienta envió una imagen: ${descripcion}` : '';
}

/**
 * Lee un documento PDF de WhatsApp — extrae su texto real (pdf-parse, sin
 * OCR) y lo resume con IA. Un PDF escaneado sin capa de texto (foto
 * convertida a PDF) devuelve '' — el caller conserva el placeholder, nunca
 * se inventa contenido de un documento que no se pudo leer de verdad.
 *
 * @param {import('openai').OpenAI} openaiClient
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @param {string} [modelo]
 * @returns {Promise<string>} resumen en español, envuelto en frase de contexto ("La clienta envió un documento: …") — '' si no es PDF o no tiene texto legible
 */
async function describirDocumento(openaiClient, buffer, mimeType, modelo = MODELO_DOCUMENTO_DEFAULT) {
  if (mimeType !== 'application/pdf') return '';

  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let texto = '';
  try {
    const resultado = await parser.getText();
    texto = (resultado.text || '').trim();
  } finally {
    await parser.destroy();
  }

  if (texto.length < MIN_CARACTERES_PDF_LEGIBLE) return '';

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: PROMPT_DOCUMENTO },
      { role: 'user', content: texto.slice(0, 8000) },
    ],
    max_tokens: 200,
  });

  const descripcion = (respuesta.choices?.[0]?.message?.content || '').trim();
  return descripcion ? `La clienta envió un documento: ${descripcion}` : '';
}

module.exports = {
  transcribirAudio, describirImagen, describirDocumento,
  MODELO_TRANSCRIPCION_DEFAULT, MODELO_VISION_DEFAULT, MODELO_DOCUMENTO_DEFAULT,
};
