/**
 * TARA Matrix™ — tickets.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2I del bloque operativo post-venta (Alina, 2026-09-28, ver
 * NORT_ENERGY_PORTAL_PLAN.md). CORE genérico — la vía para cualquier
 * pendiente de postventa que NO sea específicamente una garantía (2H): duda
 * de facturación, queja, solicitud general. `proyecto_id`/`equipo_instalado_id`
 * son opcionales — un ticket puede ser puramente del cliente, sin ligarse a
 * nada operativo.
 *
 * Línea de tiempo dedicada (`ticket_eventos`) — misma forma exacta que
 * garantia_reclamacion_eventos (2H), nunca bitacora_decisiones (mezclaría
 * con eventos de otros módulos) ni un jsonb (perdería orden).
 *
 * @module modules/tickets
 */

'use strict';

const ESTADOS_TICKET = ['abierto', 'en_proceso', 'esperando_cliente', 'resuelto', 'cerrado'];
const PRIORIDADES_TICKET = ['baja', 'media', 'alta', 'urgente'];

async function _enriquecerTicket(supabase, companyId, ticket) {
  if (!ticket) return null;
  const [{ data: eventos }, { data: cliente }] = await Promise.all([
    supabase.from('ticket_eventos').select('*').eq('company_id', companyId).eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    supabase.from('clientes').select('nombre, telefono').eq('id', ticket.cliente_id).eq('company_id', companyId).maybeSingle(),
  ]);
  return { ...ticket, eventos: eventos || [], cliente_nombre: cliente?.nombre ?? null, cliente_telefono: cliente?.telefono ?? null };
}

/**
 * Crea el ticket — valida que el cliente sea real y de esta empresa (y, si
 * se dan, que proyecto/equipo también lo sean) antes de insertar.
 */
