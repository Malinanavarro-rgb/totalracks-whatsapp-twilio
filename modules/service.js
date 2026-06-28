/**
 * TARA Matrix™ — service.js
 * Orquestador principal: coordina el flujo completo de un mensaje entrante.
 * No contiene lógica de negocio. Delega a los módulos especializados.
 */

const { supabase }                          = require('./clients');
const { obtenerOCrearCliente,
         actualizarScoreInteres,
         obtenerHistorial,
         guardarConversacion,
         crearOportunidadSiCorresponde }    = require('./crm');
const { analizarConOpenAI }                 = require('./openai');

// decision.js y summary.js están importados y preparados para FASE 5 y FASE 6.
// En FASE 1 no modifican el flujo principal.
const { construirContextoDecision }         = require('./decision');
const { generarResumenCliente }             = require('./summary');

/**
 * Procesa un mensaje entrante de WhatsApp y devuelve la respuesta de TARA.
 *
 * @param {string} telefono
 * @param {string} mensajeCliente
 * @returns {Promise<string>} - texto que se envía de vuelta por WhatsApp
 */
async function procesarMensajeTwilio(telefono, mensajeCliente) {
  try {
    console.log(`\n📱 ${telefono}: "${mensajeCliente}"`);

    // 1. Identificar o crear cliente
    const cliente = await obtenerOCrearCliente(telefono);
    if (!cliente) return '¿En qué puedo ayudarte?';

    // 2. Construir contexto de decisión (FASE 5 lo enriquecerá)
    await construirContextoDecision(cliente, mensajeCliente);

    // 3. Obtener historial reciente
    const historial = await obtenerHistorial(cliente.id);

    // 4. Analizar con OpenAI
    const analisis = await analizarConOpenAI(mensajeCliente, historial);

    const {
      categoria_principal,
      datos_extraidos,
      intenciones,
      sentimiento,
      respuesta_tara,
    } = analisis;

    // 5. Guardar conversación con sentimiento real (no hardcodeado)
    await guardarConversacion(
      cliente.id,
      mensajeCliente,
      respuesta_tara,
      categoria_principal,
      intenciones,
      sentimiento
    );

    // 6. Crear oportunidad si corresponde
    await crearOportunidadSiCorresponde(
      cliente.id,
      categoria_principal,
      mensajeCliente,
      intenciones
    );

    // 7. Actualizar score de interés
    await actualizarScoreInteres(cliente.id, cliente.score_interes);

    console.log(`✅ Respuesta: ${respuesta_tara.substring(0, 80)}...`);
    return respuesta_tara;
  } catch (e) {
    console.error('❌ Error general:', e);
    return 'Tuve un problema técnico. Por favor intenta de nuevo.';
  }
}

module.exports = { procesarMensajeTwilio };
