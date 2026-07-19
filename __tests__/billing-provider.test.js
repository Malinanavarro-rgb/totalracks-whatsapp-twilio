/**
 * TARA Matrix™ — Tests: Billing Provider Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - Contrato de la interfaz BillingProvider
 *   - MockBillingProvider: crearCliente, guardarMetodoPago, crearSuscripcion,
 *     cancelarSuscripcion, cambiarPlan
 */

'use strict';

const { BillingProvider }     = require('../adapters/billing/billing-provider');
const { MockBillingProvider } = require('../adapters/billing/mock-billing-provider');

describe('BillingProvider — contrato de interfaz', () => {
  let base;
  beforeEach(() => { base = new BillingProvider(); });

  test('nombre lanza error si no está implementado', () => {
    expect(() => base.nombre).toThrow('debe implementar nombre');
  });

  test('crearCliente() lanza error si no está implementado', async () => {
    await expect(base.crearCliente({})).rejects.toThrow('debe implementar crearCliente()');
  });

  test('guardarMetodoPago() lanza error si no está implementado', async () => {
    await expect(base.guardarMetodoPago('cliente-1', 'tok')).rejects.toThrow('debe implementar guardarMetodoPago()');
  });

  test('crearSuscripcion() lanza error si no está implementado', async () => {
    await expect(base.crearSuscripcion('cliente-1', 'plan-1')).rejects.toThrow('debe implementar crearSuscripcion()');
  });

  test('cancelarSuscripcion() lanza error si no está implementado', async () => {
    await expect(base.cancelarSuscripcion('sub-1')).rejects.toThrow('debe implementar cancelarSuscripcion()');
  });

  test('cambiarPlan() lanza error si no está implementado', async () => {
    await expect(base.cambiarPlan('sub-1', 'plan-2')).rejects.toThrow('debe implementar cambiarPlan()');
  });
});

describe('MockBillingProvider', () => {
  let provider;
  beforeEach(() => { provider = new MockBillingProvider(); });

  test('nombre devuelve "manual"', () => {
    expect(provider.nombre).toBe('manual');
  });

  describe('crearCliente()', () => {
    test('devuelve un clienteId', async () => {
      const { clienteId } = await provider.crearCliente({ nombre: 'Sugar Salon' });
      expect(clienteId).toBeDefined();
    });
  });

  describe('guardarMetodoPago()', () => {
    test('devuelve un resumen con token/marca/últimos4/expiración', async () => {
      const { clienteId } = await provider.crearCliente({ nombre: 'Sugar Salon' });
      const resumen = await provider.guardarMetodoPago(clienteId, 'tok-abc');
      expect(resumen).toEqual({ token: 'tok-abc', ultimos4: '0000', marca: 'Mock', fechaExpiracion: '12/99' });
    });
  });

  describe('crearSuscripcion()', () => {
    test('devuelve un suscripcionId y estadoBruto "active"', async () => {
      const { clienteId } = await provider.crearCliente({ nombre: 'Sugar Salon' });
      const resultado = await provider.crearSuscripcion(clienteId, 'plan-externo-1');
      expect(resultado.suscripcionId).toBeDefined();
      expect(resultado.estadoBruto).toBe('active');
    });
  });

  describe('cancelarSuscripcion()', () => {
    test('marca la suscripción como cancelled', async () => {
      const { clienteId } = await provider.crearCliente({ nombre: 'Sugar Salon' });
      const { suscripcionId } = await provider.crearSuscripcion(clienteId, 'plan-externo-1');
      await expect(provider.cancelarSuscripcion(suscripcionId)).resolves.toBeUndefined();
    });

    test('lanza si la suscripción no existe', async () => {
      await expect(provider.cancelarSuscripcion('no-existe')).rejects.toThrow('no existe');
    });
  });

  describe('cambiarPlan()', () => {
    test('actualiza el plan externo de la suscripción', async () => {
      const { clienteId } = await provider.crearCliente({ nombre: 'Sugar Salon' });
      const { suscripcionId } = await provider.crearSuscripcion(clienteId, 'plan-externo-1');
      const resultado = await provider.cambiarPlan(suscripcionId, 'plan-externo-2');
      expect(resultado.suscripcionId).toBe(suscripcionId);
    });

    test('lanza si la suscripción no existe', async () => {
      await expect(provider.cambiarPlan('no-existe', 'plan-2')).rejects.toThrow('no existe');
    });
  });

  describe('shouldFail', () => {
    test('todos los métodos lanzan error cuando shouldFail=true', async () => {
      const failProvider = new MockBillingProvider({ shouldFail: true });
      await expect(failProvider.crearCliente({})).rejects.toThrow('fallo forzado');
    });
  });
});
