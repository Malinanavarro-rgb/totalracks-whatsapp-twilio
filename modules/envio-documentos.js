/**
 * TARA Matrix™ — envio-documentos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Servicio genérico para enviar un documento (PDF, típicamente) por
 * WhatsApp — Fase 2 del módulo Ingeniería y Cotización (Alina, 2026-08-04).
 * No es exclusivo de cotizaciones: cualquier módulo futuro que necesite
 * mandar un archivo por WhatsApp puede usar `enviarDocumentoPorWhatsApp()`.
 *
 * Resuelve el proveedor igual que server.js:853-856 (Meta Cloud API si la
 * empresa lo tiene conectado, si no Twilio) y respeta las diferencias
 * reales entre ambos (ver adapters/channels/*.js::enviarDocumento): Twilio
 * necesita una URL firmada temporal, Meta prefiere subir el binario y
 * enviar por media_id. La duración de la URL firmada es configurable
 * (nunca fija en 24h ni en ningún otro valor único) — default razonable
 * para que Twilio la alcance a descargar, pero el caller puede ajustarla.
 *
 * Todo envío queda registrado en `envios_documento` (proveedor, message_id,
 * destinatario, archivo, versión de cotización, fecha, estado, error del
 * proveedor) — restricción explícita de Alina, 2026-08-04.
 *
 * Esta fase deja el servicio listo y PROBADO (ver
 * __tests__/envio-documentos.test.js) con un archivo de prueba — no genera
 * ni envía ningún PDF real de cotización todavía (eso es Fase 3).
 *
 * @module modules/envio-documentos
 */

'use strict';

const { ChannelRouter } = require('./channel-router');
const { obtenerAdapterMetaParaEmpresa } = require('./meta-auth');
const { TwilioWhatsAppAdapter } = require('../adapters/channels/twilio-whatsapp');
const { supabaseServicio, twilioClient } = require('./clients');

const SEGUNDOS_URL_FIRMADA_DEFAULT = 3600; // 1 hora — suficiente para que Twilio la descargue async, configurable por caller

const _channelRouter = new ChannelRouter(supabaseServicio);
const _twilioAdapter = new TwilioWhatsAppAdapter(twilioClient);

/**
 * Registra el intento de envío ANTES de llamar al proveedor (estado
 * 'enviando') — si el proceso se cae a media llamada, queda evidencia en
 * vez de que el envío desaparezca sin rastro.
 */
async function _registrarIntento(supabase, datos) {
  const { data, error } = await supabase
    .from('envios_documento')
    .insert([{ ...datos, estado: 'enviando' }])
    .select()
    .single();
  if (error) throw new Error(`envio-documentos._registrarIntento: ${error.message}`);
  return data;
}

async function _marcarResultado(supabase, envioId, { estado, message_id, error_proveedor }) {
  await supabase
    .from('envios_documento')
    .update({ estado, message_id: message_id || null, error_proveedor: error_proveedor || null, actualizado_en: new Date().toISOString() })
    .eq('id', envioId);
}

/**
 * Envía un documento por WhatsApp, resolviendo el proveedor real de la
 * empresa, y deja registro completo en `envios_documento` — tanto si tiene
 * éxito como si falla (nunca lanza por un error del proveedor; el error
 * queda guardado en la fila, ver `estado: 'fallido'`). Sí lanza si faltan
 * datos requeridos (bug de quien llama, no del proveedor).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.clienteId
 * @param {string} datos.destinatario       - teléfono del cliente
 * @param {string} datos.storageBucket
 * @param {string} datos.storagePath
 * @param {string} [datos.filename]
 * @param {number} [datos.cotizacionId]
 * @param {number} [datos.cotizacionVersion]
 * @param {number} [datos.segundosUrlFirmada] - default 3600, configurable por caller
 * @returns {Promise<Object>} la fila de envios_documento, ya actualizada con el resultado
 */
async function enviarDocumentoPorWhatsApp(supabase, {
  companyId, clienteId, destinatario, storageBucket, storagePath, filename,
  cotizacionId, cotizacionVersion, segundosUrlFirmada = SEGUNDOS_URL_FIRMADA_DEFAULT,
}) {
  if (!companyId || !clienteId || !destinatario || !storageBucket || !storagePath) {
    throw new Error('envio-documentos.enviarDocumentoPorWhatsApp: companyId, clienteId, destinatario, storageBucket y storagePath son requeridos');
  }

  const metaAdapterEmpresa = await obtenerAdapterMetaParaEmpresa(supabase, companyId);
  const proveedor = metaAdapterEmpresa ? 'meta' : 'twilio';

  const envio = await _registrarIntento(supabase, {
    company_id: companyId, cliente_id: clienteId, cotizacion_id: cotizacionId || null,
    cotizacion_version: cotizacionVersion || null, proveedor, destinatario,
    storage_bucket: storageBucket, storage_path: storagePath, filename: filename || null,
  });

  try {
    let resultado;
    if (metaAdapterEmpresa) {
      // Meta prefiere el binario — se descarga de Storage y se sube a Meta.
      const { data: descarga, error: errDescarga } = await supabase.storage.from(storageBucket).download(storagePath);
      if (errDescarga) throw new Error(`no se pudo leer el archivo de Storage: ${errDescarga.message}`);
      const buffer = Buffer.from(await descarga.arrayBuffer());
      resultado = await metaAdapterEmpresa.enviarDocumento(destinatario, { buffer, mimeType: descarga.type, filename });
    } else {
      const { data: firmada, error: errFirmada } = await supabase.storage.from(storageBucket).createSignedUrl(storagePath, segundosUrlFirmada);
      if (errFirmada) throw new Error(`no se pudo firmar la URL: ${errFirmada.message}`);
      const numeroOrigen = await _channelRouter.resolverEndpointDeEmpresa(companyId);
      resultado = await _twilioAdapter.enviarDocumento(destinatario, { url: firmada.signedUrl, filename, from: numeroOrigen });
    }

    await _marcarResultado(supabase, envio.id, { estado: 'enviado', message_id: resultado.message_id });
    return { ...envio, estado: 'enviado', message_id: resultado.message_id, proveedor: resultado.proveedor };
  } catch (e) {
    await _marcarResultado(supabase, envio.id, { estado: 'fallido', error_proveedor: e.message });
    return { ...envio, estado: 'fallido', error_proveedor: e.message };
  }
}

module.exports = { enviarDocumentoPorWhatsApp, SEGUNDOS_URL_FIRMADA_DEFAULT };
