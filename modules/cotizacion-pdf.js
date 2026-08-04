/**
 * TARA Matrix™ — cotizacion-pdf.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Genera el PDF COMERCIAL de una cotización (Alina, 2026-08-04) — no es un
 * documento administrativo, es una pieza de venta: portada con propuesta
 * de valor, resumen ejecutivo visual, sistema recomendado con fotos/
 * componentes, beneficios, garantías, y solo AL FINAL la inversión
 * (subtotal/IVA/total). Misma arquitectura técnica que siempre: HTML →
 * Puppeteer → PDF → WhatsApp, el mismo HTML que consume la vista previa.
 *
 * Reusable entre industrias (Alina): el copy específico de cada giro
 * (título/subtítulo de portada, beneficios, iconos de componentes) llega
 * como `pdfConfig` — normalmente `plantillas_industria.cotizacion_pdf_config`
 * — y el RESUMEN EJECUTIVO llega ya traducido a tarjetas como
 * `resumenEjecutivo` (ver motores-ingenieria/paneles-solares.js
 * ::resumenEjecutivoParaPdf — cada motor de industria expone la suya).
 * construirHtmlCotizacion() en sí no conoce nada específico de paneles
 * solares — solo sabe pintar portada/tarjetas/paquete/beneficios/garantías/
 * inversión/técnico/footer a partir de los datos que le llegan.
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
const { generarQrDataUri } = require('./qr');
const { obtenerMotor } = require('./motores-ingenieria');
const { obtenerPlantillaDeEmpresa } = require('./plantillas-industria');
const { ChannelRouter } = require('./channel-router');
const { supabaseServicio } = require('./clients');

const BUCKET_COTIZACIONES_PDF = 'cotizaciones-pdf';
// Misma instancia ligera que arma modules/cotizaciones.js (ver ahí el porqué
// — este módulo tampoco depende de server.js ni de ninguna request HTTP).
const _channelRouter = new ChannelRouter(supabaseServicio);

const COLORES_DEFAULT = {
  acento: '#1a1a2e', sol: '#f59e0b', solClaro: '#fde68a', teal: '#22c7b8',
  texto: '#111827', textoSecundario: '#6b7280', superficie: '#ffffff',
  fondoSuave: '#f8fafc', borde: '#e5e7eb', exito: '#16a34a',
};

// ── Helpers de formato/escape ───────────────────────────────────────────────

function _escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _formatoMoneda(valor) {
  return `$${Number(valor || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function _iniciales(nombre) {
  return (nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
}

function _formatoFecha(fechaIso) {
  return new Date(fechaIso || Date.now()).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
}

function _iconoProducto(tipo) {
  const t = (tipo || '').toLowerCase();
  if (t.includes('panel')) return '☀️';
  if (t.includes('inversor')) return '⚡';
  if (t.includes('bateria') || t.includes('batería')) return '🔋';
  return '🔧';
}

function _iconoComponente(nombre, componentesIconos) {
  const clave = (nombre || '').toLowerCase().trim();
  return componentesIconos?.[clave] || '✔️';
}

// ── Ilustración de portada (SVG inline, autocontenido) ──────────────────────
// Aprobado por Alina: ilustración vectorial en vez de fotografía real (no
// hay fotos cargadas en el sistema y el PDF debe ser autocontenido, sin
// depender de bajar imágenes externas).

function _ilustracionHero(colores) {
  return `
  <svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Casa con paneles solares">
    <defs>
      <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${colores.solClaro}" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="${colores.solClaro}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="sol" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${colores.sol}"/>
        <stop offset="100%" stop-color="#fbbf24"/>
      </linearGradient>
      <linearGradient id="panelG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${colores.acento}"/>
        <stop offset="100%" stop-color="#2d2d54"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="400" height="200" fill="url(#cielo)"/>
    <circle cx="330" cy="55" r="34" fill="url(#sol)"/>
    <g stroke="${colores.sol}" stroke-width="3" stroke-linecap="round" opacity="0.7">
      <line x1="330" y1="5" x2="330" y2="-8"/>
      <line x1="375" y1="20" x2="384" y2="11"/>
      <line x1="390" y1="55" x2="404" y2="55"/>
    </g>
    <path d="M60 190 L60 120 L150 70 L240 120 L240 190 Z" fill="${colores.superficie}" stroke="${colores.borde}" stroke-width="2"/>
    <path d="M50 125 L150 68 L250 125 L232 125 L150 80 L68 125 Z" fill="${colores.teal}"/>
    <g transform="translate(78,88) rotate(-31)">
      ${[0, 1, 2, 3].map(i => `<rect x="${i * 27}" y="0" width="24" height="46" rx="2" fill="url(#panelG)" stroke="#ffffff" stroke-width="1.5"/>`).join('')}
      <line x1="0" y1="23" x2="108" y2="23" stroke="#ffffff" stroke-width="1"/>
    </g>
    <rect x="130" y="140" width="40" height="50" fill="${colores.fondoSuave}" stroke="${colores.borde}" stroke-width="1.5"/>
    <rect x="70" y="150" width="22" height="22" fill="${colores.solClaro}" stroke="${colores.borde}" stroke-width="1.5"/>
    <rect x="210" y="150" width="22" height="22" fill="${colores.solClaro}" stroke="${colores.borde}" stroke-width="1.5"/>
  </svg>`;
}

// ── Secciones ────────────────────────────────────────────────────────────

function _seccionPortada({ cotizacion, cliente, empresa, asesorNombre, pdfConfig, colores }) {
  const logo = empresa?.logo_url
    ? `<img src="${_escaparHtml(empresa.logo_url)}" alt="${_escaparHtml(empresa?.nombre)}" class="logo-img"/>`
    : `<div class="logo-iniciales">${_escaparHtml(_iniciales(empresa?.nombre))}</div>`;

  return `
  <section class="portada">
    <div class="marca-superior">
      ${logo}
      <span class="marca-nombre">${_escaparHtml(empresa?.nombre)}</span>
    </div>
    <div class="hero">
      <div class="hero-ilustracion">${_ilustracionHero(colores)}</div>
      <h1>${_escaparHtml(pdfConfig?.hero?.titulo || 'Propuesta comercial')}</h1>
      <p class="hero-subtitulo">${_escaparHtml(pdfConfig?.hero?.subtitulo || '')}</p>
    </div>
    <div class="meta-portada">
      <div><span>Preparado para</span><strong>${_escaparHtml(cliente?.nombre)}</strong></div>
      <div><span>Cotización</span><strong>${_escaparHtml(cotizacion.folio || `#${cotizacion.id}`)}</strong></div>
      <div><span>Fecha</span><strong>${_formatoFecha(cotizacion.created_at)}</strong></div>
      <div><span>Asesor</span><strong>${_escaparHtml(asesorNombre || 'Nuestro equipo')}</strong></div>
    </div>
  </section>`;
}

function _seccionResumenEjecutivo(resumenEjecutivo) {
  const disponibles = (resumenEjecutivo || []).filter(t => t.disponible);
  if (disponibles.length === 0) return '';

  const tarjetas = disponibles.map(t => `
    <div class="tarjeta-resumen">
      <div class="tarjeta-icono">${t.icono}</div>
      <div class="tarjeta-valor">${_escaparHtml(t.valorTexto)}</div>
      <div class="tarjeta-etiqueta">${_escaparHtml(t.etiqueta)}</div>
    </div>`).join('');

  return `
  <section class="seccion">
    <h2>Resumen ejecutivo</h2>
    <div class="grid-resumen">${tarjetas}</div>
  </section>`;
}

function _seccionSistemaRecomendado({ paquete, pdfConfig }) {
  if (!paquete) return '';

  const componentes = Array.isArray(paquete.componentes_incluidos) ? paquete.componentes_incluidos : [];
  const listaComponentes = componentes.map(c => `
    <li><span class="check-icono">${_iconoComponente(c, pdfConfig?.componentesIconos)}</span>${_escaparHtml(c)}</li>`).join('');

  const fichaPanel = paquete.marca_panel ? `
    <div class="ficha-equipo">
      <div class="ficha-icono">${_iconoProducto('panel_solar')}</div>
      <div class="ficha-titulo">Panel solar</div>
      <div class="ficha-detalle">${_escaparHtml(paquete.marca_panel)} ${_escaparHtml(paquete.modelo_panel || '')}</div>
      ${paquete.potencia_panel_wp ? `<div class="ficha-spec">${paquete.potencia_panel_wp} W c/u</div>` : ''}
    </div>` : '';

  const fichaInversor = paquete.marca_inversor ? `
    <div class="ficha-equipo">
      <div class="ficha-icono">${_iconoProducto('inversor')}</div>
      <div class="ficha-titulo">${_escaparHtml(paquete.tipo_inversor === 'microinversor' ? 'Microinversores' : 'Inversor')}</div>
      <div class="ficha-detalle">${_escaparHtml(paquete.marca_inversor)} ${_escaparHtml(paquete.modelo_inversor || '')}</div>
      ${paquete.cantidad_inversores ? `<div class="ficha-spec">${paquete.cantidad_inversores} pieza(s)${paquete.entradas_por_inversor ? ` · ${paquete.entradas_por_inversor} entradas c/u` : ''}</div>` : ''}
    </div>` : '';

  return `
  <section class="seccion">
    <h2>Sistema recomendado</h2>
    <div class="paquete-nombre">${_escaparHtml(paquete.nombre)}${paquete.potencia_total_kwp ? ` — ${paquete.potencia_total_kwp} kWp instalados` : ''}</div>
    ${(fichaPanel || fichaInversor) ? `<div class="grid-fichas">${fichaPanel}${fichaInversor}</div>` : ''}
    ${listaComponentes ? `<ul class="lista-componentes">${listaComponentes}</ul>` : ''}
  </section>`;
}

function _seccionBeneficios(pdfConfig) {
  const beneficios = pdfConfig?.beneficios || [];
  if (beneficios.length === 0) return '';

  const items = beneficios.map(b => `
    <div class="beneficio">
      <div class="beneficio-icono">${b.icono || '✔️'}</div>
      <div class="beneficio-texto">${_escaparHtml(b.texto)}</div>
    </div>`).join('');

  return `
  <section class="seccion">
    <h2>Beneficios de tu sistema</h2>
    <div class="grid-beneficios">${items}</div>
  </section>`;
}

function _tarjetaGarantia(titulo, icono, items) {
  const filas = items.filter(([, valor]) => valor).map(([etiqueta, valor]) => `<div><span>${etiqueta}</span><strong>${_escaparHtml(valor)}</strong></div>`).join('');
  return `
    <div class="tarjeta-garantia">
      <div class="garantia-icono">${icono}</div>
      <div class="garantia-titulo">${titulo}</div>
      ${filas || '<div class="garantia-pendiente">Consulta con tu asesor</div>'}
    </div>`;
}

function _seccionGarantias(paquete) {
  const g = paquete?.garantias || {};
  return `
  <section class="seccion">
    <h2>Garantías</h2>
    <div class="grid-garantias">
      ${_tarjetaGarantia('Paneles solares', '☀️', [
        ['Garantía de producto', g.panel?.producto_anios ? `${g.panel.producto_anios} años` : null],
        ['Garantía de rendimiento', g.panel?.rendimiento_anios ? `${g.panel.rendimiento_anios} años` : null],
      ])}
      ${_tarjetaGarantia('Microinversores', '⚡', [
        ['Garantía', g.inversor?.garantia_anios ? `${g.inversor.garantia_anios} años` : null],
        ['Vida útil estimada', g.inversor?.vida_util_anios ? `${g.inversor.vida_util_anios} años` : null],
      ])}
    </div>
  </section>`;
}

function _seccionInversion({ cotizacion, lineas }) {
  const filas = (lineas || []).map(l => `
    <tr>
      <td>${_escaparHtml(l.descripcion)}${l.pendiente_levantamiento ? ' <span class="pendiente">(sujeto a levantamiento en sitio)</span>' : ''}</td>
      <td class="num">${Number(l.cantidad).toLocaleString('es-MX')}</td>
      <td class="num">${_formatoMoneda(l.precio_unitario)}</td>
      <td class="num">${l.descuento_pct ? `${l.descuento_pct}%` : '—'}</td>
      <td class="num">${_formatoMoneda(l.subtotal)}</td>
    </tr>`).join('');

  return `
  <section class="seccion seccion-inversion">
    <h2>Tu inversión</h2>
    <table>
      <thead><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Precio unitario</th><th class="num">Descuento</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="totales">
      <div><span>Subtotal</span><span>${_formatoMoneda(cotizacion.subtotal)}</span></div>
      <div><span>IVA</span><span>${_formatoMoneda(cotizacion.iva)}</span></div>
      <div class="total"><span>Total</span><span>${_formatoMoneda(cotizacion.total)}</span></div>
    </div>
    <div class="condiciones-grid">
      ${cotizacion.anticipo_pct ? `<div><span>Anticipo</span><strong>${cotizacion.anticipo_pct}%</strong></div>` : ''}
      ${cotizacion.forma_pago ? `<div><span>Forma de pago</span><strong>${_escaparHtml(cotizacion.forma_pago)}</strong></div>` : ''}
      ${cotizacion.vigencia_dias ? `<div><span>Vigencia</span><strong>${cotizacion.vigencia_dias} días</strong></div>` : ''}
    </div>
    ${cotizacion.condiciones_comerciales ? `<div class="condiciones"><strong>Condiciones comerciales:</strong> ${_escaparHtml(cotizacion.condiciones_comerciales)}</div>` : ''}
  </section>`;
}

function _seccionTecnica({ cotizacion, calculoDatosEntrada }) {
  const info = calculoDatosEntrada || {};
  const filas = [
    ['Ubicación', info.ubicacion],
    ['Tipo de alimentación eléctrica', info.tipoAlimentacion],
    ['Área utilizada', info.areaDisponibleM2 ? `${info.areaDisponibleM2} m²` : null],
  ].filter(([, v]) => v);

  if (filas.length === 0) return '';

  return `
  <section class="seccion">
    <h2>Información técnica</h2>
    <div class="tecnica-grid">
      ${filas.map(([etiqueta, valor]) => `<div><span>${etiqueta}</span><strong>${_escaparHtml(valor)}</strong></div>`).join('')}
    </div>
    <p class="aviso">Predimensionamiento — ingeniería preliminar sujeta a validación física, estructural y eléctrica en sitio. El detalle técnico completo queda documentado internamente con tu asesor.</p>
  </section>`;
}

function _footer({ empresa, asesorNombre, whatsappEmpresa, qrDataUri }) {
  return `
  <section class="footer">
    <div class="footer-datos">
      <div class="footer-empresa">${_escaparHtml(empresa?.nombre)}</div>
      ${asesorNombre ? `<div>Asesor: ${_escaparHtml(asesorNombre)}</div>` : ''}
      ${whatsappEmpresa ? `<div>WhatsApp: ${_escaparHtml(whatsappEmpresa)}</div>` : ''}
      ${empresa?.correo_contacto ? `<div>${_escaparHtml(empresa.correo_contacto)}</div>` : ''}
      ${empresa?.sitio_web ? `<div>${_escaparHtml(empresa.sitio_web)}</div>` : ''}
    </div>
    ${qrDataUri ? `<div class="footer-qr"><img src="${qrDataUri}" alt="Código QR de contacto"/><span>Escanea para escribirnos</span></div>` : ''}
  </section>`;
}

/**
 * Arma el HTML del PDF comercial — función pura, testable sin Puppeteer ni
 * DB. Ningún dato específico de paneles solares está hardcodeado aquí: el
 * copy (pdfConfig) y las métricas (resumenEjecutivo) llegan ya resueltos
 * por el caller, así que esta misma función sirve para cualquier industria
 * que le pase datos con esta forma.
 *
 * @param {Object} datos
 * @param {Object} datos.cotizacion
 * @param {Array} datos.lineas
 * @param {Object} datos.cliente
 * @param {Object} datos.empresa
 * @param {Object} [datos.paquete] - fila de paquetes_solares (o equivalente de otra industria), null si es cotización a la medida
 * @param {Array} [datos.resumenEjecutivo] - ver motor.resumenEjecutivoParaPdf()
 * @param {Object} [datos.pdfConfig] - plantilla.cotizacion_pdf_config
 * @param {Object} [datos.calculoDatosEntrada] - calculos_ingenieria.datos_entrada, solo para la sección técnica (resumen, no fórmulas)
 * @param {string} [datos.asesorNombre]
 * @param {string} [datos.whatsappEmpresa]
 * @param {string} [datos.qrDataUri]
 * @returns {string} HTML completo
 */
