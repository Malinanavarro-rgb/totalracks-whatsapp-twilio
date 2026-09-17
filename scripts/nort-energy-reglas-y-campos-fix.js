/**
 * TARA Matrix™ — nort-energy-reglas-y-campos-fix (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Replica para Nort Energy los mismos 2 fixes que ya se aplicaron a "Empresa
 * Demo Paneles Solares" (scripts/recibo-cfe-config-empresa-demo.js,
 * 2026-08-10) — nunca se generalizaron a la plantilla maestra
 * (plantillas_industria), así que cualquier empresa nueva de paneles
 * solares los necesita de nuevo:
 *
 * 1. `personalities.campos_requeridos` solo traía los 10 campos del
 *    workflow de "visita técnica" — nunca los 6 del workflow "Cotización
 *    directa" (el que corre el motor+PDF). Sin esto, la IA extrae los
 *    datos bajo nombres de campo VIEJOS (ej. consumo_mensual_cfe) en vez de
 *    los que el nodo actual necesita (consumo_mensual_kwh) — el nodo cae al
 *    fallback de texto crudo, guardando la oración completa del cliente en
 *    vez del número. Confirmado en vivo (E2E caso 8, 2026-08-15).
 * 2. Una regla decía "La cotización final siempre depende de la visita
 *    técnica gratuita — jamás cierres un precio por chat" — contradice
 *    directamente lo que "Cotización directa" existe para hacer.
 *
 * Uso: node scripts/nort-energy-reglas-y-campos-fix.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = '0affb234-3dc7-431f-862b-3230664962fb'; // Nort Energy

// Sin area_disponible_m2 — Nort Energy ya nació con el workflow corregido
// (6 nodos, dispara en preguntar_voltaje, el motor no requiere área).
const CAMPOS_COTIZACION_DIRECTA = [
  'ubicacion', 'consumo_mensual_kwh', 'importe_promedio_recibo',
  'pct_cobertura_deseado', 'tipo_alimentacion', 'voltaje_sitio',
];

const REGLA_VIEJA = 'La cotización final siempre depende de la visita técnica gratuita — jamás cierres un precio por chat.';
const REGLA_NUEVA = 'Si el cliente pide una cotización directa y ya tienes sus datos de consumo (por chat o por su recibo de CFE), puedes darle un predimensionamiento con el flujo de Cotización Directa — siempre acláralo como preliminar, sujeto a validación técnica. Si el cliente prefiere una visita técnica gratuita, esa es la vía para una cotización más precisa — nunca la presentes como la única opción posible.';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  const { data: personalidad, error: errLeer } = await supabase
    .from('personalities').select('campos_requeridos, reglas').eq('company_id', COMPANY_ID).single();
  await fatal('leyendo personalities', errLeer);

  const camposActuales = personalidad.campos_requeridos || [];
  const camposNuevos = [...new Set([...camposActuales, ...CAMPOS_COTIZACION_DIRECTA])];

  const reglasActuales = personalidad.reglas || [];
  const yaTieneReglaVieja = reglasActuales.some(r => r.texto === REGLA_VIEJA);
  const reglasNuevas = yaTieneReglaVieja
    ? reglasActuales.map(r => (r.texto === REGLA_VIEJA ? { ...r, texto: REGLA_NUEVA } : r))
    : reglasActuales;

  const { error: errUpdate } = await supabase
    .from('personalities')
    .update({ campos_requeridos: camposNuevos, reglas: reglasNuevas })
    .eq('company_id', COMPANY_ID);
  await fatal('actualizando personalities', errUpdate);

  console.log(`✅ campos_requeridos: ${camposActuales.length} → ${camposNuevos.length} (agregados: ${CAMPOS_COTIZACION_DIRECTA.filter(c => !camposActuales.includes(c)).join(', ')})`);
  console.log(yaTieneReglaVieja ? '✅ Regla contradictoria corregida.' : '⚠️  No se encontró la regla vieja exacta — revisar manualmente.');
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en nort-energy-reglas-y-campos-fix:', err.message);
  process.exit(1);
});
