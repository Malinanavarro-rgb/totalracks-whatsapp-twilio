/**
 * TARA Matrix™ — recibo-cfe-config-empresa-demo (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracción de recibo CFE (Alina, 2026-08-10) — dos correcciones de
 * configuración a "Empresa Demo Paneles Solares", encontradas en la
 * auditoría antes de implementar:
 *
 * 1. `personalities.campos_requeridos` solo tenía los 10 campos del
 *    workflow "Calificación completa y visita técnica" — nunca los 7 campos
 *    de "Cotización directa — ingeniería solar" (el que de verdad genera la
 *    cotización con PDF). Sin esto en la lista, la IA nunca podía
 *    auto-extraer esos campos de texto libre (el schema de datos_extraidos
 *    se arma en vivo desde esta lista — modules/prompt-builder.js). Se
 *    AGREGAN los 7 campos nuevos — no se quita ninguno de los 10
 *    existentes, ambos workflows siguen activos.
 *
 * 2. Una regla decía "La cotización final siempre depende de la visita
 *    técnica gratuita — jamás cierres un precio por chat" — es del
 *    paradigma del workflow de visita técnica y contradice directamente lo
 *    que "Cotización directa" existe para hacer. Confirmado con Alina: se
 *    corrige para que aplique solo cuando corresponda, sin bloquear el
 *    flujo de cotización directa que sí puede cerrar un predimensionamiento
 *    por chat (con su aviso de "sujeto a validación técnica", que el PDF ya
 *    incluye).
 *
 * Uso: node scripts/recibo-cfe-config-empresa-demo.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');

const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b';

const CAMPOS_COTIZACION_DIRECTA = [
  'ubicacion', 'consumo_mensual_kwh', 'importe_promedio_recibo',
  'pct_cobertura_deseado', 'tipo_alimentacion', 'voltaje_sitio', 'area_disponible_m2',
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

  // 1. campos_requeridos — agregar sin duplicar
  const camposActuales = personalidad.campos_requeridos || [];
  const camposNuevos = [...new Set([...camposActuales, ...CAMPOS_COTIZACION_DIRECTA])];

  // 2. reglas — reemplazar la contradictoria
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
  console.error('❌ Error fatal en recibo-cfe-config-empresa-demo:', err.message);
  process.exit(1);
});
