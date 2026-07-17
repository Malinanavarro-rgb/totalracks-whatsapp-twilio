/**
 * TARA Matrix™ — agenda.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 4: Agenda propia de TARA (UI sobre citas/asesores/
 * horarios_laborales, ya validados en Anexo A/B).
 *
 * Un solo camino de escritura para citas: este módulo reusa
 * SchedulingEngine.agendarCita()/reagendarCita()/cancelarCita() — el mismo
 * que usa el motor conversacional — resolviendo el CalendarProvider igual
 * que Orchestrator (Google si la empresa lo conectó, MockCalendarProvider
 * si no). Cero cambios al Core (ADR-005).
 *
 * @module modules/agenda
 */

'use strict';

const { SchedulingEngine }     = require('./scheduling-engine');
const { obtenerProviderParaEmpresa } = require('./google-auth');
const { MockCalendarProvider } = require('../adapters/calendar/mock-calendar-provider');

const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

async function _schedulingEngineParaEmpresa(supabase, company_id) {
  const provider = (await obtenerProviderParaEmpresa(supabase, company_id)) || new MockCalendarProvider();
  return new SchedulingEngine(supabase, provider);
}

/**
 * Resuelve el `asesores.id` vinculado a un usuario del panel, dentro de su
 * empresa activa. Null si el usuario no tiene un asesor de agenda vinculado
 * (ej. Owner que no atiende citas directamente).
 */
async function resolverAsesorDeUsuario(supabase, company_id, usuarioId) {
  const { data, error } = await supabase
    .from('asesores')
    .select('id')
    .eq('company_id', company_id)
    .eq('usuario_id', usuarioId)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

async function listarAsesores(supabase, company_id) {
  const { data, error } = await supabase
    .from('asesores')
    .select('id, nombre, usuario_id')
    .eq('company_id', company_id)
    .eq('activo', true);

  return error ? [] : (data || []);
}

/**
 * A diferencia de listarAsesores() (solo activos, para agendar/mostrar en
 * el lienzo), esta lista TODOS — activos e inactivos — para la pantalla de
 * Configuración, donde la dueña necesita ver y reactivar a alguien que
 * desactivó por error.
 */
async function listarAsesoresConfig(supabase, company_id) {
  const { data, error } = await supabase
    .from('asesores')
    .select('*')
    .eq('company_id', company_id)
    .order('nombre');

  return error ? [] : (data || []);
}

async function crearAsesor(supabase, company_id, { nombre, email }) {
  const { data, error } = await supabase
    .from('asesores')
    .insert({ company_id, nombre, email: email || null, activo: true })
    .select()
    .single();

  if (error) throw new Error(`agenda.crearAsesor: ${error.message}`);
  return data;
}

async function actualizarAsesor(supabase, company_id, id, cambios) {
  const campos = ['nombre', 'email', 'activo'];
  const payload = {};
  for (const campo of campos) if (cambios[campo] !== undefined) payload[campo] = cambios[campo];

  const { data, error } = await supabase
    .from('asesores')
    .update(payload)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar la técnica/asesor');
  return data;
}

async function eliminarAsesor(supabase, company_id, id) {
  const { error } = await supabase
    .from('asesores')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id);

  if (error) {
    if (error.code === '23503') {
      const err = new Error('No se puede eliminar: tiene citas u horarios asociados. Usa "Desactivar" en su lugar.');
      err.status = 409;
      throw err;
    }
    throw new Error('No se pudo eliminar la técnica/asesor');
  }
}

/**
 * Lista citas en un rango de fechas. Un Asesor solo ve las suyas (via su
 * asesor vinculado) — Owner/Administrador/Supervisor ven todas.
 */
async function listarCitas(supabase, company_id, usuario, { desde, hasta }) {
  let query = supabase
    .from('citas')
    .select('*, clientes(nombre, telefono), asesores(nombre)')
    .eq('company_id', company_id)
    .gte('inicio', desde)
    .lte('inicio', hasta)
    .order('inicio', { ascending: true });

  if (!ROLES_GERENCIALES.includes(usuario.rol)) {
    const asesorId = await resolverAsesorDeUsuario(supabase, company_id, usuario.id);
    if (!asesorId) return [];
    query = query.eq('asesor_id', asesorId);
  }

  const { data, error } = await query;
  return error ? [] : (data || []);
}

async function consultarDisponibilidad(supabase, company_id, { asesorId, fecha, duracionMinutos }) {
  const engine = await _schedulingEngineParaEmpresa(supabase, company_id);
  return engine.consultarDisponibilidad(company_id, { asesorId, fecha, duracionMinutos });
}

/**
 * Encuentra o crea un cliente por teléfono para alta manual desde Agenda
 * (cliente de sucursal/llamada, sin turno previo de WhatsApp). No duplica
 * si el teléfono ya existe en la empresa. No toca crm.js (frozen) — mismo
 * patrón de dedup, escritura directa sobre `clientes`.
 */
