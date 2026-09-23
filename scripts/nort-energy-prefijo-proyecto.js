/**
 * TARA Matrix™ — Nort Energy: prefijo de folio de proyecto ("NE")
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2A (Alina, 2026-09-22) — `companies.prefijo_proyecto` es
 * configurable por empresa (nunca hardcodeado en código, ver
 * modules/proyectos.js::generarFolioProyecto). Sin configurar, cualquier
 * empresa usa el default genérico "PRY". Este script solo fija el de
 * Nort Energy a "NE" (mismo patrón que agregar-nav-catalogo-tecnico.js) —
 * no toca ninguna otra empresa.
 *
 * Idempotente: si ya está en "NE", no hace nada.
 *
 * Uso: node scripts/nort-energy-prefijo-proyecto.js
 */

'use strict';

require('dotenv').config();
const { supabaseServicio: supabase } = require('../modules/clients');

(async () => {
  const { data: empresa, error } = await supabase.from('companies').select('id, nombre, prefijo_proyecto').ilike('nombre', '%Nort Energy%').maybeSingle();
  if (error) throw new Error(error.message);
  if (!empresa) throw new Error('No se encontró Nort Energy');

  if (empresa.prefijo_proyecto === 'NE') {
    console.log('✅ Nort Energy ya tiene prefijo_proyecto = "NE" — nada que hacer.');
    process.exit(0);
  }

  const { error: errUpdate } = await supabase.from('companies').update({ prefijo_proyecto: 'NE' }).eq('id', empresa.id);
  if (errUpdate) throw new Error(errUpdate.message);

  console.log(`✅ Nort Energy: prefijo_proyecto = "NE" (era: ${empresa.prefijo_proyecto ?? 'null'})`);
})().catch((err) => { console.error('❌', err.message); process.exit(1); });
