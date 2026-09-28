/**
 * TARA Matrix™ — tramites-cfe.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2E del bloque operativo post-venta (Alina, 2026-09-28, ver
 * NORT_ENERGY_PORTAL_PLAN.md). VERTICAL solar puro — sin integración
 * directa con CFE, seguimiento manual tal como se pidió.
 *
 * Estado libre (10 valores, transición libre — mismo criterio que
 * instalaciones.estado, ver migración 120). `ultima_actualizacion` se
 * actualiza en cada cambio y es la base del "badge de alerta": un trámite
 * sin movimiento por más de `companies.umbral_dias_alerta_cfe` días (o el
 * default de 7 si la empresa no lo configuró) se marca `alerta: true` —
 * nunca un número fijo enterrado en el motor.
 *
 * Documentos del trámite (identificación, comprobante de domicilio,
 * contrato, dictamen) reutilizan `documentos_cliente` con
 * categoria='tramite_cfe' vía los endpoints YA existentes
 * (/api/crm/clientes/:id/documentos) — ninguna columna nueva ahí.
 *
 * @module modules/tramites-cfe
 */

'use strict';

const ESTADOS_TRAMITE_CFE = [
  'pendiente', 'documentos_en_revision', 'ingresado_cfe', 'en_revision_cfe',
  'visita_tecnica_programada', 'visita_tecnica_realizada', 'contrato_firmado',
  'medidor_solicitado', 'medidor_instalado', 'interconexion_completada',
];

const UMBRAL_ALERTA_DEFAULT_DIAS = 7;

/** Días completos sin actualización — pura, fácil de probar con fechas fijas. */
function calcularDiasSinActualizacion(ultimaActualizacion, hoy = new Date()) {
  if (!ultimaActualizacion) return null;
  const ms = hoy.getTime() - new Date(ultimaActualizacion).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/** true si el trámite lleva más días sin actualizar que el umbral, o ya está completado (nunca alerta uno cerrado). */
function requiereAlerta(estado, diasSinActualizacion, umbralDias) {
  if (estado === 'interconexion_completada') return false;
  if (diasSinActualizacion == null) return false;
  return diasSinActualizacion > umbralDias;
}

function _conAlerta(tramite, umbralDias) {
  const dias = calcularDiasSinActualizacion(tramite.ultima_actualizacion);
  return { ...tramite, dias_sin_actualizacion: dias, alerta: requiereAlerta(tramite.estado, dias, umbralDias) };
}

async function _resolverUmbral(supabase, companyId) {
  const { data } = await supabase.from('companies').select('umbral_dias_alerta_cfe').eq('id', companyId).maybeSingle();
  return data?.umbral_dias_alerta_cfe ?? UMBRAL_ALERTA_DEFAULT_DIAS;
}

/** Crea el trámite — valida que el proyecto sea real y de esta empresa antes de insertar. */
async function crearTramiteCfe(supabase, { companyId, proyectoId, usuarioId }) {
  const { data: proyecto } = await supabase.from('proyectos').select('id, cliente_id').eq('id', proyectoId).eq('company_id', companyId).maybeSingle();
  if (!proyecto) {
    const err = new Error('Proyecto no encontrado');
    err.status = 404;
    throw err;
  }

  const ahora = new Date().toISOString();
  const { data, error } = await supabase.from('tramites_cfe').insert([{
    company_id: companyId, proyecto_id: proyectoId, estado: 'pendiente',
    fecha_inicio: ahora.slice(0, 10), ultima_actualizacion: ahora, responsable_id: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`tramites-cfe.crearTramiteCfe: ${error.message}`);

  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId, texto: 'Trámite CFE iniciado.', contexto: 'Trámite CFE',
    autor_id: usuarioId || null, cliente_id: proyecto.cliente_id, proyecto_id: proyectoId,
  }]);

  const umbral = await _resolverUmbral(supabase, companyId);
  return _conAlerta(data, umbral);
}

