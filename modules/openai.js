/**
 * TARA Matrix™ — openai.js
 * Llama a OpenAI y extrae la respuesta estructurada.
 * safeParseJSON maneja cualquier formato de respuesta del modelo.
 */

const { openai } = require('./clients');
const { construirSystemPrompt } = require('./prompts');

// ── PARSE SEGURO ──────────────────────────────────────────────────────────────

function safeParseJSON(contenido) {
  try {
    return { ok: true, data: JSON.parse(contenido) };
  } catch (_) {}

  try {
    const inicio = contenido.indexOf('{');
    const fin    = contenido.lastIndexOf('}');
    if (inicio !== -1 && fin > inicio) {
      return { ok: true, data: JSON.parse(contenido.substring(inicio, fin + 1)) };
    }
  } catch (_) {}

  const texto = contenido.trim();
  return {
    ok: false,
    data: {
      categoria_principal: 'Sin clasificar',
      datos_extraidos:     {},
      intenciones:         ['consulta'],
      sentimiento:         'Neutral',
      respuesta_tara: texto.length > 10 && texto.length < 600
        ? texto
        : '¿En qué puedo ayudarte?',
    },
  };
}

// ── ANÁLISIS ──────────────────────────────────────────────────────────────────

/**
 * @param {string} mensajeCliente
 * @param {Array<{mensaje_cliente: string, respuesta_tara: string}>} historial
 * @returns {Promise<{categoria_principal, datos_extraidos, intenciones, sentimiento, respuesta_tara}>}
 */
async function analizarConOpenAI(mensajeCliente, historial) {
  try {
    const systemPrompt = await construirSystemPrompt();

    const mensajes = [{ role: 'system', content: systemPrompt }];

    for (const h of historial) {
      mensajes.push({ role: 'user',      content: h.mensaje_cliente });
      mensajes.push({ role: 'assistant', content: h.respuesta_tara  });
    }
    mensajes.push({ role: 'user', content: mensajeCliente });

    console.log(`📤 OpenAI: historial=${historial.length} msgs`);

    const response = await openai.chat.completions.create({
      model:           'gpt-4o-mini',
      messages:        mensajes,
      temperature:     0.6,
      max_tokens:      700,
      response_format: { type: 'json_object' },
    });

    const crudo     = response.choices[0].message.content.trim();
    console.log(`📥 OpenAI raw: ${crudo.substring(0, 150)}`);

    const resultado = safeParseJSON(crudo);
    if (!resultado.ok) console.log('⚠️ Fallback JSON activado');
    else console.log(`✅ JSON: categoria=${resultado.data.categoria_principal}`);

    return resultado.data;
  } catch (e) {
    console.error('❌ Error OpenAI:', e.message);
    return {
      categoria_principal: 'Sin clasificar',
      datos_extraidos:     {},
      intenciones:         ['consulta'],
      sentimiento:         'Neutral',
      respuesta_tara:      '¿En qué puedo ayudarte?',
    };
  }
}

module.exports = { analizarConOpenAI };
