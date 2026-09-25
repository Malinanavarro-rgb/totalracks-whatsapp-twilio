/**
 * TARA Matrix™ — email.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Envío de correo real vía Resend (2026-09-25) — primer y único proveedor
 * de correo del proyecto hasta hoy. `require('resend')` está adentro de la
 * función, no arriba del archivo: si falta RESEND_API_KEY el módulo entero
 * sigue cargando sin tronar (server.js puede arrancar sin correo
 * configurado), y el error real solo aparece cuando de verdad se intenta
 * enviar — mismo criterio honesto que CotizadorForm ("el cotizador todavía
 * no está configurado") en vez de fallar en silencio o simular un envío.
 *
 * @module modules/email
 */

'use strict';

const REMITENTE = process.env.RESEND_FROM || 'Nort Energy <notificaciones@nortenergy.com.mx>';

/** Envía el código de acceso del portal del cliente por correo. */
async function enviarCorreoCodigoAcceso({ destino, nombre, codigo, minutosVigencia }) {
  if (!process.env.RESEND_API_KEY) {
    const err = new Error('El envío de correo todavía no está configurado (falta RESEND_API_KEY).');
    err.status = 503;
    throw err;
  }

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const primerNombre = (nombre || '').trim().split(' ')[0] || null;
  const saludo = primerNombre ? `Hola, ${primerNombre}:` : 'Hola:';

  const { error } = await resend.emails.send({
    from: REMITENTE,
    to: destino,
    subject: `Tu código de acceso: ${codigo}`,
    text: `${saludo}\n\nTu código de acceso a tu portal Nort Energy es: ${codigo}\n\nEs válido por ${minutosVigencia} minutos. Si tú no lo pediste, ignora este correo.`,
    html: `<p>${saludo}</p><p>Tu código de acceso a tu portal Nort Energy es:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${codigo}</p><p>Es válido por ${minutosVigencia} minutos. Si tú no lo pediste, ignora este correo.</p>`,
  });

  if (error) throw new Error(`email.enviarCorreoCodigoAcceso: ${error.message || JSON.stringify(error)}`);
}

module.exports = { enviarCorreoCodigoAcceso };
