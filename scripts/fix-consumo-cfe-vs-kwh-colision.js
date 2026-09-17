/**
 * TARA Matrix™ — fix-consumo-cfe-vs-kwh-colision (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Causa raíz confirmada del "Bug B" reaparecido en el E2E de Nort Energy
 * (2026-08-15): el campo `consumo_mensual_cfe` (workflow "visita técnica")
 * en realidad pregunta "¿Cuánto pagas aproximadamente en tu recibo de CFE?"
 * — es un IMPORTE en pesos, no un consumo en kWh. Su nombre engañoso choca
 * con `consumo_mensual_kwh` (workflow "Cotización directa") en el schema de
 * extracción que ve el modelo (ambos "consumo_..." conviven en la misma
 * lista plana de campos_requeridos) — el modelo a veces mete el número de
 * kWh que dio el cliente bajo la llave equivocada, dejando
 * consumo_mensual_kwh vacío, y el nodo cae al fallback de texto crudo.
 *
 * Fix: renombrar `consumo_mensual_cfe` → `importe_mensual_cfe` (coincide
 * con lo que de verdad pregunta) — elimina la colisión de nombres. Cero
 * código depende de este nombre (grep confirmado) — es dato puro, no toca
 * Orchestrator/WorkflowEngine/ningún archivo congelado.
 *
 * Aplica a: la plantilla maestra (toda empresa nueva de paneles solares) y
 * las 2 empresas ya vivas con este workflow (Empresa Demo Paneles Solares,
 * Nort Energy).
 *
 * Uso: node scripts/fix-consumo-cfe-vs-kwh-colision.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const CAMPO_VIEJO = 'consumo_mensual_cfe';
const CAMPO_NUEVO = 'importe_mensual_cfe';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

function renombrarEnCampos(campos) {
  return (campos || []).map(c => (c === CAMPO_VIEJO ? CAMPO_NUEVO : c));
}

async function corregirEmpresa(companyId, nombreEmpresa) {
  const { data: workflow } = await supabase
    .from('workflows').select('id').eq('company_id', companyId).eq('trigger_value', 'solicitud_visita_tecnica').maybeSingle();

  if (workflow) {
    const { error: errNodo } = await supabase
      .from('workflow_nodes').update({ campo: CAMPO_NUEVO }).eq('workflow_id', workflow.id).eq('campo', CAMPO_VIEJO);
    await fatal(`renombrando nodo de ${nombreEmpresa}`, errNodo);
  }

  const { data: personalidad } = await supabase
    .from('personalities').select('campos_requeridos').eq('company_id', companyId).single();
  if (personalidad?.campos_requeridos?.includes(CAMPO_VIEJO)) {
    const { error: errPers } = await supabase
      .from('personalities').update({ campos_requeridos: renombrarEnCampos(personalidad.campos_requeridos) }).eq('company_id', companyId);
    await fatal(`actualizando campos_requeridos de ${nombreEmpresa}`, errPers);
  }

  console.log(`✅ ${nombreEmpresa} corregida.`);
}

(async () => {
  // 1. Plantilla maestra — toda empresa NUEVA de paneles_solares ya nace bien
  const { data: plantilla, error: errPlantilla } = await supabase
    .from('plantillas_industria').select('workflow_seed, personalidad').eq('slug', 'paneles_solares').single();
  await fatal('leyendo plantilla paneles_solares', errPlantilla);

  const nodosCorregidos = plantilla.workflow_seed.nodos.map(n =>
    n.campo === CAMPO_VIEJO ? { ...n, campo: CAMPO_NUEVO } : n
  );
  const personalidadCorregida = {
    ...plantilla.personalidad,
    campos_requeridos: renombrarEnCampos(plantilla.personalidad.campos_requeridos),
  };

  await fatal('actualizando plantilla maestra', (await supabase
    .from('plantillas_industria')
    .update({ workflow_seed: { ...plantilla.workflow_seed, nodos: nodosCorregidos }, personalidad: personalidadCorregida })
    .eq('slug', 'paneles_solares')).error);
  console.log('✅ Plantilla maestra paneles_solares corregida — empresas nuevas ya nacen sin la colisión.');

  // 2. Empresas ya vivas
  await corregirEmpresa('0affb234-3dc7-431f-862b-3230664962fb', 'Nort Energy');
  await corregirEmpresa('ffac2a5a-ea4f-4bee-9b82-8f4559b7594b', 'Empresa Demo Paneles Solares');

  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en fix-consumo-cfe-vs-kwh-colision:', err.message);
  process.exit(1);
});
