/**
 * TARA Matrix™ — cotizacion-lineas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD de `cotizacion_lineas` (Fase 1, migración 088) + el paso que faltaba
 * entre "el motor calculó" y "se puede generar un PDF": convertir el
 * resultado del cálculo en líneas reales con precio, editables por el
 * asesor, y mantener `cotizaciones.subtotal/iva/total` siempre consistentes
 * con esas líneas.
 *
 * Fase 3 (Alina, 2026-08-04) — backend-first, sin pantalla todavía (frontend
 * queda para una fase aparte). No genera PDF ni envía nada — eso vive en
 * modules/cotizacion-pdf.js.
 *
 * @module modules/cotizacion-lineas
 */

'use strict';

const IVA_DEFAULT = 0.16; // IVA México — mismo criterio que el resto de TARA-OS: constante conocida, no un "parámetro configurable" (a diferencia de PR/CO2, que sí varían por fuente/región)

/**
 * Recalcula subtotal/iva/total de una cotización a partir de sus líneas
 * actuales — se llama después de CUALQUIER cambio a cotizacion_lineas
 * (agregar/editar/quitar), nunca se confía en un total guardado a mano.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} cotizacionId
 * @returns {Promise<{subtotal: number, iva: number, total: number}>}
 */
async function recalcularTotales(supabase, cotizacionId) {
  const { data: lineas, error } = await supabase
    .from('cotizacion_lineas')
    .select('cantidad, precio_unitario, descuento_pct')
    .eq('cotizacion_id', cotizacionId);

  if (error) throw new Error(`cotizacion-lineas.recalcularTotales: ${error.message}`);

  const subtotal = (lineas || []).reduce((acumulado, l) => {
    const importe = (l.cantidad || 0) * (l.precio_unitario || 0) * (1 - (l.descuento_pct || 0) / 100);
    return acumulado + importe;
  }, 0);
  const iva = subtotal * IVA_DEFAULT;
  const total = subtotal + iva;

  const redondear = (n) => Math.round(n * 100) / 100;
  const totales = { subtotal: redondear(subtotal), iva: redondear(iva), total: redondear(total) };

  const { error: errUpdate } = await supabase.from('cotizaciones').update(totales).eq('id', cotizacionId);
  if (errUpdate) throw new Error(`cotizacion-lineas.recalcularTotales (update): ${errUpdate.message}`);

  return totales;
}

/**
 * Agrega una línea y recalcula totales en la misma llamada — nunca se deja
 * una línea insertada sin que el total de la cotización la refleje.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.cotizacionId
 * @param {string} [datos.productoId]
 * @param {string} [datos.servicioId]
 * @param {string} [datos.conceptoLibre]
 * @param {string} datos.descripcion
 * @param {number} [datos.cantidad]
 * @param {number} [datos.precioUnitario]
 * @param {number} [datos.descuentoPct]
 * @param {'calculado_automatico'|'sugerido'|'manual'} [datos.origen]
 * @param {boolean} [datos.pendienteLevantamiento]
 * @param {number} [datos.orden]
 * @returns {Promise<Object>} la línea creada
 */
async function agregarLinea(supabase, { companyId, cotizacionId, productoId, servicioId, conceptoLibre, descripcion, cantidad, precioUnitario, descuentoPct, origen, pendienteLevantamiento, orden }) {
  if (!companyId || !cotizacionId || !descripcion) {
    throw new Error('cotizacion-lineas.agregarLinea: companyId, cotizacionId y descripcion son requeridos');
  }

  const cant = cantidad ?? 1;
  const precio = precioUnitario ?? 0;
  const descuento = descuentoPct ?? 0;
  const subtotalLinea = Math.round(cant * precio * (1 - descuento / 100) * 100) / 100;

  const { data, error } = await supabase
    .from('cotizacion_lineas')
    .insert([{
      company_id: companyId, cotizacion_id: cotizacionId,
      producto_id: productoId || null, servicio_id: servicioId || null, concepto_libre: conceptoLibre || null,
      descripcion, cantidad: cant, precio_unitario: precio, descuento_pct: descuento, subtotal: subtotalLinea,
      origen: origen || 'manual', pendiente_levantamiento: pendienteLevantamiento || false, orden: orden ?? 0,
    }])
    .select()
    .single();

  if (error) throw new Error(`cotizacion-lineas.agregarLinea: ${error.message}`);
  await recalcularTotales(supabase, cotizacionId);
  return data;
}

/**
 * Actualiza una línea (cantidad, precio, descuento, descripción...) y
 * recalcula tanto el subtotal de la línea como los totales de la cotización.
 */
