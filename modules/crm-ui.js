/**
 * TARA Matrix™ — crm-ui.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 5: CRM. Nombrado `crm-ui` (no `crm`) para no
 * confundirse con modules/crm.js, que es el write path congelado del motor
 * conversacional (ADR-005) — este módulo solo lee esas tablas y agrega
 * edición de campos no usados por el motor + seguimientos manuales
 * (tabla nueva, aditiva).
 *
 * La ficha de cliente reusa modules/conversaciones.js (obtenerHistorial) en
 * vez de reimplementar el combinado conversaciones+mensajes_humanos.
 *
 * @module modules/crm-ui
 */

'use strict';

const { obtenerHistorial } = require('./conversaciones');
const { ROLES_GERENCIALES } = require('./permisos');

const CAMPOS_EDITABLES  = ['nombre', 'empresa', 'ciudad', 'notas', 'estado'];
const CAMPOS_SEGUIMIENTO = ['texto', 'fecha_programada', 'prioridad', 'completado'];
// tipo_rack: nombre histórico de la columna (Total Racks, pre-multiempresa) —
// en realidad es "categoría de producto/servicio", genérico para cualquier
// giro de negocio. No se renombra: modules/crm.js (congelado, ADR-005)
// escribe directo a esta columna al crear oportunidades automáticas desde
// el bot — cambiar el nombre requeriría tocar el write path congelado.
const CAMPOS_OPORTUNIDAD = [
  'estado', 'tipo_rack', 'descripcion', 'presupuesto_estimado', 'presupuesto_confirmado',
  'probabilidad', 'proxima_accion', 'fecha_seguimiento', 'razon_cierre',
];

/**
 * Lista de clientes visibles para el usuario. Mismo criterio que
 * conversaciones (Fase 3): un Asesor ve los suyos + el pool sin asignar.
 */
/**
 * @param {Object} [filtros] - Pivote a producto, Fase 2.4: búsqueda/filtros
 *   server-side en vez de traer siempre toda la lista visible.
 * @param {string} [filtros.nombre]    - coincidencia parcial, insensible a mayúsculas (nombre o teléfono)
 * @param {string} [filtros.estado]
 * @param {number} [filtros.score_min]
 */
async function listarClientes(supabase, company_id, usuario, filtros = {}) {
  let query = supabase
    .from('clientes')
    .select('id, nombre, telefono, empresa, ciudad, estado, atendido_por, asesor_id, score_interes, logo_url')
    .eq('company_id', company_id);

  if (!ROLES_GERENCIALES.includes(usuario.rol)) {
    query = query.or(`asesor_id.eq.${usuario.id},and(atendido_por.eq.ia,asesor_id.is.null)`);
  }

  if (filtros.nombre) {
    query = query.or(`nombre.ilike.%${filtros.nombre}%,telefono.ilike.%${filtros.nombre}%`);
  }
  if (filtros.estado) {
    query = query.eq('estado', filtros.estado);
  }
  if (filtros.score_min !== undefined && filtros.score_min !== null && filtros.score_min !== '') {
    query = query.gte('score_interes', Number(filtros.score_min));
  }

  const { data, error } = await query.order('id', { ascending: false });
  if (error || !data || data.length === 0) return error ? [] : (data || []);

  const conOportunidad = await _adjuntarUltimaOportunidad(supabase, company_id, data);
  return _adjuntarInfoCitas(supabase, company_id, conOportunidad);
}

/**
 * Fase Premium · Salón de Belleza: para negocios de citas, "cada cliente
 * cuenta una historia" se traduce en próxima cita / última cita, no en
 * oportunidad de venta — se adjunta siempre (no solo para salón), null
 * limpio para empresas que no usan agenda, mismo patrón sin N+1 que
 * _adjuntarUltimaOportunidad.
 */
