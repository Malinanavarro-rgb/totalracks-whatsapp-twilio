/**
 * TARA Matrix™ — motores-ingenieria/paneles-solares.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de predimensionamiento fotovoltaico. Precisiones exigidas por
 * Alina (2026-08-04), cada una con su función dedicada, testeable sola:
 *
 *   1. Fórmulas con paréntesis explícitos, % siempre decimal (0-1).
 *   2. HSP estructurado (valor/fuente/ubicación/fecha), nunca un número mágico.
 *   3. Performance Ratio configurable, registrado en cada cálculo.
 *   4. Selección de inversor por ficha técnica real, no solo ratio DC/AC.
 *   5. Strings validados eléctricamente (Voc corregido, rango MPPT, corriente).
 *   6. Tres potencias separadas — requerida / instalada / AC del inversor.
 *   7. Producción mensual real cuando hay HSP mensual; si no, estimación
 *      simplificada, etiquetada como tal.
 *   8. Ahorro con metadatos completos — nunca solo un número.
 *   9. "Periodo simple de recuperación", nunca "ROI financiero".
 *  10. Factor de CO2 configurable y versionado con fuente.
 *  11. (aplica en modules/cotizaciones.js — líneas con origen explícito)
 *  12. (aplica en calculos_ingenieria — inmutable, versionado)
 *  13. (aplica en modules/cotizaciones.js — dos estados de aprobación)
 *  14. Alertas de bloqueo — ver generarAlertas().
 *
 * TODO: Predimensionamiento — nunca ingeniería ejecutiva. Cualquier
 * consumidor de este motor (panel, PDF) debe mostrar el aviso que
 * devuelve calcularPredimensionamiento().aviso, sin excepción.
 *
 * @module modules/motores-ingenieria/paneles-solares
 */

'use strict';

const MOTOR_VERSION = '1.0.0';
const STC_TEMP_C = 25; // temperatura de condiciones estándar de prueba (STC) de un panel

// ── 1. Consumo anual ─────────────────────────────────────────────────────────

/**
 * @param {{consumoMensualKwh?: number, historialConsumo?: Array<{mes: string, kwh: number}>}} infoTecnica
 */
function calcularConsumoAnual({ consumoMensualKwh, historialConsumo }) {
  if (Array.isArray(historialConsumo) && historialConsumo.length >= 12) {
    const valor = historialConsumo.slice(0, 12).reduce((acc, m) => acc + (Number(m.kwh) || 0), 0);
    return { valor, metodo: 'historial_12_meses' };
  }
  const valor = (Number(consumoMensualKwh) || 0) * 12;
  return { valor, metodo: 'estimado_mensual_x12' };
}

// ── 2. Potencia requerida ────────────────────────────────────────────────────

/**
 * kWp requerido = (consumo anual × % cobertura deseado) / (HSP × 365 × PR)
 * `pctCoberturaDeseado` SIEMPRE decimal (0-1) — nunca se adivina/normaliza
 * un valor fuera de rango, se rechaza explícitamente (evita silenciar un
 * error de captura, ej. "90" en vez de "0.90").
 */
function calcularPotenciaRequerida({ consumoAnualKwh, pctCoberturaDeseado, hsp, performanceRatio }) {
  if (pctCoberturaDeseado == null || pctCoberturaDeseado < 0 || pctCoberturaDeseado > 1) {
    throw new Error(`pctCoberturaDeseado debe ser decimal entre 0 y 1 (ej. 0.90 para 90%) — recibido: ${pctCoberturaDeseado}`);
  }
  if (!hsp?.valor) throw new Error('Falta HSP para calcular la potencia requerida.');
  if (!performanceRatio?.valor) throw new Error('Falta Performance Ratio para calcular la potencia requerida.');

  const valor = (consumoAnualKwh * pctCoberturaDeseado) / (hsp.valor * 365 * performanceRatio.valor);
  return { valor, formula: '(consumoAnualKwh × pctCoberturaDeseado) / (hsp.valor × 365 × performanceRatio.valor)' };
}

