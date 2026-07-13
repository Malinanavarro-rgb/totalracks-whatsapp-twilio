/**
 * TARA Matrix™ — configuracion.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 6: Configuración de empresa. Solo expone campos de
 * negocio — los parámetros técnicos del motor de IA (modelo, temperatura,
 * max_tokens, reglas, campos_requeridos, max_turnos_memoria,
 * kb_max_secciones) nunca se leen ni se escriben desde aquí; siguen siendo
 * de administración exclusiva de TARA (vía SQL directo).
 *
 * `skills` (Pivote a producto, Fase 1.4) SÍ es de negocio — es la lista de
 * habilidades que el cliente activa/desactiva para su asistente
 * ([{nombre, activo}], ver modules/context-builder.js:238-241) — se movió
 * aquí desde la lista de "solo SQL" anterior.
 *
 * Cualquier escritura sobre `personalities`/`knowledge_base` invalida la
 * caché de modules/config.js para que el cambio tenga efecto inmediato en
 * la próxima conversación, sin esperar el TTL de 5 minutos.
 *
 * @module modules/configuracion
 */

'use strict';

const { invalidarCache } = require('./config');
const { horaLocalAUTC } = require('./scheduling-engine');

const CAMPOS_PERSONALIDAD = [
  'nombre_asistente', 'cargo', 'tono', 'objetivo', 'idioma',
  'mensaje_bienvenida', 'firma', 'longitud_respuesta', 'uso_emojis', 'nivel_iniciativa',
  'mensaje_fuera_horario', 'mensaje_error_tecnico', 'skills',
];

// ── PERSONALIDAD ──────────────────────────────────────────────────────────────

async function obtenerPersonalidad(supabase, company_id) {
  const { data, error } = await supabase
    .from('personalities')
    .select(CAMPOS_PERSONALIDAD.join(', '))
    .eq('company_id', company_id)
    .maybeSingle();

  if (error) throw new Error('No se pudo obtener la personalidad');
  return data;
}

async function actualizarPersonalidad(supabase, company_id, cambios) {
  const payload = {};
  for (const campo of CAMPOS_PERSONALIDAD) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  if (Object.keys(payload).length === 0) {
    const err = new Error('Sin campos válidos para actualizar');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('personalities')
    .update(payload)
    .eq('company_id', company_id)
    .select(CAMPOS_PERSONALIDAD.join(', '))
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar la personalidad');
  invalidarCache(company_id);
  return data;
}

// ── KNOWLEDGE BASE ─────────────────────────────────────────────────────────────

async function listarKnowledgeBase(supabase, company_id) {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('company_id', company_id)
    .order('categoria');

  return error ? [] : (data || []);
}

async function crearKnowledgeBase(supabase, company_id, { categoria, contenido }) {
  const { data, error } = await supabase
    .from('knowledge_base')
    .insert([{ company_id, categoria, contenido }])
    .select()
    .single();

  if (error) throw new Error(`configuracion.crearKnowledgeBase: ${error.message}`);
  invalidarCache(company_id);
  return data;
}

async function actualizarKnowledgeBase(supabase, company_id, id, { categoria, contenido }) {
  const payload = {};
  if (categoria !== undefined) payload.categoria = categoria;
  if (contenido !== undefined) payload.contenido = contenido;

  const { data, error } = await supabase
    .from('knowledge_base')
    .update(payload)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el conocimiento');
  invalidarCache(company_id);
  return data;
}

async function eliminarKnowledgeBase(supabase, company_id, id) {
  const { error } = await supabase
    .from('knowledge_base')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id);

  if (error) throw new Error('No se pudo eliminar el conocimiento');
  invalidarCache(company_id);
}

// ── HORARIOS LABORALES (citas — Anexo A) ──────────────────────────────────────

async function listarHorarios(supabase, company_id) {
  const { data, error } = await supabase
    .from('horarios_laborales')
    .select('*')
    .eq('company_id', company_id)
    .order('dia_semana');

  return error ? [] : (data || []);
}

