/**
 * TARA Matrix™ — Nort Energy, nav "Mantenimiento" y "Tickets" (Alina, 2026-09-28)
 * ─────────────────────────────────────────────────────────────────────────────
 * Última pieza del bloque operativo (2I) desplegada — habilita los dos
 * placeholders restantes (ambos ya existían en nav_labels: /mantenimiento
 * agregado por nort-energy-nav-garantias.js, /tickets desde el
 * placeholder original de fase 1). Se corre aparte, después de confirmar
 * el deploy, mismo criterio que los scripts de nav anteriores.
 *
 * Read-modify-write: solo toca esas dos entradas, deja todo lo demás intacto.
 *
 * Uso: node scripts/nort-energy-nav-mantenimiento-tickets.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy
const RUTAS_A_HABILITAR = ['/mantenimiento', '/tickets'];

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer) {
    console.error('❌ Error leyendo Nort Energy:', errLeer.message);
    process.exit(1);
  }

  const modulosActuales = company?.nav_labels?.modulos || [];
  const faltantes = RUTAS_A_HABILITAR.filter((r) => !modulosActuales.some((m) => m.ruta === r));
  if (faltantes.length > 0) {
    console.error(`❌ No existen estas entradas en nav_labels.modulos: ${faltantes.join(', ')} — revisa manualmente.`);
    process.exit(1);
  }

  const modulosNuevos = modulosActuales.map((m) => (RUTAS_A_HABILITAR.includes(m.ruta) ? { ...m, habilitado: true } : m));
  const navLabels = { ...(company?.nav_labels || {}), modulos: modulosNuevos };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo nav_labels de Nort Energy:', errEscribir.message);
    process.exit(1);
  }

  console.log('✅ Nort Energy — "Mantenimiento" y "Tickets" habilitados en nav_labels.modulos.');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
