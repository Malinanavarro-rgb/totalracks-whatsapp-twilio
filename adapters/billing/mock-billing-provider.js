/**
 * TARA Matrix™ — MockBillingProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Proveedor de pagos simulado — lo que de verdad usan las suscripciones
 * `proveedor='manual'` (Enterprise, promociones, o mientras no exista una
 * cuenta real de Stripe/Mercado Pago/OpenPay conectada). Nunca llama a
 * ningún servicio externo.
 *
 * Mismo criterio que adapters/calendar/mock-calendar-provider.js: estado en
 * memoria (Map), shouldFail/latencia_ms opcionales para tests.
 *
 * @module adapters/billing/mock-billing-provider
 */

'use strict';

const { randomUUID } = require('crypto');
const { BillingProvider } = require('./billing-provider');

class MockBillingProvider extends BillingProvider {
  /**
   * @param {Object}  [opts]
   * @param {boolean} [opts.shouldFail=false]
   * @param {number}  [opts.latencia_ms=0]
   */
  constructor(opts = {}) {
    super();
    this._shouldFail = opts.shouldFail || false;
    this._latencia   = opts.latencia_ms ?? 0;
    this._clientes      = new Map(); // clienteId -> datos
    this._metodosPago   = new Map(); // clienteId -> MetodoPagoGuardado
    this._suscripciones = new Map(); // suscripcionId -> { clienteId, planExternoId, estadoBruto }
  }

  get nombre() { return 'manual'; }

  async _simular() {
    if (this._latencia > 0) await new Promise(resolve => setTimeout(resolve, this._latencia));
    if (this._shouldFail) throw new Error('MockBillingProvider: fallo forzado para testing');
  }

  async crearCliente(datos) {
    await this._simular();
    const clienteId = randomUUID();
    this._clientes.set(clienteId, { ...datos });
    return { clienteId };
  }

  async guardarMetodoPago(clienteId, token) {
    await this._simular();
    const resultado = { token, ultimos4: '0000', marca: 'Mock', fechaExpiracion: '12/99' };
    this._metodosPago.set(clienteId, resultado);
    return resultado;
  }

  async crearSuscripcion(clienteId, planExternoId) {
    await this._simular();
    const suscripcionId = randomUUID();
    this._suscripciones.set(suscripcionId, { clienteId, planExternoId, estadoBruto: 'active' });
    return { suscripcionId, estadoBruto: 'active' };
  }

  async cancelarSuscripcion(suscripcionExternaId) {
    await this._simular();
    const existente = this._suscripciones.get(suscripcionExternaId);
    if (!existente) throw new Error(`MockBillingProvider: suscripción ${suscripcionExternaId} no existe`);
    existente.estadoBruto = 'cancelled';
  }

  async cambiarPlan(suscripcionExternaId, nuevoPlanExternoId) {
    await this._simular();
    const existente = this._suscripciones.get(suscripcionExternaId);
    if (!existente) throw new Error(`MockBillingProvider: suscripción ${suscripcionExternaId} no existe`);
    existente.planExternoId = nuevoPlanExternoId;
    return { suscripcionId: suscripcionExternaId, estadoBruto: existente.estadoBruto };
  }
}

module.exports = { MockBillingProvider };
