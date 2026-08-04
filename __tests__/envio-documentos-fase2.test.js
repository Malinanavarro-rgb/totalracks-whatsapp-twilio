'use strict';

// ── Mocks de los módulos que envio-documentos.js construye a nivel de módulo ──
// (mismo criterio que __tests__/channel-adapter.test.js: mockear el cliente,
// no la clase). Se declaran ANTES de requerir el módulo bajo prueba, porque
// jest.mock() se hoistea y modules/envio-documentos.js arma sus instancias
// (_twilioAdapter/_channelRouter) al cargar.

const mockTwilioCreate = jest.fn().mockResolvedValue({ sid: 'SM_DOC_123' });
jest.mock('../modules/clients', () => ({
  supabaseServicio: {},
  twilioClient: { messages: { create: mockTwilioCreate } },
}));

const mockResolverEndpoint = jest.fn().mockResolvedValue('+528100000000');
jest.mock('../modules/channel-router', () => ({
  ChannelRouter: jest.fn().mockImplementation(() => ({
    resolverEndpointDeEmpresa: mockResolverEndpoint,
  })),
}));

const mockObtenerAdapterMeta = jest.fn();
jest.mock('../modules/meta-auth', () => ({
  obtenerAdapterMetaParaEmpresa: (...args) => mockObtenerAdapterMeta(...args),
}));

const { enviarDocumentoPorWhatsApp, SEGUNDOS_URL_FIRMADA_DEFAULT } = require('../modules/envio-documentos');
const { TwilioWhatsAppAdapter } = require('../adapters/channels/twilio-whatsapp');
const { MetaCloudWhatsAppAdapter } = require('../adapters/channels/meta-cloud-whatsapp');

// ── Adapters — enviarDocumento() en aislamiento ─────────────────────────────

describe('TwilioWhatsAppAdapter.enviarDocumento()', () => {
  const mockCreate = jest.fn();
  const adapter = new TwilioWhatsAppAdapter({ messages: { create: mockCreate } });

  beforeEach(() => { mockCreate.mockReset().mockResolvedValue({ sid: 'SM_ABC' }); });

  test('manda mediaUrl con la URL firmada y devuelve proveedor+message_id', async () => {
    const resultado = await adapter.enviarDocumento('+5218112345678', { url: 'https://storage/x.pdf', filename: 'cotizacion.pdf', from: '+528100000000' });
    expect(mockCreate).toHaveBeenCalledWith({
      from: 'whatsapp:+528100000000', to: 'whatsapp:+5218112345678',
      mediaUrl: ['https://storage/x.pdf'], body: 'cotizacion.pdf',
    });
    expect(resultado).toEqual({ proveedor: 'twilio', message_id: 'SM_ABC' });
  });

  test('lanza si falta url', async () => {
    await expect(adapter.enviarDocumento('+5218112345678', { from: '+528100000000' })).rejects.toThrow('falta url');
  });

  test('lanza si no hay from ni TWILIO_WHATSAPP_NUMBER', async () => {
    delete process.env.TWILIO_WHATSAPP_NUMBER;
    await expect(adapter.enviarDocumento('+5218112345678', { url: 'https://x/y.pdf' })).rejects.toThrow('no hay número de origen');
  });
});

describe('MetaCloudWhatsAppAdapter.enviarDocumento()', () => {
  beforeEach(() => { global.fetch = jest.fn(); });

  test('con buffer: sube a Meta primero y envía por media_id', async () => {
    const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_1', accessToken: 'TOKEN_1' });
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'media-999' }) }) // subida
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.XYZ' }] }) }); // envío

    const resultado = await adapter.enviarDocumento('+5218112345678', { buffer: Buffer.from('pdf'), mimeType: 'application/pdf', filename: 'cotizacion.pdf' });

    expect(global.fetch).toHaveBeenNthCalledWith(1, 'https://graph.facebook.com/v19.0/PHONE_1/media', expect.objectContaining({ method: 'POST' }));
    const segundaLlamada = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(segundaLlamada.document).toEqual({ id: 'media-999', filename: 'cotizacion.pdf' });
    expect(resultado).toEqual({ proveedor: 'meta', message_id: 'wamid.XYZ' });
  });

  test('sin buffer, con url: usa document.link en vez de subir', async () => {
    const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'PHONE_1', accessToken: 'TOKEN_1' });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.ABC' }] }) });

    await adapter.enviarDocumento('+5218112345678', { url: 'https://storage/x.pdf', filename: 'x.pdf' });

    expect(global.fetch).toHaveBeenCalledTimes(1); // nunca sube a /media
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.document).toEqual({ link: 'https://storage/x.pdf', filename: 'x.pdf' });
  });

  test('lanza si faltan credenciales', async () => {
    const adapter = new MetaCloudWhatsAppAdapter({});
    await expect(adapter.enviarDocumento('+5218112345678', { url: 'https://x/y.pdf' })).rejects.toThrow('faltan credenciales');
  });

  test('lanza si ni buffer ni url', async () => {
    const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'P', accessToken: 'T' });
    await expect(adapter.enviarDocumento('+5218112345678', {})).rejects.toThrow('falta buffer o url');
  });

  test('si la subida a Meta falla, lanza con el detalle', async () => {
    const adapter = new MetaCloudWhatsAppAdapter({ phoneNumberId: 'P', accessToken: 'T' });
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' });
    await expect(adapter.enviarDocumento('+5218112345678', { buffer: Buffer.from('x'), mimeType: 'application/pdf' }))
      .rejects.toThrow(/falló la subida a Meta/);
  });
});

