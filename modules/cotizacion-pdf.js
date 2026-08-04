/**
 * TARA Matrix™ — cotizacion-pdf.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPUESTA COMERCIAL PREMIUM (Alina, 2026-08-04) — segunda iteración de
 * filosofía. Ya no es "una cotización con mejor diseño": es un documento
 * editorial que cuenta una historia (el sueño → por qué este sistema → qué
 * recibes → beneficios → confianza → inversión, en ese orden, respondiendo
 * en secuencia a las preguntas reales que trae el cliente en la cabeza).
 * Cero íconos, cero emoji, cero ilustraciones tipo clipart — tipografía
 * editorial (serif de despliegue + sans de cuerpo), mucho blanco, un solo
 * color de acento. Misma arquitectura técnica de siempre: HTML → Puppeteer
 * → PDF → WhatsApp, el mismo HTML para vista previa y PDF real.
 *
 * Arquitectura de imagen en 3 niveles (migración 096) — cada bloque visual
 * (portada, panel, inversor, instalación) resuelve su fuente en cascada:
 *   Nivel 1 (Premium)     → foto real de la empresa/paquete
 *   Nivel 2 (Profesional) → foto de stock configurada por industria
 *   Nivel 3 (Editorial)   → sin foto: composición geométrica abstracta +
 *                           tipografía grande. Nunca un ícono, nunca un
 *                           dibujo — ver _visualEditorial().
 * Ninguna plantilla depende de que exista una imagen específica.
 *
 * Reusable entre industrias: el copy (pdfConfig) y las métricas
 * (resumenEjecutivo, por motor) llegan resueltos por el caller — esta
 * función no tiene nada hardcodeado de paneles solares.
 *
 * Última línea de defensa antes de generar: SIEMPRE valida
 * puedeEnviarCotizacion() (Fase 2) — nunca genera un PDF de una cotización
 * sin ingenieria_validada_para_cotizar, ni con una alerta de bloqueo activa.
 *
 * Requiere un cliente de Supabase con service_role — ver nota de Storage
 * más abajo (mismo criterio que inbox-adjuntos.js).
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
const _channelRouter = new ChannelRouter(supabaseServicio);

// Paleta editorial: casi monocromo (tinta cálida + papel), UN solo acento.
// empresa.color_acento (si la empresa lo configuró) sobreescribe el verde
// por defecto — sigue siendo "un solo color", solo cambia cuál.
const COLORES_DEFAULT = {
  tinta: '#17170f', textoSecundario: '#6b6a62', papel: '#ffffff',
  papelCalido: '#faf9f6', borde: '#e7e5df', acento: '#1b4332', acentoSuave: '#e8efe9',
};

const FUENTE_DISPLAY = `Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif`;
const FUENTE_CUERPO = `-apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

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

/**
 * Resuelve la fuente de una imagen en cascada: propia de la empresa/paquete
 * (Nivel 1) → stock configurado por industria (Nivel 2) → null (Nivel 3,
 * el caller pinta el tratamiento editorial). Nunca decide POR SÍ SOLA que
 * hay que usar una imagen — solo devuelve la primera URL real que exista.
 *
 * @param {...(string|null|undefined)} fuentes - en orden de prioridad
 * @returns {string|null}
 */
function resolverImagenBloque(...fuentes) {
  for (const f of fuentes) {
    if (f) return f;
  }
  return null;
}

/**
 * Composición editorial abstracta (Nivel 3, sin foto) — NUNCA un ícono ni
 * un dibujo figurativo: solo geometría (arcos, líneas finas) en el color
 * de acento, sobre el papel. Dos variantes: 'hero' (portada, más grande) y
 * 'marca' (fichas de producto, un monograma dentro de un arco).
 */
