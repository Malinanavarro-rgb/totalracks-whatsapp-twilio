/**
 * TARA Matrix™ — Nort Energy, nav "Inventario" (Alina, 2026-09-28)
 * ─────────────────────────────────────────────────────────────────────────────
 * El backend de 2F (inventario) llevaba desplegado desde el 25 de
 * septiembre, pero sin frontend — ahora que /inventario tiene página real
 * y está confirmado en producción, se habilita. Mismo criterio que el
 * resto de scripts de nav: se corre después de confirmar el deploy real
 * (bundle hash verificado), nunca antes.
 *
 * Read-modify-write: solo toca esa entrada, deja todo lo demás intacto.
 *
 * Uso: node scripts/nort-energy-nav-inventario.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer) {
    console.error('❌ Error leyendo Nort Energy:', errLeer.message);
    process.exit(1);
  }

  const modulosActuales = company?.nav_labels?.modulos || [];
  if (!modulosActuales.some((m) => m.ruta === '/inventario')) {
    console.error('❌ No existe una entrada /inventario en nav_labels.modulos — revisa manualmente.');
    process.exit(1);
  }

  const modulosNuevos = modulosActuales.map((m) => (m.ruta === '/inventario' ? { ...m, habilitado: true } : m));
  const navLabels = { ...(company?.nav_labels || {}), modulos: modulosNuevos };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo nav_labels de Nort Energy:', errEscribir.message);
    process.exit(1);
  }

  console.log('✅ Nort Energy — módulo "Inventario" habilitado en nav_labels.modulos.');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
