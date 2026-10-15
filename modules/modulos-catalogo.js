/**
 * TARA Matrix™ — modulos-catalogo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA Module Engine, Fase 3.1 — lectura del catálogo universal de módulos
 * (migración 128), para poblar el selector visual de Planes.jsx en Panel
 * Maestro. Solo lectura: esta fase no crea ni modifica módulos del catálogo.
 *
 * @module modules/modulos-catalogo
 */

'use strict';

async function listarModulosCatalogo(supabase) {
  const { data, error } = await supabase
    .from('modulos_catalogo')
    .select('*')
    .order('categoria', { ascending: true })
    .order('codigo', { ascending: true });
  return error ? [] : (data || []);
}

module.exports = { listarModulosCatalogo };
