/**
 * TARA Matrix™ — conversaciones.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 3: Conversaciones en tiempo real + intervención humana.
 *
 * Cero cambios a WorkflowEngine/SchedulingEngine/ActionRunner/Orchestrator
 * (ADR-005, baseline v1). Este módulo vive enteramente en la capa de
 * plataforma: lee `clientes`/`conversaciones` (congeladas, solo lectura) y
 * escribe en `mensajes_humanos` (tabla nueva, aditiva — migración 027).
 *
 * @module modules/conversaciones
 */

'use strict';

const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

/**
 * Lista los clientes/conversaciones visibles para el usuario que consulta.
 * Owner/Administrador/Supervisor ven todas las de la empresa. Un Asesor ve
 * las que ya tomó más el pool sin asignar (para poder tomarlas) — nunca las
 * tomadas por otro asesor.
 *
 * Consulta única contra la vista `conversaciones_resumen` (migración 040,
 * extendida en 043 con score_interes/oportunidad_estado — Pivote a
 * producto, Fase 4.3: contexto de CRM visible sin salir de Conversaciones),
 * que resuelve el "último mensaje" de cada cliente con un JOIN en SQL — antes
 * hacía 1 query de clientes + 2 queries adicionales POR CLIENTE (N+1),
 * detectado en la auditoría de arquitectura 2026-07 (hallazgo #2).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {{id: string, rol: string}} usuario
 */
async function listarConversaciones(supabase, company_id, usuario) {
  let query = supabase
    .from('conversaciones_resumen')
    .select('id, nombre, telefono, atendido_por, asesor_id, estado, score_interes, oportunidad_estado, ultimo_mensaje_texto, ultimo_mensaje_created_at')
    .eq('company_id', company_id);

  if (!ROLES_GERENCIALES.includes(usuario.rol)) {
    query = query.or(`asesor_id.eq.${usuario.id},and(atendido_por.eq.ia,asesor_id.is.null)`);
  }

  const { data, error } = await query.order('ultimo_mensaje_created_at', { ascending: false, nullsFirst: false });
  if (error || !data) return [];

  return data.map(({ ultimo_mensaje_texto, ultimo_mensaje_created_at, ...cliente }) => ({
    ...cliente,
    ultimoMensaje: ultimo_mensaje_texto
      ? { texto: ultimo_mensaje_texto, created_at: ultimo_mensaje_created_at }
      : null,
  }));
}

/**
 * Historial completo de una conversación, combinando `conversaciones`
 * (turnos de TARA) y `mensajes_humanos` (turnos de intervención humana),
 * ordenado cronológicamente.
 */
async function obtenerHistorial(supabase, company_id, clienteId) {
  const [conv, hum] = await Promise.all([
    supabase
      .from('conversaciones')
      .select('mensaje_cliente, respuesta_tara, created_at')
      .eq('company_id', company_id)
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: true }),
    supabase
      .from('mensajes_humanos')
      .select('direccion, contenido, asesor_id, created_at')
      .eq('company_id', company_id)
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: true }),
  ]);

  const mensajes = [];
  for (const fila of conv.data || []) {
    mensajes.push({ de: 'cliente', texto: fila.mensaje_cliente, created_at: fila.created_at });
    if (fila.respuesta_tara) {
      mensajes.push({ de: 'tara', texto: fila.respuesta_tara, created_at: fila.created_at });
    }
  }
  for (const fila of hum.data || []) {
    mensajes.push({
      de:         fila.direccion === 'entrante' ? 'cliente' : 'humano',
      texto:      fila.contenido,
      created_at: fila.created_at,
    });
  }

  return mensajes.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * "Tomar conversación" — asigna el cliente al usuario que la toma.
 * Update condicional (atendido_por='ia' → 'humano') para evitar doble-toma
 * concurrente: si 0 filas afectadas, alguien más ya la tomó (409).
 */
async function tomarConversacion(supabase, company_id, clienteId, asesorId) {
  const { data, error } = await supabase
    .from('clientes')
    .update({ atendido_por: 'humano', asesor_id: asesorId })
    .eq('id', clienteId)
    .eq('company_id', company_id)
    .eq('atendido_por', 'ia')
    .select()
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    const err = new Error('Esta conversación ya fue tomada por alguien más');
    err.status = 409;
    throw err;
  }
  return data;
}

/**
 * "Regresar a TARA" — TARA retoma el control de la conversación.
 */
async function regresarATara(supabase, company_id, clienteId) {
  const { data, error } = await supabase
    .from('clientes')
    .update({ atendido_por: 'ia', asesor_id: null })
    .eq('id', clienteId)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo regresar la conversación a TARA');
  return data;
}

/**
 * Envía un mensaje humano al cliente por WhatsApp (reusa
 * ChannelAdapter.sendProactive, ya existente) y lo registra en
 * mensajes_humanos. Requiere que la conversación ya esté tomada.
 */
async function enviarMensajeHumano(supabase, channelAdapter, channelRouter, company_id, clienteId, asesorId, texto) {
  const { data: cliente, error } = await supabase
    .from('clientes')
    .select('telefono, atendido_por')
    .eq('id', clienteId)
    .eq('company_id', company_id)
    .maybeSingle();

  if (error || !cliente) throw new Error('Cliente no encontrado');

  if (cliente.atendido_por !== 'humano') {
    const err = new Error('Debes tomar la conversación antes de responder');
    err.status = 409;
    throw err;
  }

  await supabase.from('mensajes_humanos').insert([{
    cliente_id: clienteId,
    company_id,
    asesor_id:  asesorId,
    direccion:  'saliente',
    contenido:  texto,
  }]);

  const numeroOrigen = await channelRouter.resolverEndpointDeEmpresa(company_id);
  await channelAdapter.sendProactive(texto, cliente.telefono, numeroOrigen);
}

/**
 * Registra un mensaje entrante mientras la conversación está en manos de un
 * humano — TARA no responde. Se llama desde el webhook de server.js, nunca
 * desde el Orchestrator.
 */
async function registrarMensajeEntranteHumano(supabase, company_id, clienteId, texto) {
  await supabase.from('mensajes_humanos').insert([{
    cliente_id: clienteId,
    company_id,
    asesor_id:  null,
    direccion:  'entrante',
    contenido:  texto,
  }]);
}

module.exports = {
  listarConversaciones,
  obtenerHistorial,
  tomarConversacion,
  regresarATara,
  enviarMensajeHumano,
  registrarMensajeEntranteHumano,
};