async function obtenerOCrearClienteManual(supabase, company_id, { telefono, nombre, empresa, notas }) {
  const { data: existente } = await supabase
    .from('clientes')
    .select('*')
    .eq('company_id', company_id)
    .eq('telefono', telefono)
    .maybeSingle();

  if (existente) return existente;

  const { data: nuevo, error } = await supabase
    .from('clientes')
    .insert([{
      telefono,
      company_id,
      nombre:        nombre || 'Sin nombre',
      empresa:       empresa || null,
      notas:         notas || null,
      fuente:        'Manual',
      estado:        'Nuevo',
      score_interes: 0,
    }])
    .select()
    .single();

  if (error) throw new Error(`agenda.obtenerOCrearClienteManual: ${error.message}`);
  return nuevo;
}

/**
 * Crea una cita nueva. Un Asesor solo puede agendar para sí mismo (asesorId
 * se fuerza a su propio asesor vinculado, ignorando cualquier otro valor).
 */
async function crearCita(supabase, company_id, usuario, { clienteId, asesorId, inicio, fin }) {
  let asesorFinal = asesorId;

  if (!ROLES_GERENCIALES.includes(usuario.rol)) {
    asesorFinal = await resolverAsesorDeUsuario(supabase, company_id, usuario.id);
    if (!asesorFinal) {
      const err = new Error('Tu usuario no tiene un asesor de agenda vinculado');
      err.status = 403;
      throw err;
    }
  }

  const engine = await _schedulingEngineParaEmpresa(supabase, company_id);
  return engine.agendarCita(company_id, { clienteId, asesorId: asesorFinal, inicio, fin });
}

async function _obtenerCitaPropia(supabase, company_id, usuario, citaId) {
  const { data: cita, error } = await supabase
    .from('citas')
    .select('*')
    .eq('id', citaId)
    .eq('company_id', company_id)
    .maybeSingle();

  if (error || !cita) {
    const err = new Error('Cita no encontrada');
    err.status = 404;
    throw err;
  }

  if (!ROLES_GERENCIALES.includes(usuario.rol)) {
    const asesorId = await resolverAsesorDeUsuario(supabase, company_id, usuario.id);
    if (!asesorId || cita.asesor_id !== asesorId) {
      const err = new Error('No puedes modificar la cita de otro asesor');
      err.status = 403;
      throw err;
    }
  }

  return cita;
}

async function reagendarCita(supabase, company_id, usuario, citaId, nuevoInicio, nuevoFin) {
  const cita = await _obtenerCitaPropia(supabase, company_id, usuario, citaId);
  const engine = await _schedulingEngineParaEmpresa(supabase, company_id);
  return engine.reagendarCita(cita, nuevoInicio, nuevoFin);
}

async function cancelarCita(supabase, company_id, usuario, citaId) {
  const cita = await _obtenerCitaPropia(supabase, company_id, usuario, citaId);
  const engine = await _schedulingEngineParaEmpresa(supabase, company_id);
  return engine.cancelarCita(cita);
}

/**
 * Motor de Agenda Universal (Fase 1): marca una cita como inasistencia.
 * `no_show` ya era un valor válido en el modelo (migración 017) — solo
 * faltaba una función que lo escriba. Reusa `_obtenerCitaPropia` para la
 * misma validación de pertenencia/rol que reagendar/cancelar. No hay un
 * método equivalente en SchedulingEngine (congelado) porque esto no toca
 * disponibilidad ni calendario externo — es solo un cambio de estado, y
 * nunca se llama sola: siempre la dispara un clic explícito de la usuaria.
 */
async function marcarNoShow(supabase, company_id, usuario, citaId) {
  const cita = await _obtenerCitaPropia(supabase, company_id, usuario, citaId);

  const { data, error } = await supabase
    .from('citas')
    .update({ estado: 'no_show', updated_at: new Date().toISOString() })
    .eq('id', cita.id)
    .eq('company_id', company_id)
    .select()
    .single();

  if (error) throw new Error(`agenda.marcarNoShow: ${error.message}`);
  return data;
}

/**
 * Vincula un asesor de agenda con un usuario del panel — base multiusuario
 * del SaaS. Solo Owner/Administrador. Valida que el usuario pertenezca a la
 * misma empresa antes de vincular.
 */
async function vincularUsuarioAAsesor(supabase, company_id, asesorId, usuarioId) {
  if (usuarioId) {
    const { data: pertenece } = await supabase
      .from('usuarios_empresas')
      .select('usuario_id')
      .eq('usuario_id', usuarioId)
      .eq('company_id', company_id)
      .eq('activo', true)
      .maybeSingle();

    if (!pertenece) {
      const err = new Error('Ese usuario no pertenece a esta empresa');
      err.status = 400;
      throw err;
    }
  }

  const { data, error } = await supabase
    .from('asesores')
    .update({ usuario_id: usuarioId || null })
    .eq('id', asesorId)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo vincular el asesor');
  return data;
}

module.exports = {
  listarAsesores,
  listarAsesoresConfig,
  crearAsesor,
  actualizarAsesor,
  eliminarAsesor,
  listarCitas,
  consultarDisponibilidad,
  obtenerOCrearClienteManual,
  crearCita,
  reagendarCita,
  cancelarCita,
  marcarNoShow,
  vincularUsuarioAAsesor,
  resolverAsesorDeUsuario,
};
