/**
 * TARA Matrix™ — Nort Energy, nav "Garantías" (Alina, 2026-09-28)
 * ─────────────────────────────────────────────────────────────────────────────
 * El placeholder original (nort-energy-fase1-nav-dashboard.js) combinaba
 * "Garantías y mantenimiento" en una sola entrada /garantias — pero 2H
 * construyó Garantias.jsx/GarantiaDetalle.jsx como su propia página, y el
 * plan (NORT_ENERGY_PORTAL_PLAN.md, 2I) diseña Mantenimientos.jsx como una
 * página SEPARADA, todavía no construida. Mantener el label combinado
 * sería mostrar "mantenimiento" como si ya funcionara ahí — se separa en
 * dos entradas: /garantias (habilitado:true, ya real) y /mantenimiento
 * (habilitado:false, placeholder para 2I).
 *
 * Read-modify-write: solo toca esa entrada, deja todo lo demás intacto.
 *
 * Uso: node scripts/nort-energy-nav-garantias.js
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
  const idx = modulosActuales.findIndex((m) => m.ruta === '/garantias');
  if (idx === -1) {
    console.error('❌ No existe una entrada /garantias en nav_labels.modulos — revisa manualmente.');
    process.exit(1);
  }

  const entradaGarantias = { ruta: '/garantias', etiqueta: 'Garantías', icono: 'configuracion', habilitado: true, grupo: 'POSTVENTA' };
  const yaTieneMantenimiento = modulosActuales.some((m) => m.ruta === '/mantenimiento');
  const entradaMantenimiento = { ruta: '/mantenimiento', etiqueta: 'Mantenimiento', icono: 'configuracion', habilitado: false, grupo: 'POSTVENTA' };

  const modulosNuevos = [
    ...modulosActuales.slice(0, idx),
    entradaGarantias,
    ...(yaTieneMantenimiento ? [] : [entradaMantenimiento]),
    ...modulosActuales.slice(idx + 1),
  ];

  const navLabels = { ...(company?.nav_labels || {}), modulos: modulosNuevos };

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: navLabels }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error escribiendo nav_labels de Nort Energy:', errEscribir.message);
    process.exit(1);
  }

  console.log('✅ Nort Energy — "Garantías" habilitada; "Mantenimiento" agregada como placeholder para 2I.');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