async function _adjuntarInfoCitas(supabase, company_id, clientes) {
  const ids = clientes.map(c => c.id);
  const ahoraIso = new Date().toISOString();

  const [proximasRes, pasadasRes] = await Promise.all([
    supabase
      .from('citas')
      .select('cliente_id, inicio, estado')
      .eq('company_id', company_id)
      .in('cliente_id', ids)
      .in('estado', ['agendada', 'confirmada'])
      .gte('inicio', ahoraIso)
      .order('inicio', { ascending: true }),
    supabase
      .from('citas')
      .select('cliente_id, inicio, estado')
      .eq('company_id', company_id)
      .in('cliente_id', ids)
      .eq('estado', 'completada')
      .order('inicio', { ascending: false }),
  ]);

  const proximaPorCliente = new Map();
  for (const c of proximasRes.data || []) {
    if (!proximaPorCliente.has(c.cliente_id)) proximaPorCliente.set(c.cliente_id, c);
  }
  const pasadaPorCliente = new Map();
  for (const c of pasadasRes.data || []) {
    if (!pasadaPorCliente.has(c.cliente_id)) pasadaPorCliente.set(c.cliente_id, c);
  }

  return clientes.map(c => {
    const proxima = proximaPorCliente.get(c.id);
    return {
      ...c,
      proxima_cita: proxima ? { inicio: proxima.inicio, estado: proxima.estado } : null,
      ultima_cita:  pasadaPorCliente.get(c.id)?.inicio || null,
    };
  });
}

/**
 * Pivote a producto, Fase Premium V1.1: "cada cliente debe contar una
 * historia" — la lista deja de mostrar solo nombre/teléfono y adjunta la
 * oportunidad más reciente de cada cliente (estado, monto, próxima acción,
 * última actividad). Una sola consulta adicional agrupada por cliente_id,
 * no N+1 — mismo patrón que obtenerActividadReciente().
 */
async function _adjuntarUltimaOportunidad(supabase, company_id, clientes) {
  const ids = clientes.map(c => c.id);
  const { data: oportunidades } = await supabase
    .from('oportunidades')
    .select('cliente_id, estado, presupuesto_confirmado, presupuesto_estimado, proxima_accion, updated_at')
    .eq('company_id', company_id)
    .in('cliente_id', ids)
    .order('updated_at', { ascending: false });

  const masReciente = new Map();
  for (const op of oportunidades || []) {
    if (!masReciente.has(op.cliente_id)) masReciente.set(op.cliente_id, op);
  }

  return clientes.map(c => {
    const op = masReciente.get(c.id);
    return {
      ...c,
      ultima_oportunidad: op ? {
        estado: op.estado,
        monto: op.presupuesto_confirmado ?? op.presupuesto_estimado ?? null,
        proxima_accion: op.proxima_accion,
        actualizado: op.updated_at,
      } : null,
    };
  });
}

/**
 * Ficha completa del cliente: datos + historial de conversaciones (Fase 3)
 * + todo el historial de citas, incluidas canceladas (Fase 4) + oportunidades.
 */
async function obtenerFichaCliente(supabase, company_id, clienteId) {
  const [clienteRes, historial, citasRes, oportunidadesRes] = await Promise.all([
    supabase.from('clientes').select('*').eq('id', clienteId).eq('company_id', company_id).maybeSingle(),
    obtenerHistorial(supabase, company_id, clienteId),
    supabase.from('citas').select('*, asesores(nombre)').eq('cliente_id', clienteId).eq('company_id', company_id).order('inicio', { ascending: false }),
    supabase.from('oportunidades').select('*').eq('cliente_id', clienteId).eq('company_id', company_id).order('created_at', { ascending: false }),
  ]);

  if (clienteRes.error || !clienteRes.data) {
    const err = new Error('Cliente no encontrado');
    err.status = 404;
    throw err;
  }

  return {
    cliente:       clienteRes.data,
    historial,
    citas:         citasRes.data || [],
    oportunidades: oportunidadesRes.data || [],
  };
}

/**
 * Edita campos de un cliente. `telefono` nunca es editable — es la clave
 * de identidad de WhatsApp usada por el dedup del motor (modules/crm.js).
 */
