/**
 * TARA Matrix™ — personalidad-presets.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 6: traduce las opciones amigables de configuración
 * (longitud de respuesta, uso de emojis, nivel de iniciativa) a instrucciones
 * reales para el prompt. El cliente nunca ve ni edita estos textos — solo
 * elige entre opciones de negocio (ver modules/configuracion.js); esta es la
 * única pieza que conoce la traducción a lenguaje de instrucción para la IA.
 *
 * Los valores "default" (normales/moderado/sugerir_productos) no agregan
 * ninguna línea — preservan el comportamiento actual de TARA sin cambios.
 *
 * @module modules/personalidad-presets
 */

'use strict';

const INSTRUCCIONES_LONGITUD = {
  cortas:     'Responde de forma breve: máximo 2-3 líneas por mensaje.',
  normales:   null,
  detalladas: 'Puedes dar respuestas más completas y explicativas cuando aporte valor real.',
};

const INSTRUCCIONES_EMOJIS = {
  nunca:     'No uses emojis en tus respuestas.',
  moderado:  null,
  frecuente: 'Usa emojis con frecuencia para sonar cercano y amigable.',
};

const INSTRUCCIONES_INICIATIVA = {
  solo_responder:    'Limítate a responder exactamente lo que se te pregunta. No ofrezcas productos ni sugieras próximos pasos por iniciativa propia.',
  sugerir_productos: null,
  cerrar_ventas:     'Sé proactivo buscando cerrar la venta: en cuanto detectes interés real, sugiere el siguiente paso concreto (cotización, cita, pago).',
};

/**
 * @param {Object} personality - fila de la tabla personalities
 * @returns {string[]} instrucciones a agregar al prompt (vacío si todo es default)
 */
function instruccionesDePersonalidad(personality) {
  return [
    INSTRUCCIONES_LONGITUD[personality?.longitud_respuesta]     ?? null,
    INSTRUCCIONES_EMOJIS[personality?.uso_emojis]                ?? null,
    INSTRUCCIONES_INICIATIVA[personality?.nivel_iniciativa]      ?? null,
  ].filter(Boolean);
}

module.exports = { instruccionesDePersonalidad };
