/**
 * TARA Matrix™ — clientes-identidad.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inbox Inteligente (v0.4) — desacopla "quién es el cliente" de "por dónde
 * escribió". `clientes.telefono` era `UNIQUE NOT NULL` (asumía que todo
 * cliente se identifica por teléfono) — Facebook/Instagram usan PSID/IGSID,
 * Correo un email, Web Chat un token de sesión, ninguno es un teléfono.
 *
 * Para WhatsApp, `resolverOCrearClientePorCanal()` delega tal cual en
 * `modules/crm.js::obtenerOCrearCliente()` (congelado por ADR-005) — cero
 * cambios de comportamiento en el único canal real hoy. Los canales nuevos
 * resuelven vía `clientes_identidades` (migración 076).
 *
 * @module modules/clientes-identidad
 */

'use strict';

const { obtenerOCrearCliente } = require('./crm');

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - solo se usa para canales no-WhatsApp
 * @param {{canal: string, identificador: string, company_id: string}} datos
 * @returns {Promise<Object>} la fila de `clientes` (existente o recién creada)
 */
async function resolverOCrearClientePorCanal(supabase, { canal, identificador, company_id }) {
  if (!canal || !identificador) {
    throw new Error('clientes-identidad.resolverOCrearClientePorCanal: canal e identificador son requeridos');
  }

  if (canal === 'whatsapp') {
    // Camino congelado, sin cambios — mismo comportamiento de siempre.
    return obtenerOCrearCliente(identificador, company_id);
  }

  const { data: identidad, error: errIdentidad } = await supabase
    .from('clientes_identidades')
    .select('cliente_id')
    .eq('canal', canal)
    .eq('identificador', identificador)
    .maybeSingle();

  if (errIdentidad) throw new Error(`clientes-identidad.resolverOCrearClientePorCanal: ${errIdentidad.message}`);

  if (identidad) {
    const { data: cliente, error: errCliente } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', identidad.cliente_id)
      .maybeSingle();
    if (errCliente) throw new Error(`clientes-identidad.resolverOCrearClientePorCanal: ${errCliente.message}`);
    if (cliente) return cliente;
  }

  const { data: nuevoCliente, error: errCrear } = await supabase
    .from('clientes')
    .insert([{ company_id, nombre: 'Sin nombre', ciudad: 'Monterrey', fuente: canal, estado: 'Nuevo' }])
    .select()
    .single();

  if (errCrear) throw new Error(`clientes-identidad.resolverOCrearClientePorCanal: ${errCrear.message}`);

  const { error: errVinculo } = await supabase
    .from('clientes_identidades')
    .insert([{ cliente_id: nuevoCliente.id, canal, identificador }]);

  if (errVinculo) throw new Error(`clientes-identidad.resolverOCrearClientePorCanal: ${errVinculo.message}`);

  return nuevoCliente;
}

module.exports = { resolverOCrearClientePorCanal };