async function obtenerTramiteCfe(supabase, companyId, tramiteId) {
  const { data } = await supabase.from('tramites_cfe').select('*').eq('id', tramiteId).eq('company_id', companyId).maybeSingle();
  if (!data) return null;
  const umbral = await _resolverUmbral(supabase, companyId);
  return _conAlerta(data, umbral);
}

/** El trámite más reciente de un proyecto (normalmente hay uno solo, pero no se fuerza unicidad — un trámite abandonado puede reiniciarse con uno nuevo). */
async function obtenerTramiteDeProyecto(supabase, companyId, proyectoId) {
  const { data } = await supabase
    .from('tramites_cfe').select('*').eq('company_id', companyId).eq('proyecto_id', proyectoId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const umbral = await _resolverUmbral(supabase, companyId);
  return _conAlerta(data, umbral);
}

/** Listado/tablero — todos los trámites de la empresa, con alerta calculada, opcionalmente filtrado por estado. */
async function listarTramitesCfe(supabase, companyId, { estado } = {}) {
  let query = supabase.from('tramites_cfe').select('*').eq('company_id', companyId).order('ultima_actualizacion', { ascending: true });
  if (estado) query = query.eq('estado', estado);
  const { data, error } = await query;
  if (error) return [];
  const umbral = await _resolverUmbral(supabase, companyId);
  return (data || []).map((t) => _conAlerta(t, umbral));
}

const CAMPOS_TRAMITE_EDITABLES = ['fecha_ingreso', 'folio_cfe', 'medidor_bidireccional', 'notas', 'responsable_id'];

/** Edita campos (no el estado — ver actualizarEstadoTramiteCfe) — siempre bump de ultima_actualizacion. */
async function actualizarTramiteCfe(supabase, { companyId, tramiteId, cambios }) {
  const payload = { ultima_actualizacion: new Date().toISOString() };
  for (const campo of CAMPOS_TRAMITE_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const { data, error } = await supabase.from('tramites_cfe').update(payload).eq('id', tramiteId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Trámite CFE no encontrado');
    err.status = 404;
    throw err;
  }
  const umbral = await _resolverUmbral(supabase, companyId);
  return _conAlerta(data, umbral);
}

/** Cambia el estado — cualquier valor del vocabulario es alcanzable desde cualquiera (deliberadamente no rígido). Deja rastro en bitácora. */
async function actualizarEstadoTramiteCfe(supabase, { companyId, tramiteId, estado, usuarioId }) {
  if (!ESTADOS_TRAMITE_CFE.includes(estado)) {
    const err = new Error(`Estado "${estado}" no reconocido.`);
    err.status = 400;
    throw err;
  }

  const { data: actual } = await supabase.from('tramites_cfe').select('id, estado, proyecto_id, company_id').eq('id', tramiteId).eq('company_id', companyId).maybeSingle();
  if (!actual) {
    const err = new Error('Trámite CFE no encontrado');
    err.status = 404;
    throw err;
  }

  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from('tramites_cfe').update({ estado, ultima_actualizacion: ahora }).eq('id', tramiteId).eq('company_id', companyId).select().single();
  if (error) throw new Error(`tramites-cfe.actualizarEstadoTramiteCfe: ${error.message}`);

  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId, texto: `Trámite CFE: "${actual.estado}" → "${estado}".`,
    contexto: 'Trámite CFE', autor_id: usuarioId || null, proyecto_id: actual.proyecto_id,
  }]);

  const umbral = await _resolverUmbral(supabase, companyId);
  return _conAlerta(data, umbral);
}

module.exports = {
  ESTADOS_TRAMITE_CFE, UMBRAL_ALERTA_DEFAULT_DIAS, calcularDiasSinActualizacion, requiereAlerta,
  crearTramiteCfe, obtenerTramiteCfe, obtenerTramiteDeProyecto, listarTramitesCfe, actualizarTramiteCfe, actualizarEstadoTramiteCfe,
};
