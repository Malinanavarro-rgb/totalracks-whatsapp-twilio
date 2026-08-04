#!/usr/bin/env node
/**
 * Genera un PDF de ejemplo real (paquete de 12 paneles) para que Alina lo
 * revise — corre el pipeline completo real (motor → paquete recomendado →
 * autorizar precio → aplicar a líneas → validar → PDF), usando datos
 * reales de la Empresa Demo Paneles Solares. No borra la cotización de
 * prueba al final a propósito, para poder inspeccionarla.
 *
 * Uso: node scripts/generar-pdf-ejemplo.js
 */

require('dotenv').config();
const fs = require('fs');
const { supabaseServicio: supabase } = require('../modules/clients');
const { correrCotizacionDesdeWorkflow, autorizarPrecioFinal, marcarPredimensionamientoRevisado, marcarIngenieriaValidada } = require('../modules/cotizaciones');
const { aplicarCalculoALineas } = require('../modules/cotizacion-lineas');
const { generarPdfCotizacion, construirHtmlCotizacion, reunirDatosParaPdf } = require('../modules/cotizacion-pdf');

const COMPANY_ID = 'ffac2a5a-ea4f-4bee-9b82-8f4559b7594b';
const CLIENTE_ID = 106; // Marisol Cantú

async function main() {
  console.log('\n📄 Generando cotización de ejemplo (paquete de 12 paneles)...\n');

  const calculo = await correrCotizacionDesdeWorkflow(supabase, {
    companyId: COMPANY_ID, clienteId: CLIENTE_ID,
    capturedFields: {
      ubicacion: 'Monterrey, Nuevo León', consumo_mensual_kwh: '900', importe_promedio_recibo: '3600',
      pct_cobertura_deseado: '90', tipo_alimentacion: 'trifasica', voltaje_sitio: '380', area_disponible_m2: '80',
    },
  });
  console.log(`✅ Motor corrido — ${calculo.resultados.numero_paneles.valor} paneles técnicos, estado: ${calculo.estado_calculo}`);

  const { data: cotizacionConPaquete } = await supabase.from('cotizaciones').select('*').eq('id', calculo.cotizacion_id).single();
  console.log(`✅ Paquete recomendado: precio $${cotizacionConPaquete.precio_paquete_recomendado}`);

  await autorizarPrecioFinal(supabase, { cotizacionId: calculo.cotizacion_id, usuarioId: null });
  await aplicarCalculoALineas(supabase, { companyId: COMPANY_ID, cotizacionId: calculo.cotizacion_id });
  await marcarPredimensionamientoRevisado(supabase, { cotizacionId: calculo.cotizacion_id, usuarioId: null });
  await marcarIngenieriaValidada(supabase, { cotizacionId: calculo.cotizacion_id, usuarioId: null });
  console.log('✅ Ingeniería validada, línea de paquete aplicada');

  // Folio + condiciones comerciales de ejemplo, para que el PDF no salga vacío ahí
  await supabase.from('cotizaciones').update({
    folio: 'COT-2026-0001', condiciones_comerciales: '50% de anticipo para iniciar, 50% contra entrega e instalación.', vigencia_dias: 15,
  }).eq('id', calculo.cotizacion_id);

  const resultado = await generarPdfCotizacion(supabase, calculo.cotizacion_id);
  console.log(`✅ PDF generado: ${resultado.storagePath}`);

  const { data: descarga } = await supabase.storage.from(resultado.storageBucket).download(resultado.storagePath);
  const buffer = Buffer.from(await descarga.arrayBuffer());
  fs.writeFileSync('/tmp/cotizacion-ejemplo.pdf', buffer);
  console.log(`✅ Guardado en /tmp/cotizacion-ejemplo.pdf (${buffer.length} bytes)`);

  // El HTML EXACTO que vio Puppeteer — misma función que usa el PDF real,
  // nunca una reconstrucción manual aparte (eso fue justo el bug que causó
  // que la primera vista previa saliera incompleta).
  const datosPdf = await reunirDatosParaPdf(supabase, calculo.cotizacion_id);
  const html = construirHtmlCotizacion(datosPdf);
  fs.writeFileSync('/tmp/cotizacion-ejemplo.html', html);
  console.log('✅ HTML guardado en /tmp/cotizacion-ejemplo.html');
  console.log(`   paquete: ${datosPdf.paquete?.nombre || 'NINGUNO'} | resumenEjecutivo: ${datosPdf.resumenEjecutivo.filter(t => t.disponible).length}/${datosPdf.resumenEjecutivo.length} tarjetas disponibles | pdfConfig: ${datosPdf.pdfConfig?.hero ? 'OK' : 'VACÍO'}\n`);

  console.log(`Cotización de prueba: id=${calculo.cotizacion_id} (NO se borró — puedes revisarla en la base)\n`);
}

main().catch(e => { console.error('❌ Error:', e.message, e.stack); process.exit(1); });
