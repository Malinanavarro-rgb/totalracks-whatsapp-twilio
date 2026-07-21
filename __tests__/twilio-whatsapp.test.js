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
});