async function crearHorario(supabase, company_id, { asesor_id, dia_semana, hora_inicio, hora_fin, zona_horaria }) {
  const { data, error } = await supabase
    .from('horarios_laborales')
    .insert([{
      company_id,
      asesor_id:    asesor_id || null,
      dia_semana,
      hora_inicio,
      hora_fin,
      zona_horaria: zona_horaria || 'America/Monterrey',
    }])
    .select()
    .single();

  if (error) throw new Error(`configuracion.crearHorario: ${error.message}`);
  return data;
}

async function actualizarHorario(supabase, company_id, id, cambios) {
  const campos = ['dia_semana', 'hora_inicio', 'hora_fin', 'zona_horaria', 'asesor_id'];
  const payload = {};
  for (const campo of campos) if (cambios[campo] !== undefined) payload[campo] = cambios[campo];

  const { data, error } = await supabase
    .from('horarios_laborales')
    .update(payload)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el horario');
  return data;
}

async function eliminarHorario(supabase, company_id, id) {
  const { error } = await supabase
    .from('horarios_laborales')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id);

  if (error) throw new Error('No se pudo eliminar el horario');
}

// ── HORARIO DE ATENCIÓN DEL BOT (distinto de horarios_laborales) ─────────────

async function listarHorarioAtencionBot(supabase, company_id) {
  const { data, error } = await supabase
    .from('horario_atencion_bot')
    .select('*')
    .eq('company_id', company_id)
    .order('dia_semana');

  return error ? [] : (data || []);
}

async function guardarHorarioAtencionBot(supabase, company_id, { dia_semana, hora_inicio, hora_fin, zona_horaria }) {
  const { data, error } = await supabase
    .from('horario_atencion_bot')
    .upsert(
      [{ company_id, dia_semana, hora_inicio, hora_fin, zona_horaria: zona_horaria || 'America/Monterrey' }],
      { onConflict: 'company_id,dia_semana' }
    )
    .select()
    .single();

  if (error) throw new Error(`configuracion.guardarHorarioAtencionBot: ${error.message}`);
  return data;
}

async function eliminarHorarioAtencionBot(supabase, company_id, id) {
  const { error } = await supabase
    .from('horario_atencion_bot')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id);

  if (error) throw new Error('No se pudo eliminar el horario de atención');
}

// ── SERVICIOS ──────────────────────────────────────────────────────────────────

async function listarServicios(supabase, company_id) {
  const { data, error } = await supabase
    .from('servicios')
    .select('*')
    .eq('company_id', company_id)
    .order('nombre');

  return error ? [] : (data || []);
}

async function crearServicio(supabase, company_id, { nombre, duracion_minutos, precio }) {
  const { data, error } = await supabase
    .from('servicios')
    .insert([{
      company_id, nombre,
      duracion_minutos: duracion_minutos || 30,
      precio:            precio ?? null,
      activo:            true,
    }])
    .select()
    .single();

  if (error) throw new Error(`configuracion.crearServicio: ${error.message}`);
  return data;
}

async function actualizarServicio(supabase, company_id, id, cambios) {
  const campos = ['nombre', 'duracion_minutos', 'precio', 'activo'];
  const payload = {};
  for (const campo of campos) if (cambios[campo] !== undefined) payload[campo] = cambios[campo];

  const { data, error } = await supabase
    .from('servicios')
    .update(payload)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el servicio');
  return data;
}

async function eliminarServicio(supabase, company_id, id) {
  const { error } = await supabase
    .from('servicios')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id);

  if (error) throw new Error('No se pudo eliminar el servicio');
}

// ── PIPELINE DE OPORTUNIDADES (Pivote a producto, Fase 2.2) ──────────────────
// Reemplaza el arreglo ESTADOS hardcodeado que antes mezclaba estado de
// cliente y de oportunidad — este catálogo es exclusivamente para
// oportunidades.estado, configurable por empresa (migración 042).