// ── 3. Cantidad de paneles y potencia instalada ─────────────────────────────

function calcularNumeroPaneles(potenciaRequeridaKwp, panelSpecs) {
  if (!panelSpecs?.potencia_wp) {
    return { valor: null, incompleto: true, motivo: 'El panel seleccionado no tiene potencia_wp en su ficha técnica.' };
  }
  const valor = Math.ceil((potenciaRequeridaKwp * 1000) / panelSpecs.potencia_wp);
  return { valor, incompleto: false };
}

function calcularPotenciaInstalada(numeroPaneles, panelSpecs) {
  return (numeroPaneles * panelSpecs.potencia_wp) / 1000;
}

// ── 4. Selección de inversor — ficha técnica real, no solo ratio DC/AC ─────

const CAMPOS_INVERSOR_REQUERIDOS = [
  'potencia_ac_nominal_kw', 'potencia_dc_max_kw', 'voltaje_max_entrada_v',
  'rango_mppt_min_v', 'rango_mppt_max_v', 'corriente_max_por_mppt_a',
  'numero_mppt', 'tipo_red', 'voltaje_salida_v',
];

/**
 * Filtra el catálogo por compatibilidad técnica real (potencia DC máxima,
 * tipo de red, voltaje de salida) y usa el ratio DC/AC (NREL: relación
 * nominal entre potencia DC del arreglo y capacidad AC del inversor) como
 * regla objetivo de selección entre los candidatos ya compatibles — nunca
 * como único criterio de validación.
 */
function seleccionarInversor({ potenciaInstaladaKwp, tipoAlimentacion, voltajeSitio, catalogoInversores, ratioDcAcObjetivo }) {
  const descartados = [];
  const candidatos = [];

  for (const inversor of catalogoInversores || []) {
    const specs = inversor.specs || {};
    const faltantes = CAMPOS_INVERSOR_REQUERIDOS.filter(c => specs[c] == null);
    if (faltantes.length > 0) {
      descartados.push({ producto_id: inversor.id, motivo: `Ficha técnica incompleta: faltan ${faltantes.join(', ')}` });
      continue;
    }
    if (specs.tipo_red !== tipoAlimentacion) {
      descartados.push({ producto_id: inversor.id, motivo: `Tipo de red incompatible (inversor: ${specs.tipo_red}, sitio: ${tipoAlimentacion})` });
      continue;
    }
    if (Math.abs(specs.voltaje_salida_v - voltajeSitio) > voltajeSitio * 0.05) {
      descartados.push({ producto_id: inversor.id, motivo: `Voltaje de salida incompatible (inversor: ${specs.voltaje_salida_v}V, sitio: ${voltajeSitio}V)` });
      continue;
    }
    if (potenciaInstaladaKwp > specs.potencia_dc_max_kw) {
      descartados.push({ producto_id: inversor.id, motivo: 'Potencia DC instalada excede la potencia DC máxima admitida del inversor.' });
      continue;
    }

    const ratioDcAc = potenciaInstaladaKwp / specs.potencia_ac_nominal_kw;
    candidatos.push({ inversor, specs, ratioDcAc, cumpleRatioObjetivo: Math.abs(ratioDcAc - ratioDcAcObjetivo) <= 0.15 });
  }

  if (candidatos.length === 0) {
    return { inversorSeleccionado: null, incompleto: true, motivo: 'Ningún inversor del catálogo cumple los requisitos técnicos.', descartados };
  }

  candidatos.sort((a, b) => (a.cumpleRatioObjetivo !== b.cumpleRatioObjetivo)
    ? (a.cumpleRatioObjetivo ? -1 : 1)
    : a.specs.potencia_ac_nominal_kw - b.specs.potencia_ac_nominal_kw);

  const elegido = candidatos[0];
  return { inversorSeleccionado: elegido.inversor, ratioDcAc: elegido.ratioDcAc, incompleto: false, descartados };
}

// ── 5. Strings — validación eléctrica preliminar ────────────────────────────

