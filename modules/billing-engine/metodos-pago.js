/**
 * TARA Matrix™ — billing-engine/metodos-pago.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD de métodos de pago. `token` es siempre el identificador que asigna
 * el proveedor — nunca el número de tarjeta (PCI). Sin un proveedor real
 * conectado todavía, esto es lo que respalda el botón "Actualizar método
 * de pago" del Panel Maestro: una escritura real en base de datos, sin
 * llamar a ningún gateway.
 *
 * @module modules/billing-engine/metodos-pago
 */

'use strict';

async function registrarMetodoPago(supabase, { organizationId, proveedor, token, ultimos4, marca, fechaExpiracion }) {
  // Un método de pago nuevo reemplaza al vigente — nunca se borra el
  // histórico (mismo criterio que suscripciones: "vigente" es una consulta,
  // no un estado exclusivo mutuamente excluyente a nivel de fila única).
  await supabase.from('metodos_pago')
    .update({ estado: 'reemplazado', updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('estado', 'activo');

  const { data, error } = await supabase
    .from('metodos_pago')
    .insert([{ organization_id: organizationId, proveedor, token, ultimos4, marca, fecha_expiracion: fechaExpiracion }])
    .select()
    .single();

  if (error) throw new Error(`billing-engine.metodos-pago.registrarMetodoPago: ${error.message}`);
  return data;
}

async function obtenerMetodoPagoVigente(supabase, organizationId) {
  const { data, error } = await supabase
    .from('metodos_pago')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('estado', 'activo')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}

async function listarMetodosPago(supabase, organizationId) {
  const { data, error } = await supabase
    .from('metodos_pago')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  return error ? [] : (data || []);
}

module.exports = { registrarMetodoPago, obtenerMetodoPagoVigente, listarMetodosPago };
