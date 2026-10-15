/**
 * TARA Matrix™ — TARA Module Engine, Fase 1: espejo de Nort Energy (Alina,
 * 2026-10-16, ver TARA_MODULE_ENGINE_PLAN_V1.md).
 * ─────────────────────────────────────────────────────────────────────────────
 * Copia fiel del `nav_labels.modulos` REAL de Nort Energy hacia
 * `modulos_empresa` — ningún módulo cambia de estado, solo se registra el
 * que ya tiene hoy. Idempotente (borra y vuelve a insertar las filas de
 * Nort Energy en cada corrida, mismo patrón que
 * scripts/nort-energy-roles-permisos.js).
 *
 * IMPORTANTE: esta corrida NO activa ningún enforcement — modulos_empresa
 * no la consulta todavía ningún middleware (Fase 2, no implementada aún).
 * Cero efecto observable para Nort Energy al correr este script.
 *
 * Uso: node scripts/nort-energy-modulos-empresa-espejo.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { calcularEspejoDesdeNavLabels } = require('../modules/modulos-espejo');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer || !company) {
    console.error('❌ Error leyendo la empresa:', errLeer?.message);
    process.exit(1);
  }

  const espejo = calcularEspejoDesdeNavLabels(company.nav_labels?.modulos);
  if (espejo.length === 0) {
    console.log('⚠️  nav_labels.modulos no tiene ninguna entrada con el campo "modulo" — nada que espejar.');
    process.exit(0);
  }

  const { error: errBorrar } = await supabase.from('modulos_empresa').delete().eq('company_id', COMPANY_ID);
  if (errBorrar) {
    console.error('❌ Error limpiando espejo previo:', errBorrar.message);
    process.exit(1);
  }

  const filas = espejo.map((e) => ({ company_id: COMPANY_ID, modulo_codigo: e.modulo_codigo, activo: e.activo }));
  const { error: errInsertar } = await supabase.from('modulos_empresa').insert(filas);
  if (errInsertar) {
    console.error('❌ Error insertando el espejo:', errInsertar.message);
    process.exit(1);
  }

  console.log(`✅ Nort Energy — espejo de módulos registrado: ${filas.length} filas.`);
  filas.forEach((f) => console.log(`   ${f.activo ? '✓' : '✗'} ${f.modulo_codigo}`));
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
