/**
 * TARA Matrix™ — qr.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Genera códigos QR como data URI (PNG en base64) — 100% local, sin llamar
 * a ningún servicio externo de generación de QR. Necesario para que el PDF
 * (Puppeteer) sea autocontenido: nada que dependa de internet al momento
 * de renderizar.
 *
 * @module modules/qr
 */

'use strict';

const QRCode = require('qrcode');

/**
 * @param {string} texto - normalmente una URL (ej. link de WhatsApp)
 * @returns {Promise<string>} data URI ("data:image/png;base64,...")
 */
async function generarQrDataUri(texto) {
  return QRCode.toDataURL(texto, { margin: 1, width: 240, color: { dark: '#0b0f19', light: '#ffffff' } });
}

module.exports = { generarQrDataUri };
