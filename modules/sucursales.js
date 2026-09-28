/**
 * TARA Matrix™ — sucursales.js
 * ─────────────────────────────────────────────────────────────────────────────
 * `sucursales` existe desde la migración 076 (Inbox Inteligente) y ya la
 * referencian `proyectos`, `instalaciones`, `inventario_saldos`,
 * `ordenes_compra`, etc. — pero nunca tuvo un endpoint propio: hasta hoy
 * ningún selector del frontend podía listar las sucursales reales de la
 * empresa (todo lo que la mostraba solo heredaba un `sucursal_id` ya
 * resuelto, nunca dejaba elegir). Primer consumidor real: el selector de
 * sucursal al crear una orden de compra (2G).
 *
 * @module modules/sucursales
 */

'use strict';

async function listarSucursales(supabase, companyId, { soloActivas = true } = {}) {
  let query = supabase.from('sucursales').select('*').eq('company_id', companyId).order('nombre', { ascending: true });
  if (soloActivas) query = query.eq('activo', true);
  const { data, error } = await query;
  return error ? [] : (data || []);
}

module.exports = { listarSucursales };
