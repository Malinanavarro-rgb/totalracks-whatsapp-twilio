/**
 * TARA Matrix™ — propuestas-solares.js
 * ─────────────────────────────────────────────────────────────────────────────
 * "3 propuestas" de una cotización de paneles solares (auditoría 2026-09-16,
 * Parte B): dado el cálculo de ingeniería ya guardado y los paquetes estándar
 * VIGENTES de la empresa, compara tres alternativas reales del catálogo:
 *
 *   - Económica    → el paquete inmediatamente MÁS CHICO que el recomendado
 *                    (cubre menos: se muestra cuánto, nunca se disfraza).
 *   - Recomendada  → la misma regla que ya usa seleccionarPaqueteRecomendado:
 *                    el paquete más chico que alcanza el número técnico de paneles.
 *   - Ampliada     → el paquete inmediatamente MÁS GRANDE (holgura/crecimiento).
 *
 * Deliberadamente NO arma un BOM con precios por componente: el modelo
 * comercial de esta empresa es por paquete (ver modules/paquetes-solares.js) —
 * los precios son los del catálogo, nunca una suma inventada.
 *
 * Producción/ahorro por paquete: la producción es lineal en los kWp
 * (kWp × HSP × 365 × PR), así que se ESCALA la producción ya calculada por el
 * motor por la razón kWp_paquete / kWp_calculo. Mismas fórmulas del motor
 * (calcularCobertura/calcularAhorro/...) — nada se reimplementa aquí. Si falta
 * un dato para calcular algo, ese campo queda null con su motivo, nunca un
 * número inventado.
 *
 * Simulador interactivo (mismo día): además de las 3 fijas, `simularRango`
 * genera un punto por cada número de paneles en un rango alrededor del
 * técnico — para un control deslizante en pantalla que no dispare una
 * consulta nueva en cada movimiento. Comparte el mismo cálculo de
 * kWp→producción/ahorro/recuperación que las propuestas (_evaluarKwp).
 *
 * `armarPropuestas`/`simularRango` son 100% puras (sin DB);
 * `generarPropuestasCotizacion`/`simularRangoCotizacion` son los que tocan Supabase.
 *
 * @module modules/propuestas-solares
 */

'use strict';

const motor = require('./motores-ingenieria/paneles-solares');

const PERIODOS_ACUMULADO_ANIOS = [5, 10, 20];

/**
 * kWp de un paquete y de dónde salió ese dato:
 *   - 'registrada': el paquete trae su potencia (potencia_total_kwp, o potencia por panel × cantidad).
 *   - 'estimada_con_panel_del_calculo': el paquete NO la trae (caso real de Nort Energy a la fecha:
 *     ningún paquete tiene potencia registrada) → cantidad × potencia del panel que usó el cálculo.
 *     Es la misma suposición con la que ya se elige el paquete recomendado (por conteo de paneles),
 *     y queda marcada como estimada — nunca se presenta como dato del paquete.
 */
function _kwpDelPaquete(paquete, wpPanelDelCalculo) {
  const declarado = Number(paquete.potencia_total_kwp);
  if (Number.isFinite(declarado) && declarado > 0) return { kwp: declarado, fuente: 'registrada' };
  const porPanel = Number(paquete.potencia_panel_wp);
  const cantidad = Number(paquete.cantidad_paneles);
  if (Number.isFinite(porPanel) && porPanel > 0 && Number.isFinite(cantidad) && cantidad > 0) return { kwp: (porPanel * cantidad) / 1000, fuente: 'registrada' };
  if (Number.isFinite(wpPanelDelCalculo) && wpPanelDelCalculo > 0 && Number.isFinite(cantidad) && cantidad > 0) return { kwp: (wpPanelDelCalculo * cantidad) / 1000, fuente: 'estimada_con_panel_del_calculo' };
  return { kwp: null, fuente: null };
}

function _resumenPaquete(p) {
  return {
    id: p.id, nombre: p.nombre, cantidad_paneles: p.cantidad_paneles, potencia_panel_wp: p.potencia_panel_wp ?? null,
    marca_panel: p.marca_panel ?? null, modelo_panel: p.modelo_panel ?? null,
    marca_inversor: p.marca_inversor ?? null, modelo_inversor: p.modelo_inversor ?? null,
    precio_contado: p.precio_contado != null ? Number(p.precio_contado) : null,
  };
}

/**
 * El cálculo compartido de kWp → producción/cobertura/ahorro/recuperación,
 * usado tanto por cada propuesta (armarPropuestas) como por cada punto del
 * simulador (simularRango) — una sola fuente de verdad para "qué pasa si el
 * sistema tiene X kWp", nunca dos copias de la misma cuenta.
 */
