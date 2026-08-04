#!/usr/bin/env node
/**
 * Valida el motor de ingeniería solar CONTRA LA BASE DE DATOS REAL —
 * checklist punto 7 de Alina (2026-08-04): "correr los 3 casos directamente
 * contra la base de datos", no solo como funciones puras aisladas.
 *
 * Corre los mismos 3 casos de __tests__/motores-ingenieria-paneles-solares.test.js
 * (residencial monofásico, comercial trifásico, bloqueado por área
 * insuficiente) pero resolviendo HSP/parámetros/catálogo desde Supabase real
 * vía modules/cotizaciones.js — y además valida punto 8 (inmutabilidad de
 * versión) y punto 9 (bloqueo de ingenieria_validada_para_cotizar).
 *
 * Uso: node scripts/validar-ingenieria-solar-db.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { correrYGuardarCalculo, marcarIngenieriaValidada } = require('../modules/cotizaciones');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b'; // Empresa Demo Paneles Solares
const CLIENTE_RESIDENCIAL = 105; // Jorge Villarreal
const CLIENTE_COMERCIAL = 107;   // Refaccionaria Cantú

let fallas = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); fallas++; }
}

async function crearCotizacionBorrador(clienteId) {
  const { data, error } = await supabase.from('cotizaciones').insert([{ company_id: COMPANY_ID, cliente_id: clienteId, estado: 'borrador', descripcion: 'Cotización de prueba — validación 088' }]).select().single();
  if (error) throw new Error(`crear cotización borrador: ${error.message}`);
  return data.id;
}

async function obtenerProductoId(sku) {
  const { data, error } = await supabase.from('productos').select('id').eq('company_id', COMPANY_ID).eq('sku', sku).single();
  if (error) throw new Error(`producto ${sku} no encontrado: ${error.message}`);
  return data.id;
}

async function main() {
  console.log('\n🔬 Validación del motor de ingeniería solar contra la base de datos real\n');

  const panelId = await obtenerProductoId('JKM550M-72HL4-V');

  // ── CASO 1 — residencial monofásico ───────────────────────────────────────
  console.log('CASO 1 — residencial monofásico:');
  const cot1 = await crearCotizacionBorrador(CLIENTE_RESIDENCIAL);
  const calculo1 = await correrYGuardarCalculo(supabase, {
    companyId: COMPANY_ID, cotizacionId: cot1, industriaSlug: 'paneles_solares',
    infoTecnica: {
      ubicacion: 'Monterrey, Nuevo León',
      consumoMensualKwh: 600, pctCoberturaDeseado: 0.90, importePromedioRecibo: 2400,
      tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 40, incluyeCargosFijos: false,
    },
    panelSeleccionadoId: panelId, temperaturaMinSitio: 5, inversionNeta: 95000,
  });
  assert(calculo1.estado_calculo === 'completo', `estado_calculo === 'completo' (fue: ${calculo1.estado_calculo})`);
  assert(calculo1.version === 1, `version === 1 (fue: ${calculo1.version})`);
  assert(calculo1.resultados.numero_paneles.valor === 8, `numero_paneles === 8 (fue: ${calculo1.resultados.numero_paneles.valor})`);
  assert(calculo1.resultados.inversor_seleccionado.inversorSeleccionado !== null, 'inversor seleccionado (Growatt monofásico)');
  assert(calculo1.parametros_usados.performance_ratio.valor === 0.77, 'PR resuelto desde DB (0.77)');

  // ── CASO 2 — comercial trifásico ──────────────────────────────────────────
  console.log('\nCASO 2 — comercial trifásico:');
  const cot2 = await crearCotizacionBorrador(CLIENTE_COMERCIAL);
  const calculo2 = await correrYGuardarCalculo(supabase, {
    companyId: COMPANY_ID, cotizacionId: cot2, industriaSlug: 'paneles_solares',
    infoTecnica: {
      ubicacion: 'Hermosillo, Sonora',
      consumoMensualKwh: 8000, pctCoberturaDeseado: 0.80, importePromedioRecibo: 32000,
      tipoAlimentacion: 'trifasica', voltajeSitio: 380, areaDisponibleM2: 350, incluyeCargosFijos: true,
    },
    panelSeleccionadoId: panelId, temperaturaMinSitio: 10, inversionNeta: 950000,
  });
  assert(calculo2.estado_calculo === 'completo', `estado_calculo === 'completo' (fue: ${calculo2.estado_calculo})`);
  assert(calculo2.resultados.inversor_seleccionado.inversorSeleccionado.id === (await obtenerProductoId('HW-SUN2000-40KTL')), 'seleccionó el inversor trifásico 40kW');
  assert(calculo2.resultados.numero_paneles.valor > 70, `numero_paneles > 70 (fue: ${calculo2.resultados.numero_paneles.valor})`);

  // ── CASO 3 — bloqueado por área insuficiente ──────────────────────────────
  console.log('\nCASO 3 — bloqueado (área insuficiente):');
  const cot3 = await crearCotizacionBorrador(CLIENTE_RESIDENCIAL);
  const calculo3 = await correrYGuardarCalculo(supabase, {
    companyId: COMPANY_ID, cotizacionId: cot3, industriaSlug: 'paneles_solares',
    infoTecnica: {
      ubicacion: 'Monterrey, Nuevo León',
      consumoMensualKwh: 600, pctCoberturaDeseado: 0.90, importePromedioRecibo: 2400,
      tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 10,
    },
    panelSeleccionadoId: panelId, temperaturaMinSitio: 5, inversionNeta: 95000,
  });
  assert(calculo3.estado_calculo === 'bloqueado', `estado_calculo === 'bloqueado' (fue: ${calculo3.estado_calculo})`);
  assert(calculo3.alertas.some(a => a.tipo === 'area_insuficiente' && a.severidad === 'bloqueo'), 'alerta area_insuficiente presente con severidad bloqueo');

  // ── Punto 8 — inmutabilidad: recalcular CASO 1 debe insertar version 2, no sobrescribir la 1 ──
  console.log('\nPunto 8 — inmutabilidad de versión:');
  const calculo1v2 = await correrYGuardarCalculo(supabase, {
    companyId: COMPANY_ID, cotizacionId: cot1, industriaSlug: 'paneles_solares',
    infoTecnica: {
      ubicacion: 'Monterrey, Nuevo León',
      consumoMensualKwh: 700, pctCoberturaDeseado: 0.90, importePromedioRecibo: 2800, // datos distintos, a propósito
      tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 40, incluyeCargosFijos: false,
    },
    panelSeleccionadoId: panelId, temperaturaMinSitio: 5, inversionNeta: 95000,
  });
  assert(calculo1v2.version === 2, `recálculo genera version === 2 (fue: ${calculo1v2.version})`);
  const { data: filaOriginal } = await supabase.from('calculos_ingenieria').select('*').eq('id', calculo1.id).single();
  assert(filaOriginal.datos_entrada.consumoMensualKwh === 600, 'la fila version 1 original NUNCA cambió (consumoMensualKwh sigue en 600)');
  const { count: totalVersiones } = await supabase.from('calculos_ingenieria').select('*', { count: 'exact', head: true }).eq('cotizacion_id', cot1);
  assert(totalVersiones === 2, `existen 2 filas para cot1, no 1 sobrescrita (fueron: ${totalVersiones})`);

  // ── Punto 9 — bloqueo de validación con alerta de bloqueo activa ─────────
  console.log('\nPunto 9 — marcarIngenieriaValidada rechaza con alerta de bloqueo:');
  try {
    await marcarIngenieriaValidada(supabase, { cotizacionId: cot3, usuarioId: null });
    assert(false, 'marcarIngenieriaValidada debía rechazar cot3 (tiene alerta de bloqueo) — NO lo hizo');
  } catch (e) {
    assert(e.status === 409 && /bloqueo/.test(e.message), `rechazó correctamente: "${e.message}"`);
  }

  console.log('\nPunto 9b — marcarIngenieriaValidada acepta sin alertas de bloqueo:');
  const validada = await marcarIngenieriaValidada(supabase, { cotizacionId: cot1, usuarioId: null });
  assert(!!validada.ingenieria_validada_para_cotizar_en, 'cot1 (sin bloqueos) quedó marcada como validada');

  console.log(`\n${fallas === 0 ? '✅ TODO EN VERDE' : `❌ ${fallas} verificación(es) fallaron`} — cotizaciones de prueba: ${cot1}, ${cot2}, ${cot3}\n`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(e => { console.error('❌ Error:', e.message, e.stack); process.exit(1); });
