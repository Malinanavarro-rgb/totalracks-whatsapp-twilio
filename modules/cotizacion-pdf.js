/**
 * TARA Matrix™ — cotizacion-pdf.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Genera el PDF profesional de una cotización — Fase 3 (Ingeniería y
 * Cotización, Alina 2026-08-04). Puppeteer + HTML/CSS propio, reusando los
 * tokens de color de frontend/src/App.css (--acento, --brand-teal, etc.)
 * para que se vea consistente con el resto del panel, no genérico.
 *
 * Última línea de defensa antes de generar: SIEMPRE valida
 * puedeEnviarCotizacion() (Fase 2) — nunca genera un PDF de una cotización
 * sin ingenieria_validada_para_cotizar, ni con una alerta de bloqueo activa,
 * sin importar quién llame a esta función.
 *
 * Requiere un cliente de Supabase con service_role: el bucket privado
 * `cotizaciones-pdf` tiene su propia RLS de Storage (independiente de la de
 * nuestras tablas), no configurada para aceptar el JWT de un usuario normal
 * — mismo criterio que inbox-adjuntos.js. El caller (server.js) debe
 * autorizar con req.supabase ANTES de llamar aquí, y pasar supabaseServicio
 * solo para esta operación.
 *
 * @module modules/cotizacion-pdf
 */

'use strict';

const puppeteer = require('puppeteer');
const { randomUUID } = require('crypto');
const { puedeEnviarCotizacion } = require('./cotizaciones');
const { enviarDocumentoPorWhatsApp } = require('./envio-documentos');

const BUCKET_COTIZACIONES_PDF = 'cotizaciones-pdf';

const COLORES = {
  ink: '#0b0f19', text: '#111827', textSecondary: '#6b7280',
  surface: '#ffffff', line: '#e5e7eb', tint: '#f3f4f6', acento: '#1a1a2e', brandTeal: '#22c7b8',
};