async function actualizarLinea(supabase, { companyId, lineaId, cambios }) {
  const { data: existente, error: errExistente } = await supabase
    .from('cotizacion_lineas').select('*').eq('id', lineaId).eq('company_id', companyId).maybeSingle();
  if (errExistente || !existente) {
    const err = new Error('Línea no encontrada'); err.status = 404; throw err;
  }

  const CAMPOS_PERMITIDOS = ['descripcion', 'cantidad', 'precio_unitario', 'descuento_pct', 'producto_id', 'servicio_id', 'concepto_libre', 'origen', 'pendiente_levantamiento', 'orden'];
  const payload = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const cantidadFinal = payload.cantidad ?? existente.cantidad;
  const precioFinal = payload.precio_unitario ?? existente.precio_unitario;
  const descuentoFinal = payload.descuento_pct ?? existente.descuento_pct;
  payload.subtotal = Math.round(cantidadFinal * precioFinal * (1 - descuentoFinal / 100) * 100) / 100;

  const { data, error } = await supabase.from('cotizacion_lineas').update(payload).eq('id', lineaId).select().single();
  if (error) throw new Error(`cotizacion-lineas.actualizarLinea: ${error.message}`);

  await recalcularTotales(supabase, existente.cotizacion_id);
  return data;
}

/** Elimina una línea y recalcula totales. */
async function eliminarLinea(supabase, { companyId, lineaId }) {
  const { data: existente, error: errExistente } = await supabase
    .from('cotizacion_lineas').select('cotizacion_id').eq('id', lineaId).eq('company_id', companyId).maybeSingle();
  if (errExistente || !existente) {
    const err = new Error('Línea no encontrada'); err.status = 404; throw err;
  }

  const { error } = await supabase.from('cotizacion_lineas').delete().eq('id', lineaId);
  if (error) throw new Error(`cotizacion-lineas.eliminarLinea: ${error.message}`);

  await recalcularTotales(supabase, existente.cotizacion_id);
}

async function listarLineas(supabase, cotizacionId) {
  const { data, error } = await supabase.from('cotizacion_lineas').select('*').eq('cotizacion_id', cotizacionId).order('orden');
  return error ? [] : (data || []);
}

/**
 * "Aplicar cálculo a la lista de materiales" (Fase 1, sección 2.1 del plan
 * original) — pre-llena cotizacion_lineas a partir del resultado del motor
 * (panel + inversor, con cantidades/specs reales), SIEMPRE editable después
 * por el asesor. No inventa precio de estructura/cableado/mano de obra —
 * esas líneas quedan `pendiente_levantamiento: true` con precio 0, el
 * asesor las completa a mano (Fase 1, punto 11: nunca asumir cableado/
 * estructura definitiva sin conocer las condiciones reales del sitio).
 *
 * Idempotente por diseño de uso: pensado para llamarse UNA vez por
 * cotización recién calculada — si ya hay líneas con origen
 * 'calculado_automatico', no las duplica (el asesor pudo haberlas ya
 * ajustado o borrado a propósito).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.cotizacionId
 * @returns {Promise<Array>} las líneas creadas (vacío si no había cálculo o ya existían)
 */
async function aplicarCalculoALineas(supabase, { companyId, cotizacionId }) {
  const { data: yaExisten } = await supabase
    .from('cotizacion_lineas').select('id').eq('cotizacion_id', cotizacionId).eq('origen', 'calculado_automatico').limit(1).maybeSingle();
  if (yaExisten) return [];

  const { data: calculo } = await supabase
    .from('calculos_ingenieria').select('*').eq('cotizacion_id', cotizacionId).order('version', { ascending: false }).limit(1).maybeSingle();
  if (!calculo?.resultados) return [];

  const { panel, inversores_candidatos } = calculo.catalogo_usado || {};
  const inversorId = calculo.resultados.inversor_seleccionado?.inversorSeleccionado?.id;
  const inversor = (inversores_candidatos || []).find(i => i.id === inversorId);

  const lineasCreadas = [];
  let orden = 0;

  if (panel && calculo.resultados.numero_paneles?.valor) {
    lineasCreadas.push(await agregarLinea(supabase, {
      companyId, cotizacionId, productoId: panel.id,
      descripcion: `Panel solar ${panel.marca || ''} ${panel.modelo || ''} ${panel.specs?.potencia_wp || ''}W`.trim().replace(/\s+/g, ' '),
      cantidad: calculo.resultados.numero_paneles.valor, precioUnitario: panel.precio || 0,
      origen: 'calculado_automatico', orden: orden++,
    }));
  }

  if (inversor) {
    lineasCreadas.push(await agregarLinea(supabase, {
      companyId, cotizacionId, productoId: inversor.id,
      descripcion: `Inversor ${inversor.marca || ''} ${inversor.modelo || ''}`.trim().replace(/\s+/g, ' '),
      cantidad: 1, precioUnitario: inversor.precio || 0,
      origen: 'calculado_automatico', orden: orden++,
    }));
  }

  // Estructura/cableado/protecciones/mano de obra: nunca un precio inventado
  // — quedan pendientes de que el asesor las levante o cotice a mano.
  for (const concepto of ['Estructura de montaje', 'Cableado y protecciones eléctricas', 'Mano de obra e instalación']) {
    lineasCreadas.push(await agregarLinea(supabase, {
      companyId, cotizacionId, conceptoLibre: concepto, descripcion: concepto,
      cantidad: 1, precioUnitario: 0, origen: 'sugerido', pendienteLevantamiento: true, orden: orden++,
    }));
  }

  return lineasCreadas;
}

module.exports = { recalcularTotales, agregarLinea, actualizarLinea, eliminarLinea, listarLineas, aplicarCalculoALineas, IVA_DEFAULT };