const CAMPOS_PANEL_STRING_REQUERIDOS = ['voc', 'vmp', 'isc', 'imp', 'coef_temp_voc'];
const CAMPOS_INVERSOR_STRING_REQUERIDOS = ['voltaje_max_entrada_v', 'rango_mppt_min_v', 'rango_mppt_max_v', 'corriente_max_por_mppt_a', 'numero_mppt'];

/**
 * Predimensionamiento de strings — NO reemplaza el diseño eléctrico
 * ejecutivo (que considera además caída de tensión, temperatura de
 * operación real, factores de seguridad NOM-001). Valida las 3 condiciones
 * mínimas pedidas: Voc corregido por temperatura, Vmp dentro del rango
 * MPPT, y corriente de strings en paralelo dentro del límite del MPPT.
 * Si falta cualquier dato técnico, marca incompleto — nunca asume.
 */
function calcularStrings({ panelSpecs, inversorSpecs, temperaturaMinSitio, numeroPaneles }) {
  const faltantesPanel = CAMPOS_PANEL_STRING_REQUERIDOS.filter(c => panelSpecs?.[c] == null);
  const faltantesInversor = CAMPOS_INVERSOR_STRING_REQUERIDOS.filter(c => inversorSpecs?.[c] == null);

  if (faltantesPanel.length > 0 || faltantesInversor.length > 0 || temperaturaMinSitio == null) {
    const faltantes = [
      ...faltantesPanel.map(c => `panel.${c}`),
      ...faltantesInversor.map(c => `inversor.${c}`),
      temperaturaMinSitio == null ? 'temperatura_min_sitio' : null,
    ].filter(Boolean);
    return { incompleto: true, motivo: `Faltan datos técnicos para validar strings: ${faltantes.join(', ')} — requiere revisión manual.` };
  }

  const deltaT = temperaturaMinSitio - STC_TEMP_C;
  const vocCorregido = panelSpecs.voc * (1 + (panelSpecs.coef_temp_voc / 100) * deltaT);

  const panelesPorStringMaxVoc = Math.floor(inversorSpecs.voltaje_max_entrada_v / vocCorregido);
  const panelesPorStringMinMppt = Math.ceil(inversorSpecs.rango_mppt_min_v / panelSpecs.vmp);
  const panelesPorStringMaxMppt = Math.floor(inversorSpecs.rango_mppt_max_v / panelSpecs.vmp);
  const panelesPorString = Math.min(panelesPorStringMaxVoc, panelesPorStringMaxMppt);

  if (panelesPorString < panelesPorStringMinMppt || panelesPorString < 1) {
    return { incompleto: true, motivo: 'No hay una configuración de string compatible con el rango MPPT del inversor — requiere revisión manual.' };
  }

  const numeroStrings = Math.ceil(numeroPaneles / panelesPorString);
  const corrienteTotalPorMppt = (numeroStrings * panelSpecs.isc) / inversorSpecs.numero_mppt;
  const dentroDeLimiteCorriente = corrienteTotalPorMppt <= inversorSpecs.corriente_max_por_mppt_a;

  return {
    incompleto: false,
    panelesPorString,
    numeroStrings,
    vocCorregido,
    corrienteTotalPorMppt,
    dentroDeLimiteCorriente,
    advertencia: dentroDeLimiteCorriente ? null : 'La corriente estimada por MPPT excede el límite del inversor — revisar distribución de strings manualmente.',
  };
}

// ── 6. Área requerida ────────────────────────────────────────────────────────

function calcularAreaRequerida(numeroPaneles, panelSpecs, factorSeparacion) {
  if (!panelSpecs?.area_m2) return { valor: null, incompleto: true, motivo: 'El panel no tiene área_m2 en su ficha técnica.' };
  return { valor: numeroPaneles * panelSpecs.area_m2 * factorSeparacion.valor, incompleto: false };
}

// ── 7. Producción — real por mes cuando hay datos, si no, estimación simple ─

