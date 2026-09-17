/**
 * TARA Matrix™ — cotizacion-directa-accion-en-voltaje (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Fix D (Alina, 2026-08-10 — diagnóstico "mándame la cotización no dispara
 * nada"): el workflow "Cotización directa — ingeniería solar" solo dispara
 * ejecutar_motor_ingenieria al completar su nodo 7 ("preguntar_area"), pero
 * el motor (modules/motores-ingenieria/paneles-solares.js::generarAlertas)
 * NO requiere area_disponible_m2 para calcular — solo bloquea si el área SÍ
 * se dio y resulta insuficiente. Los campos que el motor de verdad exige son:
 * ubicacion (HSP), consumo, pct_cobertura_deseado, tipo_alimentacion y
 * voltaje_sitio — exactamente los nodos 1-6.
 *
 * Este script mueve es_fin + la acción ejecutar_motor_ingenieria del nodo 7
 * al nodo 6 ("preguntar_voltaje") y elimina el nodo 7, que ya no se alcanza.
 * Dato, no código — mismo patrón que las plantillas de industria.
 *
 * Uso: node scripts/cotizacion-directa-accion-en-voltaje.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const WORKFLOW_ID = '83ff8fbc-a492-43a4-ae96-3e522fe8079d'; // "Cotización directa — ingeniería solar"

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  const { data: nodoVoltaje, error: errLeer } = await supabase
    .from('workflow_nodes')
    .select('id, nombre, es_fin, siguiente_nodo, acciones')
    .eq('workflow_id', WORKFLOW_ID).eq('nombre', 'preguntar_voltaje').single();
  await fatal('leyendo preguntar_voltaje', errLeer);

  if (nodoVoltaje.es_fin) {
    console.log('✅ preguntar_voltaje ya es el nodo final — nada que hacer ahí.');
  } else {
    const { error: errUpdate } = await supabase
      .from('workflow_nodes')
      .update({ es_fin: true, siguiente_nodo: null, acciones: [{ tipo: 'ejecutar_motor_ingenieria', parametros: {} }] })
      .eq('id', nodoVoltaje.id);
    await fatal('actualizando preguntar_voltaje', errUpdate);
    console.log('✅ preguntar_voltaje ahora es el nodo final y dispara ejecutar_motor_ingenieria.');
  }

  const { data: nodoArea, error: errArea } = await supabase
    .from('workflow_nodes')
    .select('id').eq('workflow_id', WORKFLOW_ID).eq('nombre', 'preguntar_area').maybeSingle();
  await fatal('leyendo preguntar_area', errArea);

  if (!nodoArea) {
    console.log('✅ preguntar_area ya no existe — nada que borrar.');
  } else {
    const { error: errDelete } = await supabase.from('workflow_nodes').delete().eq('id', nodoArea.id);
    await fatal('borrando preguntar_area', errDelete);
    console.log('✅ preguntar_area eliminado (ya no era alcanzable ni requerido por el motor).');
  }

  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en cotizacion-directa-accion-en-voltaje:', err.message);
  process.exit(1);
});
