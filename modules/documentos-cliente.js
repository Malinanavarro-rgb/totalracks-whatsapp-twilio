/**
 * TARA Matrix™ — documentos-cliente.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Documentos del cliente clasificados (auditoría 2026-09-16, Parte A —
 * Alina, 2026-09-22): "solo hay adjuntos crudos de chat, sin clasificar,
 * atados al hilo, no al cliente" — confirmado.
 *
 * Dos caminos:
 *   1. Subida manual — el archivo se sube al bucket privado 'documentos-cliente'.
 *   2. Clasificar un adjunto que el cliente YA mandó por WhatsApp — se
 *      REFERENCIA el archivo que ya vive en el bucket 'inbox-adjuntos'
 *      (mensajes.adjunto_url), nunca se duplica el binario. `bucket`+`path`
 *      van sueltos en la fila para poder apuntar a cualquiera de los dos.
 *
 * Servir el archivo (cualquiera de los dos orígenes) es siempre una URL
 * firmada de vida corta generada en el momento — mismo criterio que
 * inbox-adjuntos.js/documentos-proveedor.js, nunca una URL guardada.
 *
 * @module modules/documentos-cliente
 */

'use strict';

const BUCKET = 'documentos-cliente';

/** Categorías esperadas — texto libre sin ENUM en DB (mismo criterio que tipo_propiedad), documentadas aquí como la fuente de verdad para el frontend. */
const CATEGORIAS = [
  'foto_techo', 'foto_medidor', 'foto_centro_carga', 'identificacion', 'contrato', 'comprobante_pago', 'recibo_cfe', 'otro',
];

// Mismo mapa que inbox-adjuntos.js/documentos-proveedor.js — consistencia
// de nombres de extensión entre los tres módulos de almacenamiento.
const EXTENSIONES_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf',
};

function extensionDeMime(mimeType) {
  if (EXTENSIONES_POR_MIME[mimeType]) return EXTENSIONES_POR_MIME[mimeType];
  const subtipo = (mimeType || '').split('/')[1] || 'bin';
  return subtipo.split(';')[0];
}

/** Sube un archivo NUEVO (no un adjunto de chat existente) y lo clasifica en un solo paso. */
async function subirDocumentoCliente(supabase, { company_id, cliente_id, categoria, buffer, mimeType, nombre_archivo, subido_por }) {
  if (!company_id || !cliente_id) throw new Error('documentos-cliente.subirDocumentoCliente: company_id y cliente_id son requeridos');
  if (!categoria) throw new Error('documentos-cliente.subirDocumentoCliente: categoria es requerida');
  if (!buffer?.length) throw new Error('documentos-cliente.subirDocumentoCliente: archivo vacío o faltante');

  const { randomUUID } = require('crypto');
  const path = `${company_id}/${cliente_id}/${randomUUID()}.${extensionDeMime(mimeType)}`;

  const { error: errorSubida } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (errorSubida) throw new Error(`documentos-cliente.subirDocumentoCliente: ${errorSubida.message}`);

  const { data, error } = await supabase.from('documentos_cliente').insert({
    company_id, cliente_id, categoria, bucket: BUCKET, path,
    nombre_archivo: nombre_archivo || null, origen: 'subida_manual', subido_por: subido_por || null,
  }).select().single();
  if (error) throw new Error(`documentos-cliente.subirDocumentoCliente: ${error.message}`);

  return data;
}

/**
 * Clasifica un adjunto que el cliente YA mandó por WhatsApp — referencia el
 * archivo existente en `inbox-adjuntos`, nunca copia el binario. Verifica
 * que el mensaje sea realmente de un hilo de ESTE cliente y empresa antes
 * de clasificarlo (nunca cruza clientes/empresas).
 */
