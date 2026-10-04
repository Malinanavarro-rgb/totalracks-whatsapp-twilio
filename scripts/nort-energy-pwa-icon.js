/**
 * TARA Matrix™ — Nort Energy, ícono cuadrado para la PWA instalable
 * (Alina, 2026-10-04).
 * ─────────────────────────────────────────────────────────────────────────────
 * logo_url de Nort Energy es 1536x1024 (rectangular) — usarlo directo como
 * ícono de app se ve recortado por el sistema operativo. Este script sube el
 * ícono ya preparado (logo centrado sobre fondo blanco, 512x512, generado
 * localmente con sips a partir del logo real) al mismo bucket de Storage que
 * logo_url, y guarda su URL pública en companies.pwa_icon_url (migración 125)
 * — el manifest.webmanifest dinámico (modules/pwa.js) lo usa cuando existe.
 *
 * Uso: node scripts/nort-energy-pwa-icon.js
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy
const BUCKET = 'imagenes-empresa';
const RUTA_LOCAL = '/tmp/nort-icon-512.png';
const RUTA_STORAGE = `${COMPANY_ID}/pwa-icon-512.png`;

(async () => {
  const buffer = fs.readFileSync(RUTA_LOCAL);

  const { error: errSubida } = await supabase.storage.from(BUCKET).upload(RUTA_STORAGE, buffer, {
    contentType: 'image/png',
    upsert: true,
  });
  if (errSubida) {
    console.error('❌ Error subiendo el ícono:', errSubida.message);
    process.exit(1);
  }

  const { data: publica } = supabase.storage.from(BUCKET).getPublicUrl(RUTA_STORAGE);
  const url = publica.publicUrl;

  const { error: errUpdate } = await supabase.from('companies').update({ pwa_icon_url: url }).eq('id', COMPANY_ID);
  if (errUpdate) {
    console.error('❌ Error guardando pwa_icon_url:', errUpdate.message);
    process.exit(1);
  }

  console.log('✅ Ícono PWA de Nort Energy subido y guardado:');
  console.log('  ', url);
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
