/**
 * TARA Matrix™ — OpenAIProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Implementación de AIProvider para OpenAI (gpt-4o-mini, gpt-4o, etc.)
 *
 * Responsabilidades:
 *   - Construir el array de mensajes para la API de OpenAI
 *   - Llamar a chat.completions.create()
 *   - Parsear el JSON de la respuesta a AIOutput (con fallback seguro)
 *   - Calcular costo estimado por llamada
 *
 * El Core nunca importa este archivo. Solo lo usa el AIEngine.
 *
 * @module adapters/ai/openai-provider
 */

'use strict';

const { AIProvider, FALLBACK_OUTPUT } = require('./ai-provider');

// Precios por 1M tokens (USD) — actualizar cuando OpenAI cambie pricing
const PRICING_PER_M = {
  'gpt-4o-mini':        { input: 0.15,  output: 0.60  },
  'gpt-4o':             { input: 2.50,  output: 10.00 },
  'gpt-4-turbo':        { input: 10.00, output: 30.00 },
  'gpt-4':              { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo':      { input: 0.50,  output: 1.50  },
};

// ── Parser seguro ─────────────────────────────────────────────────────────────

/**
 * Intenta parsear el JSON de la respuesta del modelo.
 * Maneja tres casos:
 *   1. JSON perfecto
 *   2. JSON con texto extra antes/después (extrae el primer objeto)
 *   3. Texto plano → respuesta de emergencia
 *
 * @param {string} raw
 * @returns {{ data: Object, confianza: number }}
 */
function parsearRespuesta(raw) {
  const texto = (raw || '').trim();

  // Caso 1: JSON perfecto
  try {
    return { data: JSON.parse(texto), confianza: 0.95 };
  } catch (_) {}

  // Caso 2: JSON embebido en texto
  try {
    const inicio = texto.indexOf('{');
    const fin    = texto.lastIndexOf('}');
    if (inicio !== -1 && fin > inicio) {
      const data = JSON.parse(texto.substring(inicio, fin + 1));
      return { data, confianza: 0.70 };
    }
  } catch (_) {}

  // Caso 3: texto plano — usar como respuesta directa si es razonable
  const usable = texto.length > 5 && texto.length < 800;
  return {
    data: {
      respuesta_tara: usable ? texto : null,
    },
    confianza: 0.20,
  };
}

/**
 * Normaliza el objeto JSON del modelo al tipo AIOutput del Core.
 * Permite que el modelo use nombres alternativos sin romper el sistema.
 */
function normalizarOutput(data, confianza, meta) {
  // El modelo puede responder con "respuesta_tara" (FASE 1) o "respuesta_texto"
  const respuesta = data.respuesta_texto || data.respuesta_tara
    || FALLBACK_OUTPUT.respuesta_texto;

  return {
    respuesta_texto:     respuesta,
    categoria_principal: data.categoria_principal || 'Sin clasificar',
    datos_extraidos:     data.datos_extraidos      || {},
    intenciones:         Array.isArray(data.intenciones) ? data.intenciones : ['consulta'],
    sentimiento:         data.sentimiento          || 'Neutral',
    etapa_sugerida:      data.etapa_sugerida       || null,
    acciones_propuestas: Array.isArray(data.acciones_propuestas) ? data.acciones_propuestas : [],
    confianza,
    tokens_entrada:      meta.tokens_entrada,
    tokens_salida:       meta.tokens_salida,
    modelo_utilizado:    meta.modelo,
    proveedor_utilizado: 'openai',
    latencia_ms:         meta.latencia_ms,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

class OpenAIProvider extends AIProvider {
  /**
   * @param {import('openai').OpenAI} openaiClient - Instancia del cliente OpenAI
   */
  constructor(openaiClient) {
    super();
    this._client = openaiClient;
  }

  get nombre() { return 'openai'; }

  get modelos() {
    return [
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
    ];
  }

  /**
   * Llama a la API de OpenAI y devuelve un AIOutput normalizado.
   * @param {import('./ai-provider').AIInput} input
   * @returns {Promise<import('./ai-provider').AIOutput>}
   */
  async procesar(input) {
    const inicio = Date.now();

    // Construir array de mensajes
    const mensajes = [{ role: 'system', content: input.system_prompt }];

    for (const par of (input.memoria_corta || [])) {
      mensajes.push({ role: 'user',      content: par.mensaje_cliente });
      mensajes.push({ role: 'assistant', content: par.respuesta_tara  });
    }
    mensajes.push({ role: 'user', content: input.mensaje_actual });

    console.log(`📤 OpenAI [${input.modelo}] — historial: ${input.memoria_corta?.length || 0} turnos`);

    const response = await this._client.chat.completions.create({
      model:           input.modelo || 'gpt-4o-mini',
      messages:        mensajes,
      temperature:     input.temperatura   ?? 0.6,
      max_tokens:      input.max_tokens    ?? 700,
      response_format: { type: 'json_object' },
    });

    const latencia_ms     = Date.now() - inicio;
    const raw             = response.choices[0].message.content.trim();
    const tokens_entrada  = response.usage?.prompt_tokens     || 0;
    const tokens_salida   = response.usage?.completion_tokens || 0;
    const modelo          = response.model || input.modelo;

    console.log(`📥 OpenAI [${modelo}] — ${tokens_entrada}+${tokens_salida} tokens — ${latencia_ms}ms`);

    const { data, confianza } = parsearRespuesta(raw);

    if (confianza < 0.5) {
      console.warn(`⚠️  OpenAI devolvió respuesta de baja confianza (${confianza})`);
    }

    return normalizarOutput(data, confianza, { tokens_entrada, tokens_salida, modelo, latencia_ms });
  }

  /**
   * Calcula el costo estimado en USD de una llamada.
   * @param {number} tokens_entrada
   * @param {number} tokens_salida
   * @param {string} modelo
   * @returns {number}
   */
  calcularCosto(tokens_entrada, tokens_salida, modelo) {
    const precios = PRICING_PER_M[modelo] || PRICING_PER_M['gpt-4o-mini'];
    return (tokens_entrada / 1_000_000) * precios.input
         + (tokens_salida  / 1_000_000) * precios.output;
  }
}

module.exports = { OpenAIProvider };
