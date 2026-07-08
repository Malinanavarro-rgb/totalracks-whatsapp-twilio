/**
 * TARA Matrix™ — google-auth
 * ─────────────────────────────────────────────────────────────────────────────
 * Todo lo necesario para conectar la cuenta de Google Calendar de una empresa:
 * generar la URL de consentimiento OAuth, intercambiar el código por tokens,
 * y reconstruir un GoogleCalendarProvider autenticado a partir de lo guardado
 * (cifrado) en `calendar_credentials`.
 *
 * No conoce nada de agenda/citas — eso es SchedulingEngine. Este módulo solo
 * resuelve la identidad/autenticación con Google, por empresa.
 *
 * A diferencia de AIProvider (una sola cuenta de OpenAI para todo el proceso),
 * cada empresa tiene su propia cuenta de Google — por eso no hay una sola
 * instancia global de GoogleCalendarProvider: obtenerProviderParaEmpresa()
 * arma una nueva cada vez, a partir de los tokens de esa empresa.
 *
 * @module modules/google-auth
 */

'use strict';

const { google } = require('googleapis');
const { cifrar, descifrar } = require('./crypto-util');
const { GoogleCalendarProvider } = require('../adapters/calendar/google-calendar-provider');

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

function crearOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      'google-auth: faltan GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI en las variables de entorno'
    );
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/**
 * Arma la URL de consentimiento de Google para que una empresa conecte su
 * calendario. `company_id` viaja en `state` para identificar la empresa en
 * el callback (Google lo devuelve tal cual).
 * @param {string} company_id
 * @returns {string} URL a la que redirigir al usuario
 */
function generarUrlAutorizacion(company_id) {
  if (!company_id) throw new Error('google-auth.generarUrlAutorizacion: company_id es requerido');

  const client = crearOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // requerido para recibir refresh_token
    prompt:      'consent', // fuerza refresh_token también en reconexiones
    scope:       SCOPES,
    state:       company_id,
  });
}

/**
 * Intercambia el `code` del callback de OAuth por tokens y los guarda
 * cifrados en calendar_credentials (upsert por company_id + proveedor).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} code
 * @param {string} company_id
 * @returns {Promise<void>}
 */
async function manejarCallback(supabase, code, company_id) {
  if (!code || !company_id) {
    throw new Error('google-auth.manejarCallback: code y company_id son requeridos');
  }

  const client = crearOAuthClient();
  const { tokens } = await client.getToken(code);

  const { error } = await supabase
    .from('calendar_credentials')
    .upsert(
      { company_id, proveedor: 'google', credenciales: cifrar(tokens), activo: true },
      { onConflict: 'company_id,proveedor' }
    );

  if (error) throw new Error(`google-auth.manejarCallback: ${error.message}`);
}

/**
 * Reconstruye un GoogleCalendarProvider autenticado para una empresa a
 * partir de sus credenciales guardadas. Si Google refresca el access_token
 * en el proceso, el nuevo token se re-cifra y se persiste automáticamente.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<GoogleCalendarProvider|null>} null si la empresa no tiene Google conectado
 */
async function obtenerProviderParaEmpresa(supabase, company_id) {
  const { data: fila, error } = await supabase
    .from('calendar_credentials')
    .select('*')
    .eq('company_id', company_id)
    .eq('proveedor', 'google')
    .eq('activo', true)
    .maybeSingle();

  if (error || !fila) return null;

  const tokens = descifrar(fila.credenciales);
  const client = crearOAuthClient();
  client.setCredentials(tokens);

  client.on('tokens', async (nuevosTokens) => {
    try {
      await supabase
        .from('calendar_credentials')
        .update({ credenciales: cifrar({ ...tokens, ...nuevosTokens }) })
        .eq('id', fila.id);
    } catch (err) {
      console.error('❌ google-auth: fallo guardando refresh token:', err.message);
    }
  });

  return new GoogleCalendarProvider(client);
}

module.exports = { generarUrlAutorizacion, manejarCallback, obtenerProviderParaEmpresa };
