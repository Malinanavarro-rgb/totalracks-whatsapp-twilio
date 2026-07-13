/**
 * TARA Matrix™ — MetaCloudWhatsAppAdapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Implementación de ChannelAdapter para WhatsApp vía Meta Cloud API (WhatsApp
 * Business Platform directo — no Twilio).
 *
 * Modelo "Tech Provider" de Meta: una sola Meta App de TARA (app_id/app_secret/
 * verify_token a nivel plataforma, variables de entorno) — cada empresa
 * conecta su propio WABA/número/token a esa misma app. Por eso esta clase
 * SÍ necesita credenciales por instancia (phoneNumberId/accessToken) para
 * enviar mensajes — a diferencia de Twilio (una sola cuenta compartida para
 * toda la plataforma), aquí cada empresa tiene su propio token. Resolver la
 * instancia correcta por empresa es responsabilidad de modules/meta-auth.js
 * (mismo patrón que modules/google-auth.js para Google Calendar).
 *
 * parseIncoming/validateSignature/verificarWebhook NO requieren credenciales
 * de empresa — solo usan META_APP_SECRET/META_VERIFY_TOKEN (plataforma) — por
 * lo que pueden llamarse en una instancia sin credenciales.
 *
 * Diferencias clave frente a Twilio (ver ADR-007):
 *   - No hay respuesta síncrona dentro del webhook (sin TwiML) — toda
 *     respuesta es una llamada API explícita (enviarMensaje).
 *   - La firma se calcula sobre el body CRUDO (X-Hub-Signature-256,
 *     HMAC-SHA256 con META_APP_SECRET) — requiere que el caller capture
 *     `request.rawBody` (ver server.js, ruta /webhook/meta).
 *   - Exige un handshake GET de verificación (hub.challenge) que Twilio no
 *     tiene — ver verificarWebhook().
 *   - parseIncoming() puede devolver `null` si el evento es solo un estado de
 *     entrega (delivered/read/failed), sin mensaje de usuario que procesar —
 *     el caller debe manejar ese caso (ver server.js).
 *
 * Variables de entorno requeridas (a nivel plataforma, no por empresa):
 *   META_APP_SECRET          — para validar la firma del webhook
 *   META_VERIFY_TOKEN        — para el handshake GET de verificación
 *   META_GRAPH_API_VERSION   — ej. 'v19.0' (default si no se define)
 *
 * @module adapters/channels/meta-cloud-whatsapp
 */

'use strict';

const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { ChannelAdapter } = require('./channel-adapter');

class MetaCloudWhatsAppAdapter extends ChannelAdapter {
  /**
   * @param {Object} [credenciales]
   * @param {string} [credenciales.phoneNumberId] - requerido solo para enviarMensaje()/sendProactive()
   * @param {string} [credenciales.accessToken]   - requerido solo para enviarMensaje()/sendProactive()
   */
  constructor({ phoneNumberId, accessToken } = {}) {
    super();
    this._phoneNumberId = phoneNumberId;
    this._accessToken = accessToken;
  }

  get canal() {
    return 'whatsapp';
  }

  /**
   * Parsea el payload de Meta y devuelve un Message universal, o `null` si
   * el evento no trae un mensaje de usuario (ej. solo un status callback
   * delivered/read/failed — Meta los manda por el mismo webhook).
   *
   * Simplificación deliberada (MVP): toma solo el primer mensaje de la
   * primera entrada/cambio. Meta permite lotes con varios mensajes en un
   * mismo payload, pero en la práctica casi siempre llega uno — se
   * documenta como limitación conocida, no como bug.
   *
   * @param {import('express').Request} req
   * @returns {import('./channel-adapter').Message|null}
   */
  parseIncoming(req) {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const mensajeRaw = value?.messages?.[0];
    if (!mensajeRaw) return null; // solo statuses[] (delivered/read/failed) — nada que procesar

    let content = '';
    if (mensajeRaw.type === 'text') {
      content = mensajeRaw.text?.body || '';
    } else if (mensajeRaw.type === 'interactive') {
      // Botones/listas — el Core recibe el texto de la opción elegida, igual
      // que si el usuario lo hubiera escrito. Sin lógica nueva en WorkflowEngine.
      content = mensajeRaw.interactive?.button_reply?.title
        || mensajeRaw.interactive?.list_reply?.title
        || '';
    }

    return {
      id:                randomUUID(),
      company_id:        null, // el Channel Router lo asigna en server.js
      channel:           this.canal,
      // Meta manda `from` en E.164 SIN "+" (solo dígitos) — Twilio lo manda
      // con "+" (tras quitarle el prefijo "whatsapp:"). Normalizamos aquí
      // para que ambos proveedores guarden/busquen clientes con el mismo
      // formato — de lo contrario el mismo cliente físico crearía dos filas
      // distintas en `clientes` según por cuál canal escriba primero
      // (modules/crm.js::obtenerOCrearCliente compara `telefono` con
      // igualdad exacta de string).
      from:              mensajeRaw.from.startsWith('+') ? mensajeRaw.from : `+${mensajeRaw.from}`,
      incoming_endpoint: value.metadata?.phone_number_id || null, // clave de routing
      content:           content.trim(),
      timestamp:         new Date(),
      raw_metadata: {
        // MessageSid: mismo nombre de campo que usa TwilioWhatsAppAdapter —
        // preserva el contrato ya consumido por orchestrator.js (decisión
        // documentada en ADR-007), sin renombrar nada en el Core.
        MessageSid:  mensajeRaw.id || null,
        tipo:        mensajeRaw.type,
        ProfileName: value.contacts?.[0]?.profile?.name || null,
      },
    };
  }

