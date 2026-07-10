/**
 * TARA Matrix™ — auth-middleware.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 1. Middleware Express que protege rutas de la API
 * del panel — nunca las del webhook de Twilio ni del Orchestrator.
 *
 * @module modules/auth-middleware
 */

'use strict';

const { resolverSesion } = require('./auth');

/**
 * @param {(jwt: string) => import('@supabase/supabase-js').SupabaseClient} crearClienteConSesion
 *   factory que construye un cliente Supabase con el JWT del usuario adjunto
 *   (ver modules/clients.js) — necesario para que RLS resuelva auth.uid().
 * @returns {import('express').RequestHandler}
 */
function crearRequireAuth(crearClienteConSesion) {
  return async function requireAuth(req, res, next) {
    const token     = req.cookies?.tara_session;
    const companyId = req.cookies?.tara_company;

    if (!token || !companyId) {
      return res.status(401).json({ error: 'Sesión no encontrada' });
    }

    const clienteSesion = crearClienteConSesion(token);
    const usuario = await resolverSesion(clienteSesion, token, companyId);
    if (!usuario) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    req.usuario  = usuario;
    req.supabase = clienteSesion;
    next();
  };
}

module.exports = { crearRequireAuth };
