/**
 * TARA Matrix™ — inbox.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inbox Inteligente (v0.4) — CRUD de `hilos`/`mensajes` (migración 076).
 *
 * `mensajes` es la fuente de verdad del Inbox hacia adelante — la capa de
 * plataforma (server.js) escribe aquí ADEMÁS de lo que el Core ya escribe
 * en `conversaciones` (congelada por ADR-005). Es una escritura doble
 * deliberada: `conversaciones` sigue siendo el log de turnos de IA que el
 * motor congelado ya conoce; `mensajes` es multi-canal, multi-adjunto, y
 * con ciclo de vida (hilo) desde el día uno.
 *
 * @module modules/inbox
 */

'use strict';

const { ROLES_GERENCIALES } = require('./permisos');

/**
 * Encuentra el hilo abierto de este cliente en este canal, o crea uno.
 * Un cliente puede tener como máximo un hilo *abierto* por canal a la vez
 * (si el anterior se cerró, escribir de nuevo abre uno nuevo — mismo
 * criterio que un ticket de soporte).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{company_id: string, cliente_id: number, canal: string, proveedor: string, sucursal_id?: string}} datos
 * @returns {Promise<Object>} la fila de `hilos`
 */
async function resolverOCrearHilo(supabase, { company_id, cliente_id, canal, proveedor, sucursal_id }) {
  const { data: existentes, error: errBuscar } = await supabase
    .from('hilos')
    .select('*')
    .eq('cliente_id', cliente_id)
    .eq('canal', canal)
    .eq('estado', 'abierta')
    .order('created_at', { ascending: false })
    .limit(1);

  if (errBuscar) throw new Error(`inbox.resolverOCrearHilo: ${errBuscar.message}`);
  if (existentes && existentes.length > 0) return existentes[0];

  const { data: nuevo, error: errCrear } = await supabase
    .from('hilos')
    .insert([{ company_id, cliente_id, canal, proveedor, sucursal_id: sucursal_id || null }])
    .select()
    .single();

  if (errCrear) throw new Error(`inbox.resolverOCrearHilo: ${errCrear.message}`);
  return nuevo;
}

/**
 * Registra un mensaje (entrante o saliente, de cualquier canal/tipo) y
 * refresca el preview del hilo — nunca lanza si el insert del mensaje tiene
 * éxito pero el refresco del hilo falla (no debe tumbar el flujo de envío
 * al cliente por un problema cosmético).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.hilo_id
 * @param {string} datos.company_id
 * @param {'entrante'|'saliente'} datos.direccion
 * @param {'cliente'|'ia'|'humano'} datos.remitente_tipo
 * @param {'texto'|'imagen'|'audio'|'video'|'documento'|'ubicacion'} [datos.tipo_contenido='texto']
 * @param {string} [datos.contenido]
 * @param {string} [datos.adjunto_url]
 * @param {string} [datos.adjunto_mime]
 * @returns {Promise<Object>} la fila de `mensajes`
 */
