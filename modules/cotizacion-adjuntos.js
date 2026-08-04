/**
 * TARA Matrix™ — cotizacion-adjuntos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Asocia un archivo YA subido por la tubería de inbox-adjuntos.js (recibo de
 * CFE, típicamente) a la sesión de ingeniería/cotización en curso — nunca
 * vuelve a subirlo. `adjunto_id` referencia `mensajes.id`, el mensaje que ya
 * tiene `adjunto_url` (el path dentro del bucket privado). Este módulo no
 * tiene ninguna función de "subir" a propósito (restricción explícita de
 * Alina, 2026-08-04) — solo lee/relaciona.
 *
 * El recibo puede llegar ANTES de que exista la cotización (la sesión de
 * workflow sigue activa) — se guarda con `cotizacion_id = null` y se re-ata
 * cuando el motor de ingeniería crea la cotización (ver
 * modules/cotizaciones.js::correrCotizacionDesdeWorkflow).
 *
 * @module modules/cotizacion-adjuntos
 */

'use strict';

/**
 * Si el cliente tiene una sesión de workflow ACTIVA cuyo workflow dispara
 * por `solicitud_cotizacion` (el flujo de ingeniería directa, no el de
 * visita técnica), asocia el mensaje-adjunto a esa sesión. Si no hay sesión
 * activa de ese tipo, no hace nada — el adjunto se queda solo en `mensajes`,
 * como cualquier otro adjunto del Inbox.
 *
 * Idempotente: un mismo `mensajeId` nunca se asocia dos veces (índice único
 * en `cotizacion_adjuntos.adjunto_id`) — reintentos de webhook no duplican.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.clienteId
 * @param {string} datos.mensajeId       - mensajes.id (ya tiene el archivo subido)
 * @param {string} [datos.tipoDocumento] - default 'recibo_cfe'
 * @returns {Promise<Object|null>} la fila creada, o null si no había sesión de cotización directa activa
 */
async function asociarSiHaySesionDeCotizacionActiva(supabase, { companyId, clienteId, mensajeId, tipoDocumento = 'recibo_cfe' }) {
  if (!companyId || !clienteId || !mensajeId) return null;

  const { data: sesion } = await supabase
    .from('workflow_sessions')
    .select('id, workflow_id')
    .eq('company_id', companyId)
    .eq('cliente_id', clienteId)
    .eq('status', 'activo')
    .maybeSingle();

  if (!sesion) return null;

  const { data: workflow } = await supabase
    .from('workflows')
    .select('trigger_value')
    .eq('id', sesion.workflow_id)
    .maybeSingle();

  if (workflow?.trigger_value !== 'solicitud_cotizacion') return null;

  const { data, error } = await supabase
    .from('cotizacion_adjuntos')
    .insert([{
      company_id: companyId,
      adjunto_id: mensajeId,
      workflow_session_id: sesion.id,
      cliente_id: clienteId,
      tipo_documento: tipoDocumento,
    }])
    .select()
    .maybeSingle();

  // Código 23505 = unique_violation — el mismo mensaje ya se asoció antes
  // (reintento de webhook). No es un error real, se ignora en silencio.
  if (error && error.code !== '23505') {
    console.error('cotizacion-adjuntos.asociarSiHaySesionDeCotizacionActiva:', error.message);
    return null;
  }

  return data || null;
}

/**
 * Re-ata a la cotización real todos los adjuntos que llegaron mientras la
 * sesión de workflow todavía no terminaba (cotizacion_id era null).
 * Se llama justo después de crear la cotización en
 * modules/cotizaciones.js::correrCotizacionDesdeWorkflow.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.workflowSessionId
 * @param {number} datos.cotizacionId
 * @returns {Promise<number>} cuántos adjuntos se re-ataron
 */
async function reatarAdjuntosACotizacion(supabase, { workflowSessionId, cotizacionId }) {
  if (!workflowSessionId || !cotizacionId) return 0;

  const { data, error } = await supabase
    .from('cotizacion_adjuntos')
    .update({ cotizacion_id: cotizacionId })
    .eq('workflow_session_id', workflowSessionId)
    .is('cotizacion_id', null)
    .select('id');

  if (error) {
    console.error('cotizacion-adjuntos.reatarAdjuntosACotizacion:', error.message);
    return 0;
  }

  return (data || []).length;
}

/**
 * Lista los adjuntos de una cotización, con el path real del archivo
 * (join a `mensajes`) — para mostrarlos en la bandeja de revisión.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} cotizacionId
 * @returns {Promise<Array>}
 */
async function listarAdjuntosDeCotizacion(supabase, cotizacionId) {
  const { data, error } = await supabase
    .from('cotizacion_adjuntos')
    .select('id, tipo_documento, asociado_en, mensajes:adjunto_id (id, adjunto_url, adjunto_mime, tipo_contenido)')
    .eq('cotizacion_id', cotizacionId);

  return error ? [] : (data || []);
}

module.exports = { asociarSiHaySesionDeCotizacionActiva, reatarAdjuntosACotizacion, listarAdjuntosDeCotizacion };
