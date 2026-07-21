/**
 * TARA Matrix™ — meta-auth
 * ─────────────────────────────────────────────────────────────────────────────
 * Todo lo necesario para conectar el WhatsApp Business Cloud API de una
 * empresa: guardar sus credenciales (cifradas) y reconstruir un
 * MetaCloudWhatsAppAdapter autenticado a partir de lo guardado.
 *
 * Mismo rol que modules/google-auth.js, pero para Meta: cada empresa tiene
 * su propio WABA/número/token (modelo Tech Provider — una sola Meta App de
 * TARA, app_id/app_secret/verify_token a nivel plataforma, ver ADR-007), por
 * lo que no hay una sola instancia global de MetaCloudWhatsAppAdapter —
 * obtenerAdapterMetaParaEmpresa() arma una nueva cada vez, a partir de las
 * credenciales de esa empresa.
 *
 * Sin Embedded Signup de Meta todavía (requiere App Review — queda para una
 * fase posterior) — conectarWhatsAppMeta() se usa desde un formulario guiado
 * en el panel (Configuración → Canales) o desde scripts/conectar-empresa-
 * meta.js; en ambos casos el dueño de la empresa sigue teniendo que sacar
 * phone_number_id/access_token de Meta Business Manager a mano.
 *
 * @module modules/meta-auth
 */

'use strict';

const { cifrar, descifrar } = require('./crypto-util');
const { MetaCloudWhatsAppAdapter } = require('../adapters/channels/meta-cloud-whatsapp');

/**
 * Guarda (o actualiza) las credenciales de WhatsApp Cloud API de una
 * empresa. Una empresa, una cuenta de Meta (UNIQUE company_id).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {Object} datos
 * @param {string} datos.whatsappBusinessAccountId
 * @param {string} datos.phoneNumberId
 * @param {string} [datos.metaBusinessId]
 * @param {string} datos.accessToken
 * @returns {Promise<Object>} la fila guardada (sin descifrar)
 */
async function guardarCredencialesMeta(supabase, company_id, { whatsappBusinessAccountId, phoneNumberId, metaBusinessId, accessToken }) {
  if (!company_id || !whatsappBusinessAccountId || !phoneNumberId || !accessToken) {
    throw new Error('meta-auth.guardarCredencialesMeta: company_id, whatsappBusinessAccountId, phoneNumberId y accessToken son requeridos');
  }

  const { data, error } = await supabase
    .from('meta_whatsapp_credentials')
    .upsert(
      {
        company_id,
        whatsapp_business_account_id: whatsappBusinessAccountId,
        phone_number_id:              phoneNumberId,
        meta_business_id:             metaBusinessId || null,
        credenciales:                 cifrar({ access_token: accessToken }, 'META_CREDENTIALS_KEY'),
        estado:                       'activo',
        activo:                       true,
        updated_at:                   new Date().toISOString(),
      },
      { onConflict: 'company_id' }
    )
    .select()
    .single();

  if (error) throw new Error(`meta-auth.guardarCredencialesMeta: ${error.message}`);
  return data;
}

/**
 * Registra el endpoint de enrutamiento para un phone_number_id de Meta
 * (proveedor='meta', canal='whatsapp') — sin esto, el webhook recibe el
 * mensaje pero channel-router.js no encuentra empresa y lo descarta en
 * silencio. Extraído de scripts/conectar-empresa-meta.js para que tanto el
 * script de terminal como el formulario del panel (Portal de Cliente,
 * Centro de Conexiones) compartan la misma lógica.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string} phoneNumberId
 */
async function registrarChannelEndpointMeta(supabase, company_id, phoneNumberId) {
  const { error } = await supabase
    .from('channel_endpoints')
    .upsert(
      { company_id, endpoint: phoneNumberId, canal: 'whatsapp', proveedor: 'meta', activo: true },
      { onConflict: 'endpoint' }
    );
  if (error) throw new Error(`meta-auth.registrarChannelEndpointMeta: ${error.message}`);
}

/**
 * Conecta el WhatsApp Cloud API de una empresa en un solo paso: guarda las
 * credenciales cifradas y registra el enrutamiento — mismo criterio de
 * seguridad que Modo Operador (nada de esto se decide desde el cliente sin
 * pasar por el company_id ya autenticado del caller).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {Object} datos - ver guardarCredencialesMeta()
 */
async function conectarWhatsAppMeta(supabase, company_id, datos) {
  const fila = await guardarCredencialesMeta(supabase, company_id, datos);
  await registrarChannelEndpointMeta(supabase, company_id, datos.phoneNumberId);
  return fila;
}

/**
 * Reconstruye un MetaCloudWhatsAppAdapter autenticado para una empresa, a
 * partir de sus credenciales guardadas (cifradas).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<MetaCloudWhatsAppAdapter|null>} null si la empresa no tiene Meta conectado
 */
async function obtenerAdapterMetaParaEmpresa(supabase, company_id) {
  const { data: fila, error } = await supabase
    .from('meta_whatsapp_credentials')
    .select('*')
    .eq('company_id', company_id)
    .eq('activo', true)
    .maybeSingle();

  if (error || !fila) return null;

  const { access_token } = descifrar(fila.credenciales, 'META_CREDENTIALS_KEY');
  return new MetaCloudWhatsAppAdapter({ phoneNumberId: fila.phone_number_id, accessToken: access_token });
}

module.exports = {
  guardarCredencialesMeta, registrarChannelEndpointMeta, conectarWhatsAppMeta,
  obtenerAdapterMetaParaEmpresa,
};
