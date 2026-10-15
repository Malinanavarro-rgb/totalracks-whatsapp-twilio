/**
 * TARA Matrix™ — modulos-espejo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA Module Engine, Fase 1 (Alina, 2026-10-16). Calcula qué filas de
 * `modulos_empresa` reflejarían fielmente el `nav_labels.modulos` ACTUAL de
 * una empresa — una copia del estado de hoy, nunca un cambio. Lógica pura,
 * sin acceso a base de datos, para poder probarla y predecir su resultado
 * contra datos reales sin escribir nada (ver TARA_MODULE_ENGINE_PLAN_V1.md).
 *
 * Regla del espejo: solo refleja entradas de nav que YA traen el campo
 * `modulo` (agregado para Nort Energy el 2026-10-01, scripts/nort-energy-nav-
 * modulo-permisos.js) — nunca inventa un mapeo para una empresa que no lo
 * tiene. Una empresa sin ninguna entrada con `modulo` produce un espejo
 * vacío ([]), que es exactamente correcto: sin filas en modulos_empresa, la
 * futura Fase 2 trata eso como "todo activo" (cero regresión).
 *
 * nav_labels sigue siendo navegación pura — este cálculo LEE de ahí, nunca
 * lo convierte en mecanismo de autorización (eso vive en modulos_empresa,
 * una tabla nueva y separada).
 *
 * @module modules/modulos-espejo
 */

'use strict';

/**
 * @param {Array<{modulo?: string, habilitado?: boolean}>} navModulos - companies.nav_labels.modulos
 * @returns {Array<{modulo_codigo: string, activo: boolean}>} una fila por cada `modulo` único presente
 */
function calcularEspejoDesdeNavLabels(navModulos) {
  if (!Array.isArray(navModulos)) return [];

  const activoPorModulo = new Map();
  for (const item of navModulos) {
    if (!item?.modulo) continue;
    // Si el mismo módulo aparece en más de una entrada de nav (no debería,
    // pero nunca se asume), cualquier entrada habilitada=true gana — basta
    // con que UNA ruta real de ese módulo esté visible para considerarlo
    // "en uso" hoy.
    const yaActivo = activoPorModulo.get(item.modulo);
    activoPorModulo.set(item.modulo, Boolean(yaActivo) || Boolean(item.habilitado));
  }

  return [...activoPorModulo.entries()].map(([modulo_codigo, activo]) => ({ modulo_codigo, activo }));
}

module.exports = { calcularEspejoDesdeNavLabels };
