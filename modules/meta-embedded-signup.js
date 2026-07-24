/**
 * TARA Matrix™ — meta-embedded-signup
 * ─────────────────────────────────────────────────────────────────────────────
 * "Fase siguiente" prometida en ADR-007: reemplaza el alta manual de
 * credenciales de Meta (el dueño de la empresa sacando phone_number_id/
 * access_token de Meta Business Manager a mano) por el flujo oficial de
 * Meta, Embedded Signup — el dueño de la empresa autoriza a TARA sobre su
 * propio WABA desde un popup, sin salir del panel de TARA-OS.
 *
 * El modelo Tech Provider (ver ADR-007 §1) no cambia: sigue habiendo una
 * sola Meta App de plataforma (META_APP_ID/META_APP_SECRET) — Embedded
 * Signup solo automatiza cómo cada empresa le da permiso a esa misma app
 * sobre su WABA, en vez de que Alina o el cliente muevan IDs/tokens a mano.
 *
 * Flujo (ver docs/decisions/ADR-009-embedded-signup.md):
 *   1. Frontend abre el popup de Facebook Login for Business (JS SDK) con
 *      META_LOGIN_CONFIG_ID — el cliente autoriza el WABA.
 *   2. Meta manda por postMessage el waba_id/phone_number_id elegidos, y
 *      FB.login() devuelve un `code` de un solo uso.
 *   3. El frontend manda ambas cosas al backend (nunca llama a Graph API
 *      directo — mismo principio de "el frontend nunca habla con el
 *      proveedor externo directamente" ya usado para Supabase/Google).
 *   4. Este módulo cambia el `code` por un token de larga duración,
 *      suscribe el webhook de TARA a ese WABA, y devuelve el token para que
 *      el caller (server.js) lo guarde con modules/meta-auth.js (sin
 *      duplicar la lógica de cifrado/guardado ya existente).
 *
 * Requiere, en Meta for Developers (acción manual de Alina, una sola vez):
 *   - Producto "Facebook Login for Business" agregado a la Meta App.
 *   - Una Configuración ahí (caso de uso "WhatsApp Business API") → genera
 *     el config_id que va en META_LOGIN_CONFIG_ID.
 *   - App Review con acceso avanzado a whatsapp_business_management y
 *     business_management para poder hacerlo con WABAs de clientes reales
 *     (en modo Desarrollo, sin esto, solo funciona para testers de la app).
 *
 * @module modules/meta-embedded-signup
 */

'use strict';

function version() {
  return process.env.META_GRAPH_API_VERSION || 'v19.0';
}

/**
 * @returns {{appId: string, configId: string, disponible: boolean}}
 *   `disponible` es false si falta cualquiera de las 2 variables de
 *   plataforma — el frontend usa esto para decidir si mostrar el botón de
 *   Embedded Signup o solo el formulario manual existente.
 */
function configPublica() {
  const appId = process.env.META_APP_ID || null;
  const configId = process.env.META_LOGIN_CONFIG_ID || null;
  return { appId, configId, disponible: Boolean(appId && configId) };
}

/**
 * Cambia el `code` de un solo uso (JS SDK, sin redirect_uri — ver Meta docs
 * de Embedded Signup) por un token de larga duración (~60 días). Dos saltos
 * porque Graph API nunca entrega un token largo directo desde `code`.
 *
 * @param {string} code
 * @returns {Promise<string>} access_token de larga duración
 */
async function intercambiarCodigoPorTokenLargo(code) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('meta-embedded-signup: faltan META_APP_ID/META_APP_SECRET');
  }

  const v = version();

  const respCorto = await fetch(
    `https://graph.facebook.com/${v}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
  );
  const datosCorto = await respCorto.json();
  if (!respCorto.ok || !datosCorto.access_token) {
    throw new Error(`meta-embedded-signup: fallo intercambiando code — ${JSON.stringify(datosCorto)}`);
  }

  const respLargo = await fetch(
    `https://graph.facebook.com/${v}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(datosCorto.access_token)}`
  );
  const datosLargo = await respLargo.json();
  if (!respLargo.ok || !datosLargo.access_token) {
    throw new Error(`meta-embedded-signup: fallo extendiendo el token — ${JSON.stringify(datosLargo)}`);
  }

  return datosLargo.access_token;
}

/**
 * Suscribe la Meta App de TARA al WABA del cliente — sin esto, Meta nunca
 * manda los mensajes de ese número al webhook compartido de TARA
 * (/webhook/meta), aunque el número esté verificado y activo.
 *
 * @param {string} wabaId
 * @param {string} accessToken - el token largo recién obtenido (ya trae los
 *   permisos que el cliente autorizó sobre ese WABA en el popup)
 */
async function suscribirWebhookAWaba(wabaId, accessToken) {
  const v = version();
  const respuesta = await fetch(`https://graph.facebook.com/${v}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    throw new Error(`meta-embedded-signup: fallo suscribiendo webhook al WABA ${wabaId} — ${detalle}`);
  }
}

module.exports = { configPublica, intercambiarCodigoPorTokenLargo, suscribirWebhookAWaba };
