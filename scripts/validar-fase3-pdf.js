#!/usr/bin/env node
/**
 * Fase 3 — Ingeniería y Cotización: escenario completo contra la base real.
 * Crea una cotización con cálculo completo, aplica el cálculo a las líneas,
 * la valida, genera un PDF REAL con Puppeteer, y confirma que sin validar
 * NUNCA se puede generar. El intento de envío por WhatsApp se deja
 * registrado (puede fallar por número de prueba — eso también se valida:
 * que el fallo quede registrado en envios_documento, no silencioso).
 *
 * Uso: node scripts/validar-fase3-pdf.js
 */

require('dotenv').config();
const fs = require('fs');
const { supabaseServicio: supabase } = require('../modules/clients'); // Storage (cotizaciones-pdf) exige service_role, ver modules/cotizacion-pdf.js
const { correrYGuardarCalculo, marcarIngenieriaValidada, puedeEnviarCotizacion } = require('../modules/cotizaciones');
const { aplicarCalculoALineas, listarLineas } = require('../modules/cotizacion-lineas');
const { generarPdfCotizacion, generarYEnviarCotizacion } = require('../modules/cotizacion-pdf');
const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b';
const CLIENTE_ID = 105; // Jorge Villarreal

let fallas = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); fallas++; }
}

async function main() {
  console.log('\n🔬 Fase 3 — PDF real + envío, contra la base de datos real\n');

  const { data: panel } = await supabase.from('productos').select('id').eq('company_id', COMPANY_ID).eq('sku', 'JKM550M-72HL4-V').single();
  const { data: cotizacion } = await supabase.from('cotizaciones').insert([{
    company_id: COMPANY_ID, cliente_id: CLIENTE_ID, estado: 'borrador', descripcion: 'Prueba Fase 3',
  }]).select().single();

  console.log('PASO 1 — correr el motor (caso completo, Monterrey):');
  const calculo = await correrYGuardarCalculo(supabase, {
    companyId: COMPANY_ID, cotizacionId: cotizacion.id, industriaSlug: 'paneles_solares',
    infoTecnica: {
      ubicacion: 'Monterrey, Nuevo León', consumoMensualKwh: 600, pctCoberturaDeseado: 0.90, importePromedioRecibo: 2400,
      tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 40, incluyeCargosFijos: false,
    },
    panelSeleccionadoId: panel.id, temperaturaMinSitio: 5, inversionNeta: 95000,
  });
  assert(calculo.estado_calculo === 'completo', `cálculo completo (fue: ${calculo.estado_calculo})`);

  console.log('\nPASO 2 — intentar generar PDF SIN validar ingeniería (debe rechazar):');
  try {
    await generarPdfCotizacion(supabase, cotizacion.id);
    assert(false, 'generarPdfCotizacion debía rechazar sin validación — no lo hizo');
  } catch (e) {
    assert(e.status === 409, `rechazó correctamente: "${e.message}"`);
  }

  console.log('\nPASO 3 — aplicar cálculo a la lista de materiales:');
  const lineas = await aplicarCalculoALineas(supabase, { companyId: COMPANY_ID, cotizacionId: cotizacion.id });
  assert(lineas.length === 5, `se crearon 5 líneas (panel+inversor+3 pendientes) (fueron: ${lineas.length})`);
  const { data: cotizacionConTotales } = await supabase.from('cotizaciones').select('subtotal, iva, total').eq('id', cotizacion.id).single();
  assert(cotizacionConTotales.total > 0, `los totales se calcularon (total: $${cotizacionConTotales.total})`);

  console.log('\nPASO 4 — validar la ingeniería:');
  await marcarIngenieriaValidada(supabase, { cotizacionId: cotizacion.id, usuarioId: null });
  const { puede } = await puedeEnviarCotizacion(supabase, cotizacion.id);
  assert(puede === true, 'puedeEnviarCotizacion === true después de validar');

  console.log('\nPASO 5 — generar el PDF REAL (Puppeteer):');
  const resultadoPdf = await generarPdfCotizacion(supabase, cotizacion.id);
  assert(!!resultadoPdf.storagePath, `PDF generado y subido: ${resultadoPdf.storagePath}`);
  const { data: descarga, error: errDescarga } = await supabase.storage.from(resultadoPdf.storageBucket).download(resultadoPdf.storagePath);
  assert(!errDescarga && descarga, 'el PDF se puede volver a descargar de Storage (no quedó corrupto/vacío)');
  if (descarga) {
    const buffer = Buffer.from(await descarga.arrayBuffer());
    assert(buffer.slice(0, 4).toString() === '%PDF', `el archivo es un PDF real válido (${buffer.length} bytes)`);
    fs.writeFileSync('/tmp/cotizacion-prueba-fase3.pdf', buffer);
    console.log('     (guardado también en /tmp/cotizacion-prueba-fase3.pdf para inspección manual)');
  }

  console.log('\nPASO 6 — intento de envío por WhatsApp (puede fallar por número de prueba, debe quedar registrado):');
  const envio = await generarYEnviarCotizacion(supabase, { cotizacionId: cotizacion.id, destinatario: '+528100000099' });
  assert(['enviado', 'fallido'].includes(envio.estado), `el envío terminó en un estado válido (fue: ${envio.estado}${envio.error_proveedor ? ' — ' + envio.error_proveedor : ''})`);
  const { count: filasEnvio } = await supabase.from('envios_documento').select('*', { count: 'exact', head: true }).eq('cotizacion_id', cotizacion.id);
  assert(filasEnvio === 1, `el intento quedó registrado en envios_documento (${filasEnvio} fila)`);

  console.log(`\n${fallas === 0 ? '✅ TODO EN VERDE' : `❌ ${fallas} verificación(es) fallaron`} — cotización de prueba: ${cotizacion.id}\n`);

  // Limpieza
  console.log('🧹 Limpiando artefactos de prueba...');
  await supabase.storage.from(resultadoPdf.storageBucket).remove([resultadoPdf.storagePath]);
  await supabase.from('envios_documento').delete().eq('cotizacion_id', cotizacion.id);
  await supabase.from('cotizacion_lineas').delete().eq('cotizacion_id', cotizacion.id);
  await supabase.from('cotizaciones').update({ calculo_ingenieria_id: null }).eq('id', cotizacion.id);
  await supabase.from('calculos_ingenieria').delete().eq('cotizacion_id', cotizacion.id);
  await supabase.from('cotizaciones').delete().eq('id', cotizacion.id);
  console.log('✅ Limpieza completa.\n');

  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(e => { console.error('❌ Error:', e.message, e.stack); process.exit(1); });
