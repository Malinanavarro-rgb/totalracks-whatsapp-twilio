/**
 * TARA Matrix™ — ActionRunner (M8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Registro de handlers para las acciones que el AI Engine propone o que un
 * nodo de workflow dispara (`accion.tipo`). Reemplaza el `if` hardcodeado que
 * vivía dentro de `Orchestrator._ejecutarAcciones()` (stub FASE 4B).
 *
 * El ActionRunner no conoce ningún negocio: solo despacha por `tipo` al
 * handler registrado. Cada módulo del Kernel (crm.js, y más adelante
 * SchedulingEngine) se registra aquí con sus propios tipos de acción.
 *
 * @module modules/action-runner
 */

'use strict';

class ActionRunner {
  constructor() {
    this._handlers = new Map();
  }

  /**
   * Registra un handler para un tipo de acción.
   * @param {string}   tipo
   * @param {Function} handlerFn - (parametros, ctx) => Promise<any>
   */
  registrar(tipo, handlerFn) {
    this._handlers.set(tipo, handlerFn);
  }

  /**
   * Ejecuta una acción despachando al handler registrado para su tipo.
   * @param {{tipo: string, parametros: Object}} accion
   * @param {Object} ctx
   * @returns {Promise<any|{error: string}>}
   */
  async ejecutar(accion, ctx) {
    const handler = this._handlers.get(accion.tipo);
    if (!handler) return { error: `Acción desconocida: ${accion.tipo}` };
    return handler(accion.parametros, ctx);
  }
}

module.exports = { ActionRunner };
