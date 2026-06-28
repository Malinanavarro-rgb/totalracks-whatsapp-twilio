/**
 * TARA Matrix™ — decision.js
 * Decision Engine: razona antes de responder.
 *
 * FASE 1 : estructura preparada, pasa datos sin transformar.
 * FASE 5 : implementación completa — leerá cliente, oportunidad activa,
 *           tareas pendientes, historial y generará etapa comercial,
 *           objetivo de conversación, campos faltantes y acción recomendada.
 */

/**
 * Construye el contexto de decisión para una conversación entrante.
 *
 * @param {object} cliente        - objeto cliente desde CRM
 * @param {string} mensajeCliente - mensaje recibido en este turno
 * @returns {Promise<object>}     - contexto de decisión
 */
async function construirContextoDecision(cliente, mensajeCliente) {
  // FASE 5: aquí se leerán oportunidades, tareas, cotizaciones y se generará
  // etapa_comercial, objetivo_conversacion, campos_faltantes y accion_recomendada.
  return {
    cliente,
    mensajeCliente,
    etapa_comercial:       cliente?.estado            || 'Nuevo',
    objetivo_conversacion: null,   // FASE 5
    campos_faltantes:      [],     // FASE 5
    accion_recomendada:    null,   // FASE 7
  };
}

module.exports = { construirContextoDecision };
