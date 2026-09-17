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
 * ── PLANTILLA VISUAL — dos variantes, misma arquitectura (Alina, 2026-09-14) ─
 * `pdfConfig.plantilla_visual` decide qué HTML se construye:
 *   'editorial_compacto'  (default) → la plantilla de arriba, sin cambios.
 *   'premium_corporativo'           → formato comercial largo (portada,
 *     consumo, sistema, equipos, qué incluye, inversión/retorno, garantías,
 *     proceso, condiciones, cierre) con paleta de marca de 3 colores —
 *     construido para Nort Energy vía override en
 *     companies.nav_labels.cotizacion_pdf_config (ver
 *     modules/plantillas-industria.js::obtenerPlantillaDeEmpresa), así que
 *     GONDOR y Empresa Demo Paneles Solares (misma industria_slug) siguen
 *     recibiendo 'editorial_compacto' sin ningún cambio. El mecanismo es
 *     genérico por si otra empresa futura quiere la misma variante — no hay
 *     ningún `if company_id === ...` en este archivo.
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

// Paleta de marca Nort Energy (brand book, /Users/alinanavarro/Downloads/
// "nort energy branding "/ — confirmada por Alina 2026-09-14): azul marino
// dominante, verde secundario, amarillo SOLO como acento puntual (nunca
// fondo ni color de gráfica). Gris medio oficial (#8C8F94) no es apto para
// texto (no cumple AA 4.5:1) — se usa #5B6675 para texto secundario, mismo
// criterio que ya documenta nortenergy/shared/src/tokens.ts.
const COLORES_PREMIUM_DEFAULT = {
  azul: '#0D1F3D', azulOscuro: '#081326', azulClaro: '#3E5B8C',
  verde: '#22B14C', verdeOscuro: '#1A8A3B', verdeClaro: '#6FCB84',
  amarillo: '#FFC107', amarilloOscuro: '#E0A600',
  grisClaro: '#F2F4F7', borde: '#E3E8EF', texto: '#1B2430', textoSecundario: '#5B6675',
  papel: '#ffffff',
};