  /**
   * Meta no soporta responder síncronamente dentro del webhook (sin TwiML
   * ni equivalente) — toda respuesta real se envía con enviarMensaje().
   * Se documenta el porqué en vez de fingir soporte.
   */
  formatOutgoing(_text, _originalMessage) {
    throw new Error('MetaCloudWhatsAppAdapter no soporta formatOutgoing() — usa enviarMensaje()');
  }

  /**
   * Valida X-Hub-Signature-256 (HMAC-SHA256 sobre el body crudo, con
   * META_APP_SECRET). Requiere que el caller haya capturado `req.rawBody`
   * (Buffer) — ver server.js, ruta /webhook/meta con express.json({verify}).
   *
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  validateSignature(req) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return false;

    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      console.warn('⚠️  META_APP_SECRET no definida — validación de firma omitida');
      return true;
    }

    const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.alloc(0)).digest('hex');

    const bufFirma     = Buffer.from(signature);
    const bufEsperado  = Buffer.from(esperado);
    if (bufFirma.length !== bufEsperado.length) return false;

    return crypto.timingSafeEqual(bufFirma, bufEsperado);
  }

  /**
   * Handshake de verificación GET que Meta exige una sola vez al registrar
   * el webhook (hub.mode/hub.verify_token/hub.challenge). Twilio no tiene
   * equivalente — por eso el default en ChannelAdapter es no-op.
   *
   * @param {import('express').Request} req
   * @returns {string|null} el valor de hub.challenge a devolver, o null si no coincide
   */
  verificarWebhook(req) {
    const modo      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (modo === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  }

  /**
   * Envía un mensaje de texto vía Graph API — requiere credenciales de la
   * empresa (phoneNumberId/accessToken), resueltas por
   * modules/meta-auth.js::obtenerAdapterMetaParaEmpresa().
   *
   * @param {string} destinatario - Número de teléfono destino (formato interno
   *                                de TARA, con "+" — ver parseIncoming())
   * @param {string} texto        - Respuesta de TARA
   * @returns {Promise<void>}
   */
  async enviarMensaje(destinatario, texto) {
    if (!this._phoneNumberId || !this._accessToken) {
      throw new Error('MetaCloudWhatsAppAdapter.enviarMensaje: faltan credenciales (phoneNumberId/accessToken) — resuelve la instancia vía meta-auth.js');
    }

    // Graph API exige el número SIN "+" — se le quita aquí, en el borde de
    // salida, igual que Twilio le agrega su prefijo "whatsapp:" en su propio
    // sendProactive(). El formato interno de TARA (con "+") no cambia.
    const numeroDestino = destinatario.replace(/^\+/, '');

    const version = process.env.META_GRAPH_API_VERSION || 'v19.0';
    const respuesta = await fetch(`https://graph.facebook.com/${version}/${this._phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   numeroDestino,
        type: 'text',
        text: { body: texto },
      }),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      throw new Error(`MetaCloudWhatsAppAdapter.enviarMensaje: Graph API respondió ${respuesta.status} — ${detalle}`);
    }
  }

  /**
   * Recordatorios/intervención humana — mismo mecanismo que enviarMensaje()
   * en Meta (no hay distinción proactivo/reactivo en Graph API).
   */
  async sendProactive(text, identificador) {
    return this.enviarMensaje(identificador, text);
  }
}

module.exports = { MetaCloudWhatsAppAdapter };