function _visualEditorial(variante, colores, letra) {
  if (variante === 'hero') {
    return `
    <svg viewBox="0 0 600 260" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect x="0" y="0" width="600" height="260" fill="${colores.papelCalido}"/>
      <circle cx="480" cy="40" r="220" fill="none" stroke="${colores.acento}" stroke-width="1.25" opacity="0.35"/>
      <circle cx="480" cy="40" r="160" fill="none" stroke="${colores.acento}" stroke-width="1" opacity="0.22"/>
      <line x1="0" y1="230" x2="600" y2="230" stroke="${colores.acento}" stroke-width="1" opacity="0.3"/>
    </svg>`;
  }
  // 'marca' — monograma discreto para fichas de panel/inversor/instalación
  return `
  <svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="40" cy="40" r="38" fill="none" stroke="${colores.acento}" stroke-width="1"/>
    <text x="40" y="49" text-anchor="middle" font-family="${FUENTE_DISPLAY}" font-size="26" fill="${colores.acento}">${_escaparHtml(letra)}</text>
  </svg>`;
}

/** Un bloque visual (foto real o tratamiento editorial) — nunca depende de que exista la imagen. */
function _bloqueVisual({ imagenUrl, variante, letra, alt, colores, claseAlto }) {
  if (imagenUrl) {
    return `<div class="visual-foto ${claseAlto || ''}"><img src="${_escaparHtml(imagenUrl)}" alt="${_escaparHtml(alt || '')}"/></div>`;
  }
  return `<div class="visual-editorial ${claseAlto || ''}">${_visualEditorial(variante, colores, letra)}</div>`;
}

// ── Secciones (una por "página" de la historia) ─────────────────────────────

function _numeroSeccion(n) {
  return `<span class="numero-seccion">${String(n).padStart(2, '0')}</span>`;
}