function _evaluarKwp(kwp, { kwpBase, produccionBase, consumoAnual, entrada, precioContado }) {
  const base = {
    produccion_anual_kwh: null, cobertura_pct: null, ahorro_anual: null,
    periodo_recuperacion_anios: null, ahorro_acumulado: null, excede_consumo: false, motivos: [],
  };
  if (!kwp) { base.motivos.push('Sin potencia (kWp) que evaluar.'); return base; }
  if (!(Number.isFinite(kwpBase) && kwpBase > 0 && Number.isFinite(produccionBase))) {
    base.motivos.push('El cálculo de ingeniería no tiene potencia instalada / producción para escalar.');
    return base;
  }

  base.produccion_anual_kwh = produccionBase * (kwp / kwpBase);
  base.cobertura_pct = motor.calcularCobertura(base.produccion_anual_kwh, consumoAnual);
  base.excede_consumo = base.cobertura_pct != null && base.cobertura_pct > 100;

  const ahorro = motor.calcularAhorro({
    produccionMensualKwh: base.produccion_anual_kwh / 12,
    consumoMensualKwh: entrada.consumoMensualKwh,
    importeRecibo: entrada.importePromedioRecibo,
    consumoFacturadoKwh: entrada.consumoMensualKwh,
    periodo: 'mensual',
    incluyeCargosFijos: entrada.incluyeCargosFijos,
  });
  if (ahorro.incompleto) { base.motivos.push(ahorro.motivo); return base; }

  base.ahorro_anual = ahorro.ahorroAnualEstimado;
  base.ahorro_acumulado = motor.calcularAhorroAcumulado(ahorro.ahorroAnualEstimado, PERIODOS_ACUMULADO_ANIOS).porPeriodo;

  const recuperacion = motor.calcularPeriodoSimpleRecuperacion(precioContado, ahorro.ahorroAnualEstimado);
  if (recuperacion.incompleto) base.motivos.push('Sin precio de contado o sin ahorro: no se calcula el periodo de recuperación.');
  else base.periodo_recuperacion_anios = recuperacion.valor;

  return base;
}

/**
 * @param {Object} datos
 * @param {Array} datos.paquetes - paquetes VIGENTES de la empresa (cualquier orden)
 * @param {{resultados: Object, datos_entrada: Object}} datos.calculo - fila de calculos_ingenieria
 * @returns {{propuestas: Array, motivo: string|null, numero_paneles_tecnico: number|null}}
 */
function armarPropuestas({ paquetes, calculo }) {
  const resultados = calculo?.resultados || {};
  const entrada = calculo?.datos_entrada || {};
  const numeroTecnico = resultados.numero_paneles?.valor ?? null;

  if (!numeroTecnico) {
    return { propuestas: [], numero_paneles_tecnico: null, motivo: 'El cálculo de ingeniería todavía no determinó el número de paneles (falta panel seleccionado o datos de consumo).' };
  }

  const ordenados = [...(paquetes || [])].sort((a, b) => a.cantidad_paneles - b.cantidad_paneles);
  const idxRecomendado = ordenados.findIndex((p) => p.cantidad_paneles >= numeroTecnico);

  if (idxRecomendado === -1) {
    return { propuestas: [], numero_paneles_tecnico: numeroTecnico, motivo: `Ningún paquete estándar alcanza los ${numeroTecnico} paneles que requiere el cálculo — necesita un paquete a la medida.` };
  }

  const candidatos = [
    ['economica', ordenados[idxRecomendado - 1]],
    ['recomendada', ordenados[idxRecomendado]],
    ['ampliada', ordenados[idxRecomendado + 1]],
  ].filter(([, paquete]) => paquete);

  const kwpBase = Number(resultados.potencia_instalada_kwp);
  const produccionBase = resultados.produccion?.anual;
  const consumoAnual = resultados.consumo_anual_kwh?.valor ?? null;
  const puedeEscalar = Number.isFinite(kwpBase) && kwpBase > 0 && Number.isFinite(produccionBase);
  const wpPanelDelCalculo = puedeEscalar ? (kwpBase * 1000) / numeroTecnico : null;

  const propuestas = candidatos.map(([tipo, paquete]) => {
    const { kwp, fuente: kwpFuente } = _kwpDelPaquete(paquete, wpPanelDelCalculo);
    const resumen = _resumenPaquete(paquete);
    const evaluado = _evaluarKwp(kwp, { kwpBase, produccionBase, consumoAnual, entrada, precioContado: resumen.precio_contado });
    if (!kwp) evaluado.motivos = ['El paquete no tiene potencia registrada y el cálculo no permite estimarla.'];
    return { tipo, paquete: resumen, kwp, kwp_fuente: kwpFuente, ...evaluado };
  });

  return { propuestas, numero_paneles_tecnico: numeroTecnico, motivo: null };
}

/**
 * Simulador interactivo (auditoría 2026-09-16, Parte B): un punto por cada
 * número de paneles en [desde, hasta] — para que el control deslizante en
 * pantalla no dispare una petición nueva en cada movimiento, se calculan
 * TODOS los puntos en una sola pasada (es escalado lineal puro, sin DB).
 *
 * El precio/recuperación de cada punto usa el paquete VIGENTE más chico que
 * cubre esa cantidad (misma regla que el paquete recomendado) — nunca
 * interpola un precio que no existe en el catálogo. Si ese paquete tiene MÁS
 * paneles que el punto exacto, `paquete_referencia.exacto` queda en false —
 * el precio es de referencia, no el de un paquete a la medida de esa cantidad.
 *
 * @param {Object} datos
 * @param {Array} datos.paquetes - paquetes VIGENTES de la empresa
 * @param {{resultados: Object, datos_entrada: Object}} datos.calculo
 * @param {number} [datos.desde] - default: max(1, técnico - 3)
 * @param {number} [datos.hasta] - default: técnico + 6
 */