function calcularProduccion({ potenciaInstaladaKwp, hsp, performanceRatio }) {
  const anual = potenciaInstaladaKwp * hsp.valor * 365 * performanceRatio.valor;

  if (hsp.hsp_mensual && Object.keys(hsp.hsp_mensual).length > 0) {
    const DIAS_PROMEDIO_MES = 30.4; // aproximación uniforme — no se modela el número exacto de días por mes
    const mensual = {};
    for (const [mes, hspMes] of Object.entries(hsp.hsp_mensual)) {
      mensual[mes] = potenciaInstaladaKwp * hspMes * DIAS_PROMEDIO_MES * performanceRatio.valor;
    }
    return { anual, mensual, estimacionSimplificada: false };
  }

  return { anual, mensual: null, promedioMensual: anual / 12, estimacionSimplificada: true };
}

function calcularCobertura(produccionAnualKwh, consumoAnualKwh) {
  if (!consumoAnualKwh) return null;
  return (produccionAnualKwh / consumoAnualKwh) * 100;
}

// ── 8. Ahorro — con metadatos completos, nunca solo un número ──────────────

/**
 * Usa el costo efectivo REAL que el cliente ya paga (importe recibo /
 * consumo facturado) — deliberadamente NO simula la estructura escalonada
 * completa de la tarifa CFE (básico/intermedio/excedente/DAC), eso es
 * ingeniería ejecutiva, no predimensionamiento. Guarda todos los
 * metadatos de la aproximación para que nunca se presente como
 * "simulación completa de tarifa".
 */
function calcularAhorro({ produccionMensualKwh, consumoMensualKwh, importeRecibo, consumoFacturadoKwh, periodo, incluyeCargosFijos }) {
  if (!importeRecibo || !consumoFacturadoKwh) {
    return { incompleto: true, motivo: 'Falta el importe del recibo o el consumo facturado para calcular el costo efectivo por kWh.' };
  }

  const costoEfectivoKwh = importeRecibo / consumoFacturadoKwh;
  const kwhCompensados = Math.min(produccionMensualKwh, consumoMensualKwh);
  const ahorroMensualEstimado = kwhCompensados * costoEfectivoKwh;

  return {
    incompleto: false,
    ahorroMensualEstimado,
    ahorroAnualEstimado: ahorroMensualEstimado * 12,
    metadatos: {
      importeRecibo,
      consumoFacturadoKwh,
      costoEfectivoKwh,
      periodo: periodo || 'mensual',
      incluyeCargosFijos: incluyeCargosFijos ?? null,
      advertencia: 'Aproximación basada en el costo efectivo actual del cliente — no simula la estructura escalonada completa de la tarifa CFE.',
    },
  };
}

// ── 9. Periodo simple de recuperación — nunca "ROI financiero" ──────────────

/**
 * Retorno simple = inversión neta / ahorro anual estimado. Se llama
 * explícitamente "periodo simple de recuperación" — un ROI financiero real
 * requeriría degradación del sistema, incremento de tarifa, mantenimiento,
 * financiamiento, inflación, valor presente y TIR (fuera de alcance de
 * Fase 1, documentado como pendiente).
 */
function calcularPeriodoSimpleRecuperacion(inversionNeta, ahorroAnualEstimado) {
  if (!ahorroAnualEstimado || ahorroAnualEstimado <= 0 || !inversionNeta) {
    return { valor: null, incompleto: true };
  }
  return { valor: inversionNeta / ahorroAnualEstimado, unidad: 'años', etiqueta: 'Periodo simple de recuperación', incompleto: false };
}

// ── 10. Reducción de CO2 — factor configurable y versionado ────────────────

function calcularReduccionCO2(produccionAnualKwh, factorCO2) {
  if (!factorCO2?.valor) return { valor: null, incompleto: true };
  return { valor: produccionAnualKwh * factorCO2.valor, unidad: 'kgCO2e/año', fuente: factorCO2, incompleto: false };
}

// ── 14. Alertas de bloqueo ───────────────────────────────────────────────────

