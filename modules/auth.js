/**
 * TARA Matrix™ — auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 1. Autenticación mediada por el backend — el
 * frontend nunca habla con Supabase directamente, ni siquiera para login.
 *
 * Usuario↔Empresa es muchos-a-muchos (usuarios_empresas): un usuario puede
 * pertenecer a varias empresas con rol distinto en cada una. El MVP resuelve
 * automáticamente la primera empresa activa como "empresa activa" — no hay
 * selector de empresa en la UI todavía, pero el modelo de datos ya lo soporta.
 *
 * @module modules/auth
 */

'use strict';

class ErrorAuth extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} usuarioId - auth.users.id
 * @returns {Promise<Array<{company_id: string, nombre: string, rol: string}>>}
 */
async function obtenerEmpresasDeUsuario(supabase, usuarioId) {
  const { data, error } = await supabase
    .from('usuarios_empresas')
    .select('company_id, rol, created_at, companies(nombre)')
    .eq('usuario_id', usuarioId)
    .eq('activo', true)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data.map(fila => ({
    company_id: fila.company_id,
    nombre: fila.companies?.nombre || null,
    rol: fila.rol,
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
  const empresas = await obtenerEmpresasDeUsuario(supabase, usuarioId);

  if (empresas.length === 0) {
    throw new ErrorAuth('Tu cuenta no está asociada a ninguna empresa', 403);
  }

  const { data: usuarioRow } = await supabase
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

module.exports = { iniciarSesion, obtenerEmpresasDeUsuario, resolverSesion, ErrorAuth };
