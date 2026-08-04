/**
 * TARA Matrix™ — motores-ingenieria/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registro de motores de ingeniería por industria — mismo principio que
 * `KPI_TIPOS` en modules/dashboard-engine.js, aplicado a este dominio: el
 * MECANISMO de resolución es genérico (buscar por industria_slug), pero
 * cada motor es legítimamente específico de su giro — las fórmulas de
 * dimensionamiento fotovoltaico no tienen equivalente sensato en racks o
 * elevadores, forzar una "fórmula genérica" sería una generalización
 * falsa. Agregar una industria nueva es agregar un archivo nuevo aquí
 * registrado por su slug, sin tocar ningún motor existente.
 *
 * @module modules/motores-ingenieria
 */

'use strict';

const panelesSolares = require('./paneles-solares');

const MOTORES = {
  paneles_solares: panelesSolares,
};

/** @returns {Object|null} el motor de la industria, o null si esa industria no tiene uno. */
function obtenerMotor(industriaSlug) {
  return MOTORES[industriaSlug] || null;
}

module.exports = { MOTORES, obtenerMotor };