function _seccionPortada({ cotizacion, cliente, empresa, asesorNombre, pdfConfig, colores, imagenHero }) {
  const logo = empresa?.logo_url
    ? `<img src="${_escaparHtml(empresa.logo_url)}" alt="${_escaparHtml(empresa?.nombre)}" class="logo-img"/>`
    : `<span class="logo-texto">${_escaparHtml(empresa?.nombre)}</span>`;

  return `
  <section class="pagina portada">
    <div class="marca-superior">${logo}<span class="folio-discreto">${_escaparHtml(cotizacion.folio || `#${cotizacion.id}`)}</span></div>
    ${_bloqueVisual({ imagenUrl: imagenHero, variante: 'hero', alt: 'Tu nuevo sistema solar', colores, claseAlto: 'visual-hero' })}
    <div class="hero-texto">
      <h1>${_escaparHtml(pdfConfig?.hero?.titulo || 'Tu propuesta')}</h1>
      <p class="hero-subtitulo">${_escaparHtml(pdfConfig?.hero?.subtitulo || '')}</p>
    </div>
    <div class="meta-portada">
      <div><span>Preparado para</span><strong>${_escaparHtml(cliente?.nombre)}</strong></div>
      <div><span>Fecha</span><strong>${_formatoFecha(cotizacion.created_at)}</strong></div>
      <div><span>Asesor</span><strong>${_escaparHtml(asesorNombre || 'Nuestro equipo')}</strong></div>
    </div>
  </section>`;
}

/** "¿Por qué este sistema?" — narrativa breve + las 3 cifras más persuasivas, nunca 8 tarjetas. */
function _seccionPorQue({ resumenEjecutivo, pdfConfig }) {
  const disponibles = (resumenEjecutivo || []).filter(t => t.disponible);
  if (disponibles.length === 0 && !pdfConfig?.porQueEsteSistema?.texto) return '';

  const CLAVES_PRIORITARIAS = ['ahorro_mensual', 'cobertura', 'numero_paneles', 'ahorro_anual'];
  const destacadas = CLAVES_PRIORITARIAS.map(c => disponibles.find(t => t.clave === c)).filter(Boolean).slice(0, 3);

  const cifras = destacadas.map(t => `
    <div class="cifra">
      <div class="cifra-valor">${_escaparHtml(t.valorTexto)}</div>
      <div class="cifra-etiqueta">${_escaparHtml(t.etiqueta)}</div>
    </div>`).join('');

  return `
  <section class="pagina seccion">
    ${_numeroSeccion(2)}
    <h2>Por qué este sistema</h2>
    ${pdfConfig?.porQueEsteSistema?.texto ? `<p class="parrafo-editorial">${_escaparHtml(pdfConfig.porQueEsteSistema.texto)}</p>` : ''}
    ${cifras ? `<div class="fila-cifras">${cifras}</div>` : ''}
  </section>`;
}

/** "¿Qué recibirás exactamente?" — fichas de equipo con foto real o marca editorial, nunca ícono. */
function _seccionQueRecibiras({ paquete, colores }) {
  if (!paquete) return '';

  const componentes = Array.isArray(paquete.componentes_incluidos) ? paquete.componentes_incluidos : [];

  const fichaPanel = paquete.marca_panel ? `
    <div class="ficha-equipo">
      ${_bloqueVisual({ imagenUrl: paquete.imagen_panel_url, variante: 'marca', letra: 'P', alt: 'Panel solar', colores, claseAlto: 'visual-ficha' })}
      <div class="ficha-titulo">Panel solar</div>
      <div class="ficha-detalle">${_escaparHtml(paquete.marca_panel)} ${_escaparHtml(paquete.modelo_panel || '')}</div>
    </div>` : '';

  const fichaInversor = paquete.marca_inversor ? `
    <div class="ficha-equipo">
      ${_bloqueVisual({ imagenUrl: paquete.imagen_inversor_url, variante: 'marca', letra: 'I', alt: 'Inversor', colores, claseAlto: 'visual-ficha' })}
      <div class="ficha-titulo">${_escaparHtml(paquete.tipo_inversor === 'microinversor' ? 'Microinversores' : 'Inversor')}</div>
      <div class="ficha-detalle">${_escaparHtml(paquete.marca_inversor)} ${_escaparHtml(paquete.modelo_inversor || '')}</div>
    </div>` : '';

  const fichaInstalacion = paquete.imagen_instalacion_url ? `
    <div class="ficha-equipo">
      ${_bloqueVisual({ imagenUrl: paquete.imagen_instalacion_url, variante: 'marca', letra: 'S', alt: 'Instalación terminada', colores, claseAlto: 'visual-ficha' })}
      <div class="ficha-titulo">Instalación</div>
      <div class="ficha-detalle">Proyecto terminado</div>
    </div>` : '';

  return `
  <section class="pagina seccion">
    ${_numeroSeccion(3)}
    <h2>Qué recibirás exactamente</h2>
    <p class="paquete-nombre">${_escaparHtml(paquete.nombre)}</p>
    <div class="grid-fichas">${fichaPanel}${fichaInversor}${fichaInstalacion}</div>
    ${componentes.length ? `<p class="lista-componentes-editorial">${componentes.map(_escaparHtml).join(' · ')}</p>` : ''}
  </section>`;
}

/** Beneficios en lenguaje de beneficio — el dato técnico, si existe, va como pie de nota pequeño. */
function _seccionBeneficios(pdfConfig) {
  const beneficios = pdfConfig?.beneficios || [];
  if (beneficios.length === 0) return '';

  const items = beneficios.map(b => `
    <div class="beneficio">
      <div class="beneficio-titulo">${_escaparHtml(b.titulo)}</div>
      ${b.detalleTecnico ? `<div class="beneficio-detalle">${_escaparHtml(b.detalleTecnico)}</div>` : ''}
    </div>`).join('');

  return `
  <section class="pagina seccion">
    ${_numeroSeccion(4)}
    <h2>Lo que ganas</h2>
    <div class="lista-beneficios">${items}</div>
  </section>`;
}

/** Confianza — certificaciones/garantías/tecnología/CFE, en formato de marca editorial, nunca ícono infantil. */
function _seccionConfianza({ paquete, pdfConfig }) {
  const g = paquete?.garantias || {};
  const garantiaPanel = g.panel?.producto_anios || g.panel?.rendimiento_anios;
  const garantiaInversor = g.inversor?.garantia_anios || g.inversor?.vida_util_anios;

  const marcas = [
    ...(pdfConfig?.confianza || []).map(c => ({ titulo: c.titulo, detalle: c.detalle })),
    garantiaPanel ? { titulo: 'Garantía de panel', detalle: [g.panel?.producto_anios && `${g.panel.producto_anios} años producto`, g.panel?.rendimiento_anios && `${g.panel.rendimiento_anios} años rendimiento`].filter(Boolean).join(' · ') } : null,
    garantiaInversor ? { titulo: 'Garantía de inversor', detalle: [g.inversor?.garantia_anios && `${g.inversor.garantia_anios} años`, g.inversor?.vida_util_anios && `vida útil ${g.inversor.vida_util_anios} años`].filter(Boolean).join(' · ') } : null,
  ].filter(Boolean);

  if (marcas.length === 0) return '';

  const items = marcas.map(m => `
    <div class="marca-confianza">
      <div class="marca-titulo">${_escaparHtml(m.titulo)}</div>
      <div class="marca-detalle">${_escaparHtml(m.detalle || 'Consulta con tu asesor')}</div>
    </div>`).join('');

  return `
  <section class="pagina seccion">
    ${_numeroSeccion(5)}
    <h2>Respaldo y confianza</h2>
    <div class="grid-confianza">${items}</div>
  </section>`;
}

/** La inversión — al final, siempre. Minimalista: sin tabla pesada. */
function _seccionInversion({ cotizacion, lineas }) {
  const filas = (lineas || []).map(l => `
    <div class="linea-inversion">
      <span>${_escaparHtml(l.descripcion)}${l.pendiente_levantamiento ? ' <em>(sujeto a levantamiento en sitio)</em>' : ''}</span>
      <span class="num">${_formatoMoneda(l.subtotal)}</span>
    </div>`).join('');

  return `
  <section class="pagina seccion seccion-inversion">
    ${_numeroSeccion(6)}
    <h2>Tu inversión</h2>
    <div class="lineas-inversion">${filas}</div>
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
    ${cotizacion.condiciones_comerciales ? `<p class="condiciones-texto">${_escaparHtml(cotizacion.condiciones_comerciales)}</p>` : ''}
  </section>`;
}

function _footer({ empresa, asesorNombre, whatsappEmpresa, qrDataUri }) {
  return `
  <section class="pagina footer">
    <div class="footer-firma">
      <div class="footer-empresa">${_escaparHtml(empresa?.nombre)}</div>
      ${asesorNombre ? `<div class="footer-asesor">${_escaparHtml(asesorNombre)}</div>` : ''}
      <div class="footer-contacto">
        ${whatsappEmpresa ? `<span>WhatsApp ${_escaparHtml(whatsappEmpresa)}</span>` : ''}
        ${empresa?.correo_contacto ? `<span>${_escaparHtml(empresa.correo_contacto)}</span>` : ''}
        ${empresa?.sitio_web ? `<span>${_escaparHtml(empresa.sitio_web)}</span>` : ''}
      </div>
      <p class="footer-transparencia">Esta propuesta fue generada mediante nuestro sistema inteligente de análisis y posteriormente revisada y validada por un especialista.</p>
    </div>
    ${qrDataUri ? `<div class="footer-qr"><img src="${qrDataUri}" alt="Código QR de contacto"/></div>` : ''}
  </section>`;
}

/**
 * Arma el HTML del PDF comercial — función pura, testable sin Puppeteer ni
 * DB. Ver cabecera del módulo para la filosofía completa.
 *
 * @param {Object} datos
 * @param {Object} datos.cotizacion
 * @param {Array} datos.lineas
 * @param {Object} datos.cliente
 * @param {Object} datos.empresa
 * @param {Object} [datos.paquete]
 * @param {Array} [datos.resumenEjecutivo]
 * @param {Object} [datos.pdfConfig]
 * @param {Object} [datos.calculoDatosEntrada]
 * @param {string} [datos.asesorNombre]
 * @param {string} [datos.whatsappEmpresa]
 * @param {string} [datos.qrDataUri]
 * @param {string} [datos.imagenHero] - ya resuelta en cascada (Nivel 1/2), null si Nivel 3
 * @returns {string} HTML completo
 */
function construirHtmlCotizacion({
  cotizacion, lineas, cliente, empresa, paquete, resumenEjecutivo, pdfConfig,
  calculoDatosEntrada, asesorNombre, whatsappEmpresa, qrDataUri, imagenHero,
}) {
  const colores = { ...COLORES_DEFAULT, ...(empresa?.color_acento ? { acento: empresa.color_acento } : {}) };

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: ${FUENTE_CUERPO}; color: ${colores.tinta}; margin: 0; padding: 0; font-size: 13px; background: ${colores.papel}; }
  .pagina { padding: 40px 52px; }
  .numero-seccion { display: block; font-size: 11px; letter-spacing: .12em; color: ${colores.acento}; font-weight: 600; margin-bottom: 10px; }
  h2 { font-family: ${FUENTE_DISPLAY}; font-size: 24px; font-weight: 400; color: ${colores.tinta}; margin: 0 0 18px; letter-spacing: -0.01em; }

  /* Portada */
  .portada { padding: 0; }
  .marca-superior { display: flex; justify-content: space-between; align-items: center; padding: 28px 52px 0; }
  .logo-img { height: 30px; max-width: 140px; object-fit: contain; }
  .logo-texto { font-family: ${FUENTE_DISPLAY}; font-size: 15px; letter-spacing: .02em; color: ${colores.tinta}; }
  .folio-discreto { font-size: 10px; color: ${colores.textoSecundario}; letter-spacing: .05em; }
  .visual-hero { width: 100%; height: 260px; }
  .visual-hero img, .visual-hero svg { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero-texto { padding: 36px 52px 0; max-width: 480px; }
  .hero-texto h1 { font-family: ${FUENTE_DISPLAY}; font-size: 34px; font-weight: 400; line-height: 1.15; color: ${colores.tinta}; margin: 0 0 14px; letter-spacing: -0.01em; }
  .hero-subtitulo { font-size: 15px; color: ${colores.textoSecundario}; line-height: 1.5; margin: 0; }
  .meta-portada { display: flex; gap: 40px; margin: 36px 52px 40px; padding-top: 20px; border-top: 1px solid ${colores.borde}; }
  .meta-portada div { display: flex; flex-direction: column; gap: 3px; }
  .meta-portada span { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: ${colores.textoSecundario}; }
  .meta-portada strong { font-size: 13px; font-weight: 500; color: ${colores.tinta}; }

  /* Por qué este sistema */
  .parrafo-editorial { font-size: 16px; line-height: 1.65; color: ${colores.tinta}; max-width: 520px; margin: 0 0 32px; font-family: ${FUENTE_DISPLAY}; }
  .fila-cifras { display: flex; gap: 48px; }
  .cifra-valor { font-family: ${FUENTE_DISPLAY}; font-size: 40px; color: ${colores.acento}; font-variant-numeric: tabular-nums; line-height: 1; }
  .cifra-etiqueta { font-size: 11px; color: ${colores.textoSecundario}; margin-top: 8px; text-transform: uppercase; letter-spacing: .04em; }

  /* Qué recibirás */
  .paquete-nombre { font-size: 15px; color: ${colores.textoSecundario}; margin: 0 0 24px; }
  .grid-fichas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 20px; }
  .ficha-equipo { text-align: left; }
  .visual-ficha { width: 64px; height: 64px; margin-bottom: 12px; }
  .visual-ficha img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .visual-ficha svg { width: 100%; height: 100%; }
  .ficha-titulo { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: ${colores.textoSecundario}; margin-bottom: 3px; }
  .ficha-detalle { font-size: 14px; font-weight: 500; color: ${colores.tinta}; }
  .lista-componentes-editorial { font-size: 12px; color: ${colores.textoSecundario}; border-top: 1px solid ${colores.borde}; padding-top: 16px; margin-top: 8px; }

  /* Beneficios */
  .lista-beneficios { display: flex; flex-direction: column; }
  .beneficio { padding: 16px 0; border-bottom: 1px solid ${colores.borde}; }
  .beneficio:first-child { padding-top: 0; }
  .beneficio-titulo { font-family: ${FUENTE_DISPLAY}; font-size: 18px; color: ${colores.tinta}; }
  .beneficio-detalle { font-size: 11.5px; color: ${colores.textoSecundario}; margin-top: 4px; }

  /* Confianza */
  .grid-confianza { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px 32px; }
  .marca-confianza { border-left: 2px solid ${colores.acento}; padding-left: 14px; }
  .marca-titulo { font-size: 13.5px; font-weight: 600; color: ${colores.tinta}; }
  .marca-detalle { font-size: 11.5px; color: ${colores.textoSecundario}; margin-top: 3px; }

  /* Inversión */
  .seccion-inversion { background: ${colores.papelCalido}; }
  .lineas-inversion { margin-bottom: 4px; }
  .linea-inversion { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid ${colores.borde}; font-size: 13px; }
  .linea-inversion .num { font-variant-numeric: tabular-nums; }
  .linea-inversion em { color: ${colores.textoSecundario}; font-style: italic; font-size: 11px; }
  .totales { margin-top: 16px; width: 300px; margin-left: auto; }
  .totales div { display: flex; justify-content: space-between; padding: 5px 0; }
  .totales .total { font-family: ${FUENTE_DISPLAY}; font-weight: 400; font-size: 26px; color: ${colores.acento}; border-top: 1px solid ${colores.tinta}; padding-top: 12px; margin-top: 6px; }
  .condiciones-grid { display: flex; gap: 32px; margin-top: 24px; }
  .condiciones-grid div { display: flex; flex-direction: column; gap: 2px; }
  .condiciones-grid span { font-size: 10px; text-transform: uppercase; color: ${colores.textoSecundario}; }
  .condiciones-grid strong { font-size: 13px; }
  .condiciones-texto { margin-top: 18px; font-size: 11.5px; color: ${colores.textoSecundario}; line-height: 1.5; }

  /* Footer */
  .footer { display: flex; justify-content: space-between; align-items: flex-end; padding: 36px 52px; background: ${colores.tinta}; color: #fdfdfb; }
  .footer-empresa { font-family: ${FUENTE_DISPLAY}; font-size: 16px; margin-bottom: 4px; }
  .footer-asesor { font-size: 12px; opacity: 0.85; margin-bottom: 10px; }
  .footer-contacto { display: flex; gap: 16px; font-size: 11px; opacity: 0.75; margin-bottom: 16px; }
  .footer-transparencia { font-size: 10px; opacity: 0.6; max-width: 380px; line-height: 1.5; margin: 0; }
  .footer-qr img { width: 60px; height: 60px; border-radius: 4px; background: #fff; padding: 4px; }

  @media print { .pagina { break-inside: avoid-page; page-break-after: always; } .footer { page-break-after: avoid; } }
</style>
</head>
<body>
  ${_seccionPortada({ cotizacion, cliente, empresa, asesorNombre, pdfConfig, colores, imagenHero })}
  ${_seccionPorQue({ resumenEjecutivo, pdfConfig })}
  ${_seccionQueRecibiras({ paquete, colores })}
  ${_seccionBeneficios(pdfConfig)}
  ${_seccionConfianza({ paquete, pdfConfig })}
  ${_seccionInversion({ cotizacion, lineas })}
  ${_footer({ empresa, asesorNombre, whatsappEmpresa, qrDataUri })}
</body>
</html>`;
}

