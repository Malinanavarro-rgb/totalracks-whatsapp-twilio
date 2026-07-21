/**
 * TARA Matrix™ — nombre-cliente
 * ─────────────────────────────────────────────────────────────────────────────
 * Decide qué campos de `clientes` actualizar a partir de lo que la IA
 * extrajo en el turno actual (ai_output.datos_extraidos). Pura, sin acceso
 * a DB — separada de server.js para poder probarla sin arrancar el servidor
 * completo (server.js hace app.listen() al cargarse).
 *
 * @module modules/nombre-cliente
 */

'use strict';

/**
 * 'Sin nombre' es el placeholder que crm.js usa al crear un cliente nuevo
 * (nunca null) — se trata igual que "no tengo nombre todavía", para no
 * bloquear la primera captura real. Nunca pisa un nombre o empresa reales
 * ya guardados.
 *
 * @param {{nombre?: string|null, empresa?: string|null}} cliente
 * @param {{nombre?: string|null, empresa?: string|null}} datosExtraidos
 * @returns {{nombre?: string, empresa?: string}}
 */
function calcularCambiosNombreEmpresa(cliente, datosExtraidos) {
  const cambios = {};
  if (datosExtraidos?.nombre && (!cliente?.nombre || cliente.nombre === 'Sin nombre')) {
    cambios.nombre = datosExtraidos.nombre;
  }
  if (datosExtraidos?.empresa && !cliente?.empresa) {
    cambios.empresa = datosExtraidos.empresa;
  }
  return cambios;
}

module.exports = { calcularCambiosNombreEmpresa };
