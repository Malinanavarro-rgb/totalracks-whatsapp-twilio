'use strict';

const { configPublica, intercambiarCodigoPorTokenLargo, suscribirWebhookAWaba } = require('../modules/meta-embedded-signup');

const ENV_ORIGINAL = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV_ORIGINAL, META_APP_ID: 'app-123', META_APP_SECRET: 'secret-abc', META_GRAPH_API_VERSION: 'v19.0' };
  global.fetch = jest.fn();
});

afterEach(() => {
  process.env = ENV_ORIGINAL;
  jest.restoreAllMocks();
});

describe('meta-embedded-signup', () => {
  describe('configPublica()', () => {
    test('disponible=true cuando META_APP_ID y META_LOGIN_CONFIG_ID están definidos', () => {
      process.env.META_LOGIN_CONFIG_ID = 'config-456';
      const cfg = configPublica();
      expect(cfg).toEqual({ appId: 'app-123', configId: 'config-456', disponible: true });
    });

    test('disponible=false si falta META_LOGIN_CONFIG_ID', () => {
      delete process.env.META_LOGIN_CONFIG_ID;
      expect(configPublica().disponible).toBe(false);
    });

    test('disponible=false si falta META_APP_ID', () => {
      delete process.env.META_APP_ID;
      process.env.META_LOGIN_CONFIG_ID = 'config-456';
      expect(configPublica().disponible).toBe(false);
    });
  });

  describe('intercambiarCodigoPorTokenLargo()', () => {
    test('encadena los 2 saltos (code → token corto → token largo) y devuelve el largo', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token-corto' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token-largo' }) });

      const resultado = await intercambiarCodigoPorTokenLargo('un-code');

      expect(resultado).toBe('token-largo');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch.mock.calls[0][0]).toContain('code=un-code');
      expect(global.fetch.mock.calls[1][0]).toContain('fb_exchange_token=token-corto');
    });

    test('lanza si el primer intercambio falla', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'code inválido' } }) });
      await expect(intercambiarCodigoPorTokenLargo('code-malo')).rejects.toThrow('fallo intercambiando code');
    });

    test('lanza si el segundo intercambio (extender token) falla', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token-corto' }) })
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: 'no se pudo extender' } }) });

      await expect(intercambiarCodigoPorTokenLargo('un-code')).rejects.toThrow('fallo extendiendo el token');
    });

    test('lanza si faltan META_APP_ID/META_APP_SECRET', async () => {
      delete process.env.META_APP_SECRET;
      await expect(intercambiarCodigoPorTokenLargo('un-code')).rejects.toThrow('faltan META_APP_ID/META_APP_SECRET');
    });
  });

  describe('suscribirWebhookAWaba()', () => {
    test('llama a POST /{waba_id}/subscribed_apps con el token', async () => {
      global.fetch.mockResolvedValueOnce({ ok: true });

      await suscribirWebhookAWaba('waba-789', 'token-largo');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v19.0/waba-789/subscribed_apps',
        expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer token-largo' } })
      );
    });

    test('lanza si Graph API responde con error', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, text: async () => 'permiso insuficiente' });
      await expect(suscribirWebhookAWaba('waba-789', 'token-malo')).rejects.toThrow('permiso insuficiente');
    });
  });
});
