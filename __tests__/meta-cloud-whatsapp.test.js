/**
 * TARA Matrix™ — Tests: MetaCloudWhatsAppAdapter
 * Cubre: parseIncoming (texto, interactivo, solo-status), validateSignature,
 * verificarWebhook, enviarMensaje, sendProactive.
 */

'use strict';

const crypto = require('crypto');
const { MetaCloudWhatsAppAdapter } = require('../adapters/channels/meta-cloud-whatsapp');

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function firmarBody(rawBody, secret = APP_SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function makeMetaRequest({ body, rawBody, signature } = {}) {
  const cuerpoJson = body ?? {};
  const buffer = rawBody ?? Buffer.from(JSON.stringify(cuerpoJson));
  return {
    body: cuerpoJson,
    rawBody: buffer,
    headers: {
      'x-hub-signature-256': signature !== undefined ? signature : firmarBody(buffer),
    },
    query: {},
  };
}

function makeEntryConMensaje(mensaje, overrides = {}) {
  return {
    entry: [{
      id: 'waba-id-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'PHONE_NUM_ID_123', display_phone_number: '+521800...' },
          contacts: [{ profile: { name: 'Carlos López' } }],
          messages: [mensaje],
          ...overrides,
        },
      }],
    }],
  };
}

function makeEntryConStatus() {
  return {
    entry: [{
      id: 'waba-id-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'PHONE_NUM_ID_123' },
          statuses: [{ id: 'wamid.abc', status: 'delivered', timestamp: '1234567890', recipient_id: '5218112345678' }],
        },
      }],
    }],
  };
}

beforeEach(() => {
  process.env.META_APP_SECRET   = APP_SECRET;
  process.env.META_VERIFY_TOKEN = VERIFY_TOKEN;
  global.fetch = jest.fn();
});

afterEach(() => {
  delete process.env.META_APP_SECRET;
  delete process.env.META_VERIFY_TOKEN;
  delete process.env.META_GRAPH_API_VERSION;
  jest.restoreAllMocks();
});

