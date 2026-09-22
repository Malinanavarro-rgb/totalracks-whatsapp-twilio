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
 * `armarPropuestas` es 100% pura (sin DB); `generarPropuestasCotizacion` es el
 * único que toca Supabase.
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
    const propuesta = {
      tipo, paquete: _resumenPaquete(paquete), kwp, kwp_fuente: kwpFuente,
      produccion_anual_kwh: null, cobertura_pct: null, ahorro_anual: null,
      periodo_recuperacion_anios: null, ahorro_acumulado: null, excede_consumo: false, motivos: [],
    };

    if (!kwp) { propuesta.motivos.push('El paquete no tiene potencia registrada y el cálculo no permite estimarla.'); return propuesta; }
    if (!puedeEscalar) { propuesta.motivos.push('El cálculo de ingeniería no tiene potencia instalada / producción para escalar.'); return propuesta; }

    propuesta.produccion_anual_kwh = produccionBase * (kwp / kwpBase);
    propuesta.cobertura_pct = motor.calcularCobertura(propuesta.produccion_anual_kwh, consumoAnual);
    propuesta.excede_consumo = propuesta.cobertura_pct != null && propuesta.cobertura_pct > 100;

    const ahorro = motor.calcularAhorro({
      produccionMensualKwh: propuesta.produccion_anual_kwh / 12,
      consumoMensualKwh: entrada.consumoMensualKwh,
      importeRecibo: entrada.importePromedioRecibo,
      consumoFacturadoKwh: entrada.consumoMensualKwh,
      periodo: 'mensual',
      incluyeCargosFijos: entrada.incluyeCargosFijos,
    });
    if (ahorro.incompleto) { propuesta.motivos.push(ahorro.motivo); return propuesta; }

    propuesta.ahorro_anual = ahorro.ahorroAnualEstimado;
    propuesta.ahorro_acumulado = motor.calcularAhorroAcumulado(ahorro.ahorroAnualEstimado, PERIODOS_ACUMULADO_ANIOS).porPeriodo;

    const recuperacion = motor.calcularPeriodoSimpleRecuperacion(propuesta.paquete.precio_contado, ahorro.ahorroAnualEstimado);
    if (recuperacion.incompleto) propuesta.motivos.push('Sin precio de contado o sin ahorro: no se calcula el periodo de recuperación.');
    else propuesta.periodo_recuperacion_anios = recuperacion.valor;

    return propuesta;
  });

  return { propuestas, numero_paneles_tecnico: numeroTecnico, motivo: null };
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

module.exports = { armarPropuestas, generarPropuestasCotizacion };
