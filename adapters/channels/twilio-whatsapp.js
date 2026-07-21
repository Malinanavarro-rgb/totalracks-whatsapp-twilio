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

    // Fix real (v0.4, Inbox Inteligente): un mensaje de solo-adjunto (sin
    // texto) dejaba `content` vacío — ContextBuilder truena con "campo
    // requerido faltante — mensaje_actual" (mismo bug confirmado en Meta).
    // El Core (IA) sigue sin "ver" el archivo — sigue recibiendo este
    // placeholder como contenido — pero `media` (abajo) permite que la capa
    // de plataforma (server.js) descargue el archivo real para el Inbox.
    const numMedia = parseInt(req.body.NumMedia || '0', 10);
    const mediaUrl = req.body.MediaUrl0 || null;
    const mediaMimeType = req.body.MediaContentType0 || null;
    let content = (req.body.Body || '').trim();
    if (!content && numMedia > 0) {
      const tipo = (mediaMimeType || '').split('/')[0] || 'archivo';
      content = `[La clienta envió un(a) ${tipo} — todavía no puedo ver archivos, solo texto. Pídele que te lo describa con palabras.]`;
    }

    return {
      id:                randomUUID(),
      company_id:        null,              // el Channel Router lo asigna en server.js
      channel:           this.canal,
      from,
      incoming_endpoint: req.body.To || null, // número receptor — identifica la empresa
      content,
      media:             mediaUrl ? { url: mediaUrl, mimeType: mediaMimeType } : null,
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

  /**
   * Respuesta principal de una conversación — para Twilio es el mismo API
   * call que sendProactive() (mensaje saliente por WhatsApp), solo con
   * nombres de parámetros orientados a "responder", no "enviar seguimiento".
   * Existe para unificar el modelo con proveedores que no soportan
   * responder síncronamente dentro del webhook (ver Meta Cloud API).
   *
   * Requiere `from` explícito: a diferencia del viejo flujo por TwiML (que
   * respondía automáticamente por el mismo número al que llegó el mensaje),
   * una llamada API explícita no infiere el remitente — el llamador debe
   * resolverlo vía ChannelRouter, igual que en sendProactive().
   *
   * @param {string} destinatario - Número de teléfono destino
   * @param {string} texto        - Respuesta de TARA
   * @param {string} [from]       - Número de origen (sin "whatsapp:")
   * @returns {Promise<void>}
   */
  async enviarMensaje(destinatario, texto, from) {
    return this.sendProactive(texto, destinatario, from);
  }

  /**
   * Descarga el binario de un adjunto entrante (Inbox Inteligente v0.4).
   * Las MediaUrl de Twilio no son públicas — exigen Basic Auth con las
   * mismas credenciales de cuenta usadas para enviar mensajes — y no se
   * garantiza que vivan para siempre, por eso el caller (server.js) las
   * sube de inmediato a Supabase Storage en vez de guardar esta URL.
   *
   * @param {{url: string, mimeType?: string}} media - de parseIncoming()
   * @returns {Promise<{buffer: Buffer, mimeType: string}>}
   */
  async descargarMedia(media) {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const respuesta = await fetch(media.url, { headers: { Authorization: `Basic ${auth}` } });
    if (!respuesta.ok) {
      throw new Error(`TwilioWhatsAppAdapter.descargarMedia: ${respuesta.status} al descargar ${media.url}`);
    }
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    const mimeType = respuesta.headers.get('content-type') || media.mimeType || 'application/octet-stream';
    return { buffer, mimeType };
  }
}

module.exports = { TwilioWhatsAppAdapter };
