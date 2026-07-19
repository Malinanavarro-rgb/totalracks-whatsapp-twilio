/**
 * TARA Matrix™ — billing-engine/estados.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Funciones puras. `suscripciones.estado` es el vocabulario CANÓNICO de
 * negocio (trial|active|past_due|suspended|cancelled|expired) — nunca un
 * espejo directo de un proveedor. Cada proveedor tiene su propio
 * vocabulario de estado; `mapearEstadoProveedor()` es el ÚNICO lugar del
 * código que lo traduce. Esto es lo que permite sustituir Stripe por
 * Mercado Pago/OpenPay sin tocar ningún otro módulo de plataforma: ninguno
 * de ellos conoce el vocabulario de un proveedor específico.
 *
 * @module modules/billing-engine/estados
 */

'use strict';

// Estos 3 estados canónicos mantienen a la organización recibiendo tráfico
// real de WhatsApp (ver sincronizarEstadoOperativo en plataforma-billing.js)
// — past_due incluido a propósito: se le da margen antes de suspender,
// igual que ya hacía Fase 8.1 con el espejo de Stripe.
const ESTADOS_OPERATIVOS = ['trial', 'active', 'past_due'];

const MAPA_STRIPE = {
  trialing: 'trial',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'past_due',
  incomplete_expired: 'expired',
  canceled: 'cancelled',
  paused: 'suspended',
};

// Mercado Pago/OpenPay: se agrega su mapa aquí cuando exista una cuenta
// real conectada (fuera de este plan) — mismo criterio que
// GoogleCalendarProvider vs. MockCalendarProvider: el puerto ya existe, el
// adaptador concreto se agrega cuando hay algo real que adaptar.
const MAPAS_POR_PROVEEDOR = { stripe: MAPA_STRIPE };

/**
 * @param {string} proveedor   - 'stripe' | 'mercadopago' | 'openpay' ('manual' no aplica, ver abajo)
 * @param {string} estadoBruto - estado tal cual lo reporta el proveedor, sin traducir
 * @returns {string} estado canónico
 */
function mapearEstadoProveedor(proveedor, estadoBruto) {
  if (proveedor === 'manual') {
    throw new Error('mapearEstadoProveedor: "manual" no tiene estados de proveedor que traducir — se asigna el estado canónico directamente');
  }
  const mapa = MAPAS_POR_PROVEEDOR[proveedor];
  if (!mapa) throw new Error(`mapearEstadoProveedor: proveedor desconocido "${proveedor}"`);

  const estadoCanonico = mapa[estadoBruto];
  if (!estadoCanonico) throw new Error(`mapearEstadoProveedor: "${proveedor}" reportó un estado sin mapeo canónico: "${estadoBruto}"`);
  return estadoCanonico;
}

function esEstadoOperativo(estadoCanonico) {
  return ESTADOS_OPERATIVOS.includes(estadoCanonico);
}

/** true si una suscripción trial ya venció su fecha_prueba_fin y sigue en estado 'trial'. */
function haExpirado(suscripcion, ahora = new Date()) {
  return suscripcion.estado === 'trial'
    && !!suscripcion.fecha_prueba_fin
    && new Date(suscripcion.fecha_prueba_fin).getTime() <= ahora.getTime();
}

module.exports = { ESTADOS_OPERATIVOS, mapearEstadoProveedor, esEstadoOperativo, haExpirado };
