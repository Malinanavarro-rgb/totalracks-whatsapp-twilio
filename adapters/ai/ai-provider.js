/**
 * TARA Matrix™ — AIProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Contrato que todo proveedor de IA debe implementar.
 *
 * El Core nunca importa SDKs de IA directamente.
 * El Core nunca sabe si responde OpenAI, Anthropic, Gemini o un modelo propio.
 * El Core solo llama a AIEngine.procesar() y recibe un AIOutput.
 *
 * Para agregar un proveedor nuevo:
 *   1. Crear clase que extienda AIProvider
 *   2. Implementar procesar() y calcularCosto()
 *   3. Registrar en AIEngine con registerProvider()
 *   El Core no cambia.
 *
 * @module adapters/ai/ai-provider
 */

'use strict';

const { CLASIFICACION_POR_DEFECTO } = require('../../modules/clasificacion-contexto');

/**
 * @typedef {Object} MessagePair
 * @property {string} mensaje_cliente
 * @property {string} respuesta_tara
 */

/**
 * @typedef {Object} ActionRequest
 * @property {string} tipo
 * @property {Object} parametros
 */

/**
 * @typedef {Object} AIInput
 * @property {string}        system_prompt  - Prompt construido por PromptBuilder
 * @property {MessagePair[]} memoria_corta  - Últimos N turnos de conversación
 * @property {string}        mensaje_actual - Mensaje del cliente en este turno
 * @property {number}        temperatura    - 0.0–1.0
 * @property {number}        max_tokens     - Límite de tokens en la respuesta
 * @property {string}        modelo         - Modelo a utilizar (viene de company config)
 */

/**
 * @typedef {Object} AIOutput
 * @property {string}          respuesta_texto      - Lo que TARA responde al cliente
 * @property {string}          clasificacion_contexto - Contexto real del mensaje (prospecto, cliente_existente, proveedor, conversacion_personal, numero_equivocado, spam, informacion_administrativa, contexto_insuficiente) — interno, nunca se muestra al cliente
 * @property {string}          categoria_principal  - Categoría universal detectada
 * @property {Object}          datos_extraidos      - Datos estructurados del mensaje
 * @property {string[]}        intenciones          - Intenciones detectadas
 * @property {string}          sentimiento          - Sentimiento del cliente
 * @property {string}          etapa_sugerida       - Etapa comercial sugerida
 * @property {ActionRequest[]} acciones_propuestas  - Acciones que el AI sugiere
 * @property {number}          confianza            - 0–1 (1 = respuesta perfecta)
 * @property {number}          tokens_entrada       - Tokens consumidos en el prompt
 * @property {number}          tokens_salida        - Tokens en la respuesta
 * @property {string}          modelo_utilizado     - Modelo que respondió
 * @property {string}          proveedor_utilizado  - Proveedor que respondió
 * @property {number}          latencia_ms          - Tiempo total de la llamada
 */

/**
 * Respuesta de emergencia cuando todos los proveedores fallan.
 * El Core nunca se detiene.
 * @type {Partial<AIOutput>}
 */
const FALLBACK_OUTPUT = {
  respuesta_texto:     'Tuve un momento técnico. ¿Puedes repetir tu mensaje?',
  clasificacion_contexto: CLASIFICACION_POR_DEFECTO,
  categoria_principal: 'Sin clasificar',
  datos_extraidos:     {},
  intenciones:         ['consulta'],
  sentimiento:         'Neutral',
  etapa_sugerida:      null,
  acciones_propuestas: [],
  confianza:           0,
  tokens_entrada:      0,
  tokens_salida:       0,
  modelo_utilizado:    'fallback',
  proveedor_utilizado: 'none',
  latencia_ms:         0,
};

class AIProvider {
  /**
   * Nombre del proveedor. Debe ser kebab-case.
   * Ejemplos: 'openai', 'anthropic', 'google', 'mock'
   * @returns {string}
   */
  get nombre() {
    throw new Error(`${this.constructor.name} debe implementar nombre`);
  }

  /**
   * Lista de identificadores de modelos que este proveedor soporta.
   * El AIEngine los usa para resolver qué provider llamar.
   * @returns {string[]}
   */
  get modelos() {
    throw new Error(`${this.constructor.name} debe implementar modelos`);
  }

  /**
   * Llama al modelo y devuelve un AIOutput.
   * @param {AIInput} input
   * @returns {Promise<AIOutput>}
   */
  async procesar(input) {
    throw new Error(`${this.constructor.name} debe implementar procesar()`);
  }

  /**
   * Calcula el costo estimado en USD de una llamada.
   * @param {number} tokens_entrada
   * @param {number} tokens_salida
   * @param {string} modelo
   * @returns {number} costo en USD
   */
  calcularCosto(tokens_entrada, tokens_salida, modelo) {
    throw new Error(`${this.constructor.name} debe implementar calcularCosto()`);
  }
}

module.exports = { AIProvider, FALLBACK_OUTPUT };
