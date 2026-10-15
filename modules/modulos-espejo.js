/**
 * TARA Matrix™ — modulos-espejo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA Module Engine, Fase 1 (Alina, 2026-10-16, revisado 2026-10-17 tras tu
 * revisión del informe de entrega). Calcula qué filas de `modulos_empresa`
 * reflejarían fielmente el `nav_labels.modulos` ACTUAL de una empresa — una
 * copia del estado de hoy, nunca un cambio. Lógica pura, sin acceso a base
 * de datos, para poder probarla y predecir su resultado contra datos reales
 * sin escribir nada.
 *
 * Tres estados, no dos — corrección pedida explícitamente (2026-10-17):
 * un booleano activo/inactivo no distingue "este módulo realmente no se usa"
 * de "este módulo se usa de verdad, solo que no tiene link propio en el
 * menú porque vive integrado dentro de otra pantalla" (caso real:
 * Instalaciones y Cobranza de Nort Energy, accesibles desde Proyecto 360°).
 * Presentar "integrado" como "desactivado" sería engañoso comercialmente.
 *
 *   'activo'     — tiene su propia entrada de navegación, visible, habilitada.
 *   'integrado'  — funcionalidad real, sin nav propio (vive dentro de otra
 *                  pantalla) — nunca se interpreta como "apagado".
 *   'inactivo'   — sin nav propio Y sin marcar como integrado — genuinamente
 *                  no se está usando hoy.
 *
 * `integrado` se lee de un campo nuevo, descriptivo, en la MISMA entrada de
 * nav_labels (`item.integrado === true`) — nunca se infiere, nunca se
 * adivina por nombre de módulo. nav_labels sigue siendo navegación pura:
 * este campo describe DÓNDE vive la función, no si está autorizada — la
 * autorización real (Fase 2) sigue viviendo exclusivamente en
 * modulos_empresa, nunca en nav_labels (condición explícita, no se toca).
 *
 * @module modules/modulos-espejo
 */

'use strict';

const PRIORIDAD_ESTADO = { integrado: 3, activo: 2, inactivo: 1 };

function _estadoDeEntrada(item) {
  if (item.integrado === true) return 'integrado';
  return item.habilitado ? 'activo' : 'inactivo';
}

/**
 * @param {Array<{modulo?: string, habilitado?: boolean, integrado?: boolean}>} navModulos - companies.nav_labels.modulos
 * @returns {Array<{modulo_codigo: string, estado: 'activo'|'integrado'|'inactivo'}>} una fila por cada `modulo` único presente
 */
function calcularEspejoDesdeNavLabels(navModulos) {
  if (!Array.isArray(navModulos)) return [];

  const estadoPorModulo = new Map();
  for (const item of navModulos) {
    if (!item?.modulo) continue;
    const estadoNuevo = _estadoDeEntrada(item);
    const estadoPrevio = estadoPorModulo.get(item.modulo);
    // Si el mismo módulo aparece en más de una entrada (no debería, pero
    // nunca se asume), gana el estado de mayor prioridad — basta con que
    // UNA entrada esté integrada/activa para considerar el módulo en uso.
    const estadoFinal = !estadoPrevio || PRIORIDAD_ESTADO[estadoNuevo] > PRIORIDAD_ESTADO[estadoPrevio]
      ? estadoNuevo : estadoPrevio;
    estadoPorModulo.set(item.modulo, estadoFinal);
  }

  return [...estadoPorModulo.entries()].map(([modulo_codigo, estado]) => ({ modulo_codigo, estado }));
}

module.exports = { calcularEspejoDesdeNavLabels };
