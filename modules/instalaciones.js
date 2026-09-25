/**
 * TARA Matrix™ — instalaciones.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2C del bloque operativo post-venta (Alina, 2026-09-23, ver
 * NORT_ENERGY_PORTAL_PLAN.md). CORE genérico — instalar un panel solar o
 * un rack industrial usa exactamente el mismo mecanismo; lo específico de
 * cada industria vive en `detalle_tecnico` (jsonb) y en el CONTENIDO del
 * checklist (datos configurables, nunca código).
 *
 * Deliberadamente SIN estados rígidos: los 10 valores del CHECK son el
 * vocabulario permitido, pero cualquiera es alcanzable desde cualquiera —
 * "no quiero procesos rígidos imposibles de modificar después" (Alina).
 * Cada cambio de estado se anota en `bitacora_decisiones` (reutilizada,
 * nunca una tabla de historial nueva).
 *
 * El checklist se SNAPSHOTEA desde `checklists_config` al crear la
 * instalación — cambios futuros al catálogo de la empresa nunca alteran
 * una instalación ya en curso.
 *
 * @module modules/instalaciones
 */

'use strict';

const ESTADOS_INSTALACION = [
  'por_programar', 'programada', 'preparando_material', 'lista_para_instalacion', 'en_camino',
  'instalando', 'pruebas', 'terminada', 'pendiente_documentacion', 'entregada',
];

const CAMPOS_INSTALACION_EDITABLES = ['sucursal_id', 'responsable_id', 'fecha_programada', 'hora_programada', 'cuadrilla', 'detalle_tecnico', 'observaciones'];

/** El checklist configurado de la empresa para un tipo — [] si nunca lo configuró (nunca inventa uno). */
async function obtenerChecklistConfig(supabase, companyId, tipo = 'instalacion') {
  const { data } = await supabase.from('checklists_config').select('items').eq('company_id', companyId).eq('tipo', tipo).eq('activo', true).maybeSingle();
  return data?.items || [];
}

/** Alta/edición del checklist configurable de la empresa — upsert por (company_id, tipo). Gerencial-only desde la ruta. */
async function guardarChecklistConfig(supabase, companyId, tipo, items) {
  if (!Array.isArray(items)) {
    const err = new Error('items debe ser un arreglo');
    err.status = 400;
    throw err;
  }
  const itemsLimpios = items.map((it) => ({ clave: String(it.clave), etiqueta: String(it.etiqueta) }));

  const { data, error } = await supabase
    .from('checklists_config')
    .upsert([{ company_id: companyId, tipo, items: itemsLimpios, updated_at: new Date().toISOString() }], { onConflict: 'company_id,tipo' })
    .select().single();
  if (error) throw new Error(`instalaciones.guardarChecklistConfig: ${error.message}`);
  return data;
}

/** Nombres resueltos — mismo patrón de 3 consultas simples que proyectos.js (nunca un embed de PostgREST). */
async function _enriquecerInstalacion(supabase, companyId, instalacion) {
  if (!instalacion) return null;
  const { data: responsable } = instalacion.responsable_id
    ? await supabase.from('usuarios').select('nombre').eq('id', instalacion.responsable_id).maybeSingle()
    : { data: null };
  const { data: sucursal } = instalacion.sucursal_id
    ? await supabase.from('sucursales').select('nombre').eq('id', instalacion.sucursal_id).eq('company_id', companyId).maybeSingle()
    : { data: null };
  return { ...instalacion, responsable_nombre: responsable?.nombre ?? null, sucursal_nombre: sucursal?.nombre ?? null };
}

/**
 * Crea una instalación para un proyecto de venta ya existente — copia el
 * checklist vigente de la empresa (snapshot) y lo que el motor de
 * ingeniería sí sabe del sistema vendido (paneles/kWp/inversor); el resto
 * de `detalle_tecnico` (estructura, microinversores) queda null hasta que
 * alguien lo capture, nunca inventado.
 */
async function crearInstalacion(supabase, { companyId, proyectoId, sucursalId, responsableId, fechaProgramada, horaProgramada, cuadrilla, observaciones, usuarioId }) {
  const { data: proyecto } = await supabase.from('proyectos').select('id, cliente_id, config_vendida, sucursal_id').eq('id', proyectoId).eq('company_id', companyId).eq('tipo', 'venta').maybeSingle();
  if (!proyecto) {
    const err = new Error('Proyecto no encontrado');
    err.status = 404;
    throw err;
  }

  const checklist = (await obtenerChecklistConfig(supabase, companyId)).map((item) => ({ ...item, completado: false, completado_por: null, completado_en: null }));

  const v = proyecto.config_vendida || {};
  const detalleTecnico = {
    numero_paneles: v.panel?.cantidad ?? null,
    potencia_kwp: v.potencia_instalada_kwp ?? null,
    inversor: v.inversor ?? null,
    microinversores: null,
    estructura: null,
  };

  const { data, error } = await supabase.from('instalaciones').insert([{
    company_id: companyId, proyecto_id: proyectoId, sucursal_id: sucursalId || proyecto.sucursal_id || null,
    responsable_id: responsableId || null, fecha_programada: fechaProgramada || null, hora_programada: horaProgramada || null,
    cuadrilla: cuadrilla || [], estado: 'por_programar', checklist, detalle_tecnico: detalleTecnico, observaciones: observaciones || null,
  }]).select().single();
  if (error) throw new Error(`instalaciones.crearInstalacion: ${error.message}`);

  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId, texto: `Instalación creada para el proyecto — estado inicial "por programar".`,
    contexto: 'Instalación', autor_id: usuarioId || null, cliente_id: proyecto.cliente_id, proyecto_id: proyectoId,
  }]);

  return _enriquecerInstalacion(supabase, companyId, data);
}

