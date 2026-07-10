/**
 * TARA Matrix™ — TwilioWhatsAppAdapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Implementación de ChannelAdapter para WhatsApp via Twilio.
 *
 * Responsabilidades:
 *   - Convertir webhooks de Twilio en objetos Message universales
 *   - Convertir respuestas de texto en TwiML válido
 *   - Validar firma HMAC de Twilio
 *   - Enviar mensajes proactivos (seguimientos, recordatorios)
 *
 * Variables de entorno requeridas:
 *   TWILIO_AUTH_TOKEN         — para validación de firma
 *   TWILIO_WHATSAPP_NUMBER    — número origen para mensajes proactivos
 *   WEBHOOK_URL_WHATSAPP      — URL pública del webhook (producción)
 *                               Si no está definida, validateSignature() devuelve true
 *                               (modo desarrollo — nunca desplegar sin esta variable)
 *
 * @module adapters/channels/twilio-whatsapp
 */

'use strict';

const { twiml, validateRequest } = require('twilio');
const { ChannelAdapter } = require('./channel-adapter');
const { randomUUID } = require('crypto');

class TwilioWhatsAppAdapter extends ChannelAdapter {
  /**
   * @param {import('twilio').Twilio} twilioClient - Instancia del cliente Twilio
   */
  constructor(twilioClient) {
    super();
    this._client = twilioClient;
  }

  get canal() {
    return 'whatsapp';
  }

  /**
   * Parsea el body del webhook de Twilio y devuelve un Message universal.
   * El Core nunca ve `From`, `Body`, `MessageSid` ni ningún campo de Twilio.
   *
   * @param {import('express').Request} req
   * @returns {import('./channel-adapter').Message}
   */
  parseIncoming(req) {
    const rawFrom = req.body.From || '';
    const from = rawFrom.replace('whatsapp:', '').trim();

    return {
      id:                randomUUID(),
      company_id:        null,              // el Channel Router lo asigna en server.js
      channel:           this.canal,
      from,
      incoming_endpoint: req.body.To || null, // número receptor — identifica la empresa
      content:           (req.body.Body || '').trim(),
      timestamp:         new Date(),
      raw_metadata: {
        MessageSid:  req.body.MessageSid  || null,
        NumMedia:    req.body.NumMedia    || '0',
        ProfileName: req.body.ProfileName || null,
        WaId:        req.body.WaId        || null,
      },
    };
  }

  /**
   * Convierte la respuesta de texto en TwiML para Twilio.
   * Twilio escapa automáticamente caracteres especiales en el XML.
   *
   * @param {string} text
   * @param {import('./channel-adapter').Message} _originalMessage - no usado en este canal
   * @returns {string} TwiML XML
   */
  formatOutgoing(text, _originalMessage) {
    const response = new twiml.MessagingResponse();
    response.message(text);
    return response.toString();
  }

  /**
   * Valida la firma HMAC de Twilio para verificar autenticidad del webhook.
   *
   * En desarrollo (WEBHOOK_URL_WHATSAPP no definida): devuelve true.
   * En producción: valida firma contra TWILIO_AUTH_TOKEN.
   *
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  validateSignature(req) {
    const signature = req.headers['x-twilio-signature'];
    if (!signature) return false;

    const webhookUrl = process.env.WEBHOOK_URL_WHATSAPP;
    if (!webhookUrl) {
      // Modo desarrollo: advertir pero no bloquear
      console.warn('⚠️  WEBHOOK_URL_WHATSAPP no definida — validación de firma omitida');
      return true;
    }

    return validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      webhookUrl,
      req.body
    );
  }

  /**
   * Envía un mensaje proactivo a un número de WhatsApp.
   * Se usa para seguimientos y recordatorios programados.
   *
   * @param {string} text          - Texto del mensaje
   * @param {string} identificador - Número de teléfono destino (con código de país)
   * @param {string} [from]        - Número de origen (sin "whatsapp:"). Cuando se
   *                                 envía en nombre de una empresa específica, el
   *                                 llamador debe resolverlo vía ChannelRouter
   *                                 (channel_endpoints) — nunca asumir un único
   *                                 número global. Si se omite, cae a
   *                                 TWILIO_WHATSAPP_NUMBER (compatibilidad).
   * @returns {Promise<void>}
   */
  async sendProactive(text, identificador, from) {
    // Bug real encontrado en producción: TWILIO_WHATSAPP_NUMBER puede venir
    // con el prefijo "whatsapp:" ya incluido (formato documentado en
    // render.yaml) — sin este strip, el "whatsapp:" se duplicaba
    // ("whatsapp:whatsapp:+..."), Twilio rechazaba el envío (21212 Invalid
    // From Number) y, al fallar antes de marcar recordatorio_enviado, el
    // cron reintentaba la misma cita indefinidamente, agotando la cuota
    // diaria de la cuenta.
    const numeroOrigen = (from || process.env.TWILIO_WHATSAPP_NUMBER || '').replace(/^whatsapp:/, '');
    if (!numeroOrigen) throw new Error('sendProactive: no hay número de origen (from) ni TWILIO_WHATSAPP_NUMBER definido');

    await this._client.messages.create({
      from: `whatsapp:${numeroOrigen}`,
      to:   `whatsapp:${identificador}`,
      body: text,
    });
  }
}

module.exports = { TwilioWhatsAppAdapter };