/**
 * Reúne TODOS los datos que necesita construirHtmlCotizacion() a partir de
 * un cotizacionId — para que cualquier caller (PDF real, script de vista
 * previa, futura ruta de preview) arme exactamente el mismo HTML.
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
    supabase.from('companies').select('nombre, logo_url, color_acento, correo_contacto, sitio_web, industria_slug, imagen_hero_url').eq('id', cotizacion.company_id).maybeSingle(),
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

  // Nivel 1 (empresa) → Nivel 2 (stock de la industria) → null (Nivel 3, editorial)
  const imagenHero = resolverImagenBloque(empresa?.imagen_hero_url, plantilla?.imagenes_stock_default?.hero);

  return {
    cotizacion, lineas, cliente, empresa, paquete, resumenEjecutivo, pdfConfig,
    calculoDatosEntrada: calculo?.datos_entrada, asesorNombre: asesor?.nombre,
    whatsappEmpresa, qrDataUri, imagenHero,
  };
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
 * Genera el PDF y lo envía por WhatsApp en una sola llamada. Si el envío
 * falla, el PDF ya generado NO se pierde (queda en pdf_url).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {number} datos.cotizacionId
 * @param {string} datos.destinatario
 * @returns {Promise<Object>}
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

module.exports = {
  BUCKET_COTIZACIONES_PDF, resolverImagenBloque, construirHtmlCotizacion,
  reunirDatosParaPdf, generarPdfCotizacion, generarYEnviarCotizacion,
};
