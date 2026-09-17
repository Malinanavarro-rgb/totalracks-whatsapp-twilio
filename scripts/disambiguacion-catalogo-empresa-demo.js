/**
 * TARA Matrix™ — disambiguacion-catalogo-empresa-demo (one-off)
 * ─────────────────────────────────────────────────────────────────────────────
 * Backfill de la regla de desambiguación de catálogo (Alina, 2026-08-10) para
 * "Empresa Demo Paneles Solares" — root cause de que TARA preguntara "¿qué
 * tipo de paneles?" a un prospecto de una empresa cuyo único giro es paneles
 * solares. La causa: nada en el prompt le indicaba al modelo que debía
 * resolver términos ambiguos DENTRO del catálogo de la empresa en vez de
 * cubrirse preguntando por alternativas que la empresa ni siquiera vende.
 *
 * La solución (modules/plantillas-industria.js::generarReglaDisambiguacion())
 * ya aplica automáticamente a toda empresa NUEVA con industria detectada —
 * este script solo hace el backfill para la empresa demo, que ya existía
 * antes del fix. Es 100% genérico: usa la plantilla de industria de la
 * empresa (nombre_visible + palabras_clave), nunca texto propio de "paneles
 * solares" hardcodeado aquí.
 *
 * Uso: node scripts/disambiguacion-catalogo-empresa-demo.js
 */

'use strict';

require('dotenv').config();

const { supabaseServicio: supabase } = require('../modules/clients');
const { obtenerPlantillaDeEmpresa, generarReglaDisambiguacion } = require('../modules/plantillas-industria');

const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b';

async function fatal(label, error) {
  if (error) { console.error(`❌ ${label}:`, error.message); process.exit(1); }
}

(async () => {
  const plantilla = await obtenerPlantillaDeEmpresa(supabase, COMPANY_ID);
  if (!plantilla) {
    console.error('❌ La empresa no tiene industria_slug con plantilla asociada — nada que hacer.');
    process.exit(1);
  }

  const { data: personalidad, error: errLeer } = await supabase
    .from('personalities').select('reglas').eq('company_id', COMPANY_ID).single();
  await fatal('leyendo personalities', errLeer);

  const reglaNueva = generarReglaDisambiguacion(plantilla);
  const reglasActuales = personalidad.reglas || [];
  const yaLaTiene = reglasActuales.some(r => r.texto === reglaNueva.texto);

  if (yaLaTiene) {
    console.log('✅ La regla de desambiguación ya estaba presente — nada que hacer.');
    process.exit(0);
  }

  const { error: errUpdate } = await supabase
    .from('personalities')
    .update({ reglas: [reglaNueva, ...reglasActuales] })
    .eq('company_id', COMPANY_ID);
  await fatal('actualizando personalities', errUpdate);

  console.log(`✅ Regla de desambiguación agregada (giro: "${plantilla.nombre_visible}"). Total de reglas: ${reglasActuales.length} → ${reglasActuales.length + 1}.`);
  console.log(`   Texto: ${reglaNueva.texto}`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en disambiguacion-catalogo-empresa-demo:', err.message);
  process.exit(1);
});
