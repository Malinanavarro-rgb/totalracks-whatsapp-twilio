/**
 * TARA Matrix™ — clients.js
 * Inicializa y exporta los clientes externos (Supabase, OpenAI, Twilio).
 * No depende de ningún otro módulo propio.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const twilio = require('twilio');
const Stripe = require('stripe');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// RLS (Plataforma SaaS): operaciones sin usuario final — webhook de Twilio,
// cron de recordatorios, callback de OAuth, aceptar invitación — usan esta
// instancia (service_role, bypassa RLS por diseño de Supabase). Nunca se
// expone al frontend; vive solo en el proceso del servidor, igual que
// SUPABASE_ANON_KEY.
const supabaseServicio = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Cliente por-request para rutas autenticadas del panel: adjunta el JWT del
 * usuario (el mismo que vive en la cookie tara_session) para que Postgres
 * resuelva auth.uid() y las políticas RLS lo evalúen correctamente.
 * @param {string} jwt
 */
function crearClienteConSesion(jwt) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultHeaders: { 'Accept-Encoding': 'identity' },
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// FASE 8.1 (Plataforma Comercial): sin cuenta de Stripe todavía — null hasta
// que exista STRIPE_SECRET_KEY real (Sub-fase 8.3). modules/plataforma-billing.js
// falla con un mensaje claro en vez de un TypeError si se invoca antes de eso.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

module.exports = { supabase, supabaseServicio, crearClienteConSesion, openai, twilioClient, stripe };