function _escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _formatoMoneda(valor) {
  return `$${Number(valor || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Arma el HTML del PDF a partir de la cotización, sus líneas, el cliente y
 * la empresa. Función pura — testable sin Puppeteer ni DB.
 *
 * @param {Object} datos
 * @returns {string} HTML completo
 */
function construirHtmlCotizacion({ cotizacion, lineas, cliente, empresa, calculo }) {
  const filas = (lineas || []).map(l => `
    <tr>
      <td>${_escaparHtml(l.descripcion)}${l.pendiente_levantamiento ? ' <span class="pendiente">(sujeto a levantamiento en sitio)</span>' : ''}</td>
      <td class="num">${Number(l.cantidad).toLocaleString('es-MX')}</td>
      <td class="num">${_formatoMoneda(l.precio_unitario)}</td>
      <td class="num">${l.descuento_pct ? `${l.descuento_pct}%` : '—'}</td>
      <td class="num">${_formatoMoneda(l.subtotal)}</td>
    </tr>`).join('');

  const avisoPredimensionamiento = calculo
    ? `<p class="aviso">Predimensionamiento — ingeniería preliminar sujeta a validación física, estructural y eléctrica en sitio.</p>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: ${COLORES.text}; margin: 0; padding: 40px; font-size: 13px; }
  .encabezado { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${COLORES.acento}; padding-bottom: 16px; margin-bottom: 24px; }
  .empresa { font-size: 20px; font-weight: 700; color: ${COLORES.acento}; }
  .folio { text-align: right; color: ${COLORES.textSecondary}; }
  .folio strong { color: ${COLORES.ink}; font-size: 16px; }
  .cliente { margin-bottom: 20px; }
  .cliente h3 { margin: 0 0 4px; font-size: 13px; color: ${COLORES.textSecondary}; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; background: ${COLORES.tint}; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: ${COLORES.textSecondary}; }
  td { padding: 8px 10px; border-bottom: 1px solid ${COLORES.line}; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pendiente { color: ${COLORES.textSecondary}; font-size: 11px; }
  .totales { margin-top: 16px; width: 280px; margin-left: auto; }
  .totales div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totales .total { font-weight: 700; font-size: 16px; border-top: 2px solid ${COLORES.acento}; padding-top: 8px; margin-top: 4px; }
  .aviso { margin-top: 24px; padding: 10px 14px; background: ${COLORES.tint}; border-left: 3px solid ${COLORES.brandTeal}; font-size: 11px; color: ${COLORES.textSecondary}; }
  .condiciones { margin-top: 20px; font-size: 12px; color: ${COLORES.textSecondary}; }
</style>
</head>
<body>
  <div class="encabezado">
    <div class="empresa">${_escaparHtml(empresa?.nombre)}</div>
    <div class="folio">Cotización<br><strong>${_escaparHtml(cotizacion.folio || `#${cotizacion.id}`)}</strong><br>Versión ${cotizacion.version}</div>
  </div>
  <div class="cliente">
    <h3>Cliente</h3>
    ${_escaparHtml(cliente?.nombre)}${cliente?.empresa ? ` — ${_escaparHtml(cliente.empresa)}` : ''}
  </div>
  <table>
    <thead><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Descuento</th><th class="num">Subtotal</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <div class="totales">
    <div><span>Subtotal</span><span>${_formatoMoneda(cotizacion.subtotal)}</span></div>
    <div><span>IVA</span><span>${_formatoMoneda(cotizacion.iva)}</span></div>
    <div class="total"><span>Total</span><span>${_formatoMoneda(cotizacion.total)}</span></div>
  </div>
  ${cotizacion.condiciones_comerciales ? `<div class="condiciones"><strong>Condiciones comerciales:</strong> ${_escaparHtml(cotizacion.condiciones_comerciales)}</div>` : ''}
  ${cotizacion.vigencia_dias ? `<div class="condiciones">Esta cotización tiene una vigencia de ${cotizacion.vigencia_dias} días a partir de su fecha de emisión.</div>` : ''}
  ${avisoPredimensionamiento}
</body>
</html>`;
}

/**
 * Genera el PDF de una cotización YA VALIDADA, lo sube al bucket privado y
 * guarda el path en cotizaciones.pdf_url. Lanza (nunca genera en silencio)
 * si la cotización no está lista para cotizar — mismo guard que Fase 2.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} cotizacionId
 * @returns {Promise<{storageBucket: string, storagePath: string, cotizacion: Object}>}
 */
async function generarPdfCotizacion(supabase, cotizacionId) {
  const { puede, motivo } = await puedeEnviarCotizacion(supabase, cotizacionId);
  if (!puede) {
    const err = new Error(`No se puede generar el PDF: ${motivo}`);
    err.status = 409;
    throw err;
  }

  const { data: cotizacion, error: errCot } = await supabase.from('cotizaciones').select('*').eq('id', cotizacionId).single();
  if (errCot || !cotizacion) throw new Error('cotizacion-pdf.generarPdfCotizacion: cotización no encontrada');

  const [{ data: lineas }, { data: cliente }, { data: empresa }, { data: calculo }] = await Promise.all([
    supabase.from('cotizacion_lineas').select('*').eq('cotizacion_id', cotizacionId).order('orden'),
    supabase.from('clientes').select('nombre, empresa').eq('id', cotizacion.cliente_id).maybeSingle(),
    supabase.from('companies').select('nombre').eq('id', cotizacion.company_id).maybeSingle(),
    supabase.from('calculos_ingenieria').select('id').eq('cotizacion_id', cotizacionId).order('version', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const html = construirHtmlCotizacion({ cotizacion, lineas, cliente, empresa, calculo });

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    buffer = await page.pdf({ format: 'letter', printBackground: true, margin: { top: '20px', bottom: '20px' } });
  } finally {
    await browser.close();
  }

  const storagePath = `${cotizacion.company_id}/${cotizacionId}/v${cotizacion.version}-${randomUUID()}.pdf`;
  const { error: errSubida } = await supabase.storage.from(BUCKET_COTIZACIONES_PDF).upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
  if (errSubida) throw new Error(`cotizacion-pdf.generarPdfCotizacion: ${errSubida.message}`);

  const { error: errUpdate } = await supabase.from('cotizaciones').update({ pdf_url: storagePath }).eq('id', cotizacionId);
  if (errUpdate) throw new Error(`cotizacion-pdf.generarPdfCotizacion (update pdf_url): ${errUpdate.message}`);

  return { storageBucket: BUCKET_COTIZACIONES_PDF, storagePath, cotizacion: { ...cotizacion, pdf_url: storagePath } };
}

/**
 * Genera el PDF (con el guard de puedeEnviarCotizacion ya aplicado dentro
 * de generarPdfCotizacion) y lo envía por WhatsApp en una sola llamada —
 * el punto de entrada real que usará la bandeja de revisión. Si el envío
 * falla, el PDF ya generado NO se pierde (queda en pdf_url, se puede
 * reintentar el envío sin regenerar).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {number} datos.cotizacionId
 * @param {string} datos.destinatario
 * @returns {Promise<Object>} resultado de envios_documento (estado, message_id, etc.)
 */
async function generarYEnviarCotizacion(supabase, { cotizacionId, destinatario }) {
  const { storageBucket, storagePath, cotizacion } = await generarPdfCotizacion(supabase, cotizacionId);

  const envio = await enviarDocumentoPorWhatsApp(supabase, {
    companyId: cotizacion.company_id, clienteId: cotizacion.cliente_id, destinatario,
    storageBucket, storagePath, filename: `Cotizacion-${cotizacion.folio || cotizacion.id}.pdf`,
    cotizacionId, cotizacionVersion: cotizacion.version,
  });

  if (envio.estado === 'enviado') {
    await supabase.from('cotizaciones').update({ estado: 'enviada', enviada_por: 'whatsapp' }).eq('id', cotizacionId);
  }

  return envio;
}

module.exports = { BUCKET_COTIZACIONES_PDF, construirHtmlCotizacion, generarPdfCotizacion, generarYEnviarCotizacion };
