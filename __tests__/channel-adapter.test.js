/**
 * TARA Matrix™ — Tests: Channel Adapter Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - Contrato de la interfaz ChannelAdapter
 *   - TwilioWhatsAppAdapter: parseIncoming, formatOutgoing,
 *     validateSignature, sendProactive
 */

'use strict';

const { ChannelAdapter }         = require('../adapters/channels/channel-adapter');
const { TwilioWhatsAppAdapter }  = require('../adapters/channels/twilio-whatsapp');

// ── Mock de twilio ─────────────────────────────────────────────────────────────
// Solo mockeamos el cliente; la clase twiml.MessagingResponse se usa real.
const mockCreate = jest.fn().mockResolvedValue({ sid: 'SM_TEST_123' });
const mockTwilioClient = {
  messages: { create: mockCreate },
};

// ── Helper ─────────────────────────────────────────────────────────────────────
function makeTwilioRequest(overrides = {}) {
  return {
    body: {
      From:        'whatsapp:+5218112345678',
      Body:        'Hola, necesito información',
      MessageSid:  'SM_abc123',
      NumMedia:    '0',
      ProfileName: 'Carlos López',
      WaId:        '5218112345678',
      ...overrides,
    },
    headers: {
      'x-twilio-signature': 'test_signature',
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// INTERFAZ BASE — ChannelAdapter
// ═════════════════════════════════════════════════════════════════════════════

describe('ChannelAdapter — contrato de interfaz', () => {
  let base;
  beforeEach(() => { base = new ChannelAdapter(); });

  test('canal lanza error si no está implementado', () => {
    expect(() => base.canal).toThrow('debe implementar canal');
  });

  test('parseIncoming() lanza error si no está implementado', () => {
    expect(() => base.parseIncoming({})).toThrow('debe implementar parseIncoming()');
  });

  test('formatOutgoing() lanza error si no está implementado', () => {
    expect(() => base.formatOutgoing('hola', {})).toThrow('debe implementar formatOutgoing()');
  });

  test('validateSignature() lanza error si no está implementado', () => {
    expect(() => base.validateSignature({})).toThrow('debe implementar validateSignature()');
  });

  test('sendProactive() lanza error si no está implementado', async () => {
    await expect(base.sendProactive('hola', '+521234')).rejects.toThrow('no soporta envío proactivo');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TWILIO WHATSAPP ADAPTER
// ═════════════════════════════════════════════════════════════════════════════

describe('TwilioWhatsAppAdapter', () => {
  let adapter;
  beforeEach(() => {
    adapter = new TwilioWhatsAppAdapter(mockTwilioClient);
    mockCreate.mockClear();
    delete process.env.WEBHOOK_URL_WHATSAPP;
    delete process.env.TWILIO_WHATSAPP_NUMBER;
  });

  // ── canal ───────────────────────────────────────────────────────────────────
  describe('canal', () => {
    test('devuelve "whatsapp"', () => {
      expect(adapter.canal).toBe('whatsapp');
    });
  });

  // ── parseIncoming ───────────────────────────────────────────────────────────
  describe('parseIncoming()', () => {
    test('produce un Message con estructura correcta', () => {
      const msg = adapter.parseIncoming(makeTwilioRequest());

      expect(msg).toMatchObject({
        channel:    'whatsapp',
        from:       '+5218112345678',
        content:    'Hola, necesito información',
        company_id: null,
      });
      expect(msg.id).toBeDefined();
      expect(msg.id).toHaveLength(36);          // UUID v4
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    test('elimina el prefijo "whatsapp:" del número', () => {
      const msg = adapter.parseIncoming(makeTwilioRequest({ From: 'whatsapp:+5218199999999' }));
      expect(msg.from).toBe('+5218199999999');
      expect(msg.from).not.toContain('whatsapp:');
    });

    test('raw_metadata contiene campos del canal', () => {
      const msg = adapter.parseIncoming(makeTwilioRequest());
      expect(msg.raw_metadata).toMatchObject({
        MessageSid:  'SM_abc123',
        NumMedia:    '0',
        ProfileName: 'Carlos López',
        WaId:        '5218112345678',
      });
    });

    test('maneja Body undefined → content vacío', () => {
      const msg = adapter.parseIncoming(makeTwilioRequest({ Body: undefined }));
      expect(msg.content).toBe('');
    });

    test('trimea espacios en content', () => {
      const msg = adapter.parseIncoming(makeTwilioRequest({ Body: '  hola  ' }));
      expect(msg.content).toBe('hola');
    });

    test('maneja From sin prefijo whatsapp:', () => {
      const msg = adapter.parseIncoming(makeTwilioRequest({ From: '+5218112345678' }));
      expect(msg.from).toBe('+5218112345678');
    });

    test('cada mensaje tiene un ID único', () => {
      const msg1 = adapter.parseIncoming(makeTwilioRequest());
      const msg2 = adapter.parseIncoming(makeTwilioRequest());
      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  // ── formatOutgoing ──────────────────────────────────────────────────────────
  describe('formatOutgoing()', () => {
    test('devuelve TwiML XML válido', () => {
      const xml = adapter.formatOutgoing('Hola, soy TARA', {});
      expect(xml).toContain('<?xml');
      expect(xml).toContain('<Response>');
      expect(xml).toContain('<Message>');
      expect(xml).toContain('Hola, soy TARA');
      expect(xml).toContain('</Response>');
    });

    test('incluye el texto completo de la respuesta', () => {
      const texto = 'Buenos días. ¿En qué te puedo ayudar hoy?';
      const xml = adapter.formatOutgoing(texto, {});
      expect(xml).toContain(texto);
    });

    test('funciona con texto que contiene caracteres especiales', () => {
      const texto = 'Precio: $1,500 — disponible hoy';
      const xml = adapter.formatOutgoing(texto, {});
      expect(xml).toContain('$1,500');
      expect(xml).toContain('disponible hoy');
    });

    test('ignora originalMessage (no lo usa en este canal)', () => {
      const xml1 = adapter.formatOutgoing('Hola', null);
      const xml2 = adapter.formatOutgoing('Hola', { from: '+521234', channel: 'api' });
      expect(xml1).toBe(xml2);
    });
  });

  // ── validateSignature ───────────────────────────────────────────────────────
  describe('validateSignature()', () => {
    test('devuelve false si no hay firma en headers', () => {
      const req = { headers: {}, body: {} };
      expect(adapter.validateSignature(req)).toBe(false);
    });

    test('devuelve true en modo desarrollo (sin WEBHOOK_URL_WHATSAPP)', () => {
      const req = makeTwilioRequest();
      // WEBHOOK_URL_WHATSAPP no está en env → modo dev
      expect(adapter.validateSignature(req)).toBe(true);
    });
  });

  // ── sendProactive ───────────────────────────────────────────────────────────
  describe('sendProactive()', () => {
    test('llama a twilioClient.messages.create con parámetros correctos', async () => {
      process.env.TWILIO_WHATSAPP_NUMBER = '+528100000000';

      await adapter.sendProactive('Tu cita es mañana a las 10am', '+5218112345678');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        from: 'whatsapp:+528100000000',
        to:   'whatsapp:+5218112345678',
        body: 'Tu cita es mañana a las 10am',
      });
    });

    test('lanza error si TWILIO_WHATSAPP_NUMBER no está definido', async () => {
      await expect(
        adapter.sendProactive('Hola', '+5218112345678')
      ).rejects.toThrow('TWILIO_WHATSAPP_NUMBER no definido');
    });

    test('propaga errores del cliente Twilio', async () => {
      process.env.TWILIO_WHATSAPP_NUMBER = '+528100000000';
      mockCreate.mockRejectedValueOnce(new Error('Twilio API error: 21211'));

      await expect(
        adapter.sendProactive('Hola', 'numero_invalido')
      ).rejects.toThrow('Twilio API error: 21211');
    });
  });
});
