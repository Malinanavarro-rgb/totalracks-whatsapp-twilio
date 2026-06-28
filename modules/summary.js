/**
 * TARA Matrix™ — summary.js
 * Memory Engine: genera resúmenes comprimidos del cliente para el contexto de OpenAI.
 *
 * FASE 1 : resumen básico desde tabla clientes.
 * FASE 6 : implementación completa — incluirá oportunidades activas, cotizaciones
 *           enviadas, tareas pendientes y últimas conversaciones resumidas.
 *           Reemplazará el historial crudo que hoy se envía a OpenAI.
 */

const { supabase } = require('./clients');

/**
 * Genera un resumen comprimido del cliente.
 * En FASE 6 este string reemplaza el historial crudo como contexto de memoria.
 *
 * @param {number} clienteId
 * @returns {Promise<string>}
 */
async function generarResumenCliente(clienteId) {
  try {
    const { data: cliente } = await supabase
      .from('clientes')
      .select('nombre, empresa, ciudad, estado, score_interes')
      .eq('id', clienteId)
      .maybeSingle();

    if (!cliente) return 'Cliente sin historial previo.';

    const partes = [
      cliente.nombre && cliente.nombre !== 'Sin nombre' ? `Cliente: ${cliente.nombre}` : null,
      cliente.empresa    ? `Empresa: ${cliente.empresa}`          : null,
      cliente.ciudad     ? `Ciudad: ${cliente.ciudad}`            : null,
      `Estado: ${cliente.estado || 'Nuevo'}`,
      `Interés: ${cliente.score_interes || 0}/100`,
      // FASE 6: agregar oportunidad_activa, cotizaciones, tareas, últimas_conversaciones
    ].filter(Boolean);

    return partes.join(' | ');
  } catch (e) {
    console.error('Error en generarResumenCliente:', e);
    return 'Cliente sin historial previo.';
  }
}

module.exports = { generarResumenCliente };
