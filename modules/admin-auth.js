/**
 * TARA Matrix™ — admin-auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 8.1 — Plataforma Comercial. Login/sesión de Super Admin — misma
 * identidad de Supabase Auth que el login normal (modules/auth.js), pero
 * resuelta contra `plataforma_admins` en vez de `usuarios_empresas`. Una
 * cuenta puede ser, con el mismo email/password, tanto owner de una company
 * real como Super Admin: son dos superficies de autorización distintas,
 * nunca dos cuentas — por eso este módulo es una réplica deliberada de
 * auth.js en vez de una extensión de él (evita que un bug en uno afecte al
 * otro; el "camino congelado" de auth.js de tenant no se toca).
 *
 * @module modules/admin-auth
 */

'use strict';

const { supabaseServicio } = require('./clients');

// plataforma_admins es una tabla nueva — Supabase le activa Row Level
// Security automáticamente sin ninguna política (comportamiento reciente
// del proyecto por defecto), así que un cliente anon+JWT la ve vacía
// aunque la fila exista (confirmado: la misma consulta con service_role sí
// la encuentra). "¿Eres Super Admin?" es además una pregunta de plataforma,
// no de un tenant — no debería depender de RLS por empresa de todos modos,
// así que esta consulta puntual usa supabaseServicio a propósito.
//
// El embed `usuarios!plataforma_admins_id_fkey(...)` es obligatorio, no
// cosmético: plataforma_admins tiene DOS FKs hacia usuarios (id y
// creado_por), así que PostgREST no puede resolver `usuarios(...)` a
// secas — responde "Could not embed because more than one relationship
// was found" (confirmado en producción).

class ErrorAdminAuth extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{token: string, admin: Object}>}
 */
async function iniciarSesionAdmin(supabase, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    throw new ErrorAdminAuth('Credenciales inválidas', 401);
  }

  const usuarioId = data.user.id;

  const { data: fila, error: errorAdmin } = await supabaseServicio
    .from('plataforma_admins')
    .select('rol, activo, usuarios!plataforma_admins_id_fkey(id, nombre, email)')
    .eq('id', usuarioId)
    .eq('activo', true)
    .maybeSingle();

  if (errorAdmin || !fila) {
    throw new ErrorAdminAuth('Tu cuenta no tiene acceso al Panel Maestro', 403);
  }

  return {
    token: data.session.access_token,
    admin: {
      id: usuarioId,
      nombre: fila.usuarios?.nombre || null,
      email: fila.usuarios?.email || email,
      rol: fila.rol,
    },
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} token
 * @returns {Promise<{id, nombre, email, rol}|null>} null si la sesión no es válida
 */
async function resolverSesionAdmin(supabase, token) {
  if (!token) return null;

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: fila, error: errorFila } = await supabaseServicio
    .from('plataforma_admins')
    .select('rol, usuarios!plataforma_admins_id_fkey(id, nombre, email)')
    .eq('id', userData.user.id)
    .eq('activo', true)
    .maybeSingle();

  if (errorFila || !fila) return null;

  return {
    id: userData.user.id,
    nombre: fila.usuarios?.nombre || null,
    email: fila.usuarios?.email || userData.user.email,
    rol: fila.rol,
  };
}

module.exports = { iniciarSesionAdmin, resolverSesionAdmin, ErrorAdminAuth };