async function clasificarAdjuntoDeMensaje(supabase, { company_id, cliente_id, categoria, mensaje_id, subido_por }) {
  if (!categoria) throw new Error('documentos-cliente.clasificarAdjuntoDeMensaje: categoria es requerida');

  const { data: mensaje, error: errorMensaje } = await supabase
    .from('mensajes').select('id, hilo_id, adjunto_url, adjunto_mime, company_id').eq('id', mensaje_id).eq('company_id', company_id).maybeSingle();
  if (errorMensaje || !mensaje) {
    const err = new Error('Mensaje no encontrado');
    err.status = 404;
    throw err;
  }
  if (!mensaje.adjunto_url) {
    const err = new Error('Este mensaje no tiene ningún adjunto que clasificar');
    err.status = 400;
    throw err;
  }

  const { data: hilo } = await supabase.from('hilos').select('id, cliente_id').eq('id', mensaje.hilo_id).eq('company_id', company_id).maybeSingle();
  if (!hilo || hilo.cliente_id !== cliente_id) {
    const err = new Error('Este mensaje no pertenece a un hilo de este cliente');
    err.status = 403;
    throw err;
  }

  const { data, error } = await supabase.from('documentos_cliente').insert({
    company_id, cliente_id, categoria, bucket: 'inbox-adjuntos', path: mensaje.adjunto_url,
    nombre_archivo: null, origen: 'mensaje_inbox', mensaje_id: mensaje.id, subido_por: subido_por || null,
  }).select().single();
  if (error) throw new Error(`documentos-cliente.clasificarAdjuntoDeMensaje: ${error.message}`);

  return data;
}

async function listarDocumentosCliente(supabase, companyId, clienteId, { categoria } = {}) {
  let query = supabase.from('documentos_cliente').select('*').eq('company_id', companyId).eq('cliente_id', clienteId).order('created_at', { ascending: false });
  if (categoria) query = query.eq('categoria', categoria);
  const { data, error } = await query;
  return error ? [] : (data || []);
}

/**
 * Adjuntos de chat de este cliente que TODAVÍA no se han clasificado — para
 * que el expediente pueda ofrecer "clasificar" en vez de que el asesor tenga
 * que ir a buscarlos en Conversación. Dos consultas (nunca un embed de
 * PostgREST entre mensajes→hilos→clientes, arriesgoso por el problema real
 * de FK no reconocida ya encontrado en esta empresa) — primero los hilos del
 * cliente, luego sus mensajes con adjunto que no aparezcan ya en
 * documentos_cliente.mensaje_id.
 */
async function adjuntosSinClasificar(supabase, companyId, clienteId) {
  const { data: hilos } = await supabase.from('hilos').select('id').eq('company_id', companyId).eq('cliente_id', clienteId);
  const hiloIds = (hilos || []).map((h) => h.id);
  if (hiloIds.length === 0) return [];

  const [{ data: mensajes }, { data: yaClasificados }] = await Promise.all([
    supabase.from('mensajes').select('id, hilo_id, tipo_contenido, adjunto_url, adjunto_mime, created_at')
      .in('hilo_id', hiloIds).not('adjunto_url', 'is', null).order('created_at', { ascending: false }),
    supabase.from('documentos_cliente').select('mensaje_id').eq('company_id', companyId).eq('cliente_id', clienteId).eq('origen', 'mensaje_inbox'),
  ]);

  const idsClasificados = new Set((yaClasificados || []).map((d) => d.mensaje_id));
  return (mensajes || []).filter((m) => !idsClasificados.has(m.id));
}

/** Solo borra el objeto en Storage si el documento es dueño del archivo (subida_manual) — uno referenciado (mensaje_inbox) nunca borra el adjunto del chat. */
async function eliminarDocumentoCliente(supabase, companyId, documentoId) {
  const { data: documento, error: errorDoc } = await supabase
    .from('documentos_cliente').select('*').eq('id', documentoId).eq('company_id', companyId).maybeSingle();
  if (errorDoc || !documento) {
    const err = new Error('Documento no encontrado');
    err.status = 404;
    throw err;
  }

  if (documento.origen === 'subida_manual') {
    await supabase.storage.from(documento.bucket).remove([documento.path]); // best-effort — si falla, igual se borra la fila
  }

  const { error } = await supabase.from('documentos_cliente').delete().eq('id', documentoId).eq('company_id', companyId);
  if (error) throw new Error(`documentos-cliente.eliminarDocumentoCliente: ${error.message}`);
}

async function generarUrlFirmadaDocumentoCliente(supabase, documento, segundos = 60) {
  const { data, error } = await supabase.storage.from(documento.bucket).createSignedUrl(documento.path, segundos);
  if (error) throw new Error(`documentos-cliente.generarUrlFirmadaDocumentoCliente: ${error.message}`);
  return data.signedUrl;
}

module.exports = {
  BUCKET, CATEGORIAS, extensionDeMime,
  subirDocumentoCliente, clasificarAdjuntoDeMensaje, listarDocumentosCliente, adjuntosSinClasificar,
  eliminarDocumentoCliente, generarUrlFirmadaDocumentoCliente,
};
