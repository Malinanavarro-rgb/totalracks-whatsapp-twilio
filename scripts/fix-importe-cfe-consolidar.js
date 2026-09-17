/**
 * TARA Matrix™ — fix-importe-cfe-consolidar (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Segunda mitad del fix de colisión de campos (2026-08-15): renombrar
 * consumo_mensual_cfe → importe_mensual_cfe solo desplazó la colisión —
 * importe_mensual_cfe e importe_promedio_recibo preguntan EXACTAMENTE lo
 * mismo (el importe del recibo de CFE), solo que con nombres distintos en
 * cada workflow. Confirmado en vivo: el modelo puso el número en uno y dejó
 * el otro con el texto crudo del cliente.
 *
 * Fix definitivo: en vez de renombrar de nuevo (mismo problema recurriría
 * con el siguiente par), CONSOLIDAR — el workflow de "visita técnica" pasa
 * a usar el mismo nombre canónico que ya consume el motor de cotización
 * (`importe_promedio_recibo`, ver modules/cotizaciones.js). Un solo nombre
 * para un solo concepto en toda la empresa — cero campos duplicados,
 * ninguna colisión posible. Cero código depende de `importe_mensual_cfe`
 * (se creó en el fix anterior, en el mismo día) — seguro renombrar de nuevo.
 *
 * Uso: node scripts/fix-importe-cfe-consolidar.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const CAMPO_VIEJO = 'importe_mensual_cfe';
const CAMPO_CANONICO = 'importe_promedio_recibo';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

async function corregirEmpresa(companyId, nombreEmpresa) {
  const { data: workflow } = await supabase
    .from('workflows').select('id').eq('company_id', companyId).eq('trigger_value', 'solicitud_visita_tecnica').maybeSingle();

  if (workflow) {
    const { error: errNodo } = await supabase
      .from('workflow_nodes').update({ campo: CAMPO_CANONICO }).eq('workflow_id', workflow.id).eq('campo', CAMPO_VIEJO);
    await fatal(`renombrando nodo de ${nombreEmpresa}`, errNodo);
  }

  const { data: personalidad } = await supabase
    .from('personalities').select('campos_requeridos').eq('company_id', companyId).single();
  if (personalidad?.campos_requeridos?.includes(CAMPO_VIEJO)) {
    // No duplicar si por alguna razón ya tenía también el canónico.
    const sinDuplicar = [...new Set(personalidad.campos_requeridos.map(c => (c === CAMPO_VIEJO ? CAMPO_CANONICO : c)))];
    const { error: errPers } = await supabase
      .from('personalities').update({ campos_requeridos: sinDuplicar }).eq('company_id', companyId);
    await fatal(`actualizando campos_requeridos de ${nombreEmpresa}`, errPers);
  }

  console.log(`✅ ${nombreEmpresa} consolidada.`);
}

(async () => {
  const { data: plantilla, error: errPlantilla } = await supabase
    .from('plantillas_industria').select('workflow_seed, personalidad').eq('slug', 'paneles_solares').single();
  await fatal('leyendo plantilla paneles_solares', errPlantilla);

  const nodosCorregidos = plantilla.workflow_seed.nodos.map(n =>
    n.campo === CAMPO_VIEJO ? { ...n, campo: CAMPO_CANONICO } : n
  );
  const camposSinDuplicar = [...new Set((plantilla.personalidad.campos_requeridos || []).map(c => (c === CAMPO_VIEJO ? CAMPO_CANONICO : c)))];

  await fatal('actualizando plantilla maestra', (await supabase
    .from('plantillas_industria')
    .update({
      workflow_seed: { ...plantilla.workflow_seed, nodos: nodosCorregidos },
      personalidad: { ...plantilla.personalidad, campos_requeridos: camposSinDuplicar },
    })
    .eq('slug', 'paneles_solares')).error);
  console.log('✅ Plantilla maestra paneles_solares consolidada.');

  await corregirEmpresa('0affb234-3dc7-431f-862b-3230664962fb', 'Nort Energy');
  await corregirEmpresa('ffac2a5a-ea4f-4bee-9b82-8f4559b7594b', 'Empresa Demo Paneles Solares');

  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en fix-importe-cfe-consolidar:', err.message);
  process.exit(1);
});
