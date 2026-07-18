/**
 * TARA Matrix™ — admin-auth-middleware.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 8.1 — Plataforma Comercial. Protege exclusivamente las rutas
 * `/api/admin/*`. Cookie separada (`tara_admin_session`) — nunca se mezcla
 * con `tara_session`/`tara_company` del panel de tenant.
 *
 * @module modules/admin-auth-middleware
 */

'use strict';

const { resolverSesionAdmin } = require('./admin-auth');

/**
 * @param {(jwt: string) => import('@supabase/supabase-js').SupabaseClient} crearClienteConSesion
 * @returns {import('express').RequestHandler}
 */
function crearRequireAdmin(crearClienteConSesion) {
  return async function requireAdmin(req, res, next) {
    const token = req.cookies?.tara_admin_session;

    if (!token) {
      return res.status(401).json({ error: 'Sesión de administrador no encontrada' });
    }

    const clienteSesion = crearClienteConSesion(token);
    const admin = await resolverSesionAdmin(clienteSesion, token);
    if (!admin) {
      return res.status(401).json({ error: 'Sesión de administrador inválida o expirada' });
    }

    req.admin    = admin;
    req.supabase = clienteSesion;
    next();
  };
}

module.exports = { crearRequireAdmin };
