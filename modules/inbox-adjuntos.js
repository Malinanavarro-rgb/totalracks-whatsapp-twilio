/**
 * TARA Matrix™ — inbox-adjuntos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inbox Inteligente (v0.4) — almacenamiento de adjuntos reales. Las URLs de
 * media de Meta/Twilio son temporales (Meta expira en minutos; Twilio exige
 * Basic Auth y no se garantiza que viva para siempre) — nunca se guardan
 * directo en `mensajes.adjunto_url`. En vez de eso, el binario se sube a un
 * bucket privado de Supabase Storage y `adjunto_url` guarda solo el *path*
 * dentro del bucket — nunca una URL, ni siquiera firmada. Servir el archivo
 * al frontend es responsabilidad de una ruta autenticada en server.js
 * (GET /api/inbox/mensajes/:id/adjunto) que genera una URL firmada de vida
 * corta en el momento de la petición, después de confirmar que el mensaje
 * pertenece a la empresa del usuario que la pide.
 *
 * @module modules/inbox-adjuntos
 */

'use strict';

const { randomUUID } = require('crypto');

const BUCKET = 'inbox-adjuntos';
const SEGUNDOS_URL_FIRMADA_DEFAULT = 60;

const EXTENSIONES_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

/**
 * @param {string} mimeType
 * @returns {string} extensión sin punto, con fallback razonable si no está en el mapa
 */
function extensionDeMime(mimeType) {
  if (EXTENSIONES_POR_MIME[mimeType]) return EXTENSIONES_POR_MIME[mimeType];
  const subtipo = (mimeType || '').split('/')[1] || 'bin';
  return subtipo.split(';')[0];
}

/**
 * Deriva `tipo_contenido` (columna de `mensajes`) a partir del mime type real
 * del archivo descargado — más confiable que el `type` que reporta cada
 * proveedor, que varía en nombre (ej. Meta usa 'sticker', no 'imagen').
 *
 * @param {string} mimeType
 * @returns {'imagen'|'audio'|'video'|'documento'}
 */
function tipoContenidoDeMime(mimeType) {
  const familia = (mimeType || '').split('/')[0];
  if (familia === 'image') return 'imagen';
  if (familia === 'audio') return 'audio';
  if (familia === 'video') return 'video';
  return 'documento';
}

/**
 * Sube el binario de un adjunto al bucket privado — se llama justo después
 * de descargarlo del proveedor (Meta/Twilio), nunca se guarda la URL de
 * origen. Nunca lanza si el bucket no está listo con un mensaje confuso: el
 * error de Supabase Storage ya trae detalle suficiente.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - requiere service_role (bucket privado)
 * @param {Object} datos
 * @param {string} datos.company_id
 * @param {string} datos.hilo_id
 * @param {Buffer} datos.buffer
 * @param {string} datos.mimeType
 * @returns {Promise<string>} el path dentro del bucket (a guardar en `mensajes.adjunto_url`)
 */
async function subirAdjunto(supabase, { company_id, hilo_id, buffer, mimeType }) {
  const path = `${company_id}/${hilo_id}/${randomUUID()}.${extensionDeMime(mimeType)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`inbox-adjuntos.subirAdjunto: ${error.message}`);

  return path;
}

/**
 * Genera una URL firmada de vida corta para un path ya subido — se llama en
 * el momento de servir el archivo (nunca se guarda esta URL en la base de
 * datos, siempre se genera una nueva por petición).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - requiere service_role (bucket privado)
 * @param {string} path
 * @param {number} [segundos]
 * @returns {Promise<string>}
 */
async function generarUrlFirmada(supabase, path, segundos = SEGUNDOS_URL_FIRMADA_DEFAULT) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
  if (error) throw new Error(`inbox-adjuntos.generarUrlFirmada: ${error.message}`);
  return data.signedUrl;
}

module.exports = { BUCKET, extensionDeMime, tipoContenidoDeMime, subirAdjunto, generarUrlFirmada };
