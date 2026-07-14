/**
 * TARA — cotizador.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fase Demo Comercial: cotización automática al terminar el intake de
 * uniformes_deportivos — usa los precios reales de Catálogo (tabla
 * `servicios`, Fase Premium V1.1) para calcular un estimado real, en vez
 * de que TARA prometa "te la envío pronto" sin ningún número detrás.
 *
 * El catálogo real de Tienda Soccer es por nivel de personalización
 * (genérico con logo vs. diseño totalmente personalizado), no por deporte
 * — por eso se cotiza con el rango real (mínimo–máximo) del catálogo
 * activo en vez de intentar adivinar qué producto exacto eligió el
 * cliente. Es honesto: nunca inventa una cifra única sin base real.
 *
 * Deliberadamente en la capa de plataforma (invocado desde server.js), no
 * en el Orchestrator: es un cálculo de negocio sobre datos ya capturados,
 * no una decisión conversacional — cero cambios al motor congelado (ADR-005).
 *
 * @module modules/cotizador
 */

'use strict';

const MINIMO_ENVIO_GRATIS = 10;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {Object} capturedFields - workflow_sessions.captured_fields (cantidad, ...)
 * @returns {Promise<{cantidad: number, precioMin: number, precioMax: number, total: number, envioGratis: boolean}|null>}
 *   null si falta información suficiente para cotizar (cantidad no
 *   reconocida, o la empresa no tiene productos activos en su catálogo).
 *   `total` es el punto medio del rango — solo para tener un número único
 *   que guardar en la oportunidad (KPIs, "ya se cotizó"); el mensaje al
 *   cliente siempre muestra el rango real, no ese número solo.
 */
async function calcularCotizacion(supabase, company_id, capturedFields) {
  if (!capturedFields?.cantidad) return null;

  const { data: servicios, error } = await supabase
    .from('servicios')
    .select('precio')
    .eq('company_id', company_id)
    .eq('activo', true);

  if (error || !servicios || servicios.length === 0) return null;

  const precios = servicios.map(s => Number(s.precio)).filter(p => !Number.isNaN(p) && p > 0);
  if (precios.length === 0) return null;

  const match = String(capturedFields.cantidad).match(/\d+/);
  if (!match) return null;
  const cantidad = parseInt(match[0], 10);
  if (!cantidad) return null;

  const precioMin = Math.min(...precios);
  const precioMax = Math.max(...precios);

  return {
    cantidad,
    precioMin,
    precioMax,
    total:       Math.round(((precioMin + precioMax) / 2) * cantidad),
    envioGratis: cantidad >= MINIMO_ENVIO_GRATIS,
  };
}

module.exports = { calcularCotizacion };
