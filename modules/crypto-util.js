/**
 * TARA Matrix™ — crypto-util
 * ─────────────────────────────────────────────────────────────────────────────
 * Cifrado simétrico (AES-256-GCM) para credenciales sensibles guardadas en DB
 * (hoy: tokens OAuth de Google en `calendar_credentials.credenciales`).
 *
 * La clave maestra vive en CALENDAR_CREDENTIALS_KEY (variable de entorno en
 * Render, mismo modelo de confianza que TWILIO_AUTH_TOKEN/OPENAI_API_KEY —
 * Anexo A, sección 2.8). Nunca se guarda en el repo ni en la base de datos.
 *
 * Falla alto y claro si la clave falta o tiene el tamaño incorrecto — no hay
 * fallback silencioso posible para cifrado (Artículo P7/P8 de la Constitución).
 *
 * @module modules/crypto-util
 */

'use strict';

const crypto = require('crypto');

const ALGORITMO   = 'aes-256-gcm';
const IV_BYTES    = 12; // recomendado para GCM

function obtenerClave() {
  const hex = process.env.CALENDAR_CREDENTIALS_KEY;
  if (!hex) {
    throw new Error('crypto-util: falta CALENDAR_CREDENTIALS_KEY en las variables de entorno');
  }
  const clave = Buffer.from(hex, 'hex');
  if (clave.length !== 32) {
    throw new Error(
      `crypto-util: CALENDAR_CREDENTIALS_KEY debe ser 32 bytes en hex (64 caracteres) — tiene ${clave.length} bytes`
    );
  }
  return clave;
}

/**
 * Cifra un objeto serializable a JSON.
 * @param {Object} objetoPlano
 * @returns {{iv: string, tag: string, datos: string}} - todo en base64, listo para guardar en una columna jsonb
 */
function cifrar(objetoPlano) {
  const clave  = obtenerClave();
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITMO, clave, iv);

  const textoPlano = JSON.stringify(objetoPlano);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv:    iv.toString('base64'),
    tag:   tag.toString('base64'),
    datos: cifrado.toString('base64'),
  };
}

/**
 * Descifra un paquete producido por cifrar(). Lanza si la clave no coincide
 * o si el paquete fue manipulado (AEAD tag inválido).
 * @param {{iv: string, tag: string, datos: string}} paquete
 * @returns {Object} el objeto original
 */
function descifrar(paquete) {
  if (!paquete?.iv || !paquete?.tag || !paquete?.datos) {
    throw new Error('crypto-util.descifrar: paquete inválido — faltan iv/tag/datos');
  }

  const clave = obtenerClave();
  const iv    = Buffer.from(paquete.iv, 'base64');
  const tag   = Buffer.from(paquete.tag, 'base64');
  const datos = Buffer.from(paquete.datos, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITMO, clave, iv);
  decipher.setAuthTag(tag);

  const textoPlano = Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
  return JSON.parse(textoPlano);
}

module.exports = { cifrar, descifrar };
