'use strict';

const { ESTADOS_OPERATIVOS, mapearEstadoProveedor, esEstadoOperativo, haExpirado } = require('../modules/billing-engine/estados');

describe('billing-engine/estados', () => {
  describe('mapearEstadoProveedor()', () => {
    test.each([
      ['trialing', 'trial'],
      ['active', 'active'],
      ['past_due', 'past_due'],
      ['unpaid', 'past_due'],
      ['incomplete', 'past_due'],
      ['incomplete_expired', 'expired'],
      ['canceled', 'cancelled'],
      ['paused', 'suspended'],
    ])('stripe "%s" → canónico "%s"', (bruto, esperado) => {
      expect(mapearEstadoProveedor('stripe', bruto)).toBe(esperado);
    });

    test('lanza si el proveedor es "manual" (no tiene estados que traducir)', () => {
      expect(() => mapearEstadoProveedor('manual', 'active')).toThrow(/no tiene estados de proveedor/);
    });

    test('lanza si el proveedor es desconocido', () => {
      expect(() => mapearEstadoProveedor('paypal', 'active')).toThrow(/proveedor desconocido/);
    });

    test('lanza si el proveedor es conocido pero el estado bruto no tiene mapeo', () => {
      expect(() => mapearEstadoProveedor('stripe', 'algo_nuevo_de_stripe')).toThrow(/sin mapeo canónico/);
    });
  });

  describe('esEstadoOperativo()', () => {
    test.each(['trial', 'active', 'past_due'])('"%s" es operativo', (estado) => {
      expect(esEstadoOperativo(estado)).toBe(true);
    });

    test.each(['suspended', 'cancelled', 'expired'])('"%s" NO es operativo', (estado) => {
      expect(esEstadoOperativo(estado)).toBe(false);
    });
  });

  describe('ESTADOS_OPERATIVOS', () => {
    test('es exactamente trial/active/past_due', () => {
      expect(ESTADOS_OPERATIVOS).toEqual(['trial', 'active', 'past_due']);
    });
  });

  describe('haExpirado()', () => {
    test('true si está en trial y fecha_prueba_fin ya pasó', () => {
      const suscripcion = { estado: 'trial', fecha_prueba_fin: '2026-01-01T00:00:00Z' };
      expect(haExpirado(suscripcion, new Date('2026-02-01T00:00:00Z'))).toBe(true);
    });

    test('false si está en trial pero fecha_prueba_fin todavía no pasa', () => {
      const suscripcion = { estado: 'trial', fecha_prueba_fin: '2026-03-01T00:00:00Z' };
      expect(haExpirado(suscripcion, new Date('2026-02-01T00:00:00Z'))).toBe(false);
    });

    test('false si no está en trial, aunque tenga fecha_prueba_fin vencida', () => {
      const suscripcion = { estado: 'active', fecha_prueba_fin: '2026-01-01T00:00:00Z' };
      expect(haExpirado(suscripcion, new Date('2026-02-01T00:00:00Z'))).toBe(false);
    });

    test('false si no tiene fecha_prueba_fin', () => {
      const suscripcion = { estado: 'trial', fecha_prueba_fin: null };
      expect(haExpirado(suscripcion, new Date())).toBe(false);
    });
  });
});
