/**
 * TARA Matrix™ — Nort Energy, etiqueta `modulo` en nav_labels.modulos para
 * filtrado de menú por rol (Alina, 2026-10-01, segunda pasada de roles
 * departamentales tras migración 124).
 * ─────────────────────────────────────────────────────────────────────────────
 * Agrega el campo `modulo` (nombre exacto en MODULOS_PERMISOS) a cada
 * entrada del menú cuya ruta corresponde a un módulo de la matriz de
 * permisos — Shell.jsx lo usa para ocultar links que el backend negaría
 * con 403. Las entradas sin `modulo` (Dashboard, Conversaciones, Inbox,
 * Agenda, Centro de Conocimiento, catálogos, Reportes, Panel de Acción,
 * Configuración) quedan sin filtrar — Configuración a propósito, porque su
 * backend todavía no está gateado por requirePermiso.
 *
 * Uso: node scripts/nort-energy-nav-modulo-permisos.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

const MODULO_POR_RUTA = {
  '/crm/pipeline': 'crm',
  '/crm': 'crm',
  '/cotizaciones': 'cotizaciones',
  '/instalaciones': 'instalaciones',
  '/tramites-cfe': 'tramites_cfe',
  '/cobranza': 'cobranza',
  '/inventario': 'inventario',
  '/compras': 'compras',
  '/garantias': 'garantias',
  '/mantenimiento': 'mantenimiento',
  '/tickets': 'tickets',
};

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer || !company) {
    console.error('❌ Error leyendo la empresa:', errLeer?.message);
    process.exit(1);
  }

  const navLabels = company.nav_labels || {};
  const modulos = navLabels.modulos || [];
  let tocados = 0;
  const nuevosModulos = modulos.map((m) => {
    const modulo = MODULO_POR_RUTA[m.ruta];
    if (!modulo) return m;
    tocados++;
    return { ...m, modulo };
  });

  const { error: errEscribir } = await supabase
    .from('companies').update({ nav_labels: { ...navLabels, modulos: nuevosModulos } }).eq('id', COMPANY_ID);
  if (errEscribir) {
    console.error('❌ Error guardando:', errEscribir.message);
    process.exit(1);
  }

  console.log(`✅ Nort Energy — ${tocados} entradas del menú etiquetadas con "modulo" para filtrado por rol.`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
