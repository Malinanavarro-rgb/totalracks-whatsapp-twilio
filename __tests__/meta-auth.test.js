'use strict';

const mockCifrar    = jest.fn((obj) => ({ iv: 'iv', tag: 'tag', datos: JSON.stringify(obj) }));
const mockDescifrar = jest.fn((paquete) => JSON.parse(paquete.datos));

jest.mock('../modules/crypto-util', () => ({
  cifrar: (...args) => mockCifrar(...args),
  descifrar: (...args) => mockDescifrar(...args),
}));

const { guardarCredencialesMeta, registrarChannelEndpointMeta, conectarWhatsAppMeta, obtenerAdapterMetaParaEmpresa } = require('../modules/meta-auth');
const { MetaCloudWhatsAppAdapter } = require('../adapters/channels/meta-cloud-whatsapp');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then:        (resolve) => resolve(resultado), // permite `await builder.upsert(...)` sin .select().single()
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const db = { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

beforeEach(() => jest.clearAllMocks());

describe('meta-auth', () => {
  describe('guardarCredencialesMeta()', () => {
    test('cifra el access_token antes de guardar', async () => {
      const db = crearMockDb({ data: { id: 'cred-1', company_id: COMPANY_A }, error: null });

      await guardarCredencialesMeta(db, COMPANY_A, {
        whatsappBusinessAccountId: 'waba-1', phoneNumberId: 'phone-1', accessToken: 'token-secreto',
      });

      expect(mockCifrar).toHaveBeenCalledWith({ access_token: 'token-secreto' }, 'META_CREDENTIALS_KEY');

      const builder = db.from.mock.results[0].value;
      expect(builder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          company_id: COMPANY_A,
          whatsapp_business_account_id: 'waba-1',
          phone_number_id: 'phone-1',
          estado: 'activo',
          activo: true,
        }),
        { onConflict: 'company_id' }
      );
    });

    test('lanza error si falta un campo requerido', async () => {
      const db = crearMockDb();
      await expect(
        guardarCredencialesMeta(db, COMPANY_A, { whatsappBusinessAccountId: 'waba-1' })
      ).rejects.toThrow('son requeridos');
    });

    test('meta_business_id es opcional', async () => {
      const db = crearMockDb({ data: { id: 'cred-1' }, error: null });

      await guardarCredencialesMeta(db, COMPANY_A, {
        whatsappBusinessAccountId: 'waba-1', phoneNumberId: 'phone-1', accessToken: 'token',
      });

      const builder = db.from.mock.results[0].value;
      expect(builder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ meta_business_id: null }),
        expect.anything()
      );
    });
  });

  describe('registrarChannelEndpointMeta()', () => {
    test('hace upsert en channel_endpoints con proveedor=meta y canal=whatsapp', async () => {
      const db = crearMockDb({ error: null });
      await registrarChannelEndpointMeta(db, COMPANY_A, 'phone-1');

      const builder = db.from.mock.results[0].value;
      expect(builder.upsert).toHaveBeenCalledWith(
        { company_id: COMPANY_A, endpoint: 'phone-1', canal: 'whatsapp', proveedor: 'meta', activo: true },
        { onConflict: 'endpoint' }
      );
    });

    test('lanza si Supabase falla', async () => {
      const db = crearMockDb({ error: { message: 'fallo' } });
      await expect(registrarChannelEndpointMeta(db, COMPANY_A, 'phone-1')).rejects.toThrow('fallo');
    });
  });

  describe('conectarWhatsAppMeta()', () => {
    test('guarda credenciales y registra el channel_endpoint en un solo paso', async () => {
      const db = crearMockDb(
        { data: { id: 'cred-1' }, error: null }, // guardarCredencialesMeta
        { error: null },                         // registrarChannelEndpointMeta
      );

      const fila = await conectarWhatsAppMeta(db, COMPANY_A, {
        whatsappBusinessAccountId: 'waba-1', phoneNumberId: 'phone-1', accessToken: 'token',
      });

      expect(fila).toEqual({ id: 'cred-1' });
      const builderCredenciales = db.from.mock.results[0].value;
      const builderEndpoint     = db.from.mock.results[1].value;
      expect(builderCredenciales.upsert).toHaveBeenCalledWith(expect.objectContaining({ phone_number_id: 'phone-1' }), { onConflict: 'company_id' });
      expect(builderEndpoint.upsert).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'phone-1' }), { onConflict: 'endpoint' });
    });
  });

  describe('obtenerAdapterMetaParaEmpresa()', () => {
    test('devuelve un MetaCloudWhatsAppAdapter con las credenciales descifradas', async () => {
      const db = crearMockDb({
        data: {
          phone_number_id: 'phone-1',
          credenciales: { iv: 'iv', tag: 'tag', datos: JSON.stringify({ access_token: 'token-real' }) },
        },
        error: null,
      });

      const adapter = await obtenerAdapterMetaParaEmpresa(db, COMPANY_A);

      expect(adapter).toBeInstanceOf(MetaCloudWhatsAppAdapter);
      expect(mockDescifrar).toHaveBeenCalled();
    });

    test('devuelve null si la empresa no tiene Meta conectado', async () => {
      const db = crearMockDb({ data: null, error: null });
      expect(await obtenerAdapterMetaParaEmpresa(db, COMPANY_A)).toBeNull();
    });

    test('devuelve null si hay un error de consulta', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await obtenerAdapterMetaParaEmpresa(db, COMPANY_A)).toBeNull();
    });

    test('filtra por company_id y activo=true (aislamiento multiempresa)', async () => {
      const db = crearMockDb({ data: null, error: null });
      await obtenerAdapterMetaParaEmpresa(db, COMPANY_A);

      const builder = db.from.mock.results[0].value;
      expect(builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
      expect(builder.eq).toHaveBeenCalledWith('activo', true);
    });
  });
});
