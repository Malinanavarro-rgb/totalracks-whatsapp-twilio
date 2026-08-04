#!/usr/bin/env node
/**
 * Paquetes comerciales de paneles solares (Alina, 2026-08-04) — escenario
 * completo contra la base de datos real: el motor calcula la cantidad
 * técnica, el sistema recomienda el paquete inmediato superior, el asesor
 * autoriza (con o sin ajuste), y aplicarCalculoALineas usa ese precio —
 * nunca la suma de componentes del catálogo.
 *
 * Uso: node scripts/validar-paquetes-solares.js
 */

require('dotenv').config();
const { supabaseServicio: supabase } = require('../modules/clients');
const { correrCotizacionDesdeWorkflow, autorizarPrecioFinal } = require('../modules/cotizaciones');
const { aplicarCalculoALineas, listarLineas } = require('../modules/cotizacion-lineas');

const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b';
const CLIENTE_ID = 105;

let fallas = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); fallas++; }
}

const cotizacionesDePrueba = [];

async function correrCaso(pctCoberturaPorcentaje) {
  // Vía correrCotizacionDesdeWorkflow (el camino real de producción) — no
  // correrYGuardarCalculo directo, que deliberadamente NO resuelve paquete
  // (esa lógica vive en la capa de orquestación, no en el cálculo puro).
  const calculo = await correrCotizacionDesdeWorkflow(supabase, {
    companyId: COMPANY_ID, clienteId: CLIENTE_ID,
    capturedFields: {
      ubicacion: 'Monterrey, Nuevo León', consumo_mensual_kwh: '600', importe_promedio_recibo: '2400',
      pct_cobertura_deseado: String(pctCoberturaPorcentaje), tipo_alimentacion: 'monofasica', voltaje_sitio: '220', area_disponible_m2: '60',
    },
  });
  cotizacionesDePrueba.push(calculo.cotizacion_id);

  const { data: cotizacionActualizada } = await supabase.from('cotizaciones').select('*').eq('id', calculo.cotizacion_id).single();
  return { cotizacion: cotizacionActualizada, calculo };
}

async function main() {
  console.log('\n🔬 Paquetes solares — escenario completo contra la base de datos real\n');

  console.log('CASO 1 — 7 paneles técnicos → debe recomendar el paquete de 8 ($64,000), no el de 6:');
  const caso1 = await correrCaso(80);
  assert(caso1.calculo.resultados.numero_paneles.valor === 7, `numero_paneles técnico === 7 (fue: ${caso1.calculo.resultados.numero_paneles.valor})`);
  assert(caso1.cotizacion.precio_paquete_recomendado === '64000.00' || Number(caso1.cotizacion.precio_paquete_recomendado) === 64000, `precio_paquete_recomendado === 64000 (fue: ${caso1.cotizacion.precio_paquete_recomendado})`);

  console.log('\nCASO 2 — 9 paneles técnicos → debe recomendar el paquete de 10 ($84,000), no el de 8:');
  const caso2 = await correrCaso(95);
  assert(caso2.calculo.resultados.numero_paneles.valor === 9, `numero_paneles técnico === 9 (fue: ${caso2.calculo.resultados.numero_paneles.valor})`);
  assert(Number(caso2.cotizacion.precio_paquete_recomendado) === 84000, `precio_paquete_recomendado === 84000 (fue: ${caso2.cotizacion.precio_paquete_recomendado})`);

  console.log('\nPASO 3 — autorizar el precio SIN ajustar (acepta el recomendado):');
  const autorizada1 = await autorizarPrecioFinal(supabase, { cotizacionId: caso1.cotizacion.id, usuarioId: null });
  assert(Number(autorizada1.precio_final_autorizado) === 64000, `precio_final_autorizado === precio recomendado (64000), fue: ${autorizada1.precio_final_autorizado}`);
  assert(!!autorizada1.precio_final_autorizado_en, 'quedó registrada la fecha de autorización');

  console.log('\nPASO 4 — aplicarCalculoALineas crea UNA sola línea con ese precio (no 5 líneas por componente):');
  const lineas1 = await aplicarCalculoALineas(supabase, { companyId: COMPANY_ID, cotizacionId: caso1.cotizacion.id });
  assert(lineas1.length === 1, `se creó exactamente 1 línea (fueron: ${lineas1.length})`);
  assert(Number(lineas1[0]?.precio_unitario) === 64000, `precio_unitario de la línea === 64000 (fue: ${lineas1[0]?.precio_unitario})`);
  assert(lineas1[0]?.descripcion?.includes('Paquete 8 paneles'), `la descripción menciona el paquete correcto ("${lineas1[0]?.descripcion}")`);

  console.log('\nPASO 5 — el asesor AJUSTA el precio antes de autorizar (caso 2, 9 paneles → paquete de 10):');
  const autorizada2 = await autorizarPrecioFinal(supabase, { cotizacionId: caso2.cotizacion.id, usuarioId: null, precioFinal: 80000 });
  assert(Number(autorizada2.precio_final_autorizado) === 80000, `precio_final_autorizado === el monto AJUSTADO (80000), no el recomendado (84000). Fue: ${autorizada2.precio_final_autorizado}`);

  const lineas2 = await aplicarCalculoALineas(supabase, { companyId: COMPANY_ID, cotizacionId: caso2.cotizacion.id });
  assert(Number(lineas2[0]?.precio_unitario) === 80000, `la línea usa el precio AJUSTADO por el asesor (80000), no el recomendado. Fue: ${lineas2[0]?.precio_unitario}`);

  console.log(`\n${fallas === 0 ? '✅ TODO EN VERDE' : `❌ ${fallas} verificación(es) fallaron`}\n`);

  console.log('🧹 Limpiando artefactos de prueba...');
  for (const cotId of cotizacionesDePrueba) {
    await supabase.from('cotizaciones').update({ calculo_ingenieria_id: null }).eq('id', cotId);
    await supabase.from('cotizacion_lineas').delete().eq('cotizacion_id', cotId);
    await supabase.from('calculos_ingenieria').delete().eq('cotizacion_id', cotId);
    await supabase.from('cotizaciones').delete().eq('id', cotId);
  }
  console.log('✅ Limpieza completa.\n');

  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(e => { console.error('❌ Error:', e.message, e.stack); process.exit(1); });
