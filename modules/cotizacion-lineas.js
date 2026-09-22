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
 * "Aplicar cálculo a la lista de materiales" — Alina, 2026-08-04: ya NO
 * suma cada componente del catálogo con su precio individual (así era en
 * Fase 3; el cliente tiene una tabla de precios estándar por paquete que
 * reemplaza ese cálculo). Ahora crea UNA sola línea con el paquete
 * comercial recomendado (modules/paquetes-solares.js) — precio fijo, ya
 * incluye estructura/instalación/material eléctrico/trámite CFE/monitoreo
 * según lo que traiga `paquetes_solares.componentes_incluidos`, nunca
 * inventado por línea. El precio de la línea usa
 * `cotizaciones.precio_final_autorizado` si el asesor ya lo autorizó, o
 * `precio_paquete_recomendado` si todavía no — SIEMPRE editable después.
 *
 * Si la cotización no tiene paquete_recomendado_id (el cálculo técnico
 * excedió el catálogo estándar, ver seleccionarPaqueteRecomendado), no crea
 * ninguna línea — el asesor arma la cotización a la medida a mano, nunca
 * se inventa un paquete que no existe.
 *
 * Idempotente por diseño de uso: pensado para llamarse UNA vez por
 * cotización recién calculada — si ya hay una línea con origen
 * 'calculado_automatico', no la duplica (el asesor pudo haberla ya
 * ajustado o borrado a propósito).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.cotizacionId
 * @returns {Promise<Array>} la línea creada (vacío si ya existía o no hay paquete recomendado)
 */
async function aplicarCalculoALineas(supabase, { companyId, cotizacionId }) {
  const { data: yaExisten } = await supabase
    .from('cotizacion_lineas').select('id').eq('cotizacion_id', cotizacionId).eq('origen', 'calculado_automatico').limit(1).maybeSingle();
  if (yaExisten) return [];

  const { data: cotizacion } = await supabase
    .from('cotizaciones').select('paquete_recomendado_id, precio_paquete_recomendado, precio_final_autorizado').eq('id', cotizacionId).maybeSingle();
  if (!cotizacion?.paquete_recomendado_id) return [];

  const { data: paquete } = await supabase.from('paquetes_solares').select('*').eq('id', cotizacion.paquete_recomendado_id).maybeSingle();
  if (!paquete) return [];

  const precio = cotizacion.precio_final_autorizado ?? cotizacion.precio_paquete_recomendado ?? paquete.precio_contado;
  const componentes = Array.isArray(paquete.componentes_incluidos) ? paquete.componentes_incluidos : [];
  const descripcion = componentes.length
    ? `${paquete.nombre} — incluye: ${componentes.join(', ')}`
    : paquete.nombre;

  const linea = await agregarLinea(supabase, {
    companyId, cotizacionId, productoId: null, conceptoLibre: paquete.nombre,
    descripcion, cantidad: 1, precioUnitario: precio,
    origen: 'calculado_automatico', orden: 0,
  });

  return [linea];
}

/**
 * "BOM panel + inversor" (Alina, 2026-09-22) — ALTERNATIVA a
 * aplicarCalculoALineas(), no un reemplazo: crea una línea real por el panel
 * (cantidad = numero_paneles del cálculo) y otra por el inversor que el motor
 * seleccionó, cada una con el precio ACTUAL del catálogo (no el precio
 * congelado en el cálculo — un asesor puede haber actualizado el precio
 * después). El asesor elige UNA de las dos formas, nunca ambas: comparte el
 * mismo guard de "ya existe una línea automática" que aplicarCalculoALineas,
 * así que si ya se aplicó el paquete (o ya se aplicó este BOM antes), no
 * duplica nada.
 *
 * Deliberadamente NO intenta estructura/riel/cable/protecciones — el motor
 * de ingeniería no calcula esas cantidades (confirmado en la auditoría
 * 2026-09-16), y el catálogo hoy casi no tiene precios cargados fuera de
 * panel/inversor. Inventar una cantidad o un precio ahí rompería el
 * principio de "nunca alucinar" que sostiene todo este módulo — esas
 * líneas se siguen agregando a mano, como ya funciona hoy.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.cotizacionId
 * @returns {Promise<{lineas: Array, motivo: string|null}>}
 */
async function aplicarBomALineas(supabase, { companyId, cotizacionId }) {
  const { data: yaExisten } = await supabase
    .from('cotizacion_lineas').select('id').eq('cotizacion_id', cotizacionId).eq('origen', 'calculado_automatico').limit(1).maybeSingle();
  if (yaExisten) return { lineas: [], motivo: 'Esta cotización ya tiene una línea automática (paquete o BOM) — bórrala primero si quieres regenerar.' };

  const { data: cotizacion } = await supabase
    .from('cotizaciones').select('calculo_ingenieria_id').eq('id', cotizacionId).eq('company_id', companyId).maybeSingle();
  if (!cotizacion) {
    const err = new Error('Cotización no encontrada');
    err.status = 404;
    throw err;
  }
  if (!cotizacion.calculo_ingenieria_id) return { lineas: [], motivo: 'Esta cotización todavía no tiene un cálculo de ingeniería.' };

  const { data: calculo } = await supabase
    .from('calculos_ingenieria').select('resultados, catalogo_usado').eq('id', cotizacion.calculo_ingenieria_id).maybeSingle();
  const numeroPaneles = calculo?.resultados?.numero_paneles?.valor;
  const panelId = calculo?.catalogo_usado?.panel?.id;
  const inversorId = calculo?.resultados?.inversor_seleccionado?.inversorSeleccionado?.id;

  if (!numeroPaneles || !panelId) {
    return { lineas: [], motivo: 'El cálculo todavía no determinó cuántos paneles usar (falta panel seleccionado o datos de consumo).' };
  }

  const idsAConsultar = [panelId, inversorId].filter(Boolean);
  const { data: productosActuales } = await supabase.from('productos').select('id, tipo, marca, modelo, precio').in('id', idsAConsultar);
  const productoPorId = Object.fromEntries((productosActuales || []).map((p) => [p.id, p]));

  const items = [{ producto: productoPorId[panelId], cantidad: numeroPaneles, tipoEtiqueta: 'panel solar' }];
  if (inversorId) items.push({ producto: productoPorId[inversorId], cantidad: 1, tipoEtiqueta: 'inversor' });

  const lineas = [];
  let orden = 0;
  for (const { producto, cantidad, tipoEtiqueta } of items) {
    if (!producto) continue; // el producto fue borrado del catálogo desde que corrió el cálculo — nunca se inventa
    const sinPrecio = producto.precio == null;
    // eslint-disable-next-line no-await-in-loop -- cada línea depende de recalcularTotales de la anterior; volumen mínimo (panel + inversor)
    const linea = await agregarLinea(supabase, {
      companyId, cotizacionId, productoId: producto.id,
      descripcion: `${producto.marca || ''} ${producto.modelo || tipoEtiqueta}`.trim() || tipoEtiqueta,
      cantidad, precioUnitario: sinPrecio ? 0 : Number(producto.precio),
      origen: 'calculado_automatico', pendienteLevantamiento: sinPrecio, orden: orden++,
    });
    lineas.push(linea);
  }

  return { lineas, motivo: lineas.length === 0 ? 'Ni el panel ni el inversor del cálculo siguen en el catálogo.' : null };
}

module.exports = { recalcularTotales, agregarLinea, actualizarLinea, eliminarLinea, listarLineas, aplicarCalculoALineas, aplicarBomALineas, IVA_DEFAULT };
