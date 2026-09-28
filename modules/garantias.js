/**
 * TARA Matrix™ — garantias.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2H del bloque operativo post-venta (Alina, 2026-09-28, ver
 * NORT_ENERGY_PORTAL_PLAN.md). CORE genérico — nace SIEMPRE de un
 * `equipo_instalado` real (2D): marca/modelo/número de serie/fecha de
 * instalación se SNAPSHOTEAN una sola vez al crear la garantía, el asesor
 * nunca los vuelve a capturar (mismo principio de snapshot-at-creation-time
 * que proyectos.config_vendida/instalaciones.checklist).
 *
 * Idempotente vía índice único (equipo_instalado_id) + 23505 — mismo
 * patrón lazy get-or-create que pagos_cliente (2B): crear la garantía de
 * un equipo que ya tiene una devuelve la existente, nunca duplica.
 *
 * Vigencia (`vencida`/`dias_restantes`) se calcula siempre, nunca se
 * guarda — mismo criterio que inventario.disponible/cobranza.estado.
 *
 * @module modules/garantias
 */

'use strict';

const ESTADOS_RECLAMACION = ['abierta', 'en_revision', 'aprobada', 'rechazada', 'resuelta'];

/** Vigencia pura — sin fecha_inicio o meses_garantia conocidos, no se puede calcular (nunca inventa un vencimiento). */
function calcularVigenciaGarantia(fechaInicio, mesesGarantia, hoy = new Date()) {
  if (!fechaInicio || !Number.isFinite(mesesGarantia)) return { fecha_fin: null, dias_restantes: null, vigente: null };

  const fin = new Date(`${fechaInicio}T00:00:00`);
  fin.setMonth(fin.getMonth() + mesesGarantia);
  const diasRestantes = Math.ceil((fin.getTime() - hoy.getTime()) / (24 * 60 * 60 * 1000));
  return { fecha_fin: fin.toISOString().slice(0, 10), dias_restantes: diasRestantes, vigente: diasRestantes >= 0 };
}

async function _enriquecerGarantia(supabase, companyId, garantia) {
  if (!garantia) return null;
  const { data: equipo } = await supabase
    .from('equipos_instalados').select('tipo_equipo, marca, modelo, numero_serie, fecha_instalacion, proyecto_id')
    .eq('id', garantia.equipo_instalado_id).eq('company_id', companyId).maybeSingle();
  const vigencia = calcularVigenciaGarantia(garantia.fecha_inicio, garantia.meses_garantia);
  return { ...garantia, equipo: equipo || null, ...vigencia };
}

/**
 * Crea la garantía a partir del equipo — o devuelve la existente si ya se
 * había creado (idempotente). Snapshotea fecha_inicio/meses_garantia/
 * proveedor del equipo en ESTE momento; cambios futuros al equipo nunca
 * alteran retroactivamente la garantía ya creada.
 */
async function crearGarantiaDesdeEquipo(supabase, { companyId, equipoInstaladoId, usuarioId }) {
  const { data: equipo } = await supabase
    .from('equipos_instalados').select('id, fecha_instalacion, garantia_meses, proveedor').eq('id', equipoInstaladoId).eq('company_id', companyId).maybeSingle();
  if (!equipo) {
    const err = new Error('Equipo instalado no encontrado');
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabase.from('garantias').insert([{
    company_id: companyId, equipo_instalado_id: equipoInstaladoId,
    fecha_inicio: equipo.fecha_instalacion || null, meses_garantia: equipo.garantia_meses ?? null,
    proveedor: equipo.proveedor || null, registrado_por: usuarioId || null,
  }]).select().single();

  if (error?.code === '23505') {
    const { data: yaExistia } = await supabase.from('garantias').select('*').eq('company_id', companyId).eq('equipo_instalado_id', equipoInstaladoId).maybeSingle();
    return _enriquecerGarantia(supabase, companyId, yaExistia);
  }
  if (error) throw new Error(`garantias.crearGarantiaDesdeEquipo: ${error.message}`);
  return _enriquecerGarantia(supabase, companyId, data);
}

async function obtenerGarantia(supabase, companyId, garantiaId) {
  const { data } = await supabase.from('garantias').select('*').eq('id', garantiaId).eq('company_id', companyId).maybeSingle();
  if (!data) return null;
  return _enriquecerGarantia(supabase, companyId, data);
}

async function obtenerGarantiaDeEquipo(supabase, companyId, equipoInstaladoId) {
  const { data } = await supabase.from('garantias').select('*').eq('company_id', companyId).eq('equipo_instalado_id', equipoInstaladoId).maybeSingle();
  if (!data) return null;
  return _enriquecerGarantia(supabase, companyId, data);
}

/** Vista global — todas las garantías de la empresa, con vigencia calculada. */
async function listarGarantias(supabase, companyId) {
  const { data, error } = await supabase.from('garantias').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) return [];
  return Promise.all((data || []).map((g) => _enriquecerGarantia(supabase, companyId, g)));
}

const CAMPOS_GARANTIA_EDITABLES = ['fecha_inicio', 'meses_garantia', 'proveedor', 'notas'];