describe('MetaCloudWhatsAppAdapter', () => {
  describe('canal', () => {
    test('devuelve "whatsapp"', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      expect(adapter.canal).toBe('whatsapp');
    });
  });

  describe('parseIncoming()', () => {
    test('mensaje de texto produce un Message con estructura correcta', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.xyz', type: 'text', text: { body: 'Hola, necesito información' },
      });
      const req = makeMetaRequest({ body });

      const mensaje = adapter.parseIncoming(req);

      expect(mensaje.channel).toBe('whatsapp');
      expect(mensaje.from).toBe('+5218112345678');
      expect(mensaje.content).toBe('Hola, necesito información');
      expect(mensaje.incoming_endpoint).toBe('PHONE_NUM_ID_123');
      expect(mensaje.timestamp).toBeInstanceOf(Date);
      expect(mensaje.raw_metadata.MessageSid).toBe('wamid.xyz');
      expect(mensaje.raw_metadata.ProfileName).toBe('Carlos López');
    });

    test('mensaje interactivo (botón) usa el título de la opción elegida como content', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.btn', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'opt_1', title: 'Sí, confirmar' } },
      });
      const req = makeMetaRequest({ body });

      const mensaje = adapter.parseIncoming(req);
      expect(mensaje.content).toBe('Sí, confirmar');
    });

    test('mensaje interactivo (lista) usa el título de la opción elegida', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.list', type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'opt_2', title: 'Manicure clásico' } },
      });
      const req = makeMetaRequest({ body });

      const mensaje = adapter.parseIncoming(req);
      expect(mensaje.content).toBe('Manicure clásico');
    });

    test('imagen: content nunca queda vacío (evita el crash de ContextBuilder en producción)', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.img', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' },
      });
      const req = makeMetaRequest({ body });

      const mensaje = adapter.parseIncoming(req);
      expect(mensaje.content).not.toBe('');
      expect(mensaje.content).toContain('image');
    });

    test('imagen con caption: incluye el texto de la caption en el content', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.img2', type: 'image', image: { id: 'media-2', caption: '¿Cuánto cuesta esto?' },
      });
      const req = makeMetaRequest({ body });

      const mensaje = adapter.parseIncoming(req);
      expect(mensaje.content).toContain('¿Cuánto cuesta esto?');
    });

    test('ubicación: content nunca queda vacío', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.loc', type: 'location', location: { latitude: 25.6, longitude: -100.3 },
      });
      const req = makeMetaRequest({ body });

      const mensaje = adapter.parseIncoming(req);
      expect(mensaje.content).not.toBe('');
      expect(mensaje.content).toContain('location');
    });

    test('audio/sticker/video/documento: content nunca queda vacío para ningún tipo', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      for (const tipo of ['audio', 'video', 'document', 'sticker']) {
        const body = makeEntryConMensaje({ from: '5218112345678', id: `wamid.${tipo}`, type: tipo, [tipo]: { id: 'media-x' } });
        const mensaje = adapter.parseIncoming(makeMetaRequest({ body }));
        expect(mensaje.content).not.toBe('');
      }
    });

    test('imagen: expone media (mediaId/mimeType) para que la capa de plataforma pueda descargarla', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.img3', type: 'image', image: { id: 'media-77', mime_type: 'image/jpeg' },
      });
      const mensaje = adapter.parseIncoming(makeMetaRequest({ body }));

      expect(mensaje.media).toEqual({ mediaId: 'media-77', mimeType: 'image/jpeg' });
    });

    test('ubicación: no expone media (sin archivo descargable)', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({
        from: '5218112345678', id: 'wamid.loc2', type: 'location', location: { latitude: 25.6, longitude: -100.3 },
      });
      const mensaje = adapter.parseIncoming(makeMetaRequest({ body }));

      expect(mensaje.media).toBeNull();
    });

    test('texto: no expone media', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({ from: '521...', id: 'w1', type: 'text', text: { body: 'hola' } });
      const mensaje = adapter.parseIncoming(makeMetaRequest({ body }));

      expect(mensaje.media).toBeNull();
    });

    test('evento de solo-status (delivered/read/failed) devuelve null — nada que procesar', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const req = makeMetaRequest({ body: makeEntryConStatus() });

      expect(adapter.parseIncoming(req)).toBeNull();
    });

    test('trimea espacios en el content', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({ from: '521...', id: 'w1', type: 'text', text: { body: '  hola  ' } });
      const req = makeMetaRequest({ body });

      expect(adapter.parseIncoming(req).content).toBe('hola');
    });

    test('agrega "+" a from si Meta lo manda sin él (normaliza al mismo formato que Twilio)', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({ from: '5218112345678', id: 'w1', type: 'text', text: { body: 'hola' } });
      const req = makeMetaRequest({ body });

      expect(adapter.parseIncoming(req).from).toBe('+5218112345678');
    });

    test('no duplica el "+" si Meta ya lo manda (defensivo)', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const body = makeEntryConMensaje({ from: '+5218112345678', id: 'w1', type: 'text', text: { body: 'hola' } });
      const req = makeMetaRequest({ body });

      expect(adapter.parseIncoming(req).from).toBe('+5218112345678');
    });
  });

  describe('validateSignature()', () => {
    test('devuelve true con una firma válida', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const rawBody = Buffer.from(JSON.stringify({ hola: 'mundo' }));
      const req = makeMetaRequest({ rawBody, signature: firmarBody(rawBody) });

      expect(adapter.validateSignature(req)).toBe(true);
    });

    test('devuelve false con una firma inválida', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const rawBody = Buffer.from(JSON.stringify({ hola: 'mundo' }));
      const req = makeMetaRequest({ rawBody, signature: 'sha256=firmaincorrecta' });

      expect(adapter.validateSignature(req)).toBe(false);
    });

    test('devuelve false si no hay firma en headers', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const req = { headers: {}, rawBody: Buffer.from('{}') };

      expect(adapter.validateSignature(req)).toBe(false);
    });

    test('devuelve false si la firma fue calculada con otro secreto (payload falsificado)', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const rawBody = Buffer.from(JSON.stringify({ hola: 'mundo' }));
      const req = makeMetaRequest({ rawBody, signature: firmarBody(rawBody, 'secreto-equivocado') });

      expect(adapter.validateSignature(req)).toBe(false);
    });

    test('modo desarrollo (sin META_APP_SECRET): devuelve true con advertencia', () => {
      delete process.env.META_APP_SECRET;
      const adapter = new MetaCloudWhatsAppAdapter();
      const req = makeMetaRequest({ signature: 'cualquier-cosa' });

      expect(adapter.validateSignature(req)).toBe(true);
    });
  });

  describe('verificarWebhook()', () => {
    test('devuelve el hub.challenge si mode=subscribe y el token coincide', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const req = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc123' } };

      expect(adapter.verificarWebhook(req)).toBe('abc123');
    });

    test('devuelve null si el token no coincide', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const req = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'token-equivocado', 'hub.challenge': 'abc123' } };

      expect(adapter.verificarWebhook(req)).toBeNull();
    });

    test('devuelve null si mode no es "subscribe"', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      const req = { query: { 'hub.mode': 'otra-cosa', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc123' } };

      expect(adapter.verificarWebhook(req)).toBeNull();
    });
  });

  describe('formatOutgoing()', () => {
    test('lanza error — Meta no soporta respuesta síncrona en el webhook', () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      expect(() => adapter.formatOutgoing('hola', {})).toThrow('usa enviarMensaje()');
    });
  });

  describe('enviarMensaje()', () => {
    test('llama a Graph API con el phoneNumberId/accessToken de la instancia', async () => {
      global.fetch.mockResolvedValue({ ok: true });
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-abc' });

      await adapter.enviarMensaje('5218112345678', 'Hola, en qué te ayudo');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v19.0/PHONE_123/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
        })
      );
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '5218112345678',
        type: 'text',
        text: { body: 'Hola, en qué te ayudo' },
      });
    });

    test('usa META_GRAPH_API_VERSION si está definida', async () => {
      process.env.META_GRAPH_API_VERSION = 'v20.0';
      global.fetch.mockResolvedValue({ ok: true });
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-abc' });

      await adapter.enviarMensaje('5218112345678', 'Hola');

      expect(global.fetch).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/PHONE_123/messages', expect.anything());
    });

    test('lanza error si faltan credenciales de la instancia', async () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      await expect(adapter.enviarMensaje('5218112345678', 'Hola')).rejects.toThrow('faltan credenciales');
    });

    test('lanza error legible si Graph API responde con error', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => '{"error":"invalid token"}' });
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-malo' });

      await expect(adapter.enviarMensaje('5218112345678', 'Hola')).rejects.toThrow('Graph API respondió 401');
    });

    test('quita el "+" del destinatario antes de llamar a Graph API (Meta lo exige sin "+")', async () => {
      global.fetch.mockResolvedValue({ ok: true });
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-abc' });

      await adapter.enviarMensaje('+5218112345678', 'Hola');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.to).toBe('5218112345678');
    });
  });

  describe('sendProactive()', () => {
    test('delega en enviarMensaje() (Meta no distingue proactivo/reactivo)', async () => {
      global.fetch.mockResolvedValue({ ok: true });
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-abc' });

      await adapter.sendProactive('Recordatorio de cita', '5218112345678');

      expect(global.fetch).toHaveBeenCalledWith('https://graph.facebook.com/v19.0/PHONE_123/messages', expect.anything());
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.to).toBe('5218112345678');
      expect(body.text.body).toBe('Recordatorio de cita');
    });
  });

  describe('descargarMedia()', () => {
    test('resuelve la URL temporal por media id y descarga el binario, ambos con Bearer', async () => {
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-abc' });
      const bytes = new Uint8Array([1, 2, 3]).buffer;
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://graph.facebook.com/media-temp-url', mime_type: 'image/jpeg' }) })
        .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => bytes });

      const { buffer, mimeType } = await adapter.descargarMedia({ mediaId: 'media-77' });

      expect(global.fetch).toHaveBeenNthCalledWith(1, 'https://graph.facebook.com/v19.0/media-77', {
        headers: { Authorization: 'Bearer token-abc' },
      });
      expect(global.fetch).toHaveBeenNthCalledWith(2, 'https://graph.facebook.com/media-temp-url', {
        headers: { Authorization: 'Bearer token-abc' },
      });
      expect(mimeType).toBe('image/jpeg');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer).toEqual(Buffer.from(bytes));
    });

    test('lanza si falla la resolución de la URL temporal', async () => {
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-abc' });
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(adapter.descargarMedia({ mediaId: 'media-x' })).rejects.toThrow('404');
    });

    test('lanza si falla la descarga del binario', async () => {
      const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_123', accessToken: 'token-abc' });
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://graph.facebook.com/media-temp-url', mime_type: 'image/jpeg' }) })
        .mockResolvedValueOnce({ ok: false, status: 410 });

      await expect(adapter.descargarMedia({ mediaId: 'media-x' })).rejects.toThrow('410');
    });

    test('lanza si faltan credenciales de la instancia', async () => {
      const adapter = new MetaCloudWhatsAppAdapter();
      await expect(adapter.descargarMedia({ mediaId: 'media-x' })).rejects.toThrow('falta accessToken');
    });
  });
});
