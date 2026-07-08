/**
 * TARA Matrix™ — mensaje-automatico
 * ─────────────────────────────────────────────────────────────────────────────
 * Renderizado de plantillas de mensajes_automaticos. Función pura, sin DB
 * ni red — la fecha/hora/nombre/asesor de un mensaje operativo siempre
 * vienen de aquí, nunca de texto generado (Anexo, sección 4.2.1, regla 1).
 *
 * @module modules/mensaje-automatico
 */

'use strict';

/**
 * Sustituye {{variable}} en una plantilla. Variables sin valor se dejan
 * como cadena vacía (nunca se deja "{{nombre}}" literal en el mensaje final).
 * @param {string} plantilla
 * @param {Object<string,string>} variables
 * @returns {string}
 */
function renderizarPlantilla(plantilla, variables = {}) {
  return plantilla.replace(/\{\{(\w+)\}\}/g, (_, clave) => {
    const valor = variables[clave];
    return valor != null ? String(valor) : '';
  });
}

module.exports = { renderizarPlantilla };
