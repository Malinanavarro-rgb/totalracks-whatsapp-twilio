/**
 * TARA Matrix™ — auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 1. Autenticación mediada por el backend — el
 * frontend nunca habla con Supabase directamente, ni siquiera para login.
 *
 * Usuario↔Empresa es muchos-a-muchos (usuarios_empresas): un usuario puede
 * pertenecer a varias empresas con rol distinto en cada una. `iniciarSesion()`
 * fija la primera como "empresa activa" al hacer login; cambiar a otra
 * después es responsabilidad de `POST /api/auth/cambiar-empresa` (server.js)
 * — ver selector de empresa activa en el panel (Shell.jsx).
 *
 * @module modules/auth
 */

'use strict';

const { crearClienteConSesion } = require('./clients');

class ErrorAuth extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} usuarioId - auth.users.id
 * @returns {Promise<Array<{company_id: string, nombre: string, rol: string, logo_url: string|null, color_acento: string|null, industria_slug: string|null, nav_labels: Object|null}>>}
 */
async function obtenerEmpresasDeUsuario(supabase, usuarioId) {
  const { data, error } = await supabase
    .from('usuarios_empresas')
    .select('company_id, rol, created_at, companies(nombre, logo_url, color_acento, industria_slug, nav_labels)')
    .eq('usuario_id', usuarioId)
    .eq('activo', true)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data.map(fila => ({
    company_id: fila.company_id,
    nombre: fila.companies?.nombre || null,
    rol: fila.rol,
    logo_url: fila.companies?.logo_url || null,
    color_acento: fila.companies?.color_acento || null,
    industria_slug: fila.companies?.industria_slug || null,
    nav_labels: fila.companies?.nav_labels || null,
  }));
}

/**
 * Login: valida credenciales contra Supabase Auth y resuelve las empresas
 * del usuario. Lanza ErrorAuth (con .status) si falla — el caller decide
 * cómo responder al cliente.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{token: string, usuario: Object, empresaActiva: Object, empresas: Array}>}
 */
async function iniciarSesion(supabase, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    throw new ErrorAuth('Credenciales inválidas', 401);
  }

  const usuarioId = data.user.id;

  // RLS: en cuanto existe el JWT, se usa un cliente por-sesión (nunca el
  // singleton) para que auth.uid() resuelva correctamente en las políticas
  // de usuarios_empresas/usuarios.
  const clienteSesion = crearClienteConSesion(data.session.access_token);

  const empresas = await obtenerEmpresasDeUsuario(clienteSesion, usuarioId);

  if (empresas.length === 0) {
    throw new ErrorAuth('Tu cuenta no está asociada a ninguna empresa', 403);
  }

  const { data: usuarioRow } = await clienteSesion
    .from('usuarios')
    .select('id, nombre, email')
    .eq('id', usuarioId)
    .maybeSingle();

  return {
    token: data.session.access_token,
    usuario: usuarioRow || { id: usuarioId, email, nombre: null },
    empresaActiva: empresas[0],
    empresas,
  };
}

/**
 * Resuelve la sesión completa a partir del JWT (cookie tara_session) y la
 * empresa activa (cookie tara_company). Nunca confía en que la cookie de
 * empresa sea válida — siempre revalida contra usuarios_empresas, que es
 * la única fuente de verdad de a qué empresa pertenece un usuario.
 *
 * RLS: el llamador (crearRequireAuth) debe pasar un cliente construido con
 * crearClienteConSesion(token) — el mismo token que se valida aquí — para
 * que auth.uid() resuelva correctamente en la política de usuarios_empresas.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} token
 * @param {string} companyId
 * @returns {Promise<{id, nombre, email, company_id, rol}|null>} null si la sesión no es válida
 */
async function resolverSesion(supabase, token, companyId) {
  if (!token || !companyId) return null;

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: fila, error: errorFila } = await supabase
    .from('usuarios_empresas')
    .select('rol, usuarios(id, nombre, email)')
    .eq('usuario_id', userData.user.id)
    .eq('company_id', companyId)
    .eq('activo', true)
    .maybeSingle();

  if (errorFila || !fila) return null;

  return {
    id: userData.user.id,
    nombre: fila.usuarios?.nombre || null,
    email: fila.usuarios?.email || userData.user.email,
    company_id: companyId,
    rol: fila.rol,
  };
}

/**
 * Recuperación de contraseña, paso 1: pide a Supabase Auth que mande el
 * correo de recuperación (usa el envío de correo ya configurado de
 * Supabase — sin infraestructura de correo propia). Nunca revela si el
 * email existe o no (mismo mensaje siempre) — evita enumeración de cuentas.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - cliente anon, nunca service_role
 * @param {string} email
 * @param {string} redirectTo - URL del frontend a la que Supabase redirige con el token (?type=recovery)
 */
async function solicitarRecuperacion(supabase, email, redirectTo) {
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  // Deliberadamente no se revisa el resultado — la respuesta al cliente es
  // siempre la misma exista o no la cuenta (evita enumeración de emails).
}

/**
 * Recuperación de contraseña, paso 2: valida el access_token que Supabase
 * puso en la URL de recuperación y actualiza la contraseña. El frontend
 * nunca habla con Supabase directamente (ver docstring del módulo) — solo
 * lee el token de la URL (string) y se lo manda a este backend.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - cliente anon, para validar el token
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseServicio - service_role, para actualizar el password
 * @param {string} accessToken
 * @param {string} nuevaPassword
 */
async function restablecerPassword(supabase, supabaseServicio, accessToken, nuevaPassword) {
  const { data: userData, error } = await supabase.auth.getUser(accessToken);
  if (error || !userData?.user) {
    throw new ErrorAuth('El link de recuperación no es válido o ya expiró', 400);
  }

  const { error: errorUpdate } = await supabaseServicio.auth.admin.updateUserById(userData.user.id, { password: nuevaPassword });
  if (errorUpdate) {
    throw new ErrorAuth(errorUpdate.message, 400);
  }
}

module.exports = {
  iniciarSesion, obtenerEmpresasDeUsuario, resolverSesion,
  solicitarRecuperacion, restablecerPassword, ErrorAuth,
};
