/**
 * TARA Matrix™ — Nort Energy: agregar dirección al workflow de visita
 * técnica (Alina, 2026-09-15 — auditoría del workflow real de ventas)
 * ─────────────────────────────────────────────────────────────────────────────
 * Hallazgo: "Calificación completa y agenda de visita técnica solar" nunca
 * preguntaba la dirección física de la instalación antes de agendar — una
 * clienta real recibió "tu visita quedó agendada" sin que TARA jamás le
 * pidiera calle/número/colonia.
 *
 * Cambios, EXCLUSIVOS de Nort Energy (workflow_id específico, no toca la
 * plantilla compartida `paneles_solares` — GONDOR/Demo no se ven afectados):
 *   1. Nuevo nodo `preguntar_direccion` (campo: direccion), insertado entre
 *      preguntar_espacio_azotea y preguntar_hora_preferida.
 *   2. preguntar_espacio_azotea.siguiente_nodo → preguntar_direccion.
 *   3. preguntar_hora_preferida.acciones: agrega `camposRequeridos:
 *      ['direccion']` a la acción agendar_cita_con_horario_solicitado — la
 *      validación real vive en modules/orchestrator.js (handler registrado
 *      en crearOrchestrator), aquí solo se declara el requisito como DATA.
 *
 * Uso: node scripts/nort-energy-workflow-direccion-fix.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const WORKFLOW_VISITA_TECNICA = '9f9f7423-5b08-49b5-a1bf-8b1adb5caa77'; // Nort Energy

(async () => {
  const { data: nodoEspacio, error: errEspacio } = await supabase
    .from('workflow_nodes').select('id, siguiente_nodo')
    .eq('workflow_id', WORKFLOW_VISITA_TECNICA).eq('nombre', 'preguntar_espacio_azotea').maybeSingle();
  if (errEspacio || !nodoEspacio) {
    console.error('❌ No se encontró preguntar_espacio_azotea:', errEspacio?.message);
    process.exit(1);
  }

  const { data: nodoHora, error: errHora } = await supabase
    .from('workflow_nodes').select('id, acciones')
    .eq('workflow_id', WORKFLOW_VISITA_TECNICA).eq('nombre', 'preguntar_hora_preferida').maybeSingle();
  if (errHora || !nodoHora) {
    console.error('❌ No se encontró preguntar_hora_preferida:', errHora?.message);
    process.exit(1);
  }

  // 1. Insertar el nodo nuevo (si no existe ya — idempotente)
  const { data: yaExiste } = await supabase
    .from('workflow_nodes').select('id')
    .eq('workflow_id', WORKFLOW_VISITA_TECNICA).eq('nombre', 'preguntar_direccion').maybeSingle();

  if (!yaExiste) {
    const { error: errCrear } = await supabase.from('workflow_nodes').insert([{
      workflow_id:    WORKFLOW_VISITA_TECNICA,
      nombre:         'preguntar_direccion',
      campo:          'direccion',
      pregunta:       '¿Cuál es la dirección completa donde sería la instalación? (calle, número, colonia y alguna referencia)',
      siguiente_nodo: 'preguntar_hora_preferida',
      modo_respuesta: 'replace_ai',
      es_inicio:      false,
      es_fin:         false,
      es_opcional:    false,
    }]);
    if (errCrear) {
      console.error('❌ Error creando preguntar_direccion:', errCrear.message);
      process.exit(1);
    }
    console.log('✅ Nodo preguntar_direccion creado.');
  } else {
    console.log('ℹ️  Nodo preguntar_direccion ya existía — no se duplica.');
  }

  // 2. Reencadenar preguntar_espacio_azotea → preguntar_direccion (antes iba directo a preguntar_hora_preferida)
  if (nodoEspacio.siguiente_nodo !== 'preguntar_direccion') {
    const { error: errReencadenar } = await supabase
      .from('workflow_nodes').update({ siguiente_nodo: 'preguntar_direccion' }).eq('id', nodoEspacio.id);
    if (errReencadenar) {
      console.error('❌ Error reencadenando preguntar_espacio_azotea:', errReencadenar.message);
      process.exit(1);
    }
    console.log('✅ preguntar_espacio_azotea ahora apunta a preguntar_direccion.');
  } else {
    console.log('ℹ️  preguntar_espacio_azotea ya apuntaba a preguntar_direccion.');
  }

  // 3. Agregar camposRequeridos a la acción de agendar, sin tocar duracionMinutos ni crear_oportunidad
  const accionesActualizadas = (nodoHora.acciones || []).map(accion =>
    accion.tipo === 'agendar_cita_con_horario_solicitado'
      ? { ...accion, parametros: { ...accion.parametros, camposRequeridos: ['direccion'] } }
      : accion
  );
  const { error: errAcciones } = await supabase
    .from('workflow_nodes').update({ acciones: accionesActualizadas }).eq('id', nodoHora.id);
  if (errAcciones) {
    console.error('❌ Error actualizando acciones de preguntar_hora_preferida:', errAcciones.message);
    process.exit(1);
  }
  console.log('✅ preguntar_hora_preferida ahora exige dirección antes de agendar.');

  process.exit(0);
})().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
