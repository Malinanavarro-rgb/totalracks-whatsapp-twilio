/**
 * TARA Matrix™ — CalendarProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Contrato que todo proveedor de calendario debe implementar.
 *
 * El Kernel (SchedulingEngine) nunca importa SDKs de calendario directamente.
 * El Kernel nunca sabe si agenda contra Google Calendar, Outlook o un mock.
 * El Kernel solo llama a los métodos de este puerto.
 *
 * Para agregar un proveedor nuevo:
 *   1. Crear clase que extienda CalendarProvider
 *   2. Implementar los 4 métodos + el getter nombre
 *   El Kernel no cambia.
 *
 * Mismo patrón que adapters/ai/ai-provider.js — no se inventa uno distinto.
 *
 * @module adapters/calendar/calendar-provider
 */

'use strict';

/**
 * @typedef {Object} DisponibilidadParams
 * @property {string} calendarioId  - ID del calendario externo a consultar
 * @property {Date}   desde         - Inicio de la ventana a consultar
 * @property {Date}   hasta         - Fin de la ventana a consultar
 */

/**
 * @typedef {Object} BloqueOcupado
 * @property {Date} inicio
 * @property {Date} fin
 */

/**
 * @typedef {Object} EventoParams
 * @property {string} calendarioId
 * @property {string} titulo
 * @property {Date}   inicio
 * @property {Date}   fin
 * @property {string} [descripcion]
 */

/**
 * @typedef {Object} EventoCreado
 * @property {string} id   - ID del evento en el proveedor externo
 */

class CalendarProvider {
  /**
   * Nombre del proveedor. Debe ser kebab-case.
   * Ejemplos: 'google', 'outlook', 'mock-calendar'
   * @returns {string}
   */
  get nombre() {
    throw new Error(`${this.constructor.name} debe implementar nombre`);
  }

  /**
   * Consulta los bloques ocupados de un calendario en una ventana de tiempo.
   * @param {DisponibilidadParams} params
   * @returns {Promise<BloqueOcupado[]>}
   */
  async consultarDisponibilidad(params) {
    throw new Error(`${this.constructor.name} debe implementar consultarDisponibilidad()`);
  }

  /**
   * Crea un evento en el calendario externo.
   * @param {EventoParams} params
   * @returns {Promise<EventoCreado>}
   */
  async crearEvento(params) {
    throw new Error(`${this.constructor.name} debe implementar crearEvento()`);
  }

  /**
   * Actualiza un evento existente.
   * @param {string} eventoId
   * @param {Partial<EventoParams> & {calendarioId: string}} params - calendarioId
   *        es obligatorio: proveedores reales (Google) requieren calendarId + eventId
   *        para editar un evento, no basta con el id del evento.
   * @returns {Promise<EventoCreado>}
   */
  async actualizarEvento(eventoId, params) {
    throw new Error(`${this.constructor.name} debe implementar actualizarEvento()`);
  }

  /**
   * Cancela (elimina) un evento existente.
   * @param {string} eventoId
   * @param {string} calendarioId - obligatorio, mismo motivo que en actualizarEvento()
   * @returns {Promise<void>}
   */
  async cancelarEvento(eventoId, calendarioId) {
    throw new Error(`${this.constructor.name} debe implementar cancelarEvento()`);
  }
}

module.exports = { CalendarProvider };
