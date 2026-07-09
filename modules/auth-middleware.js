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
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {import('express').RequestHandler}
 */
function crearRequireAuth(supabase) {
  return async function requireAuth(req, res, next) {
    const token     = req.cookies?.tara_session;
    const companyId = req.cookies?.tara_company;

    if (!token || !companyId) {
      return res.status(401).json({ error: 'Sesión no encontrada' });
    }

    const usuario = await resolverSesion(supabase, token, companyId);
    if (!usuario) {
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    req.usuario = usuario;
    next();
  };
}

module.exports = { crearRequireAuth };
