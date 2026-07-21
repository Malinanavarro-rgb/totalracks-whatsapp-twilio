/**
 * TARA Matrix™ — Tests: TwilioWhatsAppAdapter::parseIncoming()
 * Enfocado en el fix de v0.4 (Inbox Inteligente): un mensaje de solo-adjunto
 * (sin texto) dejaba `content` vacío, causando el mismo crash de
 * ContextBuilder ya confirmado en producción para Meta.
 */

'use strict';

const { TwilioWhatsAppAdapter } = require('../adapters/channels/twilio-whatsapp');

function makeReq(body) {
  return { body };
}

describe('TwilioWhatsAppAdapter', () => {
  describe('parseIncoming()', () => {
    test('mensaje de texto normal produce content tal cual', () => {
      const adapter = new TwilioWhatsAppAdapter({});
      const mensaje = adapter.parseIncoming(makeReq({
        From: 'whatsapp:+5218112345678', To: 'whatsapp:+14155238886', Body: 'Hola, quiero información', MessageSid: 'SM1',
      }));

      expect(mensaje.channel).toBe('whatsapp');
      expect(mensaje.from).toBe('+5218112345678');
      expect(mensaje.content).toBe('Hola, quiero información');
    });

    test('mensaje de solo-adjunto (Body vacío, NumMedia=1): content nunca queda vacío', () => {
      const adapter = new TwilioWhatsAppAdapter({});
      const mensaje = adapter.parseIncoming(makeReq({
        From: 'whatsapp:+5218112345678', To: 'whatsapp:+14155238886', Body: '',
        NumMedia: '1', MediaContentType0: 'image/jpeg', MediaUrl0: 'https://api.twilio.com/media/x',
      }));

      expect(mensaje.content).not.toBe('');
      expect(mensaje.content).toContain('image');
    });

    test('mensaje con adjunto: expone media (url/mimeType) para que la capa de plataforma pueda descargarlo', () => {
      const adapter = new TwilioWhatsAppAdapter({});
      const mensaje = adapter.parseIncoming(makeReq({
        From: 'whatsapp:+5218112345678', To: 'whatsapp:+14155238886', Body: '',
        NumMedia: '1', MediaContentType0: 'image/jpeg', MediaUrl0: 'https://api.twilio.com/media/x',
      }));

      expect(mensaje.media).toEqual({ url: 'https://api.twilio.com/media/x', mimeType: 'image/jpeg' });
    });

    test('mensaje de solo texto: no expone media', () => {
      const adapter = new TwilioWhatsAppAdapter({});
      const mensaje = adapter.parseIncoming(makeReq({
        From: 'whatsapp:+5218112345678', To: 'whatsapp:+14155238886', Body: 'Hola', NumMedia: '0',
      }));

      expect(mensaje.media).toBeNull();
    });

    test('adjunto con caption (Body con texto + NumMedia>0): usa el texto tal cual, no el placeholder', () => {
      const adapter = new TwilioWhatsAppAdapter({});
      const mensaje = adapter.parseIncoming(makeReq({
        From: 'whatsapp:+5218112345678', To: 'whatsapp:+14155238886', Body: '¿Cuánto cuesta esto?',
        NumMedia: '1', MediaContentType0: 'image/jpeg',
      }));

      expect(mensaje.content).toBe('¿Cuánto cuesta esto?');
    });

    test('sin Body y sin NumMedia (mensaje vacío real, caso raro): content queda vacío, no lanza', () => {
      const adapter = new TwilioWhatsAppAdapter({});
      const mensaje = adapter.parseIncoming(makeReq({ From: 'whatsapp:+5218112345678', To: 'whatsapp:+14155238886' }));
      expect(mensaje.content).toBe('');
    });
  });

  describe('descargarMedia()', () => {
    const ENV_ORIGINAL = process.env;

    beforeEach(() => {
      process.env = { ...ENV_ORIGINAL, TWILIO_ACCOUNT_SID: 'ACxxx', TWILIO_AUTH_TOKEN: 'secret-token' };
      global.fetch = jest.fn();
    });

    afterEach(() => {
      process.env = ENV_ORIGINAL;
      jest.restoreAllMocks();
    });

    test('descarga con Basic Auth (Account SID:Auth Token) y devuelve buffer + mimeType', async () => {
      const adapter = new TwilioWhatsAppAdapter({});
      const bytes = new Uint8Array([9, 8, 7]).buffer;
      global.fetch.mockResolvedValue({
        ok: true, arrayBuffer: async () => bytes, headers: { get: () => 'image/jpeg' },
      });

      const { buffer, mimeType } = await adapter.descargarMedia({ url: 'https://api.twilio.com/media/x', mimeType: 'image/jpeg' });

      const authEsperado = 'Basic ' + Buffer.from('ACxxx:secret-token').toString('base64');
      expect(global.fetch).toHaveBeenCalledWith('https://api.twilio.com/media/x', { headers: { Authorization: authEsperado } });
      expect(mimeType).toBe('image/jpeg');
      expect(buffer).toEqual(Buffer.from(bytes));
    });

    test('usa el mimeType del mensaje si la respuesta no trae content-type', async () => {
      const adapter = new TwilioWhatsAppAdapter({});
      global.fetch.mockResolvedValue({
        ok: true, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null },
      });

      const { mimeType } = await adapter.descargarMedia({ url: 'https://api.twilio.com/media/x', mimeType: 'audio/ogg' });
      expect(mimeType).toBe('audio/ogg');
    });

    test('lanza si la descarga falla', async () => {
      const adapter = new TwilioWhatsAppAdapter({});
      global.fetch.mockResolvedValue({ ok: false, status: 403 });

      await expect(adapter.descargarMedia({ url: 'https://api.twilio.com/media/x' })).rejects.toThrow('403');
    });
  });
});