async function crearTicket(supabase, { companyId, clienteId, proyectoId, equipoInstaladoId, asunto, categoria, prioridad, usuarioId }) {
  if (!asunto || !asunto.trim()) {
    const err = new Error('El asunto del ticket es requerido.');
    err.status = 400;
    throw err;
  }
  if (!categoria || !categoria.trim()) {
    const err = new Error('La categoría del ticket es requerida.');
    err.status = 400;
    throw err;
  }
  if (prioridad && !PRIORIDADES_TICKET.includes(prioridad)) {
    const err = new Error(`Prioridad "${prioridad}" no reconocida.`);
    err.status = 400;
    throw err;
  }

  const [{ data: cliente }, proyectoValido, equipoValido] = await Promise.all([
    supabase.from('clientes').select('id').eq('id', clienteId).eq('company_id', companyId).maybeSingle(),
    proyectoId
      ? supabase.from('proyectos').select('id').eq('id', proyectoId).eq('company_id', companyId).maybeSingle().then((r) => Boolean(r.data))
      : Promise.resolve(true),
    equipoInstaladoId
      ? supabase.from('equipos_instalados').select('id').eq('id', equipoInstaladoId).eq('company_id', companyId).maybeSingle().then((r) => Boolean(r.data))
      : Promise.resolve(true),
  ]);
  if (!cliente) { const err = new Error('Cliente no encontrado'); err.status = 404; throw err; }
  if (!proyectoValido) { const err = new Error('Proyecto no encontrado'); err.status = 404; throw err; }
  if (!equipoValido) { const err = new Error('Equipo no encontrado'); err.status = 404; throw err; }

  const { data, error } = await supabase.from('tickets').insert([{
    company_id: companyId, cliente_id: clienteId, proyecto_id: proyectoId || null, equipo_instalado_id: equipoInstaladoId || null,
    asunto: asunto.trim(), categoria: categoria.trim(), prioridad: prioridad || 'media', responsable_id: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`tickets.crearTicket: ${error.message}`);

  await supabase.from('ticket_eventos').insert([{
    company_id: companyId, ticket_id: data.id, tipo: 'creado', texto: asunto.trim(), autor_id: usuarioId || null,
  }]);

  return _enriquecerTicket(supabase, companyId, data);
}

async function obtenerTicket(supabase, companyId, ticketId) {
  const { data } = await supabase.from('tickets').select('*').eq('id', ticketId).eq('company_id', companyId).maybeSingle();
  if (!data) return null;
  return _enriquecerTicket(supabase, companyId, data);
}

async function listarTickets(supabase, companyId, { estado, prioridad, clienteId } = {}) {
  let query = supabase.from('tickets').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (estado) query = query.eq('estado', estado);
  if (prioridad) query = query.eq('prioridad', prioridad);
  if (clienteId) query = query.eq('cliente_id', clienteId);
  const { data, error } = await query;
  if (error) return [];
  return Promise.all((data || []).map((t) => _enriquecerTicket(supabase, companyId, t)));
}

const CAMPOS_TICKET_EDITABLES = ['asunto', 'categoria', 'prioridad', 'responsable_id'];

async function actualizarTicket(supabase, { companyId, ticketId, cambios }) {
  if (cambios.prioridad !== undefined && !PRIORIDADES_TICKET.includes(cambios.prioridad)) {
    const err = new Error(`Prioridad "${cambios.prioridad}" no reconocida.`);
    err.status = 400;
    throw err;
  }
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_TICKET_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const { data, error } = await supabase.from('tickets').update(payload).eq('id', ticketId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Ticket no encontrado');
    err.status = 404;
    throw err;
  }
  return _enriquecerTicket(supabase, companyId, data);
}

/** Cambia el estado — transición libre (no rígida), deja evento propio. */
async function actualizarEstadoTicket(supabase, { companyId, ticketId, estado, usuarioId }) {
  if (!ESTADOS_TICKET.includes(estado)) {
    const err = new Error(`Estado "${estado}" no reconocido.`);
    err.status = 400;
    throw err;
  }

  const { data: actual } = await supabase.from('tickets').select('id, estado').eq('id', ticketId).eq('company_id', companyId).maybeSingle();
  if (!actual) {
    const err = new Error('Ticket no encontrado');
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('tickets').update({ estado, updated_at: new Date().toISOString() }).eq('id', ticketId).eq('company_id', companyId).select().single();
  if (error) throw new Error(`tickets.actualizarEstadoTicket: ${error.message}`);

  await supabase.from('ticket_eventos').insert([{
    company_id: companyId, ticket_id: ticketId, tipo: 'cambio_estado', texto: `"${actual.estado}" → "${estado}"`, autor_id: usuarioId || null,
  }]);

  return _enriquecerTicket(supabase, companyId, data);
}

/** Agrega un comentario a la línea de tiempo sin cambiar el estado. */
async function agregarComentarioTicket(supabase, { companyId, ticketId, texto, usuarioId }) {
  if (!texto || !texto.trim()) {
    const err = new Error('El comentario no puede estar vacío.');
    err.status = 400;
    throw err;
  }
  const { data: ticket } = await supabase.from('tickets').select('id').eq('id', ticketId).eq('company_id', companyId).maybeSingle();
  if (!ticket) {
    const err = new Error('Ticket no encontrado');
    err.status = 404;
    throw err;
  }

  const { error } = await supabase.from('ticket_eventos').insert([{
    company_id: companyId, ticket_id: ticketId, tipo: 'comentario', texto: texto.trim(), autor_id: usuarioId || null,
  }]);
  if (error) throw new Error(`tickets.agregarComentarioTicket: ${error.message}`);

  return obtenerTicket(supabase, companyId, ticketId);
}

module.exports = {
  ESTADOS_TICKET, PRIORIDADES_TICKET,
  crearTicket, obtenerTicket, listarTickets, actualizarTicket, actualizarEstadoTicket, agregarComentarioTicket,
};