// 'Inter' es la tipografía de marca (brand book) — si el motor de Puppeteer
// no la tiene instalada localmente, cae a la misma pila de sans-serif del
// sistema que ya usa el resto de TARA-OS (sin depender de una fuente web
// remota, para no introducir una llamada de red al render del PDF).
const FUENTE_PREMIUM = `'Inter', -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

// ── Helpers de formato/escape (compartidos entre ambas plantillas) ─────────

function _escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _formatoMoneda(valor) {
  return `$${Number(valor || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function _formatoMonedaEntera(valor) {
  return `$${Math.round(Number(valor || 0)).toLocaleString('es-MX')}`;
}

function _formatoEntero(valor) {
  return Math.round(Number(valor || 0)).toLocaleString('es-MX');
}

function _formatoPct(valor, decimales = 1) {
  return `${Number(valor).toLocaleString('es-MX', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}%`;
}

function _iniciales(nombre) {
  return (nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
}

function _formatoFecha(fechaIso) {
  return new Date(fechaIso || Date.now()).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** "Pendiente de cálculo"/"Consulta con tu asesor" — nunca un placeholder numérico inventado. */
function _valorOPendiente(valor, formateador, textoPendiente = 'Dato pendiente de cálculo') {
  return valor == null ? `<span class="valor-pendiente">${_escaparHtml(textoPendiente)}</span>` : formateador(valor);
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

// ═════════════════════════════════════════════════════════════════════════
// ── PLANTILLA 1/2: editorial_compacto (default, sin cambios de siempre) ────
// ═════════════════════════════════════════════════════════════════════════

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

function _construirHtmlEditorialCompacto({
  cotizacion, lineas, cliente, empresa, paquete, resumenEjecutivo, pdfConfig,
  asesorNombre, whatsappEmpresa, qrDataUri, imagenHero,
}) {
  const colores = { ...COLORES_DEFAULT, ...(empresa?.color_acento ? { acento: empresa.color_acento } : {}) };

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  /* Compactado a 1-2 páginas (Alina, pedido explícito): se quitó el
     page-break-after:always que forzaba una página física por sección —
     ahora todo fluye junto y solo se evita partir una unidad chica a la
     mitad (ficha, beneficio, línea de inversión). Misma jerarquía visual
     y misma secuencia narrativa de siempre, con menos aire entre bloques. */
  * { box-sizing: border-box; }
  body { font-family: ${FUENTE_CUERPO}; color: ${colores.tinta}; margin: 0; padding: 0; font-size: 11.5px; background: ${colores.papel}; }
  .pagina { padding: 5px 44px; }
  .numero-seccion { display: block; font-size: 9.5px; letter-spacing: .12em; color: ${colores.acento}; font-weight: 600; margin-bottom: 3px; }
  h2 { font-family: ${FUENTE_DISPLAY}; font-size: 15px; font-weight: 400; color: ${colores.tinta}; margin: 0 0 6px; letter-spacing: -0.01em; }

  /* Portada */
  .portada { padding: 0; }
  .marca-superior { display: flex; justify-content: space-between; align-items: center; padding: 7px 44px 0; }
  .logo-img { height: 24px; max-width: 120px; object-fit: contain; }
  .logo-texto { font-family: ${FUENTE_DISPLAY}; font-size: 13px; letter-spacing: .02em; color: ${colores.tinta}; }
  .folio-discreto { font-size: 9px; color: ${colores.textoSecundario}; letter-spacing: .05em; }
  .visual-hero { width: 100%; height: 108px; }
  .visual-hero img, .visual-hero svg { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero-texto { padding: 7px 44px 0; max-width: 480px; }
  .hero-texto h1 { font-family: ${FUENTE_DISPLAY}; font-size: 22px; font-weight: 400; line-height: 1.1; color: ${colores.tinta}; margin: 0 0 4px; letter-spacing: -0.01em; }
  .hero-subtitulo { font-size: 11.5px; color: ${colores.textoSecundario}; line-height: 1.35; margin: 0; }
  .meta-portada { display: flex; gap: 30px; margin: 9px 44px 9px; padding-top: 7px; border-top: 1px solid ${colores.borde}; }
  .meta-portada div { display: flex; flex-direction: column; gap: 2px; }
  .meta-portada span { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: ${colores.textoSecundario}; }
  .meta-portada strong { font-size: 11.5px; font-weight: 500; color: ${colores.tinta}; }

  /* Por qué este sistema */
  .parrafo-editorial { font-size: 12px; line-height: 1.4; color: ${colores.tinta}; max-width: 520px; margin: 0 0 9px; font-family: ${FUENTE_DISPLAY}; }
  .fila-cifras { display: flex; gap: 30px; }
  .cifra-valor { font-family: ${FUENTE_DISPLAY}; font-size: 24px; color: ${colores.acento}; font-variant-numeric: tabular-nums; line-height: 1; }
  .cifra-etiqueta { font-size: 8.5px; color: ${colores.textoSecundario}; margin-top: 4px; text-transform: uppercase; letter-spacing: .04em; }

  /* Qué recibirás */
  .paquete-nombre { font-size: 12px; color: ${colores.textoSecundario}; margin: 0 0 6px; }
  .grid-fichas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 6px; }
  .ficha-equipo { text-align: left; }
  .visual-ficha { width: 34px; height: 34px; margin-bottom: 4px; }
  .visual-ficha img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .visual-ficha svg { width: 100%; height: 100%; }
  .ficha-titulo { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: ${colores.textoSecundario}; margin-bottom: 2px; }
  .ficha-detalle { font-size: 11.5px; font-weight: 500; color: ${colores.tinta}; }
  .lista-componentes-editorial { font-size: 9.5px; color: ${colores.textoSecundario}; border-top: 1px solid ${colores.borde}; padding-top: 5px; margin-top: 1px; }

  /* Beneficios — 2 columnas para no gastar tanto alto */
  .lista-beneficios { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; }
  .beneficio { padding: 6px 0; border-bottom: 1px solid ${colores.borde}; }
  .beneficio-titulo { font-family: ${FUENTE_DISPLAY}; font-size: 12.5px; color: ${colores.tinta}; }
  .beneficio-detalle { font-size: 9px; color: ${colores.textoSecundario}; margin-top: 2px; }

  /* Confianza */
  .grid-confianza { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 20px; }
  .marca-confianza { border-left: 2px solid ${colores.acento}; padding-left: 10px; }
  .marca-titulo { font-size: 11px; font-weight: 600; color: ${colores.tinta}; }
  .marca-detalle { font-size: 9px; color: ${colores.textoSecundario}; margin-top: 2px; }

  /* Inversión */
  .seccion-inversion { background: ${colores.papelCalido}; }
  .lineas-inversion { margin-bottom: 2px; }
  .linea-inversion { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid ${colores.borde}; font-size: 11.5px; }
  .linea-inversion .num { font-variant-numeric: tabular-nums; }
  .linea-inversion em { color: ${colores.textoSecundario}; font-style: italic; font-size: 10px; }
  .totales { margin-top: 5px; width: 260px; margin-left: auto; }
  .totales div { display: flex; justify-content: space-between; padding: 2px 0; }
  .totales .total { font-family: ${FUENTE_DISPLAY}; font-weight: 400; font-size: 17px; color: ${colores.acento}; border-top: 1px solid ${colores.tinta}; padding-top: 4px; margin-top: 2px; }
  .condiciones-grid { display: flex; gap: 24px; margin-top: 6px; }
  .condiciones-grid div { display: flex; flex-direction: column; gap: 1px; }
  .condiciones-grid span { font-size: 9px; text-transform: uppercase; color: ${colores.textoSecundario}; }
  .condiciones-grid strong { font-size: 11.5px; }
  .condiciones-texto { margin-top: 4px; font-size: 9px; color: ${colores.textoSecundario}; line-height: 1.3; }

  /* Footer */
  .footer { display: flex; justify-content: space-between; align-items: flex-end; padding: 8px 44px; background: ${colores.tinta}; color: #fdfdfb; }
  .footer-empresa { font-family: ${FUENTE_DISPLAY}; font-size: 12px; margin-bottom: 1px; }
  .footer-asesor { font-size: 9px; opacity: 0.85; margin-bottom: 3px; }
  .footer-contacto { display: flex; gap: 12px; font-size: 8.5px; opacity: 0.75; margin-bottom: 4px; }
  .footer-transparencia { font-size: 7.5px; opacity: 0.6; max-width: 380px; line-height: 1.3; margin: 0; }
  .footer-qr img { width: 42px; height: 42px; border-radius: 4px; background: #fff; padding: 3px; }

  @media print {
    .ficha-equipo, .beneficio, .marca-confianza, .linea-inversion, .cifra, .footer { break-inside: avoid; }
  }
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

// ═════════════════════════════════════════════════════════════════════════
// ── PLANTILLA 2/2: premium_corporativo (Nort Energy, Alina 2026-09-14) ─────
// ═════════════════════════════════════════════════════════════════════════
//
// Formato comercial largo, 3 colores de marca, una página física por
// bloque (page-break-after en @media print, tamaño carta). Principio que
// gobierna TODA esta plantilla, repetido literalmente por Alina en cada
// sección del brief: nunca inventar un dato — si falta, se oculta el bloque
// o se muestra "Dato/Pendiente de cálculo", nunca un número de relleno.

function _pgNum(n, total = 10) {
  return `<span class="pg-num">${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>`;
}

/** Gráfica de barras verticales simple — azul (actual/CFE) o verde (solar/ahorro) por serie, nunca amarillo (solo acento). */
function _premGraficaBarras({ items, colorBarra, colores, alto = 90 }) {
  if (!items || items.length === 0) return '';
  const max = Math.max(...items.map(i => i.valor), 1);
  const anchoBarra = Math.min(46, Math.floor(560 / items.length) - 8);
  const paso = 560 / items.length;

  const barras = items.map((it, i) => {
    const h = Math.max(2, (it.valor / max) * (alto - 22));
    const x = i * paso + (paso - anchoBarra) / 2;
    const y = alto - h - 16;
    return `
      <rect x="${x}" y="${y}" width="${anchoBarra}" height="${h}" rx="2" fill="${colorBarra}"/>
      <text x="${x + anchoBarra / 2}" y="${alto - 4}" text-anchor="middle" font-family="${FUENTE_PREMIUM}" font-size="8" fill="${colores.textoSecundario}">${_escaparHtml(it.etiqueta)}</text>
    `;
  }).join('');

  return `<svg viewBox="0 0 560 ${alto}" xmlns="http://www.w3.org/2000/svg" class="grafica-svg" preserveAspectRatio="xMidYMid meet">
    <line x1="0" y1="${alto - 16}" x2="560" y2="${alto - 16}" stroke="${colores.borde}" stroke-width="1"/>
    ${barras}
  </svg>`;
}

/** Gráfica de dos series lado a lado (consumo vs solar; sin sistema vs con sistema) — azul vs verde, leyenda simple. */
function _premGraficaDosSeries({ grupos, colores, serieA, serieB, alto = 120 }) {
  if (!grupos || grupos.length === 0) return '';
  const max = Math.max(...grupos.flatMap(g => [g.a, g.b]), 1);
  const paso = 560 / grupos.length;
  const anchoBarra = Math.min(34, paso / 3);

  const barras = grupos.map((g, i) => {
    const centro = i * paso + paso / 2;
    const hA = Math.max(2, (g.a / max) * (alto - 34));
    const hB = Math.max(2, (g.b / max) * (alto - 34));
    const xA = centro - anchoBarra - 3;
    const xB = centro + 3;
    const yA = alto - hA - 20;
    const yB = alto - hB - 20;
    return `
      <rect x="${xA}" y="${yA}" width="${anchoBarra}" height="${hA}" rx="2" fill="${colores.azul}"/>
      <rect x="${xB}" y="${yB}" width="${anchoBarra}" height="${hB}" rx="2" fill="${colores.verde}"/>
      <text x="${centro}" y="${alto - 6}" text-anchor="middle" font-family="${FUENTE_PREMIUM}" font-size="8" fill="${colores.textoSecundario}">${_escaparHtml(g.etiqueta)}</text>
    `;
  }).join('');

  return `
  <div class="grafica-con-leyenda">
    <svg viewBox="0 0 560 ${alto}" xmlns="http://www.w3.org/2000/svg" class="grafica-svg" preserveAspectRatio="xMidYMid meet">
      <line x1="0" y1="${alto - 20}" x2="560" y2="${alto - 20}" stroke="${colores.borde}" stroke-width="1"/>
      ${barras}
    </svg>
    <div class="leyenda-grafica">
      <span><i style="background:${colores.azul}"></i>${_escaparHtml(serieA)}</span>
      <span><i style="background:${colores.verde}"></i>${_escaparHtml(serieB)}</span>
    </div>
  </div>`;
}

function _premPortada({ cotizacion, cliente, empresa, pdfConfig, colores, imagenHero, resultados }) {
  // Logo sobrepuesto SOBRE la fotografía del banner (Alina, 2026-09-14) —
  // no en una barra aparte arriba. Va dentro de una tarjeta blanca flotante
  // (nunca directo sobre la foto) para garantizar contraste sea cual sea la
  // zona de la imagen detrás — el logo trae azul marino/verde, que se
  // perdería contra un scrim oscuro. El archivo del logo nunca se toca.
  const logoChip = empresa?.logo_url
    ? `<img src="${_escaparHtml(empresa.logo_url)}" alt="${_escaparHtml(empresa?.nombre)}"/>`
    : `<span class="prem-logo-chip-texto">${_escaparHtml(empresa?.nombre)}</span>`;

  const numeroPaneles = resultados?.numero_paneles?.valor ?? null;
  const potenciaInstalada = resultados?.potencia_instalada_kwp ?? null;
  // promedioMensual solo existe cuando el motor usó estimación simplificada
  // (sin HSP mensual real) — con HSP mensual real, calcularProduccion()
  // devuelve `mensual` (desglose por mes) sin ese atajo, así que hay que
  // derivarlo de `anual` igual en ambos casos (mismo criterio que ya usaba
  // produccionMensual más abajo, en _premSistemaRecomendado).
  const _produccionMensualBase = resultados?.produccion?.promedioMensual
    ?? (resultados?.produccion?.anual != null ? resultados.produccion.anual / 12 : null);
  const produccionBimestral = _produccionMensualBase != null ? _produccionMensualBase * 2 : null;

  return `
  <section class="pagina prem-portada">
    <div class="prem-visual-hero-wrap">
      ${_bloqueVisual({ imagenUrl: imagenHero, variante: 'hero', alt: 'Instalación fotovoltaica', colores: { papelCalido: colores.grisClaro, acento: colores.azul }, claseAlto: 'prem-visual-hero' })}
      <div class="prem-logo-chip">${logoChip}</div>
    </div>
    <div class="prem-titulo-bloque">
      <h1>PROPUESTA DE SISTEMA FOTOVOLTAICO</h1>
      <p class="prem-subtitulo">Energía diseñada para reducir el costo de tu consumo eléctrico.</p>
    </div>
    <div class="prem-meta-grid">
      <div><span>Cliente</span><strong>${_escaparHtml(cliente?.nombre)}</strong></div>
      <div><span>Dirección</span><strong>${_escaparHtml(cliente?.direccion || 'Pendiente de confirmar')}</strong></div>
      <div><span>Ciudad</span><strong>${_escaparHtml([cliente?.municipio, cliente?.entidad].filter(Boolean).join(', ') || 'Pendiente de confirmar')}</strong></div>
      <div><span>No. de servicio CFE</span><strong>${_escaparHtml(cliente?.numero_servicio_cfe || 'Pendiente de confirmar')}</strong></div>
      <div><span>Tarifa</span><strong>${_escaparHtml(cliente?.tarifa_cfe || 'Pendiente de confirmar')}</strong></div>
      <div><span>Fecha</span><strong>${_formatoFecha(cotizacion.created_at)}</strong></div>
      <div><span>Vigencia</span><strong>${cotizacion.vigencia_dias ? `${cotizacion.vigencia_dias} días` : 'Pendiente de confirmar'}</strong></div>
      <div><span>Folio</span><strong>${_escaparHtml(cotizacion.folio || `#${cotizacion.id}`)}</strong></div>
    </div>
    <div class="prem-tarjeta-sistema">
      <div class="prem-tarjeta-titulo">Sistema propuesto</div>
      <div class="prem-tarjeta-filas">
        <div>${numeroPaneles != null ? `<strong>${numeroPaneles}</strong> paneles solares` : '<span class="valor-pendiente">Paneles: pendiente de cálculo</span>'}</div>
        <div>${potenciaInstalada != null ? `<strong>${potenciaInstalada.toFixed(2)} kWp</strong> de potencia instalada` : '<span class="valor-pendiente">Potencia: pendiente de cálculo</span>'}</div>
        <div>${produccionBimestral != null ? `Producción estimada: <strong>${_formatoEntero(produccionBimestral)} kWh/bimestre</strong>` : '<span class="valor-pendiente">Producción: pendiente de cálculo</span>'}</div>
        <div>Sistema interconectado a CFE</div>
      </div>
    </div>
  </section>`;
}

function _premConsumoActual({ calculoDatosEntrada, resultados, cliente }) {
  const consumoMensual = calculoDatosEntrada?.consumoMensualKwh ?? null;
  const pagoPromedio = calculoDatosEntrada?.importePromedioRecibo ?? null;
  const consumoAnual = resultados?.consumo_anual_kwh?.valor ?? null;
  const costoAnual = pagoPromedio != null ? pagoPromedio * 6 : null; // CFE factura bimestral en México — 6 periodos/año
  const historial = Array.isArray(calculoDatosEntrada?.historialConsumo) ? calculoDatosEntrada.historialConsumo : [];

  const grafica = historial.length > 0
    ? _premGraficaBarras({
        items: historial.slice(0, 12).map(h => ({ etiqueta: (h.mes || '').slice(0, 3), valor: Number(h.kwh) || 0 })),
        colorBarra: COLORES_PREMIUM_DEFAULT.azul, colores: COLORES_PREMIUM_DEFAULT, alto: 110,
      })
    : `<p class="prem-nota">No hay historial de recibos capturado para este cliente todavía — esta gráfica aparecerá cuando se registren los periodos de consumo.</p>`;

  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(2)}</div>
    <h2>ENTENDEMOS TU CONSUMO</h2>
    <div class="prem-datos-consumo">
      <div><span>Consumo promedio actual</span><strong>${_valorOPendiente(consumoMensual, v => `${_formatoEntero(v)} kWh/bimestre`)}</strong></div>
      <div><span>Pago promedio CFE</span><strong>${_valorOPendiente(pagoPromedio, _formatoMonedaEntera)}</strong></div>
      <div><span>Consumo anual estimado</span><strong>${_valorOPendiente(consumoAnual, v => `${_formatoEntero(v)} kWh`)}</strong></div>
      <div><span>Tarifa</span><strong>${_escaparHtml(cliente?.tarifa_cfe || 'Pendiente de confirmar')}</strong></div>
      <div><span>Costo anual aproximado</span><strong>${_valorOPendiente(costoAnual, _formatoMonedaEntera)}</strong></div>
    </div>
    <h3>Consumo histórico CFE</h3>
    ${grafica}
    <p class="prem-nota-marco">Dimensionamos el sistema tomando como referencia tu consumo eléctrico para evitar instalar capacidad innecesaria o insuficiente.</p>
  </section>`;
}

function _premSistemaRecomendado({ resultados }) {
  const numeroPaneles = resultados?.numero_paneles?.valor ?? null;
  const potenciaInstalada = resultados?.potencia_instalada_kwp ?? null;
  // promedioMensual solo existe cuando el motor usó estimación simplificada
  // (sin HSP mensual real) — con HSP mensual real, calcularProduccion()
  // devuelve `mensual` (desglose por mes) sin ese atajo, así que hay que
  // derivarlo de `anual` igual en ambos casos (mismo criterio que ya usaba
  // produccionMensual más abajo, en _premSistemaRecomendado).
  const _produccionMensualBase = resultados?.produccion?.promedioMensual
    ?? (resultados?.produccion?.anual != null ? resultados.produccion.anual / 12 : null);
  const produccionBimestral = _produccionMensualBase != null ? _produccionMensualBase * 2 : null;
  const coberturaPct = resultados?.cobertura_pct ?? null;
  const produccionAnual = resultados?.produccion?.anual ?? null;
  const produccionMensual = resultados?.produccion?.promedioMensual ?? (produccionAnual != null ? produccionAnual / 12 : null);

  const consumoAnual = resultados?.consumo_anual_kwh?.valor ?? null;
  const grafica = (produccionAnual != null && consumoAnual != null)
    ? _premGraficaDosSeries({
        grupos: [{ etiqueta: 'Anual', a: consumoAnual, b: produccionAnual }],
        colores: COLORES_PREMIUM_DEFAULT, serieA: 'Consumo actual', serieB: 'Energía solar estimada', alto: 110,
      })
    : `<p class="prem-nota">Gráfica disponible una vez que el cálculo de ingeniería esté completo.</p>`;

  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(3)}</div>
    <h2>EL SISTEMA QUE DISEÑAMOS PARA TI</h2>
    <div class="prem-indicadores-4">
      <div><span>Paneles</span><strong>${_valorOPendiente(numeroPaneles, v => v)}</strong></div>
      <div><span>Potencia instalada</span><strong>${_valorOPendiente(potenciaInstalada, v => `${v.toFixed(2)} kWp`)}</strong></div>
      <div><span>Producción estimada</span><strong>${_valorOPendiente(produccionBimestral, v => `${_formatoEntero(v)} kWh/bim.`)}</strong></div>
      <div><span>Cobertura estimada</span><strong>${_valorOPendiente(coberturaPct, v => _formatoPct(v))}</strong></div>
    </div>
    <div class="prem-datos-consumo prem-datos-consumo-3">
      <div><span>Producción anual estimada</span><strong>${_valorOPendiente(produccionAnual, v => `${_formatoEntero(v)} kWh/año`)}</strong></div>
      <div><span>Producción mensual promedio</span><strong>${_valorOPendiente(produccionMensual, v => `${_formatoEntero(v)} kWh`)}</strong></div>
      <div><span>Ahorro energético estimado</span><strong>${_valorOPendiente(coberturaPct, v => _formatoPct(v))}</strong></div>
    </div>
    <h3>Consumo actual vs. energía solar estimada</h3>
    ${grafica}
    <p class="prem-nota-marco">Las estimaciones de generación pueden variar por ubicación, orientación, inclinación, condiciones climáticas, sombras, características del inmueble y condiciones de operación.</p>
  </section>`;
}

/** Ficha genérica de un producto del catálogo — sin ninguna marca hardcodeada, lee lo que venga de `productos`. */
function _premFichaProducto(producto, tipoEtiqueta) {
  if (!producto) return '';
  const specs = producto.specs || {};
  const garantiaProducto = specs.garantia_producto_anios ?? null;
  const garantiaRendimiento = specs.garantia_rendimiento_anios ?? null;
  const garantiaGeneral = specs.garantia_anios ?? (producto.garantia_meses ? +(producto.garantia_meses / 12).toFixed(1) : null);

  return `
  <div class="prem-ficha-producto">
    <div class="prem-ficha-etiqueta">${_escaparHtml(tipoEtiqueta)}</div>
    <div class="prem-ficha-marca">${_escaparHtml(producto.marca || '')}</div>
    <div class="prem-ficha-modelo">${_escaparHtml(producto.modelo || 'según ficha técnica')}</div>
    <table class="prem-ficha-tabla">
      ${specs.potencia_wp ? `<tr><td>Potencia</td><td>${_formatoEntero(specs.potencia_wp)} W</td></tr>` : ''}
      ${specs.potencia_ac_nominal_kw ? `<tr><td>Capacidad</td><td>${specs.potencia_ac_nominal_kw} kW</td></tr>` : ''}
      ${producto.cantidad ? `<tr><td>Cantidad</td><td>${producto.cantidad}</td></tr>` : ''}
      ${specs.tecnologia ? `<tr><td>Tecnología</td><td>${_escaparHtml(specs.tecnologia)}</td></tr>` : ''}
      ${specs.monitoreo != null ? `<tr><td>Monitoreo</td><td>${specs.monitoreo ? 'Sí' : 'No'}</td></tr>` : ''}
      <tr><td>Garantía de producto</td><td>${garantiaProducto != null ? `${garantiaProducto} años` : (garantiaGeneral != null ? `${garantiaGeneral} años` : 'Según ficha técnica/proveedor')}</td></tr>
      ${garantiaRendimiento != null ? `<tr><td>Garantía de rendimiento</td><td>${garantiaRendimiento} años</td></tr>` : ''}
    </table>
  </div>`;
}

function _premEquipos({ equiposPorTipo, paquete }) {
  const paneles = equiposPorTipo?.panel_solar || [];
  const inversores = [...(equiposPorTipo?.inversor || []), ...(equiposPorTipo?.microinversor || [])];

  // Fallback a los campos denormalizados del paquete si la cotización no trae
  // líneas ligadas a `productos` todavía (compatibilidad con paquetes viejos).
  const fichaPanel = paneles.length > 0
    ? paneles.map(p => _premFichaProducto(p, 'Panel solar')).join('')
    : (paquete?.marca_panel ? _premFichaProducto({ marca: paquete.marca_panel, modelo: paquete.modelo_panel, cantidad: paquete.cantidad_paneles, specs: { potencia_wp: paquete.potencia_panel_wp } }, 'Panel solar') : '');

  const fichaInversor = inversores.length > 0
    ? inversores.map(p => _premFichaProducto(p, p.tipo === 'microinversor' ? 'Microinversor' : 'Inversor')).join('')
    : (paquete?.marca_inversor ? _premFichaProducto({ marca: paquete.marca_inversor, modelo: paquete.modelo_inversor, cantidad: paquete.cantidad_inversores, specs: {} }, paquete.tipo_inversor === 'microinversor' ? 'Microinversor' : 'Inversor') : '');

  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(4)}</div>
    <h2>TECNOLOGÍA QUE RESPALDA TU INVERSIÓN</h2>
    <div class="prem-grid-equipos">${fichaPanel}${fichaInversor}</div>
    <h3>¿Por qué importa el equipo?</h3>
    <div class="prem-porque-importa">
      <div><strong>Eficiencia</strong><p>Más energía generada en menos espacio de techo.</p></div>
      <div><strong>Confiabilidad</strong><p>Componentes de fabricantes con trayectoria comprobada en campo.</p></div>
      <div><strong>Monitoreo</strong><p>Visibilidad de tu producción real desde tu celular.</p></div>
      <div><strong>Modularidad</strong><p>Falla de un equipo no detiene todo el sistema (según arquitectura del inversor).</p></div>
      <div><strong>Garantías</strong><p>Respaldo directo del fabricante, por escrito.</p></div>
      <div><strong>Vida útil esperada</strong><p>Diseñado para operar de forma continua por décadas.</p></div>
    </div>
  </section>`;
}

const COMPONENTE_ETIQUETA = {
  monitoreo: 'Sistema de monitoreo',
  'estructura de aluminio': 'Estructura especializada de aluminio',
  instalación: 'Instalación profesional',
  'material eléctrico': 'Material eléctrico requerido',
  'trámite ante cfe': 'Gestión/trámite de interconexión ante CFE',
};

function _premQueIncluye({ paquete, pdfConfig }) {
  const componentes = Array.isArray(paquete?.componentes_incluidos) ? paquete.componentes_incluidos : [];
  const itemsBase = ['Paneles solares', 'Microinversores/inversor'];
  const itemsComponentes = componentes.map(c => COMPONENTE_ETIQUETA[String(c).toLowerCase()] || c);
  const itemsFinal = ['Protecciones eléctricas contempladas en la propuesta', 'Configuración del sistema', 'Puesta en marcha', 'Entrega de información del sistema'];
  const checklist = [...itemsBase, ...itemsComponentes, ...itemsFinal];

  const noIncluye = pdfConfig?.consideracionesEspeciales || [
    'Adecuaciones eléctricas fuera del alcance descrito',
    'Obra civil',
    'Impermeabilización',
    'Modificaciones al centro de carga no contempladas',
    'Trabajos estructurales',
    'Distancias extraordinarias de cableado',
    'Condiciones especiales del inmueble detectadas hasta la visita técnica',
  ];

  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(5)}</div>
    <h2>UNA SOLUCIÓN COMPLETA</h2>
    <ul class="prem-checklist">
      ${checklist.map(i => `<li>${_escaparHtml(i)}</li>`).join('')}
    </ul>
    <h3>No incluye / consideraciones especiales</h3>
    <ul class="prem-checklist prem-checklist-no">
      ${noIncluye.map(i => `<li>${_escaparHtml(i)}</li>`).join('')}
    </ul>
  </section>`;
}

function _premInversion({ cotizacion, resultados, calculoDatosEntrada }) {
  const subtotal = cotizacion.subtotal ?? null;
  const descuento = cotizacion.descuento_monto ?? (cotizacion.descuento_pct && subtotal != null ? subtotal * (cotizacion.descuento_pct / 100) : null);
  const iva = cotizacion.iva ?? null;
  const total = cotizacion.total ?? null;

  const pagoActual = calculoDatosEntrada?.importePromedioRecibo ?? null;
  const ahorroMensual = (resultados?.ahorro && !resultados.ahorro.incompleto) ? resultados.ahorro.ahorroMensualEstimado : null;
  const ahorroAnual = (resultados?.ahorro && !resultados.ahorro.incompleto) ? resultados.ahorro.ahorroAnualEstimado : null;
  const pagoEstimadoDespues = (pagoActual != null && ahorroMensual != null) ? Math.max(0, pagoActual - ahorroMensual) : null;
  const acumulado = (resultados?.ahorro_acumulado && !resultados.ahorro_acumulado.incompleto) ? resultados.ahorro_acumulado.porPeriodo : null;
  const retorno = (resultados?.periodo_simple_recuperacion && !resultados.periodo_simple_recuperacion.incompleto) ? resultados.periodo_simple_recuperacion.valor : null;

  // "Sin sistema vs. con sistema" acumulado — solo con datos reales (pago
  // actual real × periodos, menos el ahorro ya calculado); nunca inventa
  // incremento de tarifa (mismo criterio que calcularAhorroAcumulado()).
  let grafica = `<p class="prem-nota">Pendiente de análisis con recibo CFE.</p>`;
  if (pagoActual != null && acumulado) {
    const grupos = [5, 10, 20].filter(a => acumulado[a] != null).map(anios => {
      const sinSistema = pagoActual * 6 * anios;
      const conSistema = Math.max(0, sinSistema - acumulado[anios]);
      return { etiqueta: `${anios} años`, a: sinSistema, b: conSistema };
    });
    if (grupos.length > 0) {
      grafica = _premGraficaDosSeries({ grupos, colores: COLORES_PREMIUM_DEFAULT, serieA: 'Sin sistema solar', serieB: 'Con sistema solar', alto: 130 });
    }
  }

  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(6)}</div>
    <h2>TU INVERSIÓN</h2>
    <div class="prem-tarjeta-inversion">
      <div class="prem-inv-fila"><span>Inversión total</span><strong>${_valorOPendiente(subtotal, _formatoMoneda)}</strong></div>
      ${descuento ? `<div class="prem-inv-fila prem-inv-descuento"><span>Descuento</span><strong>-${_formatoMoneda(descuento)}</strong></div>` : ''}
      <div class="prem-inv-fila"><span>IVA</span><strong>${iva != null ? _formatoMoneda(iva) : 'Se agrega por separado'}</strong></div>
      <div class="prem-inv-fila prem-inv-total"><span>Total</span><strong>${_valorOPendiente(total, _formatoMoneda)}</strong></div>
    </div>
    <h3>Impacto económico estimado</h3>
    <div class="prem-datos-consumo prem-datos-consumo-3">
      <div><span>Pago CFE actual promedio</span><strong>${_valorOPendiente(pagoActual, _formatoMonedaEntera)}</strong></div>
      <div><span>Pago estimado después del sistema</span><strong>${_valorOPendiente(pagoEstimadoDespues, _formatoMonedaEntera)}</strong></div>
      <div><span>Ahorro estimado por bimestre</span><strong>${_valorOPendiente(ahorroMensual != null ? ahorroMensual * 2 : null, _formatoMonedaEntera)}</strong></div>
    </div>
    <div class="prem-datos-consumo prem-datos-consumo-3">
      <div><span>Ahorro anual estimado</span><strong>${_valorOPendiente(ahorroAnual, _formatoMonedaEntera)}</strong></div>
      <div><span>Ahorro acumulado 5 años</span><strong>${acumulado?.[5] != null ? _formatoMonedaEntera(acumulado[5]) : '<span class="valor-pendiente">Pendiente de análisis con recibo CFE</span>'}</strong></div>
      <div><span>Ahorro acumulado 10 años</span><strong>${acumulado?.[10] != null ? _formatoMonedaEntera(acumulado[10]) : '<span class="valor-pendiente">Pendiente de análisis con recibo CFE</span>'}</strong></div>
    </div>
    <div class="prem-retorno-linea">
      <span>Retorno simple estimado</span>
      <strong>${retorno != null ? `${retorno.toFixed(1)} años` : 'Pendiente de análisis con recibo CFE'}</strong>
    </div>
    <h3>Sin sistema solar vs. con sistema solar</h3>
    ${grafica}
  </section>`;
}

function _premGarantias({ equiposPorTipo, paquete, pdfConfig, whatsappEmpresa, empresa }) {
  const panel = (equiposPorTipo?.panel_solar || [])[0];
  const inversor = (equiposPorTipo?.inversor || equiposPorTipo?.microinversor || [])[0];
  const gPaquete = paquete?.garantias || {};

  const garantiaProductoPanel = panel?.specs?.garantia_producto_anios ?? gPaquete.panel?.producto_anios ?? null;
  const garantiaRendimientoPanel = panel?.specs?.garantia_rendimiento_anios ?? gPaquete.panel?.rendimiento_anios ?? null;
  const garantiaInversor = inversor?.specs?.garantia_anios ?? gPaquete.inversor?.garantia_anios ?? (inversor?.garantia_meses ? +(inversor.garantia_meses / 12).toFixed(1) : null);
  const garantiaInstalacionNort = pdfConfig?.garantiaInstalacionAnios ?? gPaquete.instalacion_anios ?? null;

  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(7)}</div>
    <h2>TU INVERSIÓN ESTÁ RESPALDADA</h2>
    <div class="prem-grid-garantias">
      <div class="prem-garantia-bloque">
        <div class="prem-garantia-titulo">Garantía del panel <span class="prem-tag-fabricante">Fabricante</span></div>
        <div>Producto: <strong>${garantiaProductoPanel != null ? `${garantiaProductoPanel} años` : 'Según ficha técnica/proveedor'}</strong></div>
        <div>Rendimiento: <strong>${garantiaRendimientoPanel != null ? `${garantiaRendimientoPanel} años` : 'Según ficha técnica/proveedor'}</strong></div>
      </div>
      <div class="prem-garantia-bloque">
        <div class="prem-garantia-titulo">Garantía del inversor / microinversor <span class="prem-tag-fabricante">Fabricante</span></div>
        <div><strong>${garantiaInversor != null ? `${garantiaInversor} años` : 'Según ficha técnica/proveedor'}</strong></div>
      </div>
      <div class="prem-garantia-bloque prem-garantia-nort">
        <div class="prem-garantia-titulo">Garantía de instalación <span class="prem-tag-nort">Nort Energy</span></div>
        <div><strong>${garantiaInstalacionNort != null ? `${garantiaInstalacionNort} años` : 'Consulta con tu asesor'}</strong></div>
      </div>
      <div class="prem-garantia-bloque">
        <div class="prem-garantia-titulo">Monitoreo</div>
        <div>Supervisión de generación disponible según equipo instalado.</div>
      </div>
    </div>
    <h3>¿Qué pasa después de instalar?</h3>
    <ol class="prem-timeline-simple">
      <li>Instalación</li>
      <li>Puesta en marcha</li>
      <li>Gestión documental / interconexión CFE</li>
      <li>Activación de monitoreo</li>
      <li>Entrega</li>
      <li>Garantía y soporte</li>
    </ol>
    <p class="prem-nota-marco">Soporte: ${whatsappEmpresa ? _escaparHtml(whatsappEmpresa) : ''}${empresa?.correo_contacto ? ` · ${_escaparHtml(empresa.correo_contacto)}` : ''}</p>
  </section>`;
}

function _premProceso({ pdfConfig }) {
  const pasos = pdfConfig?.procesoInstalacion || [
    'Aceptación de propuesta', 'Anticipo', 'Validación técnica / visita', 'Ingeniería final',
    'Instalación', 'Puesta en operación', 'Proceso CFE cuando corresponda', 'Monitoreo y soporte',
  ];
  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(8)}</div>
    <h2>DE LA COTIZACIÓN A TU PROPIA ENERGÍA</h2>
    <div class="prem-timeline">
      ${pasos.map((p, i) => `<div class="prem-timeline-item"><span class="prem-timeline-num">${String(i + 1).padStart(2, '0')}</span><span>${_escaparHtml(p)}</span></div>`).join('')}
    </div>
  </section>`;
}

function _premCondicionesComerciales({ cotizacion, pdfConfig }) {
  const total = cotizacion.total ?? null;
  const anticipoPct = cotizacion.anticipo_pct ?? null;
  const anticipoMonto = (total != null && anticipoPct != null) ? total * (anticipoPct / 100) : null;
  const saldoMonto = (total != null && anticipoMonto != null) ? total - anticipoMonto : null;

  return `
  <section class="pagina prem-seccion">
    <div class="prem-num-pagina">${_pgNum(9)}</div>
    <h2>CONDICIONES COMERCIALES</h2>
    <div class="prem-datos-consumo">
      <div><span>Forma de pago</span><strong>${_escaparHtml(cotizacion.forma_pago || 'A definir con tu asesor')}</strong></div>
      <div><span>Anticipo</span><strong>${anticipoPct != null ? `${anticipoPct}%${anticipoMonto != null ? ` (${_formatoMoneda(anticipoMonto)})` : ''}` : 'A definir con tu asesor'}</strong></div>
      <div><span>Saldo</span><strong>${saldoMonto != null ? _formatoMoneda(saldoMonto) : 'A definir con tu asesor'}</strong></div>
      <div><span>Vigencia</span><strong>${cotizacion.vigencia_dias ? `${cotizacion.vigencia_dias} días` : 'A definir con tu asesor'}</strong></div>
      <div><span>Tiempo estimado de instalación</span><strong>${_escaparHtml(pdfConfig?.tiempoEstimadoInstalacion || 'A confirmar con tu asesor')}</strong></div>
      <div><span>IVA</span><strong>${_escaparHtml(pdfConfig?.notaIva || 'Ver detalle en Tu Inversión')}</strong></div>
    </div>
    <h3>Condiciones de interconexión</h3>
    <p class="prem-nota">${_escaparHtml(pdfConfig?.condicionesInterconexion || 'Sujetas al proceso vigente de la Comisión Federal de Electricidad (CFE) para el punto de interconexión del inmueble.')}</p>
    ${cotizacion.condiciones_comerciales ? `<h3>Observaciones</h3><p class="prem-nota">${_escaparHtml(cotizacion.condiciones_comerciales)}</p>` : ''}
    <p class="prem-disclaimer">Las estimaciones de producción y ahorro son proyecciones basadas en la información disponible al momento de elaborar esta propuesta y pueden variar por condiciones climatológicas, características del inmueble, hábitos de consumo, modificaciones tarifarias y condiciones de operación.</p>
  </section>`;
}

function _premCierre({ empresa, sucursales, asesorNombre, whatsappEmpresa }) {
  return `
  <section class="pagina prem-seccion prem-cierre">
    <div class="prem-num-pagina">${_pgNum(10)}</div>
    <h2>EMPIEZA A PRODUCIR TU PROPIA ENERGÍA</h2>
    <p class="prem-cierre-texto">${_escaparHtml(empresa?.nombre)} diseña sistemas fotovoltaicos pensando en rendimiento, seguridad y rentabilidad. Nuestro objetivo no es instalar más paneles, sino diseñar el sistema adecuado para tu consumo.</p>
    <div class="prem-contacto-grid">
      <div><span>Asesor</span><strong>${_escaparHtml(asesorNombre || 'Nuestro equipo')}</strong></div>
      ${whatsappEmpresa ? `<div><span>WhatsApp</span><strong>${_escaparHtml(whatsappEmpresa)}</strong></div>` : ''}
      ${empresa?.correo_contacto ? `<div><span>Correo</span><strong>${_escaparHtml(empresa.correo_contacto)}</strong></div>` : ''}
      ${empresa?.sitio_web ? `<div><span>Web</span><strong>${_escaparHtml(empresa.sitio_web)}</strong></div>` : ''}
    </div>
    ${sucursales && sucursales.length > 0 ? `
    <div class="prem-sucursales">
      ${sucursales.map(s => `<div><strong>${_escaparHtml(s.nombre)}</strong>${s.direccion ? `<br>${_escaparHtml(s.direccion)}` : ''}</div>`).join('')}
    </div>` : ''}
    <div class="prem-firma">
      <h3>Aceptación de propuesta</h3>
      <div class="prem-firma-lineas">
        <div>Nombre: <span class="prem-linea"></span></div>
        <div>Firma: <span class="prem-linea"></span></div>
        <div>Fecha: <span class="prem-linea"></span></div>
      </div>
    </div>
  </section>`;
}

function _premAnexos({ equiposPorTipo }) {
  const conFicha = [
    ...(equiposPorTipo?.panel_solar || []),
    ...(equiposPorTipo?.inversor || []),
    ...(equiposPorTipo?.microinversor || []),
  ].filter(p => p.ficha_tecnica_url);

  if (conFicha.length === 0) return '';

  return `
  <section class="pagina prem-seccion prem-anexos">
    <h2>ANEXOS</h2>
    <ul class="prem-checklist">
      ${conFicha.map((p, i) => `<li>Anexo ${String.fromCharCode(65 + i)} — Ficha técnica: ${_escaparHtml(p.marca)} ${_escaparHtml(p.modelo || '')} — <a href="${_escaparHtml(p.ficha_tecnica_url)}">${_escaparHtml(p.ficha_tecnica_url)}</a></li>`).join('')}
    </ul>
  </section>`;
}

function _premEstilos(colores) {
  return `
  * { box-sizing: border-box; }
  body { font-family: ${FUENTE_PREMIUM}; color: ${colores.texto}; margin: 0; padding: 0; font-size: 11.5px; background: ${colores.papel}; }
  .pagina { padding: 26px 46px; page-break-after: always; }
  .pagina:last-child { page-break-after: auto; }
  h2 { font-size: 19px; font-weight: 700; color: ${colores.azul}; letter-spacing: .01em; margin: 0 0 14px; }
  h3 { font-size: 12.5px; font-weight: 700; color: ${colores.azul}; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
  .prem-num-pagina { text-align: right; font-size: 8.5px; color: ${colores.textoSecundario}; letter-spacing: .08em; margin-bottom: 8px; }
  .valor-pendiente { color: ${colores.textoSecundario}; font-style: italic; font-weight: 400; font-size: 10px; }
  .prem-nota, .prem-nota-marco { font-size: 9.5px; color: ${colores.textoSecundario}; line-height: 1.5; }
  .prem-nota-marco { border-left: 2px solid ${colores.verde}; padding-left: 10px; margin-top: 12px; }
  .prem-disclaimer { font-size: 8.5px; color: ${colores.textoSecundario}; line-height: 1.5; margin-top: 18px; border-top: 1px solid ${colores.borde}; padding-top: 10px; }

  /* Portada — banner fotográfico con el logo sobrepuesto (no en barra aparte) */
  .prem-portada { padding: 0; }
  .prem-visual-hero-wrap { position: relative; width: 100%; height: 230px; background: ${colores.grisClaro}; }
  .prem-visual-hero { width: 100%; height: 100%; }
  .prem-visual-hero img, .prem-visual-hero svg { width: 100%; height: 100%; object-fit: cover; display: block; }
  .prem-logo-chip {
    position: absolute; top: 20px; left: 26px;
    background: rgba(255,255,255,.97);
    border-radius: 8px;
    padding: 9px 16px;
    box-shadow: 0 4px 18px rgba(8,19,38,.28);
    display: inline-flex; align-items: center;
  }
  .prem-logo-chip img { height: 32px; max-width: 190px; object-fit: contain; display: block; }
  .prem-logo-chip-texto { font-size: 14px; font-weight: 800; color: ${colores.azul}; }
  .prem-titulo-bloque { padding: 20px 46px 0; }
  .prem-titulo-bloque h1 { font-size: 26px; font-weight: 800; color: ${colores.azul}; margin: 0 0 6px; letter-spacing: -0.01em; }
  .prem-subtitulo { font-size: 12.5px; color: ${colores.textoSecundario}; margin: 0 0 18px; }
  .prem-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; padding: 0 46px 18px; border-bottom: 1px solid ${colores.borde}; margin: 0 46px 18px; }
  .prem-meta-grid div { display: flex; justify-content: space-between; border-bottom: 1px dotted ${colores.borde}; padding-bottom: 3px; }
  .prem-meta-grid span { font-size: 9.5px; color: ${colores.textoSecundario}; text-transform: uppercase; letter-spacing: .03em; }
  .prem-meta-grid strong { font-size: 10.5px; font-weight: 600; color: ${colores.texto}; text-align: right; }
  .prem-tarjeta-sistema { margin: 0 46px; background: ${colores.azul}; color: #fff; border-radius: 8px; padding: 18px 22px; border-top: 3px solid ${colores.amarillo}; }
  .prem-tarjeta-titulo { font-size: 9.5px; text-transform: uppercase; letter-spacing: .1em; opacity: .75; margin-bottom: 10px; }
  .prem-tarjeta-filas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; font-size: 12px; }
  .prem-tarjeta-filas strong { color: ${colores.verdeClaro}; font-size: 15px; }

  /* Secciones genéricas */
  .prem-datos-consumo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 28px; background: ${colores.grisClaro}; border-radius: 8px; padding: 16px 20px; }
  .prem-datos-consumo-3 { grid-template-columns: 1fr 1fr 1fr; }
  .prem-datos-consumo div { display: flex; flex-direction: column; gap: 2px; }
  .prem-datos-consumo span { font-size: 9px; text-transform: uppercase; letter-spacing: .03em; color: ${colores.textoSecundario}; }
  .prem-datos-consumo strong { font-size: 14px; font-weight: 700; color: ${colores.azul}; }

  .grafica-svg { width: 100%; height: auto; display: block; }
  .grafica-con-leyenda { margin-top: 4px; }
  .leyenda-grafica { display: flex; gap: 18px; justify-content: center; margin-top: 4px; font-size: 9px; color: ${colores.textoSecundario}; }
  .leyenda-grafica span { display: flex; align-items: center; gap: 5px; }
  .leyenda-grafica i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

  /* Sistema recomendado — indicadores */
  .prem-indicadores-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
  .prem-indicadores-4 div { background: ${colores.papel}; border: 1px solid ${colores.borde}; border-top: 3px solid ${colores.verde}; border-radius: 6px; padding: 12px; }
  .prem-indicadores-4 span { display: block; font-size: 8.5px; text-transform: uppercase; color: ${colores.textoSecundario}; letter-spacing: .03em; margin-bottom: 4px; }
  .prem-indicadores-4 strong { font-size: 17px; color: ${colores.azul}; font-weight: 800; }

  /* Equipos */
  .prem-grid-equipos { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .prem-ficha-producto { border: 1px solid ${colores.borde}; border-radius: 8px; padding: 14px 16px; }
  .prem-ficha-etiqueta { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: ${colores.verde}; font-weight: 700; margin-bottom: 4px; }
  .prem-ficha-marca { font-size: 15px; font-weight: 800; color: ${colores.azul}; }
  .prem-ficha-modelo { font-size: 10.5px; color: ${colores.textoSecundario}; margin-bottom: 8px; }
  .prem-ficha-tabla { width: 100%; border-collapse: collapse; font-size: 10px; }
  .prem-ficha-tabla td { padding: 3px 0; border-top: 1px solid ${colores.borde}; }
  .prem-ficha-tabla td:first-child { color: ${colores.textoSecundario}; }
  .prem-ficha-tabla td:last-child { text-align: right; font-weight: 600; }
  .prem-porque-importa { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 18px; }
  .prem-porque-importa strong { font-size: 10.5px; color: ${colores.azul}; }
  .prem-porque-importa p { font-size: 9px; color: ${colores.textoSecundario}; margin: 3px 0 0; line-height: 1.4; }

  /* Checklist */
  .prem-checklist { list-style: none; padding: 0; margin: 0 0 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; }
  .prem-checklist li { font-size: 10.5px; padding-left: 18px; position: relative; }
  .prem-checklist li::before { content: '✓'; position: absolute; left: 0; color: ${colores.verde}; font-weight: 700; }
  .prem-checklist-no li::before { content: '—'; color: ${colores.textoSecundario}; }
  .prem-checklist-no li { color: ${colores.textoSecundario}; }

  /* Inversión */
  .prem-tarjeta-inversion { background: ${colores.azul}; color: #fff; border-radius: 8px; padding: 18px 22px; border-top: 3px solid ${colores.amarillo}; margin-bottom: 6px; }
  .prem-inv-fila { display: flex; justify-content: space-between; padding: 5px 0; font-size: 11.5px; border-bottom: 1px solid rgba(255,255,255,.15); }
  .prem-inv-fila span { opacity: .8; }
  .prem-inv-descuento strong { color: ${colores.verdeClaro}; }
  .prem-inv-total { border-bottom: none; padding-top: 8px; }
  .prem-inv-total strong { font-size: 22px; color: ${colores.verdeClaro}; }
  .prem-retorno-linea { display: flex; justify-content: space-between; align-items: center; background: ${colores.grisClaro}; border-radius: 6px; padding: 10px 16px; margin-top: 10px; }
  .prem-retorno-linea span { font-size: 10px; text-transform: uppercase; color: ${colores.textoSecundario}; }
  .prem-retorno-linea strong { font-size: 15px; color: ${colores.azul}; }

  /* Garantías */
  .prem-grid-garantias { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .prem-garantia-bloque { border: 1px solid ${colores.borde}; border-radius: 8px; padding: 12px 14px; font-size: 10.5px; }
  .prem-garantia-bloque div { margin-top: 4px; }
  .prem-garantia-titulo { font-size: 11px; font-weight: 700; color: ${colores.azul}; display: flex; align-items: center; gap: 6px; }
  .prem-garantia-nort { border-color: ${colores.verde}; }
  .prem-tag-fabricante, .prem-tag-nort { font-size: 7.5px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px; border-radius: 3px; font-weight: 600; }
  .prem-tag-fabricante { background: ${colores.grisClaro}; color: ${colores.textoSecundario}; }
  .prem-tag-nort { background: ${colores.verde}; color: #fff; }
  .prem-timeline-simple { padding-left: 18px; font-size: 10.5px; }
  .prem-timeline-simple li { padding: 3px 0; }

  /* Proceso */
  .prem-timeline { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
  .prem-timeline-item { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid ${colores.borde}; padding-bottom: 8px; }
  .prem-timeline-num { font-size: 15px; font-weight: 800; color: ${colores.amarilloOscuro}; min-width: 26px; }

  /* Cierre */
  .prem-cierre-texto { font-size: 12.5px; line-height: 1.6; color: ${colores.texto}; max-width: 520px; margin-bottom: 22px; }
  .prem-contacto-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 16px; }
  .prem-contacto-grid span { display: block; font-size: 9px; text-transform: uppercase; color: ${colores.textoSecundario}; }
  .prem-contacto-grid strong { font-size: 11px; }
  .prem-sucursales { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 9.5px; color: ${colores.textoSecundario}; margin-bottom: 24px; border-top: 1px solid ${colores.borde}; padding-top: 12px; }
  .prem-firma { border-top: 2px solid ${colores.azul}; padding-top: 14px; }
  .prem-firma-lineas { display: flex; flex-direction: column; gap: 18px; margin-top: 10px; font-size: 10.5px; }
  .prem-linea { display: inline-block; border-bottom: 1px solid ${colores.texto}; width: 260px; margin-left: 8px; }

  @media print {
    .prem-ficha-producto, .prem-garantia-bloque, .prem-timeline-item { break-inside: avoid; }
  }
  `;
}

function _construirHtmlPremiumCorporativo({
  cotizacion, cliente, empresa, paquete, pdfConfig, calculoDatosEntrada,
  asesorNombre, whatsappEmpresa, imagenHero, equiposPorTipo, sucursales, resultados,
}) {
  const colores = COLORES_PREMIUM_DEFAULT;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>${_premEstilos(colores)}</style>
</head>
<body>
  ${_premPortada({ cotizacion, cliente, empresa, pdfConfig, colores, imagenHero, resultados })}
  ${_premConsumoActual({ calculoDatosEntrada, resultados, cliente })}
  ${_premSistemaRecomendado({ resultados })}
  ${_premEquipos({ equiposPorTipo, paquete })}
  ${_premQueIncluye({ paquete, pdfConfig })}
  ${_premInversion({ cotizacion, resultados, calculoDatosEntrada })}
  ${_premGarantias({ equiposPorTipo, paquete, pdfConfig, whatsappEmpresa, empresa })}
  ${_premProceso({ pdfConfig })}
  ${_premCondicionesComerciales({ cotizacion, pdfConfig })}
  ${_premCierre({ empresa, sucursales, asesorNombre, whatsappEmpresa })}
  ${_premAnexos({ equiposPorTipo })}
</body>
</html>`;
}

// ═════════════════════════════════════════════════════════════════════════
// ── Dispatcher + recolección de datos + generación (compartido) ───────────
// ═════════════════════════════════════════════════════════════════════════

/**
 * Arma el HTML del PDF comercial — función pura, testable sin Puppeteer ni
 * DB. Despacha por `pdfConfig.plantilla_visual` — ver cabecera del módulo.
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
 * @param {Object} [datos.resultados] - `calculos_ingenieria.resultados` completos (solo usados por premium_corporativo)
 * @param {Object} [datos.equiposPorTipo] - productos reales de la cotización, agrupados por `tipo` (solo premium_corporativo)
 * @param {Array} [datos.sucursales] - sucursales activas de la empresa (solo premium_corporativo)
 * @param {string} [datos.asesorNombre]
 * @param {string} [datos.whatsappEmpresa]
 * @param {string} [datos.qrDataUri]
 * @param {string} [datos.imagenHero] - ya resuelta en cascada (Nivel 1/2), null si Nivel 3
 * @returns {string} HTML completo
 */
function construirHtmlCotizacion(datos) {
  if (datos.pdfConfig?.plantilla_visual === 'premium_corporativo') {
    return _construirHtmlPremiumCorporativo(datos);
  }
  return _construirHtmlEditorialCompacto(datos);
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
    supabase.from('clientes').select('nombre, empresa, direccion, colonia, municipio, entidad, numero_servicio_cfe, tarifa_cfe').eq('id', cotizacion.cliente_id).maybeSingle(),
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

  // Solo se resuelve lo extra de premium_corporativo si la empresa lo usa —
  // cero costo/consulta adicional para el resto de las empresas.
  let equiposPorTipo = null;
  let sucursales = null;
  if (pdfConfig?.plantilla_visual === 'premium_corporativo') {
    const productoIds = [...new Set((lineas || []).map(l => l.producto_id).filter(Boolean))];
    const [{ data: productos }, { data: sucs }] = await Promise.all([
      productoIds.length > 0
        ? supabase.from('productos').select('*').in('id', productoIds)
        : Promise.resolve({ data: [] }),
      supabase.from('sucursales').select('nombre, direccion').eq('company_id', cotizacion.company_id).eq('activo', true),
    ]);
    equiposPorTipo = {};
    for (const p of productos || []) {
      const cantidadLinea = (lineas || []).find(l => l.producto_id === p.id)?.cantidad;
      (equiposPorTipo[p.tipo] = equiposPorTipo[p.tipo] || []).push({ ...p, cantidad: cantidadLinea });
    }
    sucursales = sucs || [];
  }

  return {
    cotizacion, lineas, cliente, empresa, paquete, resumenEjecutivo, pdfConfig,
    calculoDatosEntrada: calculo?.datos_entrada, resultados: calculo?.resultados,
    asesorNombre: asesor?.nombre, whatsappEmpresa, qrDataUri, imagenHero,
    equiposPorTipo, sucursales,
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
  COLORES_PREMIUM_DEFAULT,
};