async function obtenerInstalacion(supabase, companyId, instalacionId) {
  const { data, error } = await supabase.from('instalaciones').select('*').eq('id', instalacionId).eq('company_id', companyId).maybeSingle();
  if (error || !data) return null;
  return _enriquecerInstalacion(supabase, companyId, data);
}

async function listarInstalacionesDeProyecto(supabase, companyId, proyectoId) {
  const { data, error } = await supabase.from('instalaciones').select('*').eq('company_id', companyId).eq('proyecto_id', proyectoId).order('created_at', { ascending: false });
  if (error) return [];
  return Promise.all((data || []).map((i) => _enriquecerInstalacion(supabase, companyId, i)));
}

/** Lista/tablero — todas las instalaciones de la empresa, opcionalmente filtradas por estado. */
async function listarInstalaciones(supabase, companyId, { estado } = {}) {
  let query = supabase.from('instalaciones').select('*').eq('company_id', companyId).order('fecha_programada', { ascending: true, nullsFirst: false });
  if (estado) query = query.eq('estado', estado);
  const { data, error } = await query;
  if (error) return [];
  return Promise.all((data || []).map((i) => _enriquecerInstalacion(supabase, companyId, i)));
}

async function actualizarInstalacion(supabase, { companyId, instalacionId, cambios }) {
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_INSTALACION_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const { data, error } = await supabase.from('instalaciones').update(payload).eq('id', instalacionId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Instalación no encontrada');
    err.status = 404;
    throw err;
  }
  return _enriquecerInstalacion(supabase, companyId, data);
}

/** Cambia el estado — cualquier valor del vocabulario es alcanzable desde cualquiera (deliberadamente no rígido). Deja rastro en bitácora. */
async function actualizarEstadoInstalacion(supabase, { companyId, instalacionId, estado, usuarioId }) {
  if (!ESTADOS_INSTALACION.includes(estado)) {
    const err = new Error(`Estado "${estado}" no reconocido.`);
    err.status = 400;
    throw err;
  }

  const { data: actual } = await supabase.from('instalaciones').select('id, estado, proyecto_id, company_id').eq('id', instalacionId).eq('company_id', companyId).maybeSingle();
  if (!actual) {
    const err = new Error('Instalación no encontrada');
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('instalaciones').update({ estado, updated_at: new Date().toISOString() }).eq('id', instalacionId).eq('company_id', companyId).select().single();
  if (error) throw new Error(`instalaciones.actualizarEstadoInstalacion: ${error.message}`);

  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId, texto: `Instalación: "${actual.estado}" → "${estado}".`,
    contexto: 'Instalación', autor_id: usuarioId || null, proyecto_id: actual.proyecto_id,
  }]);

  return _enriquecerInstalacion(supabase, companyId, data);
}

/** Marca/desmarca UN ítem del checklist ya snapshoteado — 404 si esa instalación no tiene esa clave (nunca la agrega sola). */
async function actualizarChecklistItem(supabase, { companyId, instalacionId, clave, completado, usuarioId }) {
  const { data: instalacion } = await supabase.from('instalaciones').select('checklist').eq('id', instalacionId).eq('company_id', companyId).maybeSingle();
  if (!instalacion) {
    const err = new Error('Instalación no encontrada');
    err.status = 404;
    throw err;
  }

  const checklist = instalacion.checklist || [];
  const idx = checklist.findIndex((it) => it.clave === clave);
  if (idx === -1) {
    const err = new Error(`El checklist de esta instalación no tiene el ítem "${clave}".`);
    err.status = 404;
    throw err;
  }

  checklist[idx] = { ...checklist[idx], completado: Boolean(completado), completado_por: completado ? (usuarioId || null) : null, completado_en: completado ? new Date().toISOString() : null };

  const { data, error } = await supabase.from('instalaciones').update({ checklist, updated_at: new Date().toISOString() }).eq('id', instalacionId).eq('company_id', companyId).select().single();
  if (error) throw new Error(`instalaciones.actualizarChecklistItem: ${error.message}`);
  return _enriquecerInstalacion(supabase, companyId, data);
}

module.exports = {
  ESTADOS_INSTALACION, obtenerChecklistConfig, guardarChecklistConfig,
  crearInstalacion, obtenerInstalacion, listarInstalacionesDeProyecto, listarInstalaciones,
  actualizarInstalacion, actualizarEstadoInstalacion, actualizarChecklistItem,
};
