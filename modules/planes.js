/**
 * TARA Matrix™ — planes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 8.1 — Plataforma Comercial. CRUD del catálogo de planes de
 * suscripción — plataforma-wide, no por empresa (a diferencia de
 * modules/configuracion.js::listarServicios, que sí es por company_id).
 *
 * @module modules/planes
 */

'use strict';

async function listarPlanes(supabase, { soloActivos } = {}) {
  let query = supabase.from('planes').select('*').order('orden', { ascending: true });
  if (soloActivos) query = query.eq('activo', true);

  const { data, error } = await query;
  return error ? [] : (data || []);
}

async function crearPlan(supabase, { clave, nombre, precioCentavos, moneda, periodo, limites, orden }) {
  const { data, error } = await supabase
    .from('planes')
    .insert([{
      clave, nombre,
      precio_centavos: precioCentavos,
      moneda: moneda || 'MXN',
      periodo: periodo || 'mensual',
      limites: limites || {},
      orden: orden ?? 0,
    }])
    .select()
    .single();

  if (error) throw new Error(`planes.crearPlan: ${error.message}`);
  return data;
}

async function actualizarPlan(supabase, id, cambios) {
  const campos = ['nombre', 'precio_centavos', 'moneda', 'periodo', 'stripe_price_id', 'limites', 'activo', 'orden'];
  const payload = {};
  for (const campo of campos) if (cambios[campo] !== undefined) payload[campo] = cambios[campo];

  const { data, error } = await supabase
    .from('planes')
    .update(payload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el plan');
  return data;
}

/**
 * No hay DELETE real: un plan con suscripciones históricas nunca debe
 * desaparecer (rompería la trazabilidad de pagos/facturas pasadas). Retirar
 * un plan de venta es actualizarPlan(id, {activo: false}).
 */
module.exports = { listarPlanes, crearPlan, actualizarPlan };
