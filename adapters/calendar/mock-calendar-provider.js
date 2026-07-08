/**
 * TARA Matrix™ — MockCalendarProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Proveedor de calendario simulado para tests y desarrollo local sin
 * credenciales reales de Google.
 *
 * Comportamiento:
 *   - Mantiene los eventos en memoria (array), sin red
 *   - consultarDisponibilidad() devuelve los eventos en memoria que caen
 *     dentro de la ventana solicitada
 *   - Nunca falla (salvo configuración explícita con shouldFail)
 *
 * Uso en tests:
 *   const mock = new MockCalendarProvider();
 *   const engine = new SchedulingEngine(supabase, mock);
 *
 * Uso para simular fallo:
 *   const mock = new MockCalendarProvider({ shouldFail: true });
 *
 * @module adapters/calendar/mock-calendar-provider
 */

'use strict';

const { randomUUID } = require('crypto');
const { CalendarProvider } = require('./calendar-provider');

class MockCalendarProvider extends CalendarProvider {
  /**
   * @param {Object}  [opts]
   * @param {boolean} [opts.shouldFail=false]  - Si true, todos los métodos lanzan error
   * @param {number}  [opts.latencia_ms=0]     - Latencia simulada en ms
   */
  constructor(opts = {}) {
    super();
    this._shouldFail = opts.shouldFail || false;
    this._latencia   = opts.latencia_ms ?? 0;
    this._eventos    = new Map(); // id -> EventoParams
  }

  get nombre() { return 'mock-calendar'; }

  async _simular() {
    if (this._latencia > 0) {
      await new Promise(resolve => setTimeout(resolve, this._latencia));
    }
    if (this._shouldFail) {
      throw new Error('MockCalendarProvider: fallo forzado para testing');
    }
  }

  /**
   * @param {import('./calendar-provider').DisponibilidadParams} params
   * @returns {Promise<import('./calendar-provider').BloqueOcupado[]>}
   */
  async consultarDisponibilidad({ calendarioId, desde, hasta }) {
    await this._simular();

    return Array.from(this._eventos.values())
      .filter(ev => ev.calendarioId === calendarioId)
      .filter(ev => ev.inicio < hasta && ev.fin > desde)
      .map(ev => ({ inicio: ev.inicio, fin: ev.fin }));
  }

  /**
   * @param {import('./calendar-provider').EventoParams} params
   * @returns {Promise<import('./calendar-provider').EventoCreado>}
   */
  async crearEvento(params) {
    await this._simular();

    const id = randomUUID();
    this._eventos.set(id, { ...params });
    return { id };
  }

  /**
   * @param {string} eventoId
   * @param {Partial<import('./calendar-provider').EventoParams>} params
   * @returns {Promise<import('./calendar-provider').EventoCreado>}
   */
  async actualizarEvento(eventoId, params) {
    await this._simular();

    const existente = this._eventos.get(eventoId);
    if (!existente) {
      throw new Error(`MockCalendarProvider: evento ${eventoId} no existe`);
    }
    this._eventos.set(eventoId, { ...existente, ...params });
    return { id: eventoId };
  }

  /**
   * @param {string} eventoId
   * @returns {Promise<void>}
   */
  async cancelarEvento(eventoId) {
    await this._simular();

    if (!this._eventos.has(eventoId)) {
      throw new Error(`MockCalendarProvider: evento ${eventoId} no existe`);
    }
    this._eventos.delete(eventoId);
  }
}

module.exports = { MockCalendarProvider };
