/**
 * TARA Matrix™ — conectar-empresa-meta
 * ─────────────────────────────────────────────────────────────────────────────
 * Entrypoint standalone para dar de alta (o actualizar) las credenciales de
 * WhatsApp Cloud API de una empresa, mientras no exista portal de onboarding
 * (Embedded Signup) — ver ADR-007. El access_token se cifra en el proceso,
 * nunca se guarda en texto plano.
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

  console.log(`✅ Empresa ${companyId} conectada a Meta — phone_number_id=${phoneNumberId} (fila ${fila.id})`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error conectando empresa a Meta:', err.message);
  process.exit(1);
});
