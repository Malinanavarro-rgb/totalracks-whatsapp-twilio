/**
 * TARA Matrix™ — rentabilidad.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Distinción matemática margen-sobre-venta vs. markup-sobre-costo (auditoría
 * 2026-09-16, Parte B: "existe la columna `margen` (numeric libre) pero
 * ninguna fórmula la define" — Alina, 2026-09-22). Dos definiciones NO son
 * intercambiables y confundirlas es un error de negocio real:
 *
 *   margen_sobre_venta = (precio - costo) / precio   → % del precio de venta que es utilidad
 *   markup_sobre_costo  = (precio - costo) / costo    → % que se le sumó al costo para llegar al precio
 *
 * Un 50% de markup NO es un 50% de margen (es 33.3% de margen) — la
 * confusión clásica de cualquier catálogo con un solo campo "margen" sin
 * fórmula, exactamente lo que `productos.margen` es hoy.
 *
 * INTERNO ÚNICAMENTE — mismo criterio que ya aplica catalogo-tecnico.js::
 * sanearProducto() ("el cliente JAMÁS debe recibir el costo del proveedor o
 * margen interno"): nada de este módulo debe alcanzar una ruta o pantalla
 * que no esté explícitamente restringida a gerenciales.
 *
 * @module modules/rentabilidad
 */

'use strict';

/** % del precio de venta que es utilidad. null si no hay datos o el precio es 0 (indefinido, no un error). */
function calcularMargenSobreVenta(precio, costo) {
  if (!(Number.isFinite(precio) && precio > 0) || !(Number.isFinite(costo) && costo >= 0)) return null;
  return ((precio - costo) / precio) * 100;
}

/** % que se sumó al costo para llegar al precio. null si no hay datos o el costo es 0 (indefinido, no un error — nunca se reporta como 0% ni como infinito). */
function calcularMarkupSobreCosto(precio, costo) {
  if (!(Number.isFinite(precio) && precio >= 0) || !(Number.isFinite(costo) && costo > 0)) return null;
  return ((precio - costo) / costo) * 100;
}

/**
 * Costo total de un producto para rentabilidad: `costo_interno_nort_energy`
 * si ya está capturado como el costo todo-incluido, si no la SUMA de
 * proveedor+instalación+materiales — pero solo si los TRES están presentes;
 * una suma parcial (ej. solo costo_proveedor, sin instalación) subestimaría
 * el costo real y ese error es peor que no mostrar nada. Sin ninguno de los
 * dos caminos completo → null, nunca un número parcial disfrazado de total.
 */
function costoTotalProducto(producto) {
  if (Number.isFinite(producto?.costo_interno_nort_energy)) return producto.costo_interno_nort_energy;
  const { costo_proveedor: p, costo_instalacion: i, costo_materiales: m } = producto || {};
  if (Number.isFinite(p) && Number.isFinite(i) && Number.isFinite(m)) return p + i + m;
  return null;
}

/**
 * Rentabilidad de una cotización, línea por línea + agregado — SOLO para
 * pantallas/rutas ya restringidas a gerenciales (ver soloGerencial en
 * server.js). Líneas sin producto_id (manuales/libres) o cuyo producto no
 * tiene costo capturado quedan con costo:null — se excluyen del agregado en
 * vez de tratarlas como costo 0 (costo 0 inflaría la rentabilidad real).
 *
 * @returns {Promise<{lineas: Array, agregado: Object, lineas_sin_costo: number}>}
 */
async function calcularRentabilidadCotizacion(supabase, { companyId, cotizacionId }) {
  const { data: cotizacion } = await supabase
    .from('cotizaciones').select('id').eq('id', cotizacionId).eq('company_id', companyId).maybeSingle();
  if (!cotizacion) return null;

  const { data: lineasRaw } = await supabase
    .from('cotizacion_lineas').select('id, descripcion, producto_id, cantidad, precio_unitario, subtotal').eq('cotizacion_id', cotizacionId).order('orden');
  const lineasCotizacion = lineasRaw || [];

  const idsProducto = [...new Set(lineasCotizacion.map((l) => l.producto_id).filter(Boolean))];
  const { data: productos } = idsProducto.length
    ? await supabase.from('productos').select('id, costo_interno_nort_energy, costo_proveedor, costo_instalacion, costo_materiales').in('id', idsProducto)
    : { data: [] };
  const productoPorId = Object.fromEntries((productos || []).map((p) => [p.id, p]));

  let totalVenta = 0;
  let totalCosto = 0;
  let lineasSinCosto = 0;

  const lineas = lineasCotizacion.map((linea) => {
    const producto = linea.producto_id ? productoPorId[linea.producto_id] : null;
    const costoUnitario = producto ? costoTotalProducto(producto) : null;
    const ventaLinea = Number(linea.subtotal) || 0;
    totalVenta += ventaLinea;

    if (costoUnitario == null) {
      lineasSinCosto += 1;
      return { ...linea, costo_unitario: null, costo_total: null, margen_sobre_venta_pct: null, markup_sobre_costo_pct: null };
    }

    const costoLinea = costoUnitario * (Number(linea.cantidad) || 0);
    totalCosto += costoLinea;

    return {
      ...linea,
      costo_unitario: costoUnitario,
      costo_total: Math.round(costoLinea * 100) / 100,
      margen_sobre_venta_pct: calcularMargenSobreVenta(ventaLinea, costoLinea),
      markup_sobre_costo_pct: calcularMarkupSobreCosto(ventaLinea, costoLinea),
    };
  });

  const redondear = (n) => Math.round(n * 100) / 100;
  const agregado = {
    total_venta: redondear(totalVenta),
    // El costo/margen agregado SOLO cubre las líneas con costo conocido — nunca
    // se completa el faltante con 0. `lineas_sin_costo` dice cuántas quedaron fuera.
    total_costo_conocido: lineasSinCosto === lineasCotizacion.length ? null : redondear(totalCosto),
    margen_sobre_venta_pct: lineasSinCosto === lineasCotizacion.length ? null : calcularMargenSobreVenta(totalVenta, totalCosto),
    markup_sobre_costo_pct: lineasSinCosto === lineasCotizacion.length ? null : calcularMarkupSobreCosto(totalVenta, totalCosto),
  };

  return { lineas, agregado, lineas_sin_costo: lineasSinCosto };
}

module.exports = { calcularMargenSobreVenta, calcularMarkupSobreCosto, costoTotalProducto, calcularRentabilidadCotizacion };
