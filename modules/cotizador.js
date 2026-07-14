/**
 * TARA — cotizador.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fase Demo Comercial: cotización automática al terminar el intake de
 * uniformes_deportivos — usa los precios reales de Catálogo (tabla
 * `servicios`, Fase Premium V1.1) para calcular un total real, en vez de
 * que TARA prometa "te la envío pronto" sin ningún número detrás.
 *
 * Deliberadamente en la capa de plataforma (invocado desde server.js), no
 * en el Orchestrator: es un cálculo de negocio sobre datos ya capturados,
 * no una decisión conversacional — cero cambios al motor congelado (ADR-005).
 *
 * @module modules/cotizador
 */

'use strict';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {Object} capturedFields - workflow_sessions.captured_fields (deporte, cantidad, ...)
 * @returns {Promise<{servicio: string, precioUnitario: number, cantidad: number, total: number}|null>}
 *   null si falta información suficiente para cotizar (deporte/cantidad no
 *   reconocidos, o la empresa no tiene ese producto en su catálogo).
 */
async function calcularCotizacion(supabase, company_id, capturedFields) {
  if (!capturedFields?.deporte || !capturedFields?.cantidad) return null;

  const { data: servicios, error } = await supabase
    .from('servicios')
    .select('nombre, precio')
    .eq('company_id', company_id)
    .eq('activo', true);

  if (error || !servicios || servicios.length === 0) return null;

  const deporte = String(capturedFields.deporte).toLowerCase();
  const servicio = servicios.find(s => s.nombre.toLowerCase().includes(deporte));
  if (!servicio || servicio.precio == null) return null;

  const match = String(capturedFields.cantidad).match(/\d+/);
  if (!match) return null;
  const cantidad = parseInt(match[0], 10);
  if (!cantidad) return null;

  return {
    servicio:       servicio.nombre,
    precioUnitario: Number(servicio.precio),
    cantidad,
    total:          Number(servicio.precio) * cantidad,
  };
}

module.exports = { calcularCotizacion };
