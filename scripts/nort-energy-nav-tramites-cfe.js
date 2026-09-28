/**
 * TARA Matrix™ — Nort Energy, nav "Trámites CFE" (Alina, 2026-09-28)
 * ─────────────────────────────────────────────────────────────────────────────
 * El módulo /tramites-cfe ya existía como placeholder (habilitado:false,
 * grupo OPERACIONES) desde scripts/nort-energy-fase1-nav-dashboard.js —
 * ahora que 2E tiene página real, se voltea a habilitado:true. Mismo
 * criterio que scripts/nort-energy-nav-compras.js: se corre aparte,
 * después de confirmar el deploy, para no mostrar un link antes de que la
 * página esté realmente en producción.
 *
 * Read-modify-write: solo toca la entrada de /tramites-cfe, deja todo lo
 * demás intacto.
 *
 * Uso: node scripts/nort-energy-nav-tramites-cfe.js
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
  const existe = modulosActuales.some((m) => m.ruta === '/tramites-cfe');
  if (!existe) {
    console.error('❌ No existe una entrada /tramites-cfe en nav_labels.modulos — revisa manualmente.');
    process.exit(1);
  }

  const modulosNuevos = modulosActuales.map((m) => (m.ruta === '/tramites-cfe' ? { ...m, habilitado: true } : m));
  const navLabels = { ...(company?.nav_labels || {}), modulos: modulosNuevos };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo nav_labels de Nort Energy:', errEscribir.message);
    process.exit(1);
  }

  console.log('✅ Nort Energy — módulo "Trámites CFE" habilitado en nav_labels.modulos.');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
