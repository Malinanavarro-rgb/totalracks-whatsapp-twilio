'use strict';

const CLAVE_TEST = 'a'.repeat(64); // 32 bytes en hex

describe('crypto-util', () => {
  const envOriginal = process.env.CALENDAR_CREDENTIALS_KEY;

  beforeEach(() => {
    jest.resetModules();
    process.env.CALENDAR_CREDENTIALS_KEY = CLAVE_TEST;
  });

  afterAll(() => {
    process.env.CALENDAR_CREDENTIALS_KEY = envOriginal;
  });

  describe('cifrar() / descifrar()', () => {
    test('round-trip: descifrar(cifrar(x)) devuelve x', () => {
      const { cifrar, descifrar } = require('../modules/crypto-util');
      const original = { access_token: 'abc123', refresh_token: 'xyz789', expiry_date: 1234567890 };

      const paquete = cifrar(original);
      const resultado = descifrar(paquete);

      expect(resultado).toEqual(original);
    });

    test('el paquete cifrado tiene la forma {iv, tag, datos} en base64', () => {
      const { cifrar } = require('../modules/crypto-util');
      const paquete = cifrar({ foo: 'bar' });

      expect(typeof paquete.iv).toBe('string');
      expect(typeof paquete.tag).toBe('string');
      expect(typeof paquete.datos).toBe('string');
      expect(() => Buffer.from(paquete.iv, 'base64')).not.toThrow();
    });

    test('dos cifrados del mismo objeto producen iv distintos (no determinista)', () => {
      const { cifrar } = require('../modules/crypto-util');
      const p1 = cifrar({ foo: 'bar' });
      const p2 = cifrar({ foo: 'bar' });

      expect(p1.iv).not.toBe(p2.iv);
      expect(p1.datos).not.toBe(p2.datos);
    });

    test('descifrar lanza si el "datos" fue manipulado (falla la verificación AEAD)', () => {
      const { cifrar, descifrar } = require('../modules/crypto-util');
      const paquete = cifrar({ foo: 'bar' });

      const manipulado = { ...paquete, datos: Buffer.from('otra-cosa-totalmente-distinta').toString('base64') };

      expect(() => descifrar(manipulado)).toThrow();
    });

    test('descifrar lanza si el "tag" fue manipulado', () => {
      const { cifrar, descifrar } = require('../modules/crypto-util');
      const paquete = cifrar({ foo: 'bar' });

      const manipulado = { ...paquete, tag: Buffer.alloc(16).toString('base64') };

      expect(() => descifrar(manipulado)).toThrow();
    });

    test('descifrar lanza un error legible si falta iv/tag/datos', () => {
      const { descifrar } = require('../modules/crypto-util');
      expect(() => descifrar({})).toThrow('paquete inválido');
    });
  });

  describe('validación de CALENDAR_CREDENTIALS_KEY', () => {
    test('lanza un error legible si la variable de entorno no está definida', () => {
      delete process.env.CALENDAR_CREDENTIALS_KEY;
      const { cifrar } = require('../modules/crypto-util');

      expect(() => cifrar({ foo: 'bar' })).toThrow('falta CALENDAR_CREDENTIALS_KEY');
    });

    test('lanza un error legible si la clave no mide 32 bytes', () => {
      process.env.CALENDAR_CREDENTIALS_KEY = 'deadbeef'; // solo 4 bytes
      const { cifrar } = require('../modules/crypto-util');

      expect(() => cifrar({ foo: 'bar' })).toThrow('debe ser 32 bytes');
    });
  });
});