function construirHtmlCotizacion({
  cotizacion, lineas, cliente, empresa, paquete, resumenEjecutivo, pdfConfig,
  calculoDatosEntrada, asesorNombre, whatsappEmpresa, qrDataUri,
}) {
  const colores = { ...COLORES_DEFAULT, ...(empresa?.color_acento ? { acento: empresa.color_acento } : {}) };

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: ${colores.texto}; margin: 0; padding: 0; font-size: 13px; }
  .seccion { padding: 28px 44px; }
  h2 { font-size: 18px; font-weight: 700; color: ${colores.acento}; margin: 0 0 16px; }

  /* Portada */
  .portada { padding: 32px 44px 36px; background: linear-gradient(180deg, ${colores.fondoSuave} 0%, #ffffff 65%); }
  .marca-superior { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .logo-img { height: 34px; max-width: 140px; object-fit: contain; }
  .logo-iniciales { width: 34px; height: 34px; border-radius: 8px; background: ${colores.acento}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
  .marca-nombre { font-weight: 700; color: ${colores.acento}; font-size: 14px; }
  .hero { text-align: center; padding: 8px 0 20px; }
  .hero-ilustracion { width: 320px; max-width: 80%; margin: 0 auto 8px; }
  .hero-ilustracion svg { width: 100%; height: auto; display: block; }
  .hero h1 { font-size: 26px; font-weight: 800; color: ${colores.acento}; margin: 4px 0 8px; letter-spacing: -0.01em; }
  .hero-subtitulo { font-size: 14px; color: ${colores.textoSecundario}; max-width: 440px; margin: 0 auto; }
  .meta-portada { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 20px; border-top: 1px solid ${colores.borde}; padding-top: 18px; }
  .meta-portada div { display: flex; flex-direction: column; gap: 2px; }
  .meta-portada span { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: ${colores.textoSecundario}; }
  .meta-portada strong { font-size: 13px; color: ${colores.texto}; }

  /* Resumen ejecutivo */
  .grid-resumen { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .tarjeta-resumen { background: ${colores.fondoSuave}; border: 1px solid ${colores.borde}; border-radius: 10px; padding: 14px 10px; text-align: center; break-inside: avoid; }
  .tarjeta-icono { font-size: 20px; margin-bottom: 6px; }
  .tarjeta-valor { font-size: 16px; font-weight: 800; color: ${colores.acento}; font-variant-numeric: tabular-nums; }
  .tarjeta-etiqueta { font-size: 10px; color: ${colores.textoSecundario}; margin-top: 3px; line-height: 1.3; }

  /* Sistema recomendado */
  .paquete-nombre { font-size: 15px; font-weight: 700; color: ${colores.texto}; margin-bottom: 14px; }
  .grid-fichas { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }
  .ficha-equipo { border: 1px solid ${colores.borde}; border-radius: 10px; padding: 14px; break-inside: avoid; }
  .ficha-icono { font-size: 24px; margin-bottom: 6px; }
  .ficha-titulo { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: ${colores.textoSecundario}; }
  .ficha-detalle { font-size: 14px; font-weight: 700; margin-top: 2px; }
  .ficha-spec { font-size: 12px; color: ${colores.textoSecundario}; margin-top: 4px; }
  .lista-componentes { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 16px; }
  .lista-componentes li { font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .check-icono { font-size: 14px; }

  /* Beneficios */
  .grid-beneficios { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .beneficio { display: flex; align-items: center; gap: 10px; break-inside: avoid; }
  .beneficio-icono { font-size: 20px; flex-shrink: 0; }
  .beneficio-texto { font-size: 12.5px; line-height: 1.35; }

  /* Garantías */
  .grid-garantias { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .tarjeta-garantia { border: 1px solid ${colores.borde}; border-radius: 10px; padding: 16px; break-inside: avoid; }
  .garantia-icono { font-size: 22px; }
  .garantia-titulo { font-size: 13px; font-weight: 700; margin: 6px 0 10px; }
  .tarjeta-garantia div:not(.garantia-titulo) { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; border-top: 1px solid ${colores.borde}; }
  .tarjeta-garantia div:first-of-type { border-top: none; }
  .garantia-pendiente { color: ${colores.textoSecundario}; font-style: italic; font-size: 12px; }

  /* Inversión */
  .seccion-inversion { background: ${colores.fondoSuave}; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; background: ${colores.superficie}; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: ${colores.textoSecundario}; border-bottom: 2px solid ${colores.borde}; }
  td { padding: 8px 10px; border-bottom: 1px solid ${colores.borde}; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pendiente { color: ${colores.textoSecundario}; font-size: 11px; }
  .totales { margin-top: 14px; width: 280px; margin-left: auto; }
  .totales div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totales .total { font-weight: 800; font-size: 18px; color: ${colores.acento}; border-top: 2px solid ${colores.acento}; padding-top: 8px; margin-top: 4px; }
  .condiciones-grid { display: flex; gap: 24px; margin-top: 16px; }
  .condiciones-grid div { display: flex; flex-direction: column; gap: 2px; }
  .condiciones-grid span { font-size: 10px; text-transform: uppercase; color: ${colores.textoSecundario}; }
  .condiciones-grid strong { font-size: 13px; }
  .condiciones { margin-top: 14px; font-size: 12px; color: ${colores.textoSecundario}; }

  /* Técnica */
  .tecnica-grid { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 12px; }
  .tecnica-grid div { display: flex; flex-direction: column; gap: 2px; }
  .tecnica-grid span { font-size: 10px; text-transform: uppercase; color: ${colores.textoSecundario}; }
  .aviso { padding: 10px 14px; background: ${colores.fondoSuave}; border-left: 3px solid ${colores.teal}; font-size: 11px; color: ${colores.textoSecundario}; border-radius: 0 6px 6px 0; }

  /* Footer */
  .footer { display: flex; justify-content: space-between; align-items: center; padding: 24px 44px; background: ${colores.acento}; color: #ffffff; }
  .footer-datos { font-size: 11.5px; line-height: 1.7; opacity: 0.92; }
  .footer-empresa { font-weight: 700; font-size: 13px; margin-bottom: 4px; opacity: 1; }
  .footer-qr { text-align: center; }
  .footer-qr img { width: 64px; height: 64px; border-radius: 6px; background: #fff; padding: 4px; }
  .footer-qr span { display: block; font-size: 9px; margin-top: 4px; opacity: 0.85; }

  @media print { .seccion { break-inside: avoid-page; } }
</style>
</head>
<body>
  ${_seccionPortada({ cotizacion, cliente, empresa, asesorNombre, pdfConfig, colores })}
  ${_seccionResumenEjecutivo(resumenEjecutivo)}
  ${_seccionSistemaRecomendado({ paquete, pdfConfig })}
  ${_seccionBeneficios(pdfConfig)}
  ${_seccionGarantias(paquete)}
  ${_seccionInversion({ cotizacion, lineas })}
  ${_seccionTecnica({ cotizacion, calculoDatosEntrada })}
  ${_footer({ empresa, asesorNombre, whatsappEmpresa, qrDataUri })}
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
/**
 * Reúne TODOS los datos que necesita construirHtmlCotizacion() a partir de
 * un cotizacionId — extraído aparte (no inline en generarPdfCotizacion())
 * para que cualquier caller (la propia generación del PDF, un script de
 * vista previa, una futura ruta de preview en el panel) arme exactamente
 * el mismo HTML que el PDF real, nunca una reconstrucción manual aparte
 * que se pueda desincronizar del original.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} cotizacionId
 * @returns {Promise<Object>} props listas para construirHtmlCotizacion()
 */
async function reunirDatosParaPdf(supabase, cotizacionId) {
  const { data: cotizacion, error: errCot } = await supabase.from('cotizaciones').select('*').eq('id', cotizacionId).single();
  if (errCot || !cotizacion) throw new Error('cotizacion-pdf.reunirDatosParaPdf: cotización no encontrada');

  const [{ data: lineas }, { data: cliente }, { data: empresa }, { data: calculo }, { data: paquete }, { data: asesor }] = await Promise.all([
    supabase.from('cotizacion_lineas').select('*').eq('cotizacion_id', cotizacionId).order('orden'),
    supabase.from('clientes').select('nombre, empresa').eq('id', cotizacion.cliente_id).maybeSingle(),
    supabase.from('companies').select('nombre, logo_url, color_acento, correo_contacto, sitio_web, industria_slug').eq('id', cotizacion.company_id).maybeSingle(),
    supabase.from('calculos_ingenieria').select('resultados, datos_entrada, motor').eq('cotizacion_id', cotizacionId).order('version', { ascending: false }).limit(1).maybeSingle(),
    cotizacion.paquete_recomendado_id
      ? supabase.from('paquetes_solares').select('*').eq('id', cotizacion.paquete_recomendado_id).maybeSingle()
      : Promise.resolve({ data: null }),
    cotizacion.ejecutivo_id
      ? supabase.from('usuarios').select('nombre').eq('id', cotizacion.ejecutivo_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const plantilla = await obtenerPlantillaDeEmpresa(supabase, cotizacion.company_id);
  const pdfConfig = plantilla?.cotizacion_pdf_config || {};

  const motor = calculo?.motor ? obtenerMotor(calculo.motor) : null;
  const resumenEjecutivo = (motor?.resumenEjecutivoParaPdf && calculo?.resultados)
    ? motor.resumenEjecutivoParaPdf(calculo.resultados)
    : [];

  const whatsappEmpresa = await _channelRouter.resolverEndpointDeEmpresa(cotizacion.company_id).catch(() => null);
  const qrDataUri = whatsappEmpresa ? await generarQrDataUri(`https://wa.me/${whatsappEmpresa.replace(/\D/g, '')}`).catch(() => null) : null;

  return {
    cotizacion, lineas, cliente, empresa, paquete, resumenEjecutivo, pdfConfig,
    calculoDatosEntrada: calculo?.datos_entrada, asesorNombre: asesor?.nombre,
    whatsappEmpresa, qrDataUri,
  };
}

async function generarPdfCotizacion(supabase, cotizacionId) {
  const { puede, motivo } = await puedeEnviarCotizacion(supabase, cotizacionId);
  if (!puede) {
    const err = new Error(`No se puede generar el PDF: ${motivo}`);
    err.status = 409;
    throw err;
  }

  const datosPdf = await reunirDatosParaPdf(supabase, cotizacionId);
  const { cotizacion } = datosPdf;
  const html = construirHtmlCotizacion(datosPdf);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    buffer = await page.pdf({ format: 'letter', printBackground: true, margin: { top: '0px', bottom: '0px' } });
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

module.exports = { BUCKET_COTIZACIONES_PDF, construirHtmlCotizacion, reunirDatosParaPdf, generarPdfCotizacion, generarYEnviarCotizacion };
