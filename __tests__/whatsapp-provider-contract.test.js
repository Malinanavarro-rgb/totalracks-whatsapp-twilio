/**
 * TARA Matrix™ — Tests de contrato: TwilioWhatsAppAdapter vs MetaCloudWhatsAppAdapter
 *
 * El Core (Orchestrator/WorkflowEngine) nunca debe saber qué proveedor
 * entregó un mensaje — ambos adapters deben producir un `Message` con
 * exactamente la misma forma (mismas claves, mismos tipos) a partir de sus
 * respectivos payloads crudos. Este test corre el mismo conjunto de
 * aserciones contra los dos adapters, con un payload de ejemplo por
 * proveedor.
 *
 * No cubre transporte (HTTP real) ni credenciales — eso ya lo cubren
 * twilio-whatsapp.test.js / meta-cloud-whatsapp.test.js. Este archivo
 * cubre exclusivamente la forma del objeto Message resultante.
 */

'use strict';

const crypto = require('crypto');
const { TwilioWhatsAppAdapter } = require('../adapters/channels/twilio-whatsapp');
const { MetaCloudWhatsAppAdapter } = require('../adapters/channels/meta-cloud-whatsapp');

const CAMPOS_MESSAGE = ['id', 'company_id', 'channel', 'from', 'incoming_endpoint', 'content', 'timestamp', 'raw_metadata'];

function makeTwilioRequest() {
  return {
    body: {
      From: 'whatsapp:+5218112345678',
      To: 'whatsapp:+14155238886',
      Body: '  Hola, necesito información  ',
      MessageSid: 'SM123abc',
      NumMedia: '0',
      ProfileName: 'Carlos López',
      WaId: '5218112345678',
    },
  };
}

function makeMetaRequest() {
  const body = {
    entry: [{
      id: 'waba-id-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'PHONE_NUM_ID_123', display_phone_number: '+521800...' },
          contacts: [{ profile: { name: 'Carlos López' } }],
          messages: [{ from: '5218112345678', id: 'wamid.xyz', type: 'text', text: { body: '  Hola, necesito información  ' } }],
        },
      }],
    }],
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    body,
    rawBody,
    query: {},
    headers: { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(rawBody).digest('hex') },
  };
}

describe('Contrato compartido — Message universal (Twilio vs Meta)', () => {
  beforeEach(() => {
    process.env.META_APP_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.META_APP_SECRET;
  });

  const proveedores = [
    { nombre: 'Twilio', adapter: new TwilioWhatsAppAdapter(/* twilioClient no usado en parseIncoming */ {}), req: makeTwilioRequest() },
    { nombre: 'Meta', adapter: new MetaCloudWhatsAppAdapter(), req: makeMetaRequest() },
  ];

  test.each(proveedores)('$nombre: parseIncoming() devuelve exactamente las claves de Message, sin más ni menos', ({ adapter, req }) => {
    const mensaje = adapter.parseIncoming(req);
    expect(Object.keys(mensaje).sort()).toEqual([...CAMPOS_MESSAGE].sort());
  });

  test.each(proveedores)('$nombre: channel es "whatsapp"', ({ adapter, req }) => {
    expect(adapter.parseIncoming(req).channel).toBe('whatsapp');
  });

  test.each(proveedores)('$nombre: from es E.164 con "+", sin prefijo de canal', ({ adapter, req }) => {
    const { from } = adapter.parseIncoming(req);
    expect(typeof from).toBe('string');
    expect(from).toBe('+5218112345678');
    expect(from).not.toMatch(/^whatsapp:/);
  });

  test.each(proveedores)('$nombre: content llega trimeado', ({ adapter, req }) => {
    expect(adapter.parseIncoming(req).content).toBe('Hola, necesito información');
  });

  test.each(proveedores)('$nombre: company_id inicia null — lo asigna el ChannelRouter en server.js', ({ adapter, req }) => {
    expect(adapter.parseIncoming(req).company_id).toBeNull();
  });

  test.each(proveedores)('$nombre: incoming_endpoint identifica el número/endpoint receptor', ({ adapter, req }) => {
    expect(typeof adapter.parseIncoming(req).incoming_endpoint).toBe('string');
  });

  test.each(proveedores)('$nombre: timestamp es un Date', ({ adapter, req }) => {
    expect(adapter.parseIncoming(req).timestamp).toBeInstanceOf(Date);
  });

  test.each(proveedores)('$nombre: raw_metadata.MessageSid preserva el id nativo del mensaje (mismo nombre de campo entre proveedores)', ({ adapter, req }) => {
    expect(adapter.parseIncoming(req).raw_metadata.MessageSid).toBeTruthy();
  });

  test('ambos proveedores producen el mismo from/content para el mismo mensaje lógico', () => {
    const msgTwilio = proveedores[0].adapter.parseIncoming(proveedores[0].req);
    const msgMeta = proveedores[1].adapter.parseIncoming(proveedores[1].req);

    expect(msgTwilio.from).toBe(msgMeta.from);
    expect(msgTwilio.content).toBe(msgMeta.content);
  });
});