function generarAlertas({ infoTecnica, hsp, panelSeleccionado, inversorSeleccionado, areaRequerida, coberturaPct, strings }) {
  const alertas = [];

  if (!infoTecnica.consumoMensualKwh && !(infoTecnica.historialConsumo?.length)) {
    alertas.push({ tipo: 'consumo_faltante', severidad: 'bloqueo', mensaje: 'Falta el consumo mensual o el historial de consumo.' });
  }
  if (!hsp) {
    alertas.push({ tipo: 'hsp_faltante', severidad: 'bloqueo', mensaje: 'No se pudo resolver la ubicación o el HSP del sitio.' });
  }
  if (areaRequerida?.valor != null && infoTecnica.areaDisponibleM2 != null && infoTecnica.areaDisponibleM2 < areaRequerida.valor) {
    alertas.push({ tipo: 'area_insuficiente', severidad: 'bloqueo', mensaje: `El área disponible (${infoTecnica.areaDisponibleM2} m²) es menor al área requerida (${areaRequerida.valor.toFixed(1)} m²).` });
  }
  if (!panelSeleccionado || !inversorSeleccionado) {
    alertas.push({ tipo: 'ficha_tecnica_incompleta', severidad: 'bloqueo', mensaje: 'El panel o el inversor seleccionado no tienen ficha técnica completa.' });
  }
  if (!infoTecnica.tipoAlimentacion || !infoTecnica.voltajeSitio) {
    alertas.push({ tipo: 'red_desconocida', severidad: 'bloqueo', mensaje: 'Falta el tipo de red o el voltaje del sitio.' });
  }
  if (strings?.incompleto) {
    alertas.push({ tipo: 'strings_incompletos', severidad: 'bloqueo', mensaje: strings.motivo });
  } else if (strings?.advertencia) {
    alertas.push({ tipo: 'strings_fuera_de_limite', severidad: 'bloqueo', mensaje: strings.advertencia });
  }
  if (coberturaPct != null && coberturaPct > 150) {
    alertas.push({ tipo: 'cobertura_anormal', severidad: 'bloqueo', mensaje: `La cobertura estimada (${coberturaPct.toFixed(0)}%) es anormalmente alta — revisar los datos capturados.` });
  }

  return alertas;
}

// ── Orquestador ───────────────────────────────────────────────────────────────

/**
 * Corre el motor completo. No toca la base de datos — recibe ya resueltos
 * el HSP, los parámetros configurables, el panel elegido y el catálogo de
 * inversores candidatos (resolución de datos es responsabilidad de
 * modules/cotizaciones.js, para que este archivo sea 100% puro y testeable
 * sin mocks). Nunca sobrescribe potencia_requerida_kwp/potencia_instalada_kwp/
 * potencia_ac_inversor_kw entre sí — quedan siempre como claves separadas.
 *
 * @returns {{motor, motor_version, resultados, alertas, estado_calculo, aviso}}
 */
