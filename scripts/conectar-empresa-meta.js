/**
 * TARA Matrix™ — conectar-empresa-meta
 * ─────────────────────────────────────────────────────────────────────────────
 * Entrypoint standalone para dar de alta (o actualizar) las credenciales de
 * WhatsApp Cloud API de una empresa, mientras no exista portal de onboarding
 * (Embedded Signup) — ver ADR-007. El access_token se cifra en el proceso,
 * nunca se guarda en texto plano.
 *
 * También registra el endpoint en `channel_endpoints` (proveedor='meta',
 * endpoint=phone_number_id) en el mismo paso — sin esto, el webhook de Meta
 * recibe el mensaje pero channel-router.js no encuentra empresa y lo
 * descarta en silencio (ningún otro módulo escribía antes en esta tabla
 * para Meta; era un segundo paso manual que se olvidaba fácilmente).
 *
 * Uso:
 *   node scripts/conectar-empresa-meta.js \
 *     --company-id <uuid> \
 *     --waba-id <whatsapp_business_account_id> \
 *     --phone-number-id <phone_number_id> \
 *     --access-token <token> \
 *     [--meta-business-id <id>]
 *
 * @module scripts/conectar-empresa-meta
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { guardarCredencialesMeta } = require('../modules/meta-auth');

async function registrarChannelEndpoint(companyId, phoneNumberId) {
  const { error } = await supabase
    .from('channel_endpoints')
    .upsert(
      { company_id: companyId, endpoint: phoneNumberId, canal: 'whatsapp', proveedor: 'meta', activo: true },
      { onConflict: 'endpoint' }
    );
  if (error) throw new Error(`registrando channel_endpoints: ${error.message}`);
}

function leerArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const clave = process.argv[i]?.replace(/^--/, '');
    args[clave] = process.argv[i + 1];
  }
  return args;
}

(async () => {
  const args = leerArgs();

  const companyId   = args['company-id'];
  const wabaId      = args['waba-id'];
  const phoneNumberId = args['phone-number-id'];
  const accessToken = args['access-token'];
  const metaBusinessId = args['meta-business-id'];

  if (!companyId || !wabaId || !phoneNumberId || !accessToken) {
    console.error('❌ Uso: node scripts/conectar-empresa-meta.js --company-id <uuid> --waba-id <id> --phone-number-id <id> --access-token <token> [--meta-business-id <id>]');
    process.exit(1);
  }

  const fila = await guardarCredencialesMeta(supabase, companyId, {
    whatsappBusinessAccountId: wabaId,
    phoneNumberId,
    metaBusinessId,
    accessToken,
  });

  await registrarChannelEndpoint(companyId, phoneNumberId);

  console.log(`✅ Empresa ${companyId} conectada a Meta — phone_number_id=${phoneNumberId} (fila ${fila.id})`);
  console.log(`✅ channel_endpoints registrado — los mensajes entrantes de este número ya enrutan a esta empresa.`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error conectando empresa a Meta:', err.message);
  process.exit(1);
});
