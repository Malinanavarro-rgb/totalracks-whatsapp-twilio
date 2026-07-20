/**
 * TARA Matrix™ — expirar-pruebas
 * ─────────────────────────────────────────────────────────────────────────────
 * Entrypoint standalone para un cron diario (mismo patrón que
 * scripts/enviar-recordatorios.js). No es parte del servidor Express —
 * corre una vez y termina.
 *
 * Pasa a 'expired' toda suscripción TARA Launch (u otro plan con prueba)
 * cuya fecha_prueba_fin ya venció — "al terminar debe solicitar la
 * contratación de un plan" lo resuelve el frontend al ver ese estado, no
 * este script.
 *
 * Uso: node scripts/expirar-pruebas.js
 *
 * @module scripts/expirar-pruebas
 */

'use strict';

require('dotenv').config();

// RLS: cron job sin usuario final — usa supabaseServicio (bypassa RLS).
const { supabaseServicio: supabase } = require('../modules/clients');
const { expirarPruebasVencidas } = require('../modules/plataforma-billing');

(async () => {
  const resultado = await expirarPruebasVencidas(supabase);
  console.log(`✅ Pruebas expiradas: ${resultado.expiradas}`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en expirar-pruebas:', err);
  process.exit(1);
});
