/**
 * TARA Matrix™ — BillingProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Contrato que todo proveedor de pagos debe implementar (Stripe, Mercado
 * Pago, OpenPay, ...). La capa de plataforma (modules/plataforma-billing.js)
 * nunca importa un SDK de pagos directamente, ni conoce el vocabulario de
 * estado propio de un proveedor — solo llama a los métodos de este puerto y
 * traduce lo que devuelve vía modules/billing-engine/estados.js.
 *
 * Para agregar un proveedor nuevo:
 *   1. Crear clase que extienda BillingProvider
 *   2. Implementar los 5 métodos + el getter nombre
 *   La capa de plataforma no cambia.
 *
 * Mismo patrón que adapters/calendar/calendar-provider.js — no se inventa
 * uno distinto.
 *
 * @module adapters/billing/billing-provider
 */

'use strict';

/**
 * @typedef {Object} ClienteCreado
 * @property {string} clienteId - ID del cliente en el proveedor externo
 */

/**
 * @typedef {Object} MetodoPagoGuardado
 * @property {string} token
 * @property {string} [ultimos4]
 * @property {string} [marca]
 * @property {string} [fechaExpiracion] - 'MM/YY'
 */

/**
 * @typedef {Object} SuscripcionCreada
 * @property {string} suscripcionId - ID de la suscripción en el proveedor externo
 * @property {string} estadoBruto   - estado tal cual lo reporta el proveedor (sin traducir)
 */

class BillingProvider {
  /**
   * Nombre del proveedor. Debe coincidir con el CHECK de suscripciones.proveedor/pagos.proveedor.
   * Ejemplos: 'stripe', 'mercadopago', 'openpay', 'manual'
   * @returns {string}
   */
  get nombre() {
    throw new Error(`${this.constructor.name} debe implementar nombre`);
  }

  /**
   * @param {{nombre: string, email?: string}} datos
   * @returns {Promise<ClienteCreado>}
   */
  async crearCliente(datos) {
    throw new Error(`${this.constructor.name} debe implementar crearCliente()`);
  }

  /**
   * @param {string} clienteId
   * @param {string} token - token de método de pago ya generado del lado del cliente (nunca el PAN)
   * @returns {Promise<MetodoPagoGuardado>}
   */
  async guardarMetodoPago(clienteId, token) {
    throw new Error(`${this.constructor.name} debe implementar guardarMetodoPago()`);
  }

  /**
   * @param {string} clienteId
   * @param {string} planExternoId - id del precio/plan en el proveedor (ej. stripe_price_id)
   * @returns {Promise<SuscripcionCreada>}
   */
  async crearSuscripcion(clienteId, planExternoId) {
    throw new Error(`${this.constructor.name} debe implementar crearSuscripcion()`);
  }

  /**
   * @param {string} suscripcionExternaId
   * @returns {Promise<void>}
   */
  async cancelarSuscripcion(suscripcionExternaId) {
    throw new Error(`${this.constructor.name} debe implementar cancelarSuscripcion()`);
  }

  /**
   * @param {string} suscripcionExternaId
   * @param {string} nuevoPlanExternoId
   * @returns {Promise<SuscripcionCreada>}
   */
  async cambiarPlan(suscripcionExternaId, nuevoPlanExternoId) {
    throw new Error(`${this.constructor.name} debe implementar cambiarPlan()`);
  }
}

module.exports = { BillingProvider };