async function registrarMensaje(supabase, { hilo_id, company_id, direccion, remitente_tipo, tipo_contenido = 'texto', contenido, adjunto_url, adjunto_mime }) {
  const { data: mensaje, error } = await supabase
    .from('mensajes')
    .insert([{ hilo_id, company_id, direccion, remitente_tipo, tipo_contenido, contenido: contenido || null, adjunto_url: adjunto_url || null, adjunto_mime: adjunto_mime || null }])
    .select()
    .single();

  if (error) throw new Error(`inbox.registrarMensaje: ${error.message}`);

  try {
    const preview = (contenido || `[${tipo_contenido}]`).slice(0, 140);
    await supabase.from('hilos').update({
      ultimo_mensaje_preview: preview,
      ultimo_mensaje_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', hilo_id);
  } catch (e) {
    console.error('inbox.registrarMensaje: no se pudo refrescar el preview del hilo —', e.message);
  }

  return mensaje;
}

/**
 * Lista hilos con filtros reales + paginación por cursor (ultimo_mensaje_at)
 * — sin esto, "miles de conversaciones" trae el dataset completo en cada
 * carga (hallazgo confirmado en la auditoría previa a este módulo).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {{usuario?: {id: string, rol: string}, canal?: string, sucursal_id?: string, asesor_id?: string, estado?: string, prioridad?: string, etiqueta?: string, cursor?: string, limite?: number}} [filtros]
 * @returns {Promise<Object[]>}
 */
async function listarHilos(supabase, company_id, filtros = {}) {
  const { usuario, canal, sucursal_id, asesor_id, estado, prioridad, etiqueta, cursor, limite = 30 } = filtros;

  let query = supabase
    .from('hilos')
    .select('*, clientes(nombre, telefono, atendido_por, score_interes)')
    .eq('company_id', company_id);

  if (usuario && !ROLES_GERENCIALES.includes(usuario.rol)) {
    query = query.or(`asesor_id.eq.${usuario.id},asesor_id.is.null`);
  }
  if (canal)       query = query.eq('canal', canal);
  if (sucursal_id) query = query.eq('sucursal_id', sucursal_id);
  if (asesor_id)   query = query.eq('asesor_id', asesor_id);
  if (estado)      query = query.eq('estado', estado);
  if (prioridad)   query = query.eq('prioridad', prioridad);
  if (etiqueta)    query = query.contains('etiquetas', [etiqueta]);
  if (cursor)      query = query.lt('ultimo_mensaje_at', cursor);

  const { data, error } = await query.order('ultimo_mensaje_at', { ascending: false, nullsFirst: false }).limit(limite);
  if (error) throw new Error(`inbox.listarHilos: ${error.message}`);
  return data || [];
}

/**
 * Un solo hilo con los datos del cliente — para la vista de conversación
 * (necesita cliente_id/atendido_por para saber si ya se puede responder).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} hilo_id
 * @returns {Promise<Object|null>}
 */
async function obtenerHilo(supabase, company_id, hilo_id) {
  const { data, error } = await supabase
    .from('hilos')
    .select('*, clientes(id, nombre, telefono, atendido_por, asesor_id)')
    .eq('id', hilo_id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (error) throw new Error(`inbox.obtenerHilo: ${error.message}`);
  return data;
}

/**
 * Historial completo de un hilo, cronológico — incluye adjuntos (a
 * diferencia de conversaciones.js::obtenerHistorial, que solo trae texto).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} hilo_id
 * @returns {Promise<Object[]>}
 */
async function listarMensajesDeHilo(supabase, hilo_id) {
  const { data, error } = await supabase
    .from('mensajes')
    .select('*')
    .eq('hilo_id', hilo_id)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`inbox.listarMensajesDeHilo: ${error.message}`);
  return data || [];
}

/**
 * Cambia estado/prioridad/etiquetas/asignación de un hilo. Reasignar a otro
 * asesor está gateado a roles gerenciales — el caller (server.js) es
 * responsable de aplicar ese chequeo antes de llamar aquí con `asesor_id`.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} hilo_id
 * @param {{estado?: string, prioridad?: string, etiquetas?: string[], asesor_id?: string|null}} cambios
 */
async function actualizarHilo(supabase, company_id, hilo_id, cambios) {
  const payload = {};
  if (cambios.estado !== undefined)     payload.estado = cambios.estado;
  if (cambios.prioridad !== undefined)  payload.prioridad = cambios.prioridad;
  if (cambios.etiquetas !== undefined)  payload.etiquetas = cambios.etiquetas;
  if (cambios.asesor_id !== undefined)  payload.asesor_id = cambios.asesor_id;
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('hilos')
    .update(payload)
    .eq('id', hilo_id)
    .eq('company_id', company_id)
    .select()
    .single();

  if (error) throw new Error(`inbox.actualizarHilo: ${error.message}`);
  return data;
}

module.exports = {
  resolverOCrearHilo, registrarMensaje, listarHilos, obtenerHilo, listarMensajesDeHilo, actualizarHilo,
  ROLES_GERENCIALES,
};
