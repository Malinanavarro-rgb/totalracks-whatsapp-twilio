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

const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];
const CAMPOS_EDITABLES  = ['nombre', 'empresa', 'ciudad', 'notas', 'estado'];
const CAMPOS_SEGUIMIENTO = ['texto', 'fecha_programada', 'prioridad', 'completado'];

/**
 * Lista de clientes visibles para el usuario. Mismo criterio que
 * conversaciones (Fase 3): un Asesor ve los suyos + el pool sin asignar.
 */
async function listarClientes(supabase, company_id, usuario) {
  let query = supabase
    .from('clientes')
    .select('id, nombre, telefono, empresa, ciudad, estado, atendido_por, asesor_id, score_interes')
    .eq('company_id', company_id);

  if (!ROLES_GERENCIALES.includes(usuario.rol)) {
    query = query.or(`asesor_id.eq.${usuario.id},and(atendido_por.eq.ia,asesor_id.is.null)`);
  }

  const { data, error } = await query.order('id', { ascending: false });
  return error ? [] : (data || []);
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

module.exports = {
  listarClientes,
  obtenerFichaCliente,
  actualizarCliente,
  listarSeguimientos,
  crearSeguimiento,
  actualizarSeguimiento,
};
