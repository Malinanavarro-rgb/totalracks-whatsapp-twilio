/**
 * TARA Matrix™ — actualizar-plantilla-paneles-solares (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Aplica a "Empresa Demo Paneles Solares" (ya creada, migración 082/083) la
 * calificación comercial completa de la migración 085 — la fila de
 * plantillas_industria solo afecta a empresas NUEVAS; esta empresa ya
 * existente necesita que sus propias filas de `personalities`/
 * `workflow_nodes` se actualicen aparte (mismo patrón que
 * scripts/seed-demo-bella-studio.js: corrige la FUENTE y la empresa ya
 * creada en el mismo script).
 *
 * Encontrado en la validación real con Alina (2026-07-30): el workflow
 * original solo tenía 4 nodos — nunca pedía nombre, colonia, pisos, climas,
 * tipo de techo ni espacio en azotea. Reemplaza los 4 nodos viejos por los
 * 11 nuevos de la migración 085.
 *
 * Uso: node scripts/actualizar-plantilla-paneles-solares.js
 * Requiere: haber corrido migrations/085_plantilla_paneles_solares_calificacion_completa.sql primero.
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { listarNodos, crearNodo, eliminarNodo } = require('../modules/workflow-admin');

const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  // 1. Leer la plantilla ya actualizada (migración 085) — fuente única de verdad
  const { data: plantilla, error: errPlantilla } = await supabase
    .from('plantillas_industria').select('personalidad, workflow_seed').eq('slug', 'paneles_solares').single();
  await fatal('leyendo plantilla paneles_solares', errPlantilla);

  if (plantilla.workflow_seed.nodos.length !== 11) {
    console.error(`❌ La plantilla todavía tiene ${plantilla.workflow_seed.nodos.length} nodos — corre primero migrations/085_plantilla_paneles_solares_calificacion_completa.sql en Supabase.`);
    process.exit(1);
  }

  // 2. Actualizar personalidad de la empresa ya creada (campos_requeridos + reglas nuevas)
  await fatal('actualizando personalidad', (await supabase
    .from('personalities')
    .update({ campos_requeridos: plantilla.personalidad.campos_requeridos, reglas: plantilla.personalidad.reglas })
    .eq('company_id', COMPANY_ID)).error);
  console.log('✅ personalities.campos_requeridos y reglas actualizados.');

  // 3. Encontrar el workflow ya existente de esta empresa
  const { data: workflow, error: errWf } = await supabase
    .from('workflows').select('id, nombre').eq('company_id', COMPANY_ID).eq('trigger_value', 'solicitud_cotizacion').maybeSingle();
  await fatal('buscando workflow existente', errWf);
  if (!workflow) { console.error('❌ No se encontró el workflow de paneles solares para esta empresa.'); process.exit(1); }

  // 4. Actualizar nombre/descripción del workflow
  await fatal('actualizando workflow', (await supabase
    .from('workflows')
    .update({ nombre: plantilla.workflow_seed.nombre, descripcion: plantilla.workflow_seed.descripcion })
    .eq('id', workflow.id)).error);

  // 5. Borrar los nodos viejos (4) y crear los nuevos (11), reusando crearNodo() (misma validación que usa Configuración → Workflows)
  const nodosViejos = await listarNodos(supabase, COMPANY_ID, workflow.id);
  for (const nodo of nodosViejos) {
    await eliminarNodo(supabase, COMPANY_ID, nodo.id);
  }
  console.log(`✅ ${nodosViejos.length} nodo(s) viejo(s) eliminado(s).`);

  for (const nodo of plantilla.workflow_seed.nodos) {
    await crearNodo(supabase, COMPANY_ID, workflow.id, nodo);
  }
  console.log(`✅ ${plantilla.workflow_seed.nodos.length} nodo(s) nuevo(s) creado(s).`);

  console.log('\n🎉 "Empresa Demo Paneles Solares" actualizada — el workflow ahora pide nombre, tipo de propiedad, consumo, frecuencia del recibo, ciudad, colonia, pisos, climas, tipo de techo y espacio en azotea antes de agendar.');
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en actualizar-plantilla-paneles-solares:', err.message);
  process.exit(1);
});