function simularRango({ paquetes, calculo, desde, hasta }) {
  const resultados = calculo?.resultados || {};
  const entrada = calculo?.datos_entrada || {};
  const numeroTecnico = resultados.numero_paneles?.valor ?? null;

  if (!numeroTecnico) {
    return { puntos: [], numero_paneles_tecnico: null, motivo: 'El cálculo de ingeniería todavía no determinó el número de paneles (falta panel seleccionado o datos de consumo).' };
  }

  const kwpBase = Number(resultados.potencia_instalada_kwp);
  const produccionBase = resultados.produccion?.anual;
  const consumoAnual = resultados.consumo_anual_kwh?.valor ?? null;
  const wpPanel = (Number.isFinite(kwpBase) && kwpBase > 0) ? (kwpBase * 1000) / numeroTecnico : null;

  const rangoDesde = Math.max(1, Number.isFinite(desde) ? Math.round(desde) : numeroTecnico - 3);
  const rangoHasta = Math.max(rangoDesde, Number.isFinite(hasta) ? Math.round(hasta) : numeroTecnico + 6);

  const ordenados = [...(paquetes || [])].sort((a, b) => a.cantidad_paneles - b.cantidad_paneles);

  const puntos = [];
  for (let n = rangoDesde; n <= rangoHasta; n += 1) {
    const kwp = wpPanel ? (wpPanel * n) / 1000 : null;
    const paqueteCubre = ordenados.find((p) => p.cantidad_paneles >= n) || null;
    const evaluado = _evaluarKwp(kwp, { kwpBase, produccionBase, consumoAnual, entrada, precioContado: paqueteCubre?.precio_contado != null ? Number(paqueteCubre.precio_contado) : null });
    puntos.push({
      numero_paneles: n, es_tecnico: n === numeroTecnico, kwp, ...evaluado,
      paquete_referencia: paqueteCubre ? { ..._resumenPaquete(paqueteCubre), exacto: paqueteCubre.cantidad_paneles === n } : null,
    });
  }

  return { puntos, numero_paneles_tecnico: numeroTecnico, motivo: null };
}

/**
 * Lee el cálculo vigente de la cotización y los paquetes vigentes de la empresa, y arma las propuestas.
 * Devuelve null si la cotización no existe o es de otra empresa (nunca cruza company_id).
 */
async function generarPropuestasCotizacion(supabase, { companyId, cotizacionId }) {
  const { data: cotizacion } = await supabase
    .from('cotizaciones').select('id, calculo_ingenieria_id, paquete_recomendado_id')
    .eq('id', cotizacionId).eq('company_id', companyId).maybeSingle();
  if (!cotizacion) return null;

  if (!cotizacion.calculo_ingenieria_id) {
    return { propuestas: [], numero_paneles_tecnico: null, motivo: 'Esta cotización todavía no tiene un cálculo de ingeniería.', paquete_recomendado_actual_id: cotizacion.paquete_recomendado_id };
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const [{ data: calculo }, { data: paquetes }] = await Promise.all([
    supabase.from('calculos_ingenieria').select('resultados, datos_entrada').eq('id', cotizacion.calculo_ingenieria_id).maybeSingle(),
    supabase.from('paquetes_solares').select('*').eq('company_id', companyId).eq('activo', true)
      .lte('vigencia_desde', hoy).or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`).order('cantidad_paneles', { ascending: true }),
  ]);

  return { ...armarPropuestas({ paquetes: paquetes || [], calculo }), paquete_recomendado_actual_id: cotizacion.paquete_recomendado_id };
}

/** Mismo patrón que generarPropuestasCotizacion, para el simulador (acepta desde/hasta opcionales del query string). */
async function simularRangoCotizacion(supabase, { companyId, cotizacionId, desde, hasta }) {
  const { data: cotizacion } = await supabase
    .from('cotizaciones').select('id, calculo_ingenieria_id').eq('id', cotizacionId).eq('company_id', companyId).maybeSingle();
  if (!cotizacion) return null;

  if (!cotizacion.calculo_ingenieria_id) {
    return { puntos: [], numero_paneles_tecnico: null, motivo: 'Esta cotización todavía no tiene un cálculo de ingeniería.' };
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const [{ data: calculo }, { data: paquetes }] = await Promise.all([
    supabase.from('calculos_ingenieria').select('resultados, datos_entrada').eq('id', cotizacion.calculo_ingenieria_id).maybeSingle(),
    supabase.from('paquetes_solares').select('*').eq('company_id', companyId).eq('activo', true)
      .lte('vigencia_desde', hoy).or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`).order('cantidad_paneles', { ascending: true }),
  ]);

  return simularRango({ paquetes: paquetes || [], calculo, desde, hasta });
}

module.exports = { armarPropuestas, generarPropuestasCotizacion, simularRango, simularRangoCotizacion };
