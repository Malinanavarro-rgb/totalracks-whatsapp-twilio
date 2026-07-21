/**
 * TARA Matrix™ — permisos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Consolida `ROLES_GERENCIALES`, duplicado hasta ahora en `agenda.js`,
 * `conversaciones.js`, `crm-ui.js`, `inbox.js` y `server.js` (deuda ya
 * documentada en la auditoría previa al Inbox Inteligente) — una sola
 * fuente de verdad de qué roles ven todo dentro de su empresa vs. solo lo
 * asignado a sí mismos.
 *
 * No cambia el comportamiento de ningún módulo — mismo valor exacto que ya
 * tenían todos (`['owner', 'administrador', 'supervisor']`), solo deja de
 * estar repetido cinco veces.
 *
 * @module modules/permisos
 */

'use strict';

const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

/**
 * @param {string} rol
 * @returns {boolean}
 */
function esGerencial(rol) {
  return ROLES_GERENCIALES.includes(rol);
}

module.exports = { ROLES_GERENCIALES, esGerencial };