async function actualizarGarantia(supabase, { companyId, garantiaId, cambios }) {
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_GARANTIA_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  const { data, error } = await supabase.from('garantias').update(payload).eq('id', garantiaId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Garantía no encontrada');
    err.status = 404;
    throw err;
  }
  return _enriquecerGarantia(supabase, companyId, data);
}

// ── Reclamaciones ────────────────────────────────────────────────────────────

async function _enriquecerReclamacion(supabase, companyId, reclamacion) {
  if (!reclamacion) return null;
  const { data: eventos } = await supabase
    .from('garantia_reclamacion_eventos').select('*').eq('company_id', companyId).eq('reclamacion_id', reclamacion.id).order('created_at', { ascending: true });
  return { ...reclamacion, eventos: eventos || [] };
}

/** Verifica que la garantía sea real y de esta empresa antes de abrir la reclamación. */
async function crearReclamacion(supabase, { companyId, garantiaId, descripcion, usuarioId }) {
  if (!descripcion || !descripcion.trim()) {
    const err = new Error('La descripción de la reclamación es requerida.');
    err.status = 400;
    throw err;
  }
  const { data: garantia } = await supabase.from('garantias').select('id').eq('id', garantiaId).eq('company_id', companyId).maybeSingle();
  if (!garantia) {
    const err = new Error('Garantía no encontrada');
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabase.from('garantia_reclamaciones').insert([{
    company_id: companyId, garantia_id: garantiaId, descripcion: descripcion.trim(), registrado_por: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`garantias.crearReclamacion: ${error.message}`);

  await supabase.from('garantia_reclamacion_eventos').insert([{
    company_id: companyId, reclamacion_id: data.id, tipo: 'creada', texto: descripcion.trim(), autor_id: usuarioId || null,
  }]);

  return _enriquecerReclamacion(supabase, companyId, data);
}

async function obtenerReclamacion(supabase, companyId, reclamacionId) {
  const { data } = await supabase.from('garantia_reclamaciones').select('*').eq('id', reclamacionId).eq('company_id', companyId).maybeSingle();
  if (!data) return null;
  return _enriquecerReclamacion(supabase, companyId, data);
}

async function listarReclamacionesDeGarantia(supabase, companyId, garantiaId) {
  const { data, error } = await supabase
    .from('garantia_reclamaciones').select('*').eq('company_id', companyId).eq('garantia_id', garantiaId).order('created_at', { ascending: false });
  if (error) return [];
  return Promise.all((data || []).map((r) => _enriquecerReclamacion(supabase, companyId, r)));
}

/** Cambia el estado — transición libre (no rígida), deja un evento propio (no bitacora_decisiones — ver migración 121). */
async function actualizarEstadoReclamacion(supabase, { companyId, reclamacionId, estado, usuarioId }) {
  if (!ESTADOS_RECLAMACION.includes(estado)) {
    const err = new Error(`Estado "${estado}" no reconocido.`);
    err.status = 400;
    throw err;
  }

  const { data: actual } = await supabase.from('garantia_reclamaciones').select('id, estado').eq('id', reclamacionId).eq('company_id', companyId).maybeSingle();
  if (!actual) {
    const err = new Error('Reclamación no encontrada');
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('garantia_reclamaciones').update({ estado, updated_at: new Date().toISOString() }).eq('id', reclamacionId).eq('company_id', companyId).select().single();
  if (error) throw new Error(`garantias.actualizarEstadoReclamacion: ${error.message}`);

  await supabase.from('garantia_reclamacion_eventos').insert([{
    company_id: companyId, reclamacion_id: reclamacionId, tipo: 'cambio_estado',
    texto: `"${actual.estado}" → "${estado}"`, autor_id: usuarioId || null,
  }]);

  return _enriquecerReclamacion(supabase, companyId, data);
}

/** Agrega un comentario a la línea de tiempo sin cambiar el estado. */
async function agregarComentarioReclamacion(supabase, { companyId, reclamacionId, texto, usuarioId }) {
  if (!texto || !texto.trim()) {
    const err = new Error('El comentario no puede estar vacío.');
    err.status = 400;
    throw err;
  }
  const { data: reclamacion } = await supabase.from('garantia_reclamaciones').select('id').eq('id', reclamacionId).eq('company_id', companyId).maybeSingle();
  if (!reclamacion) {
    const err = new Error('Reclamación no encontrada');
    err.status = 404;
    throw err;
  }

  const { error } = await supabase.from('garantia_reclamacion_eventos').insert([{
    company_id: companyId, reclamacion_id: reclamacionId, tipo: 'comentario', texto: texto.trim(), autor_id: usuarioId || null,
  }]);
  if (error) throw new Error(`garantias.agregarComentarioReclamacion: ${error.message}`);

  return obtenerReclamacion(supabase, companyId, reclamacionId);
}

module.exports = {
  ESTADOS_RECLAMACION, calcularVigenciaGarantia,
  crearGarantiaDesdeEquipo, obtenerGarantia, obtenerGarantiaDeEquipo, listarGarantias, actualizarGarantia,
  crearReclamacion, obtenerReclamacion, listarReclamacionesDeGarantia, actualizarEstadoReclamacion, agregarComentarioReclamacion,
};
