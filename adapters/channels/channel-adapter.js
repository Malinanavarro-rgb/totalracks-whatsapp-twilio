/**
 * TARA Matrix™ — ChannelAdapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Contrato que todo adaptador de canal debe implementar.
 *
 * El Core nunca importa implementaciones de canal específicas.
 * El Core nunca sabe si el mensaje vino de WhatsApp, Telegram o una API.
 * El Core solo recibe y devuelve objetos Message y Response.
 *
 * Para agregar un canal nuevo:
 *   1. Crear clase que extienda ChannelAdapter
 *   2. Implementar los 4 métodos obligatorios
 *   3. Registrar en ChannelRouter (FASE 2 — Orchestrator)
 *   El Core no cambia.
 *
 * @module adapters/channels/channel-adapter
 */

'use strict';

/**
 * @typedef {Object} Message
 * @property {string} id           - UUID generado por el Core (no por el canal)
 * @property {string|null} company_id - Asignado por el Orchestrator
 * @property {string} channel      - 'whatsapp'|'web'|'instagram'|'telegram'|'email'|'api'
 * @property {string} from         - Identificador genérico del emisor
 * @property {string} content      - Texto del mensaje
 * @property {Date}   timestamp    - Momento de recepción
 * @property {Object} raw_metadata - Datos del canal; el Core los ignora
 */

class ChannelAdapter {
  /**
   * Identificador del canal. Implementar como getter.
   * @returns {string}
   */
  get canal() {
    throw new Error(`${this.constructor.name} debe implementar canal`);
  }

  /**
   * Transforma el request raw del canal en un Message universal.
   * @param {Object} rawRequest - El objeto request de Express (u otro framework)
   * @returns {Message}
   */
  parseIncoming(rawRequest) {
    throw new Error(`${this.constructor.name} debe implementar parseIncoming()`);
  }

  /**
   * Transforma una respuesta de texto en el formato nativo del canal.
   * @param {string}  text            - Respuesta de TARA
   * @param {Message} originalMessage - Mensaje que originó la respuesta
   * @returns {*} - Formato específico del canal (TwiML, JSON, etc.)
   */
  formatOutgoing(text, originalMessage) {
    throw new Error(`${this.constructor.name} debe implementar formatOutgoing()`);
  }

  /**
   * Verifica la autenticidad del request (firma HMAC, token, etc.).
   * @param {Object} request - El objeto request de Express
   * @returns {boolean}
   */
  validateSignature(request) {
    throw new Error(`${this.constructor.name} debe implementar validateSignature()`);
  }

  /**
   * Envía un mensaje proactivo (para seguimientos, recordatorios, etc.).
   * Implementación opcional — no todos los canales la soportan.
   * @param {string} text           - Texto a enviar
   * @param {string} identificador  - Destino (phone, email, user_id)
   * @returns {Promise<void>}
   */
  async sendProactive(text, identificador) {
    throw new Error(`${this.constructor.name} no soporta envío proactivo`);
  }

  /**
   * Envía la respuesta principal de una conversación de forma asíncrona
   * (llamada API explícita), en vez de devolverla inline en la respuesta
   * HTTP del webhook. Necesario porque no todos los proveedores soportan
   * responder síncronamente dentro del propio webhook (ej. Meta Cloud API
   * no lo soporta; Twilio sí, vía TwiML, pero puede unificarse igual).
   * @param {string} destinatario - Identificador del destino (phone, user_id)
   * @param {string} texto        - Respuesta de TARA
   * @param {string} [from]       - Origen explícito (ej. número de la empresa),
   *                                cuando el proveedor lo requiere
   * @returns {Promise<void>}
   */
  async enviarMensaje(destinatario, texto, from) {
    throw new Error(`${this.constructor.name} debe implementar enviarMensaje()`);
  }

  /**
   * Maneja el handshake de verificación de webhook que algunos proveedores
   * exigen antes de aceptar el registro (ej. Meta Cloud API: GET con
   * hub.mode/hub.verify_token/hub.challenge). Opcional — el default no hace
   * nada, ya que Twilio (y la mayoría de proveedores) no lo necesitan.
   * @param {Object} request - El objeto request de Express
   * @returns {string|null} el valor a devolver como respuesta (ej. hub.challenge), o null si no aplica
   */
  verificarWebhook(request) {
    return null;
  }
}

module.exports = { ChannelAdapter };
