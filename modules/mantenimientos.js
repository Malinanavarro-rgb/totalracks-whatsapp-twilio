/**
 * TARA Matrix™ — mantenimientos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2I del bloque operativo post-venta (Alina, 2026-09-28, ver
 * NORT_ENERGY_PORTAL_PLAN.md) — la subfase con MÁS reutilización de todo
 * el bloque: checklist configurable (mismo mecanismo de checklists_config
 * que instalaciones/2C, tipo='mantenimiento'), y agenda/SchedulingEngine
 * para "programar el siguiente" (cero motor de recordatorios nuevo — ver
 * modules/agenda.js::schedulingEngineParaEmpresa, exportada para esto).
 *
 * "Estado" de un mantenimiento nunca se guarda — se deriva de
 * fecha_programada/fecha_realizada (mismo criterio que cobranza.estado,
 * inventario.disponible).
 *
 * `programarSiguienteMantenimiento` crea una cita REAL vía el mismo
 * SchedulingEngine que usa toda la Agenda TARA, y con ella una NUEVA fila
 * de `mantenimientos` (la próxima visita real, agendada) — el
 * `proximo_mantenimiento` del mantenimiento ACTUAL solo queda como
 * recordatorio de que ya se programó, la visita real vive en su propia
 * fila (mismo principio que instalaciones: un evento, no un campo suelto).
 *
 * @module modules/mantenimientos
 */

'use strict';

const { obtenerChecklistConfig } = require('./instalaciones');
const { schedulingEngineParaEmpresa } = require('./agenda');

/** Estado derivado — nunca guardado. */
function calcularEstadoMantenimiento({ fechaProgramada, fechaRealizada, hoy = new Date() }) {
  if (fechaRealizada) return 'realizado';
  if (!fechaProgramada) return 'pendiente';
  const hoyFecha = hoy.toISOString().slice(0, 10);
  return fechaProgramada < hoyFecha ? 'vencido' : 'programado';
}

async function _validarTecnico(supabase, companyId, tecnicoId) {
  if (!tecnicoId) return null;
  const { data } = await supabase.from('asesores').select('id, nombre').eq('id', tecnicoId).eq('company_id', companyId).maybeSingle();
  if (!data) {
    const err = new Error('Técnico no encontrado');
    err.status = 404;
    throw err;
  }
  return data;
}

async function _enriquecerMantenimiento(supabase, companyId, mantenimiento) {
  if (!mantenimiento) return null;
  const [tecnico] = await Promise.all([
    mantenimiento.tecnico_id
      ? supabase.from('asesores').select('nombre').eq('id', mantenimiento.tecnico_id).eq('company_id', companyId).maybeSingle().then((r) => r.data)
      : null,
  ]);
  return {
    ...mantenimiento, tecnico_nombre: tecnico?.nombre ?? null,
    estado: calcularEstadoMantenimiento({ fechaProgramada: mantenimiento.fecha_programada, fechaRealizada: mantenimiento.fecha_realizada }),
  };
}

