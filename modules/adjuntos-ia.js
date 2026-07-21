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

const PROMPT_VISION = [
  'Eres los ojos de un asistente de negocio por WhatsApp — un cliente acaba de enviar esta imagen.',
  'Describe en 1-3 oraciones, en español, qué se ve y por qué podría importarle al negocio',
  '(ej. una prenda, un comprobante de pago, una dirección o mapa, una captura de pantalla, una referencia de diseño o color).',
  'Sé concreto y útil para que un asesor humano o una IA de ventas puedan responder bien — nunca inventes detalles que no se vean con claridad.',
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

module.exports = { transcribirAudio, describirImagen, MODELO_TRANSCRIPCION_DEFAULT, MODELO_VISION_DEFAULT };
