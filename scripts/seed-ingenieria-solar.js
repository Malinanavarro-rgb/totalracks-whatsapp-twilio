#!/usr/bin/env node
/**
 * Seed mínimo para validar el motor de ingeniería solar contra la DB real:
 * 1 ubicación con HSP, 1 panel, 1 inversor monofásico, 1 inversor
 * trifásico — para la empresa demo de paneles solares. Idempotente: si ya
 * existe una fila con el mismo nombre/sku, no la duplica.
 *
 * Uso: node scripts/seed-ingenieria-solar.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b'; // Empresa Demo Paneles Solares

async function upsertHSP() {
  const { data: existente } = await supabase.from('irradiacion_regional').select('id').eq('nombre_ubicacion', 'Monterrey, Nuevo León').maybeSingle();
  if (existente) { console.log('  ⏭️  HSP Monterrey ya existe'); return; }

  const { error } = await supabase.from('irradiacion_regional').insert([{
    nombre_ubicacion: 'Monterrey, Nuevo León',
    lat: 25.6866, lng: -100.3161,
    hsp_promedio_anual: 5.5,
    hsp_mensual: { enero: 4.6, febrero: 5.1, marzo: 5.8, abril: 6.2, mayo: 6.3, junio: 6.1, julio: 6.0, agosto: 5.9, septiembre: 5.4, octubre: 5.0, noviembre: 4.5, diciembre: 4.3 },
    fuente: 'NREL NSRDB',
    fecha_fuente: '2024-01-01',
  }]);
  console.log(error ? `  ❌ HSP Monterrey: ${error.message}` : '  ✅ HSP Monterrey creado');
}

async function upsertProducto(producto) {
  const { data: existente } = await supabase.from('productos').select('id').eq('company_id', COMPANY_ID).eq('sku', producto.sku).maybeSingle();
  if (existente) { console.log(`  ⏭️  ${producto.sku} ya existe`); return; }

  const { error } = await supabase.from('productos').insert([{ company_id: COMPANY_ID, ...producto }]);
  console.log(error ? `  ❌ ${producto.sku}: ${error.message}` : `  ✅ ${producto.sku} creado`);
}

async function upsertHSPHermosillo() {
  const { data: existente } = await supabase.from('irradiacion_regional').select('id').eq('nombre_ubicacion', 'Hermosillo, Sonora').maybeSingle();
  if (existente) { console.log('  ⏭️  HSP Hermosillo ya existe'); return; }

  const { error } = await supabase.from('irradiacion_regional').insert([{
    nombre_ubicacion: 'Hermosillo, Sonora',
    lat: 29.0729, lng: -110.9559,
    hsp_promedio_anual: 6.0,
    fuente: 'NREL NSRDB',
    fecha_fuente: '2024-01-01',
  }]);
  console.log(error ? `  ❌ HSP Hermosillo: ${error.message}` : '  ✅ HSP Hermosillo creado');
}

async function main() {
  console.log('\n🌱 Seed de ingeniería solar — Empresa Demo Paneles Solares\n');

  await upsertHSP();
  await upsertHSPHermosillo();

  await upsertProducto({
    tipo: 'panel_solar', marca: 'Jinko Solar', modelo: 'Tiger Neo 550', sku: 'JKM550M-72HL4-V',
    descripcion: 'Panel monocristalino 550W', precio: 3200, unidad: 'pieza',
    ficha_tecnica_completa: true,
    specs: { potencia_wp: 550, voc: 49.5, vmp: 41.7, isc: 14.02, imp: 13.19, coef_temp_voc: -0.27, area_m2: 2.58 },
  });

  await upsertProducto({
    tipo: 'inversor', marca: 'Growatt', modelo: 'MIN 4000TL-X', sku: 'GW-MIN4000TL-X',
    descripcion: 'Inversor monofásico 4kW', precio: 9500, unidad: 'pieza',
    ficha_tecnica_completa: true,
    specs: {
      tipo_red: 'monofasica', voltaje_salida_v: 220, potencia_ac_nominal_kw: 4, potencia_dc_max_kw: 6,
      voltaje_max_entrada_v: 500, rango_mppt_min_v: 80, rango_mppt_max_v: 450, numero_mppt: 2, corriente_max_por_mppt_a: 13.5,
    },
  });

  await upsertProducto({
    tipo: 'inversor', marca: 'Huawei', modelo: 'SUN2000-40KTL-M3', sku: 'HW-SUN2000-40KTL',
    descripcion: 'Inversor trifásico 40kW', precio: 68000, unidad: 'pieza',
    ficha_tecnica_completa: true,
    specs: {
      tipo_red: 'trifasica', voltaje_salida_v: 380, potencia_ac_nominal_kw: 40, potencia_dc_max_kw: 60,
      voltaje_max_entrada_v: 1100, rango_mppt_min_v: 200, rango_mppt_max_v: 1000, numero_mppt: 4, corriente_max_por_mppt_a: 26,
    },
  });

  console.log('\n✅ Seed completo.\n');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
