/**
 * TARA Matrix™ — nort-energy-workflow-nombre-fix (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Quick win de la auditoría de Expediente/Cotizador (2026-09-16, sección E):
 * causa raíz real confirmada de "Sin nombre" en Nort Energy — el workflow
 * "Cotización directa — ingeniería solar" (trigger_value='solicitud_cotizacion',
 * ver scripts/nort-energy-cotizador-setup.js) nunca pregunta el nombre del
 * cliente, a diferencia de "Calificación completa y agenda de visita técnica
 * solar" (migración 085), cuyo primer nodo sí lo hace.
 *
 * Agrega "preguntar_nombre" como nuevo nodo de inicio (mismo texto/campo/
 * modo_respuesta que ya usa el workflow de visita técnica — una sola fuente
 * de estilo conversacional) y reencadena "preguntar_ubicacion" como segundo
 * paso, sin tocar ningún otro nodo. Idempotente — si "preguntar_nombre" ya
 * existe, no hace nada.
 *
 * Uso: node scripts/nort-energy-workflow-nombre-fix.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  const { data: workflow, error: errWf } = await supabase
    .from('workflows').select('id')
    .eq('company_id', COMPANY_ID).eq('nombre', 'Cotización directa — ingeniería solar').maybeSingle();
  await fatal('leyendo workflow Cotización directa', errWf);
  if (!workflow) { console.error('❌ No se encontró el workflow "Cotización directa — ingeniería solar" — corre primero nort-energy-cotizador-setup.js.'); process.exit(1); }

  const { data: nodoNombre } = await supabase
    .from('workflow_nodes').select('id').eq('workflow_id', workflow.id).eq('nombre', 'preguntar_nombre').maybeSingle();
  if (nodoNombre) {
    console.log('⏭️  "preguntar_nombre" ya existe en este workflow — nada que hacer.');
    process.exit(0);
  }

  const { data: nodoUbicacion, error: errUbicacion } = await supabase
    .from('workflow_nodes').select('id, es_inicio').eq('workflow_id', workflow.id).eq('nombre', 'preguntar_ubicacion').maybeSingle();
  await fatal('leyendo nodo preguntar_ubicacion', errUbicacion);
  if (!nodoUbicacion) { console.error('❌ No se encontró el nodo "preguntar_ubicacion" — estructura inesperada, revisar a mano.'); process.exit(1); }

  await fatal('creando nodo preguntar_nombre', (await supabase.from('workflow_nodes').insert([{
    workflow_id: workflow.id, nombre: 'preguntar_nombre', es_inicio: true, es_fin: false,
    pregunta: '¿Con quién tengo el gusto?', campo: 'nombre', tipo_campo: 'text', es_opcional: false,
    siguiente_nodo: 'preguntar_ubicacion', acciones: [], modo_respuesta: 'prepend_ai', orden: 0,
  }])).error);
  console.log('✅ Nodo "preguntar_nombre" creado como nuevo inicio del workflow.');

  await fatal('reencadenando preguntar_ubicacion', (await supabase
    .from('workflow_nodes').update({ es_inicio: false }).eq('id', nodoUbicacion.id)).error);
  console.log('✅ "preguntar_ubicacion" ya no es el nodo de inicio — ahora es el segundo paso.');

  console.log('\n🎉 Listo — el workflow "Cotización directa" ahora pregunta el nombre primero.');
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en nort-energy-workflow-nombre-fix:', err.message);
  process.exit(1);
});