function calcularPredimensionamiento({ infoTecnica, hsp, parametros, panelSeleccionado, catalogoInversores, temperaturaMinSitio, inversionNeta }) {
  const alertasPrevias = [];
  const consumoAnual = calcularConsumoAnual(infoTecnica);

  let potenciaRequerida = null;
  try {
    potenciaRequerida = calcularPotenciaRequerida({
      consumoAnualKwh: consumoAnual.valor,
      pctCoberturaDeseado: infoTecnica.pctCoberturaDeseado,
      hsp,
      performanceRatio: parametros.performance_ratio,
    });
  } catch (e) {
    alertasPrevias.push({ tipo: 'potencia_requerida_error', severidad: 'bloqueo', mensaje: e.message });
  }

  let numeroPaneles = null, potenciaInstalada = null, areaRequerida = null;
  if (potenciaRequerida && panelSeleccionado) {
    numeroPaneles = calcularNumeroPaneles(potenciaRequerida.valor, panelSeleccionado.specs);
    if (!numeroPaneles.incompleto) {
      potenciaInstalada = calcularPotenciaInstalada(numeroPaneles.valor, panelSeleccionado.specs);
      areaRequerida = calcularAreaRequerida(numeroPaneles.valor, panelSeleccionado.specs, parametros.factor_separacion_filas);
    }
  }

  let seleccionInversor = null;
  if (potenciaInstalada != null) {
    seleccionInversor = seleccionarInversor({
      potenciaInstaladaKwp: potenciaInstalada,
      tipoAlimentacion: infoTecnica.tipoAlimentacion,
      voltajeSitio: infoTecnica.voltajeSitio,
      catalogoInversores,
      ratioDcAcObjetivo: parametros.ratio_dc_ac_objetivo.valor,
    });
  }

  let strings = null;
  if (seleccionInversor?.inversorSeleccionado && panelSeleccionado && numeroPaneles && !numeroPaneles.incompleto) {
    strings = calcularStrings({
      panelSpecs: panelSeleccionado.specs,
      inversorSpecs: seleccionInversor.inversorSeleccionado.specs,
      temperaturaMinSitio,
      numeroPaneles: numeroPaneles.valor,
    });
  }

  let produccion = null, coberturaPct = null;
  if (potenciaInstalada != null) {
    produccion = calcularProduccion({ potenciaInstaladaKwp: potenciaInstalada, hsp, performanceRatio: parametros.performance_ratio });
    coberturaPct = calcularCobertura(produccion.anual, consumoAnual.valor);
  }

  let ahorro = null, periodoRecuperacion = null, co2 = null;
  if (produccion) {
    ahorro = calcularAhorro({
      produccionMensualKwh: produccion.promedioMensual ?? produccion.anual / 12,
      consumoMensualKwh: infoTecnica.consumoMensualKwh,
      importeRecibo: infoTecnica.importePromedioRecibo,
      consumoFacturadoKwh: infoTecnica.consumoMensualKwh,
      periodo: 'mensual',
      incluyeCargosFijos: infoTecnica.incluyeCargosFijos,
    });
    if (ahorro && !ahorro.incompleto && inversionNeta) {
      periodoRecuperacion = calcularPeriodoSimpleRecuperacion(inversionNeta, ahorro.ahorroAnualEstimado);
    }
    co2 = calcularReduccionCO2(produccion.anual, parametros.factor_emision_co2);
  }

  const alertas = [
    ...alertasPrevias,
    ...generarAlertas({ infoTecnica, hsp, panelSeleccionado, inversorSeleccionado: seleccionInversor?.inversorSeleccionado, areaRequerida, coberturaPct, strings }),
  ];

  const hayBloqueos = alertas.some(a => a.severidad === 'bloqueo');
  const hayIncompletos = [numeroPaneles, seleccionInversor, strings, ahorro].some(r => r?.incompleto);
  const estado_calculo = hayBloqueos ? 'bloqueado' : (hayIncompletos ? 'incompleto_faltan_datos' : 'completo');

  return {
    motor: 'paneles_solares',
    motor_version: MOTOR_VERSION,
    resultados: {
      consumo_anual_kwh: consumoAnual,
      potencia_requerida_kwp: potenciaRequerida,
      numero_paneles: numeroPaneles,
      potencia_instalada_kwp: potenciaInstalada,
      potencia_ac_inversor_kw: seleccionInversor?.inversorSeleccionado?.specs?.potencia_ac_nominal_kw ?? null,
      inversor_seleccionado: seleccionInversor,
      strings,
      area_requerida_m2: areaRequerida,
      produccion,
      cobertura_pct: coberturaPct,
      ahorro,
      periodo_simple_recuperacion: periodoRecuperacion,
      reduccion_co2: co2,
    },
    alertas,
    estado_calculo,
    aviso: 'Predimensionamiento — ingeniería preliminar sujeta a validación física, estructural y eléctrica.',
  };
}

// ── PDF comercial — resumen ejecutivo (Alina, 2026-08-04) ──────────────────
// Traduce `resultados` (los mismos números técnicos de siempre, sin
// recalcular nada) a tarjetas listas para mostrar en el PDF de venta.
// Mecanismo genérico + contenido específico por industria: el renderer del
// PDF (modules/cotizacion-pdf.js) solo sabe pintar un arreglo de tarjetas —
// CADA motor de industria expone su propia resumenEjecutivoParaPdf() con
// las suyas (mismo criterio que motores-ingenieria/index.js ya documenta).
// Nunca inventa un valor: si un cálculo quedó incompleto (ahorro sin
// importe de recibo, CO2 sin factor, retorno sin inversión capturada), la
// tarjeta se marca `disponible: false` — el renderer decide cómo mostrarlo,
// esta función nunca rellena con un placeholder numérico.

