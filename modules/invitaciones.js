/**
 * TARA Matrix™ — invitaciones.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 6: alta de usuarios sin depender de crear cuentas
 * manualmente en el Dashboard de Supabase.
 *
 * Flujo completo (no solo "preparado"): Agregar usuario (nombre/correo/rol)
 * → invitación pendiente con token → invitado abre /aceptar-invitacion/:token
 * → crea su contraseña → auth.signUp() (funciona con la anon key, sin
 * necesidad de service_role) → queda vinculado automáticamente a la empresa
 * con el rol asignado.
 *
 * Único hueco real: no hay proveedor de correo integrado — el link se
 * muestra en pantalla para compartir manualmente. Cuando se integre un
 * proveedor de correo, solo cambia el método de envío, no este flujo.
 *
 * @module modules/invitaciones
 */

'use strict';

const crypto = require('crypto');

const DIAS_EXPIRACION = 7;

function _generarToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Miembros activos (y no) de la empresa, con su rol.
 */
async function listarMiembros(supabase, company_id) {
  const { data, error } = await supabase
    .from('usuarios_empresas')
    .select('usuario_id, rol, activo, usuarios(nombre, email)')
    .eq('company_id', company_id);

  return error ? [] : (data || []);
}

async function listarInvitacionesPendientes(supabase, company_id) {
  const { data, error } = await supabase
    .from('invitaciones')
    .select('*')
    .eq('company_id', company_id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: false });

  return error ? [] : (data || []);
}

/**
 * Crea una invitación pendiente. Devuelve la fila (incluye el token) para
 * que el llamador arme el link `/aceptar-invitacion/:token` a compartir.
 */
async function crearInvitacion(supabase, company_id, { nombre, email, rol }) {
  const token = _generarToken();
  const expiresAt = new Date(Date.now() + DIAS_EXPIRACION * 24 * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invitaciones')
    .insert([{
      company_id, nombre, email,
      rol:        rol || 'asesor',
      token,
      estado:     'pendiente',
      expires_at: expiresAt,
    }])
    .select()
    .single();

  if (error) throw new Error(`invitaciones.crearInvitacion: ${error.message}`);
  return data;
}

/**
 * Detalles públicos de una invitación (para la pantalla de aceptación).
 * Lanza 404 si no existe/ya fue usada, 410 si expiró.
 */
async function obtenerInvitacionPorToken(supabase, token) {
  const { data, error } = await supabase
    .from('invitaciones')
    .select('*, companies(nombre)')
    .eq('token', token)
    .eq('estado', 'pendiente')
    .maybeSingle();

  if (error || !data) {
    const err = new Error('Invitación no encontrada o ya utilizada');
    err.status = 404;
    throw err;
  }

  if (new Date(data.expires_at) < new Date()) {
    const err = new Error('Esta invitación expiró');
    err.status = 410;
    throw err;
  }

  return data;
}

/**
 * Acepta la invitación: crea la cuenta de Auth (signUp, sin service_role),
 * la vincula a `usuarios`/`usuarios_empresas` con el rol de la invitación,
 * y marca la invitación como aceptada.
 */
async function aceptarInvitacion(supabase, token, password) {
  const invitacion = await obtenerInvitacionPorToken(supabase, token);

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email:    invitacion.email,
    password,
  });

  if (authError || !authData?.user) {
    throw new Error(authError?.message || 'No se pudo crear la cuenta');
  }

  const usuarioId = authData.user.id;

  await supabase.from('usuarios').insert([{ id: usuarioId, email: invitacion.email, nombre: invitacion.nombre }]);
  await supabase.from('usuarios_empresas').insert([{
    usuario_id: usuarioId, company_id: invitacion.company_id, rol: invitacion.rol, activo: true,
  }]);
  await supabase.from('invitaciones').update({ estado: 'aceptada' }).eq('token', token);

  return { usuarioId, email: invitacion.email };
}

async function actualizarMiembro(supabase, company_id, usuarioId, { rol, activo }) {
  const payload = {};
  if (rol !== undefined) payload.rol = rol;
  if (activo !== undefined) payload.activo = activo;

  const { data, error } = await supabase
    .from('usuarios_empresas')
    .update(payload)
    .eq('usuario_id', usuarioId)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el usuario');
  return data;
}

/**
 * Fase Premium V1.1: editar el nombre de un miembro ya existente (ej. la
 * cuenta admin@uprise.com.mx, creada directo en Supabase antes de que
 * existiera el flujo de invitación, sin `nombre` — usado en el saludo de
 * TARA en Inicio). `nombre` vive en `usuarios`, no en `usuarios_empresas`
 * (tabla compartida entre empresas) — se verifica primero que el usuario
 * pertenezca a esta empresa antes de tocarla, mismo criterio de
 * aislamiento que el resto del módulo.
 */
async function actualizarNombreMiembro(supabase, company_id, usuarioId, nombre) {
  const { data: pertenece } = await supabase
    .from('usuarios_empresas')
    .select('usuario_id')
    .eq('usuario_id', usuarioId)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!pertenece) {
    const err = new Error('Ese usuario no pertenece a tu empresa');
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('usuarios')
    .update({ nombre })
    .eq('id', usuarioId)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el nombre');
  return data;
}

module.exports = {
  listarMiembros,
  listarInvitacionesPendientes,
  crearInvitacion,
  obtenerInvitacionPorToken,
  aceptarInvitacion,
  actualizarMiembro,
  actualizarNombreMiembro,
};