// ── Servicio genérico + tracking ────────────────────────────────────────────

describe('enviarDocumentoPorWhatsApp()', () => {
  // storage.from() debe devolver SIEMPRE el mismo objeto — si no, el test no
  // puede observar las llamadas que hace enviarDocumentoPorWhatsApp() por
  // dentro (cada llamada a .from() con una factory nueva crearía un mock
  // distinto al que el test inspecciona).
  const bucketBuilder = {
    download: jest.fn().mockResolvedValue({ data: { arrayBuffer: async () => Buffer.from('pdf-binario'), type: 'application/pdf' }, error: null }),
    createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://firmada/x.pdf' }, error: null }),
  };
  const supabase = {
    storage: { from: jest.fn().mockReturnValue(bucketBuilder) },
    from: jest.fn(),
  };

  function mockTablaEnviosDocumento(filaInsertada) {
    const builder = {
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: filaInsertada, error: null }),
      then: (resolve) => resolve({ data: null, error: null }),
    };
    supabase.from.mockReturnValue(builder);
    return builder;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockObtenerAdapterMeta.mockReset();
    mockResolverEndpoint.mockResolvedValue('+528100000000');
  });

  test('lanza si faltan datos requeridos', async () => {
    await expect(enviarDocumentoPorWhatsApp(supabase, { companyId: 'c1' })).rejects.toThrow('son requeridos');
  });

  test('proveedor Meta: descarga el binario de Storage y envía por media_id — nunca genera URL firmada', async () => {
    mockTablaEnviosDocumento({ id: 'envio-1' });
    const metaEnviarDocumento = jest.fn().mockResolvedValue({ proveedor: 'meta', message_id: 'wamid.1' });
    mockObtenerAdapterMeta.mockResolvedValue({ enviarDocumento: metaEnviarDocumento });

    const resultado = await enviarDocumentoPorWhatsApp(supabase, {
      companyId: 'c1', clienteId: 1, destinatario: '+521', storageBucket: 'cotizaciones-pdf', storagePath: 'c1/x.pdf', filename: 'x.pdf',
    });

    expect(metaEnviarDocumento).toHaveBeenCalledWith('+521', expect.objectContaining({ mimeType: 'application/pdf', filename: 'x.pdf' }));
    expect(resultado.estado).toBe('enviado');
    expect(resultado.message_id).toBe('wamid.1');
  });

  test('proveedor Twilio (sin Meta conectado): genera URL firmada con la duración pedida y la manda', async () => {
    mockTablaEnviosDocumento({ id: 'envio-2' });
    mockObtenerAdapterMeta.mockResolvedValue(null);
    mockTwilioCreate.mockResolvedValue({ sid: 'SM_999' });

    const resultado = await enviarDocumentoPorWhatsApp(supabase, {
      companyId: 'c1', clienteId: 1, destinatario: '+521', storageBucket: 'cotizaciones-pdf', storagePath: 'c1/x.pdf', segundosUrlFirmada: 7200,
    });

    expect(bucketBuilder.createSignedUrl).toHaveBeenCalledWith('c1/x.pdf', 7200);
    expect(mockTwilioCreate).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: ['https://firmada/x.pdf'] }));
    expect(resultado.estado).toBe('enviado');
  });

  test('usa SEGUNDOS_URL_FIRMADA_DEFAULT cuando no se especifica duración', async () => {
    mockTablaEnviosDocumento({ id: 'envio-3' });
    mockObtenerAdapterMeta.mockResolvedValue(null);

    await enviarDocumentoPorWhatsApp(supabase, { companyId: 'c1', clienteId: 1, destinatario: '+521', storageBucket: 'b', storagePath: 'p.pdf' });

    expect(bucketBuilder.createSignedUrl).toHaveBeenCalledWith('p.pdf', SEGUNDOS_URL_FIRMADA_DEFAULT);
  });

  test('si el proveedor falla, registra estado fallido con el error — no lanza', async () => {
    mockTablaEnviosDocumento({ id: 'envio-4' });
    mockObtenerAdapterMeta.mockResolvedValue({ enviarDocumento: jest.fn().mockRejectedValue(new Error('Graph API 500')) });

    const resultado = await enviarDocumentoPorWhatsApp(supabase, {
      companyId: 'c1', clienteId: 1, destinatario: '+521', storageBucket: 'b', storagePath: 'p.pdf',
    });

    expect(resultado.estado).toBe('fallido');
    expect(resultado.error_proveedor).toMatch(/Graph API 500/);
  });
});