async function listarPipelineEtapas(supabase, company_id) {
  const { data, error } = await supabase
    .from('pipeline_etapas')
    .select('*')
    .eq('company_id', company_id)
    .order('orden');

  return error ? [] : (data || []);
}

async function crearPipelineEtapa(supabase, company_id, { nombre, orden }) {
  const { data, error } = await supabase
    .from('pipeline_etapas')
    .insert([{ company_id, nombre, orden: orden ?? 0, activo: true }])
    .select()
    .single();

  if (error) throw new Error(`configuracion.crearPipelineEtapa: ${error.message}`);
  return data;
}

async function actualizarPipelineEtapa(supabase, company_id, id, cambios) {
  const campos = ['nombre', 'orden', 'activo'];
  const payload = {};
  for (const campo of campos) if (cambios[campo] !== undefined) payload[campo] = cambios[campo];

  const { data, error } = await supabase
    .from('pipeline_etapas')
    .update(payload)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar la etapa');
  return data;
}

async function eliminarPipelineEtapa(supabase, company_id, id) {
  const { error } = await supabase
    .from('pipeline_etapas')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id);

  if (error) throw new Error('No se pudo eliminar la etapa');
}

// ── CANALES (solo lectura en MVP + estado de Google Calendar) ────────────────

async function listarCanales(supabase, company_id) {
  const [canalesRes, calendarRes] = await Promise.all([
    supabase.from('channel_endpoints').select('endpoint, canal, activo').eq('company_id', company_id),
    supabase.from('calendar_credentials').select('proveedor, created_at').eq('company_id', company_id).eq('activo', true).maybeSingle(),
  ]);

  return {
    canales:         canalesRes.data || [],
    googleCalendar:  calendarRes.data ? { conectado: true, ...calendarRes.data } : { conectado: false },
  };
}

// ── WEBHOOK (usados desde server.js — capa de plataforma, cero cambios Core) ──

/**
 * ¿TARA debe responder ahora mismo? Distinto de horarios_laborales (citas,
 * Anexo A). Sin fila configurada para el día = sin restricción (24/7 por
 * default) — el MVP es opt-in, no rompe empresas que no configuren nada.
 * Mismo enfoque de día-de-semana en UTC que SchedulingEngine._obtenerHorario
 * (simplificación ya aceptada y validada en el motor).
 */
async function estaDentroDeHorarioAtencion(supabase, company_id, ahora = new Date()) {
  const { data, error } = await supabase
    .from('horario_atencion_bot')
    .select('*')
    .eq('company_id', company_id)
    .eq('dia_semana', ahora.getUTCDay())
    .maybeSingle();

  if (error || !data) return true;

  const inicio = horaLocalAUTC(ahora, data.hora_inicio, data.zona_horaria);
  const fin    = horaLocalAUTC(ahora, data.hora_fin, data.zona_horaria);

  return ahora >= inicio && ahora <= fin;
}

/**
 * ¿Es el primer contacto de este cliente? Usado para anteponer
 * mensaje_bienvenida solo una vez, no en cada turno.
 */
async function esPrimerContacto(supabase, clienteId) {
  const { count, error } = await supabase
    .from('conversaciones')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId);

  return error ? false : (count || 0) === 0;
}

module.exports = {
  obtenerPersonalidad, actualizarPersonalidad,
  listarKnowledgeBase, crearKnowledgeBase, actualizarKnowledgeBase, eliminarKnowledgeBase,
  listarHorarios, crearHorario, actualizarHorario, eliminarHorario,
  listarHorarioAtencionBot, guardarHorarioAtencionBot, eliminarHorarioAtencionBot,
  listarServicios, crearServicio, actualizarServicio, eliminarServicio,
  listarPipelineEtapas, crearPipelineEtapa, actualizarPipelineEtapa, eliminarPipelineEtapa,
  listarCanales,
  estaDentroDeHorarioAtencion, esPrimerContacto,
};