/** Crea un mantenimiento — snapshotea el checklist configurable de la empresa (tipo='mantenimiento'), vacío si no se ha configurado ninguno. */
async function crearMantenimiento(supabase, { companyId, proyectoId, tipo, fechaProgramada, tecnicoId, notas, usuarioId }) {
  if (!tipo || !tipo.trim()) {
    const err = new Error('El tipo de mantenimiento es requerido.');
    err.status = 400;
    throw err;
  }
  const { data: proyecto } = await supabase.from('proyectos').select('id').eq('id', proyectoId).eq('company_id', companyId).maybeSingle();
  if (!proyecto) {
    const err = new Error('Proyecto no encontrado');
    err.status = 404;
    throw err;
  }
  await _validarTecnico(supabase, companyId, tecnicoId);

  const checklist = await obtenerChecklistConfig(supabase, companyId, 'mantenimiento');

  const { data, error } = await supabase.from('mantenimientos').insert([{
    company_id: companyId, proyecto_id: proyectoId, tipo: tipo.trim(), fecha_programada: fechaProgramada || null,
    tecnico_id: tecnicoId || null, checklist, notas: notas || null, registrado_por: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`mantenimientos.crearMantenimiento: ${error.message}`);

  return _enriquecerMantenimiento(supabase, companyId, data);
}

async function obtenerMantenimiento(supabase, companyId, mantenimientoId) {
  const { data } = await supabase.from('mantenimientos').select('*').eq('id', mantenimientoId).eq('company_id', companyId).maybeSingle();
  if (!data) return null;
  return _enriquecerMantenimiento(supabase, companyId, data);
}

async function listarMantenimientosDeProyecto(supabase, companyId, proyectoId) {
  const { data, error } = await supabase
    .from('mantenimientos').select('*').eq('company_id', companyId).eq('proyecto_id', proyectoId).order('created_at', { ascending: false });
  if (error) return [];
  return Promise.all((data || []).map((m) => _enriquecerMantenimiento(supabase, companyId, m)));
}

/** Vista global/tablero. */
async function listarMantenimientos(supabase, companyId) {
  const { data, error } = await supabase.from('mantenimientos').select('*').eq('company_id', companyId).order('fecha_programada', { ascending: true, nullsFirst: false });
  if (error) return [];
  return Promise.all((data || []).map((m) => _enriquecerMantenimiento(supabase, companyId, m)));
}

const CAMPOS_MANTENIMIENTO_EDITABLES = ['fecha_programada', 'fecha_realizada', 'mediciones', 'proximo_mantenimiento', 'notas'];

async function actualizarMantenimiento(supabase, { companyId, mantenimientoId, cambios }) {
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_MANTENIMIENTO_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  if (cambios.tecnicoId !== undefined) {
    await _validarTecnico(supabase, companyId, cambios.tecnicoId);
    payload.tecnico_id = cambios.tecnicoId;
  }

  const { data, error } = await supabase.from('mantenimientos').update(payload).eq('id', mantenimientoId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Mantenimiento no encontrado');
    err.status = 404;
    throw err;
  }
  return _enriquecerMantenimiento(supabase, companyId, data);
}

/** Marca ítems específicos como completados (checklist ya snapshoteado) — 404 si esa clave no existe. Mismo criterio que instalaciones.actualizarChecklistItem. */
async function actualizarChecklistItemMantenimiento(supabase, { companyId, mantenimientoId, clave, completado, usuarioId }) {
  const { data: mantenimiento } = await supabase.from('mantenimientos').select('checklist').eq('id', mantenimientoId).eq('company_id', companyId).maybeSingle();
  if (!mantenimiento) {
    const err = new Error('Mantenimiento no encontrado');
    err.status = 404;
    throw err;
  }
  const checklist = mantenimiento.checklist || [];
  const idx = checklist.findIndex((it) => it.clave === clave);
  if (idx === -1) {
    const err = new Error(`El checklist de este mantenimiento no tiene el ítem "${clave}".`);
    err.status = 404;
    throw err;
  }
  checklist[idx] = { ...checklist[idx], completado: Boolean(completado), completado_por: completado ? (usuarioId || null) : null, completado_en: completado ? new Date().toISOString() : null };

  const { data, error } = await supabase.from('mantenimientos').update({ checklist, updated_at: new Date().toISOString() }).eq('id', mantenimientoId).eq('company_id', companyId).select().single();
  if (error) throw new Error(`mantenimientos.actualizarChecklistItemMantenimiento: ${error.message}`);
  return _enriquecerMantenimiento(supabase, companyId, data);
}

/**
 * Programa la SIGUIENTE visita: crea una cita real (mismo SchedulingEngine
 * que toda la Agenda TARA) y, con ella, una NUEVA fila de mantenimientos
 * (la próxima visita agendada) — el mantenimiento actual solo guarda
 * `proximo_mantenimiento` como recordatorio de que ya se programó.
 */
async function programarSiguienteMantenimiento(supabase, { companyId, mantenimientoId, inicio, fin, usuarioId }) {
  const { data: actual } = await supabase.from('mantenimientos').select('*').eq('id', mantenimientoId).eq('company_id', companyId).maybeSingle();
  if (!actual) {
    const err = new Error('Mantenimiento no encontrado');
    err.status = 404;
    throw err;
  }
  if (!actual.tecnico_id) {
    const err = new Error('Este mantenimiento no tiene técnico asignado — asígnalo antes de programar la siguiente visita.');
    err.status = 409;
    throw err;
  }

  const { data: proyecto } = await supabase.from('proyectos').select('cliente_id').eq('id', actual.proyecto_id).eq('company_id', companyId).maybeSingle();
  if (!proyecto?.cliente_id) {
    const err = new Error('El proyecto de este mantenimiento no tiene un cliente asociado.');
    err.status = 409;
    throw err;
  }

  const engine = await schedulingEngineParaEmpresa(supabase, companyId);
  const cita = await engine.agendarCita(companyId, { clienteId: proyecto.cliente_id, asesorId: actual.tecnico_id, inicio, fin });

  const checklist = await obtenerChecklistConfig(supabase, companyId, 'mantenimiento');
  const { data: siguiente, error } = await supabase.from('mantenimientos').insert([{
    company_id: companyId, proyecto_id: actual.proyecto_id, tipo: actual.tipo, fecha_programada: inicio.toISOString().slice(0, 10),
    tecnico_id: actual.tecnico_id, checklist, cita_id: cita.id, registrado_por: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`mantenimientos.programarSiguienteMantenimiento: ${error.message}`);

  await supabase.from('mantenimientos').update({ proximo_mantenimiento: inicio.toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', mantenimientoId).eq('company_id', companyId);

  return { mantenimientoSiguiente: await _enriquecerMantenimiento(supabase, companyId, siguiente), cita };
}

module.exports = {
  calcularEstadoMantenimiento, crearMantenimiento, obtenerMantenimiento, listarMantenimientosDeProyecto, listarMantenimientos,
  actualizarMantenimiento, actualizarChecklistItemMantenimiento, programarSiguienteMantenimiento,
};
