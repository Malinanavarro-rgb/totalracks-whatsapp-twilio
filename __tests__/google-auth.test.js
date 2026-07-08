'use strict';

const mockGenerateAuthUrl  = jest.fn().mockReturnValue('https://accounts.google.com/fake-consent-url');
const mockGetToken         = jest.fn();
const mockSetCredentials   = jest.fn();
const mockOn               = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        getToken:        mockGetToken,
        setCredentials:  mockSetCredentials,
        on:              mockOn,
      })),
    },
  },
}));

jest.mock('../modules/crypto-util', () => ({
  cifrar:    jest.fn(obj => ({ iv: 'iv-fake', tag: 'tag-fake', datos: JSON.stringify(obj) })),
  descifrar: jest.fn(paquete => JSON.parse(paquete.datos)),
}));

jest.mock('../adapters/calendar/google-calendar-provider', () => ({
  GoogleCalendarProvider: jest.fn().mockImplementation((client) => ({ __fake: 'GoogleCalendarProvider', client })),
}));

const { google } = require('googleapis');
const { cifrar, descifrar } = require('../modules/crypto-util');
const { GoogleCalendarProvider } = require('../adapters/calendar/google-calendar-provider');
const { generarUrlAutorizacion, manejarCallback, obtenerProviderParaEmpresa } = require('../modules/google-auth');

// ─── Mock Supabase (mismo patrón thenable que scheduling-engine.test.js) ──────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const builders = [];
  const db = {
    from: jest.fn(() => {
      const b = crearBuilder(resultados[idx++] ?? { data: null, error: null });
      builders.push(b);
      return b;
    }),
    _builders: builders,
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('google-auth', () => {
  const envOriginal = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID     = 'client-id-test';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret-test';
    process.env.GOOGLE_REDIRECT_URI  = 'http://localhost:3000/oauth/google/callback';
  });

  afterAll(() => {
    process.env = envOriginal;
  });

  describe('generarUrlAutorizacion()', () => {
    test('arma la URL con access_type offline, prompt consent y el company_id en state', () => {
      const url = generarUrlAutorizacion(COMPANY_A);

      expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
        access_type: 'offline',
        prompt:      'consent',
        scope:       ['https://www.googleapis.com/auth/calendar.events'],
        state:       COMPANY_A,
      });
      expect(url).toBe('https://accounts.google.com/fake-consent-url');
    });

    test('lanza error si no se provee company_id', () => {
      expect(() => generarUrlAutorizacion()).toThrow('company_id es requerido');
    });

    test('lanza error legible si faltan las variables de entorno de Google', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      expect(() => generarUrlAutorizacion(COMPANY_A)).toThrow('faltan GOOGLE_CLIENT_ID');
    });
  });

  describe('manejarCallback()', () => {
    test('intercambia el code por tokens, los cifra y hace upsert en calendar_credentials', async () => {
      mockGetToken.mockResolvedValue({ tokens: { access_token: 'at-1', refresh_token: 'rt-1' } });
      const db = crearMockDb({ data: null, error: null });

      await manejarCallback(db, 'code-123', COMPANY_A);

      expect(mockGetToken).toHaveBeenCalledWith('code-123');
      expect(cifrar).toHaveBeenCalledWith({ access_token: 'at-1', refresh_token: 'rt-1' });
      expect(db.from).toHaveBeenCalledWith('calendar_credentials');
      expect(db._builders[0].upsert).toHaveBeenCalledWith(
        expect.objectContaining({ company_id: COMPANY_A, proveedor: 'google', activo: true }),
        { onConflict: 'company_id,proveedor' }
      );
    });

    test('lanza error legible si el upsert falla', async () => {
      mockGetToken.mockResolvedValue({ tokens: { access_token: 'at-1' } });
      const db = crearMockDb({ data: null, error: { message: 'fallo de red' } });

      await expect(manejarCallback(db, 'code-123', COMPANY_A)).rejects.toThrow('fallo de red');
    });

    test('lanza error si falta code o company_id', async () => {
      const db = crearMockDb();
      await expect(manejarCallback(db, null, COMPANY_A)).rejects.toThrow('code y company_id son requeridos');
      await expect(manejarCallback(db, 'code-123', null)).rejects.toThrow('code y company_id son requeridos');
    });
  });

  describe('obtenerProviderParaEmpresa()', () => {
    test('devuelve null si la empresa no tiene Google conectado', async () => {
      const db = crearMockDb({ data: null, error: null });

      const provider = await obtenerProviderParaEmpresa(db, COMPANY_A);

      expect(provider).toBeNull();
    });

    test('descifra las credenciales, autentica el cliente y devuelve un GoogleCalendarProvider', async () => {
      const credencialesFila = {
        id: 'cred-1',
        credenciales: { iv: 'iv-fake', tag: 'tag-fake', datos: JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1' }) },
      };
      const db = crearMockDb({ data: credencialesFila, error: null });

      const provider = await obtenerProviderParaEmpresa(db, COMPANY_A);

      expect(descifrar).toHaveBeenCalledWith(credencialesFila.credenciales);
      expect(mockSetCredentials).toHaveBeenCalledWith({ access_token: 'at-1', refresh_token: 'rt-1' });
      expect(GoogleCalendarProvider).toHaveBeenCalled();
      expect(provider.__fake).toBe('GoogleCalendarProvider');
    });

    test('re-cifra y persiste cuando Google emite un token refrescado', async () => {
      const credencialesFila = {
        id: 'cred-1',
        credenciales: { iv: 'iv-fake', tag: 'tag-fake', datos: JSON.stringify({ access_token: 'at-viejo' }) },
      };
      const db = crearMockDb({ data: credencialesFila, error: null });

      await obtenerProviderParaEmpresa(db, COMPANY_A);

      expect(mockOn).toHaveBeenCalledWith('tokens', expect.any(Function));
      const handlerTokens = mockOn.mock.calls[0][1];

      await handlerTokens({ access_token: 'at-nuevo' });

      expect(cifrar).toHaveBeenCalledWith({ access_token: 'at-nuevo' });
      expect(db._builders[1].update).toHaveBeenCalledWith(
        expect.objectContaining({ credenciales: expect.any(Object) })
      );
    });
  });
});