function _formatoEntero(n) { return Math.round(n).toLocaleString('es-MX'); }
function _formatoDecimal1(n) { return n.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function _formatoMoneda(n) { return `$${Math.round(n).toLocaleString('es-MX')}`; }

function resumenEjecutivoParaPdf(resultados) {
  const tarjetas = [];

  tarjetas.push({
    clave: 'numero_paneles', etiqueta: 'Paneles recomendados', icono: '☀️',
    disponible: resultados.numero_paneles?.valor != null,
    valorTexto: resultados.numero_paneles?.valor != null ? `${resultados.numero_paneles.valor} paneles` : null,
  });

  tarjetas.push({
    clave: 'potencia_instalada', etiqueta: 'Potencia instalada', icono: '⚡',
    disponible: resultados.potencia_instalada_kwp != null,
    valorTexto: resultados.potencia_instalada_kwp != null ? `${_formatoDecimal1(resultados.potencia_instalada_kwp)} kWp` : null,
  });

  tarjetas.push({
    clave: 'produccion_anual', etiqueta: 'Producción estimada', icono: '🔋',
    disponible: resultados.produccion?.anual != null,
    valorTexto: resultados.produccion?.anual != null ? `${_formatoEntero(resultados.produccion.anual)} kWh/año` : null,
  });

  const ahorroDisponible = Boolean(resultados.ahorro && !resultados.ahorro.incompleto);
  tarjetas.push({
    clave: 'ahorro_mensual', etiqueta: 'Ahorro mensual estimado', icono: '💰',
    disponible: ahorroDisponible,
    valorTexto: ahorroDisponible ? _formatoMoneda(resultados.ahorro.ahorroMensualEstimado) : null,
  });
  tarjetas.push({
    clave: 'ahorro_anual', etiqueta: 'Ahorro anual estimado', icono: '💵',
    disponible: ahorroDisponible,
    valorTexto: ahorroDisponible ? _formatoMoneda(resultados.ahorro.ahorroAnualEstimado) : null,
  });

  tarjetas.push({
    clave: 'cobertura', etiqueta: 'Cobertura de tu consumo', icono: '📊',
    disponible: resultados.cobertura_pct != null,
    valorTexto: resultados.cobertura_pct != null ? `${_formatoDecimal1(resultados.cobertura_pct)}%` : null,
  });

  const co2Disponible = Boolean(resultados.reduccion_co2 && !resultados.reduccion_co2.incompleto);
  tarjetas.push({
    clave: 'reduccion_co2', etiqueta: 'Reducción de CO₂ al año', icono: '🌱',
    disponible: co2Disponible,
    valorTexto: co2Disponible ? `${_formatoEntero(resultados.reduccion_co2.valor)} kg` : null,
  });

  const retornoDisponible = Boolean(resultados.periodo_simple_recuperacion && !resultados.periodo_simple_recuperacion.incompleto);
  tarjetas.push({
    clave: 'retorno', etiqueta: 'Retorno aproximado de tu inversión', icono: '⏱️',
    disponible: retornoDisponible,
    valorTexto: retornoDisponible ? `${_formatoDecimal1(resultados.periodo_simple_recuperacion.valor)} años` : null,
  });

  return tarjetas;
}

module.exports = {
  MOTOR_VERSION,
  calcularConsumoAnual,
  calcularPotenciaRequerida,
  calcularNumeroPaneles,
  calcularPotenciaInstalada,
  seleccionarInversor,
  calcularStrings,
  calcularAreaRequerida,
  calcularProduccion,
  calcularCobertura,
  calcularAhorro,
  calcularPeriodoSimpleRecuperacion,
  calcularReduccionCO2,
  generarAlertas,
  calcularPredimensionamiento,
  resumenEjecutivoParaPdf,
};