async function actualizarCliente(supabase, company_id, clienteId, cambios) {
  const payload = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  if (Object.keys(payload).length === 0) {
    const err = new Error('Sin campos válidos para actualizar');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('clientes')
    .update(payload)
    .eq('id', clienteId)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el cliente');
  return data;
}

/**
 * Elimina un cliente (Pivote a producto, Fase 2.5). Solo funciona si el
 * cliente no tiene historial asociado — citas, seguimientos y mensajes
 * humanos referencian clientes SIN "ON DELETE CASCADE" (a diferencia de
 * conversaciones/oportunidades, que sí cascadean), a propósito: no se debe
 * poder borrar en silencio el historial de conversación de WhatsApp de un
 * cliente real. Postgres rechaza el delete con foreign_key_violation
 * (23503) — se traduce a un mensaje claro en vez de un 500 genérico.
 */
async function eliminarCliente(supabase, company_id, clienteId) {
  const { error } = await supabase
    .from('clientes')
    .delete()
    .eq('id', clienteId)
    .eq('company_id', company_id);

  if (error) {
    if (error.code === '23503') {
      const err = new Error('No se puede eliminar: este cliente tiene historial asociado (citas o seguimientos). Solo se pueden eliminar clientes sin actividad registrada.');
      err.status = 409;
      throw err;
    }
    throw new Error('No se pudo eliminar el cliente');
  }
}

async function listarSeguimientos(supabase, company_id, clienteId) {
  const { data, error } = await supabase
    .from('seguimientos')
    .select('*')
    .eq('company_id', company_id)
    .eq('cliente_id', clienteId)
    .order('completado', { ascending: true })
    .order('fecha_programada', { ascending: true });

  return error ? [] : (data || []);
}

async function crearSeguimiento(supabase, company_id, clienteId, usuarioId, { texto, fecha_programada, prioridad }) {
  const { data, error } = await supabase
    .from('seguimientos')
    .insert([{
      cliente_id:       clienteId,
      company_id,
      usuario_id:       usuarioId,
      texto,
      fecha_programada: fecha_programada || null,
      prioridad:        prioridad || 'media',
    }])
    .select()
    .single();

  if (error) throw new Error(`crm-ui.crearSeguimiento: ${error.message}`);
  return data;
}

async function actualizarSeguimiento(supabase, company_id, seguimientoId, cambios) {
  const payload = {};
  for (const campo of CAMPOS_SEGUIMIENTO) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const { data, error } = await supabase
    .from('seguimientos')
    .update(payload)
    .eq('id', seguimientoId)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el seguimiento');
  return data;
}

/**
 * Todas las oportunidades de la empresa, con datos del cliente embebidos
 * (para la vista de pipeline/kanban, Fase 2.3) — a diferencia de
 * obtenerFichaCliente(), que las trae solo para UN cliente.
 */
async function listarOportunidades(supabase, company_id) {
  const { data, error } = await supabase
    .from('oportunidades')
    .select('*, clientes(nombre, telefono)')
    .eq('company_id', company_id)
    .order('created_at', { ascending: false });

  return error ? [] : (data || []);
}

/**
 * CRUD de oportunidades desde el panel (Pivote a producto, Fase 2.1). Antes
 * solo se creaban automáticamente por triggers de palabras clave del bot
 * (modules/crm.js::crearOportunidadSiCorresponde, congelado) — esto agrega
 * la capa de administración manual encima, sin tocar ese write path.
 */
async function crearOportunidad(supabase, company_id, clienteId, datos) {
  const payload = { cliente_id: clienteId, company_id };
  for (const campo of CAMPOS_OPORTUNIDAD) {
    if (datos[campo] !== undefined) payload[campo] = datos[campo];
  }

  const { data, error } = await supabase
    .from('oportunidades')
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error(`crm-ui.crearOportunidad: ${error.message}`);
  return data;
}

async function actualizarOportunidad(supabase, company_id, oportunidadId, cambios) {
  const payload = {};
  for (const campo of CAMPOS_OPORTUNIDAD) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  if (Object.keys(payload).length === 0) {
    const err = new Error('Sin campos válidos para actualizar');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('oportunidades')
    .update(payload)
    .eq('id', oportunidadId)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar la oportunidad');
  return data;
}

async function eliminarOportunidad(supabase, company_id, oportunidadId) {
  const { error } = await supabase
    .from('oportunidades')
    .delete()
    .eq('id', oportunidadId)
    .eq('company_id', company_id);

  if (error) throw new Error('No se pudo eliminar la oportunidad');
}

module.exports = {
  listarClientes,
  obtenerFichaCliente,
  actualizarCliente,
  eliminarCliente,
  listarSeguimientos,
  crearSeguimiento,
  actualizarSeguimiento,
  listarOportunidades,
  crearOportunidad,
  actualizarOportunidad,
  eliminarOportunidad,
};
