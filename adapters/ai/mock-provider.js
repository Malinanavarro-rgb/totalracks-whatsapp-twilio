/**
 * TARA Matrix™ — MockProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Proveedor de IA simulado para tests y desarrollo local sin créditos de OpenAI.
 *
 * Comportamiento:
 *   - Devuelve AIOutput realistas basados en palabras clave del mensaje
 *   - Costo siempre $0
 *   - Latencia simulada configurable
 *   - Nunca falla (salvo configuración explícita con shouldFail)
 *
 * Uso en tests:
 *   const mock = new MockProvider();
 *   const engine = new AIEngine(mock);
 *
 * Uso para simular fallo:
 *   const mock = new MockProvider({ shouldFail: true });
 *
 * @module adapters/ai/mock-provider
 */

'use strict';

const { AIProvider } = require('./ai-provider');

// Patrones de detección de intención (sin lógica de negocio)
const PATRON_INTERES     = /precio|costo|cuánto|cuanto|cotiz|propuesta|presupuesto/i;
const PATRON_AGENDA      = /cita|agendar|cuando|horario|disponib|reserv/i;
const PATRON_NEGATIVO    = /no me interesa|caro|imposible|no gracias|cancelar/i;

class MockProvider extends AIProvider {
  /**
   * @param {Object}  [opts]
   * @param {boolean} [opts.shouldFail=false]  - Si true, procesar() lanza error
   * @param {number}  [opts.latencia_ms=50]    - Latencia simulada en ms
   */
  constructor(opts = {}) {
    super();
    this._shouldFail = opts.shouldFail || false;
    this._latencia   = opts.latencia_ms ?? 50;
  }

  get nombre() { return 'mock'; }
  get modelos() { return ['mock-v1']; }

  /**
   * @param {import('./ai-provider').AIInput} input
   * @returns {Promise<import('./ai-provider').AIOutput>}
   */
  async procesar(input) {
    if (this._shouldFail) {
      throw new Error('MockProvider: fallo forzado para testing');
    }

    // Simular latencia de red
    if (this._latencia > 0) {
      await new Promise(resolve => setTimeout(resolve, this._latencia));
    }

    const inicio  = Date.now();
    const mensaje = input.mensaje_actual || '';

    const quiereInteres  = PATRON_INTERES.test(mensaje);
    const quiereAgenda   = PATRON_AGENDA.test(mensaje);
    const esNegativo     = PATRON_NEGATIVO.test(mensaje);

    const intenciones = quiereInteres
      ? ['solicitud_cotizacion', 'interes_compra']
      : quiereAgenda
        ? ['seguimiento']
        : ['consulta_general'];

    const sentimiento = esNegativo
      ? 'Negativo'
      : quiereInteres
        ? 'Muy interesado'
        : 'Neutral';

    const acciones = quiereInteres
      ? [{ tipo: 'crear_oportunidad', parametros: {} }]
      : quiereAgenda
        ? [{ tipo: 'crear_tarea', parametros: { tipo: 'cita' } }]
        : [];

    return {
      respuesta_texto:     `[MOCK] Entendido. Me ocupo de tu solicitud sobre: "${mensaje.substring(0, 60)}"`,
      categoria_principal: 'Sin clasificar',
      datos_extraidos:     {},
      intenciones,
      sentimiento,
      etapa_sugerida:      quiereInteres ? 'Calificacion' : 'Nuevo',
      acciones_propuestas: acciones,
      confianza:           0.5,
      tokens_entrada:      0,
      tokens_salida:       0,
      modelo_utilizado:    'mock-v1',
      proveedor_utilizado: 'mock',
      latencia_ms:         Date.now() - inicio,
    };
  }

  calcularCosto(_tokens_entrada, _tokens_salida, _modelo) {
    return 0;
  }
}

module.exports = { MockProvider };
