/**
 * TARA Matrix™ — TARA Module Engine, Fase 1: espejo de Nort Energy (Alina,
 * 2026-10-16, revisado 2026-10-17 tras tu revisión del informe de entrega
 * — ver TARA_MODULE_ENGINE_PLAN_V1.md).
 * ─────────────────────────────────────────────────────────────────────────────
 * Copia fiel del `nav_labels.modulos` REAL de Nort Energy hacia
 * `modulos_empresa` — ningún módulo cambia de estado, solo se registra el
 * que ya tiene hoy. Idempotente (borra y vuelve a insertar las filas de
 * Nort Energy en cada corrida, mismo patrón que
 * scripts/nort-energy-roles-permisos.js) — correr esto 2 veces produce
 * exactamente el mismo resultado final (o el resultado actualizado, si
 * nav_labels cambió entre corridas — eso es el comportamiento correcto de
 * un espejo, no un bug).
 *
 * Paso previo (2026-10-17): marca `integrado: true` en las 2 entradas de
 * nav_labels que son funcionalidad real sin nav propia — Instalaciones y
 * Cobranza, accesibles desde Proyecto 360°. Nunca se infiere por nombre de
 * módulo (modules/modulos-espejo.js lo exige explícito) — se escribe UNA
 * vez, de forma idempotente (if ya está marcado, no lo vuelve a tocar), y
 * sigue siendo metadata de navegación pura — nunca un mecanismo de
 * autorización (esa sigue siendo, exclusivamente, modulos_empresa).
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
const MODULOS_INTEGRADOS_SIN_NAV_PROPIA = new Set(['instalaciones', 'cobranza']);

(async () => {
  const { data: company, error: errLeer } = await supabase
    .from('companies').select('nav_labels').eq('id', COMPANY_ID).maybeSingle();
  if (errLeer || !company) {
    console.error('❌ Error leyendo la empresa:', errLeer?.message);
    process.exit(1);
  }

  const modulosNav = company.nav_labels?.modulos || [];

  // Paso previo, idempotente: marca integrado:true donde corresponda, solo
  // si todavía no estaba marcado — nunca reescribe nada más de la entrada.
  let huboCambios = false;
  const modulosActualizados = modulosNav.map((item) => {
    if (item.modulo && MODULOS_INTEGRADOS_SIN_NAV_PROPIA.has(item.modulo) && item.integrado !== true) {
      huboCambios = true;
      return { ...item, integrado: true };
    }
    return item;
  });

  if (huboCambios) {
    const { error: errNav } = await supabase
      .from('companies').update({ nav_labels: { ...company.nav_labels, modulos: modulosActualizados } }).eq('id', COMPANY_ID);
    if (errNav) {
      console.error('❌ Error marcando integrado:true en nav_labels:', errNav.message);
      process.exit(1);
    }
    console.log('✅ nav_labels actualizado: Instalaciones/Cobranza marcadas como integrado:true.');
  } else {
    console.log('ℹ️  nav_labels ya tenía integrado:true donde correspondía — sin cambios.');
  }

  const espejo = calcularEspejoDesdeNavLabels(modulosActualizados);
  if (espejo.length === 0) {
    console.log('⚠️  nav_labels.modulos no tiene ninguna entrada con el campo "modulo" — nada que espejar.');
    process.exit(0);
  }

  const { error: errBorrar } = await supabase.from('modulos_empresa').delete().eq('company_id', COMPANY_ID);
  if (errBorrar) {
    console.error('❌ Error limpiando espejo previo:', errBorrar.message);
    process.exit(1);
  }

  const filas = espejo.map((e) => ({ company_id: COMPANY_ID, modulo_codigo: e.modulo_codigo, estado: e.estado }));
  const { error: errInsertar } = await supabase.from('modulos_empresa').insert(filas);
  if (errInsertar) {
    console.error('❌ Error insertando el espejo:', errInsertar.message);
    process.exit(1);
  }

  const { error: errMarcar } = await supabase
    .from('companies').update({ module_engine_configurado_en: new Date().toISOString() }).eq('id', COMPANY_ID);
  if (errMarcar) {
    console.error('❌ Error marcando module_engine_configurado_en:', errMarcar.message);
    process.exit(1);
  }

  console.log(`✅ Nort Energy — espejo de módulos registrado: ${filas.length} filas.`);
  filas.forEach((f) => console.log(`   ${f.estado.padEnd(10)} ${f.modulo_codigo}`));
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
