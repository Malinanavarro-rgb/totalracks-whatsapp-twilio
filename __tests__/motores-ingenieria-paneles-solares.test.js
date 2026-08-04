'use strict';

const {
  calcularConsumoAnual, calcularPotenciaRequerida, calcularNumeroPaneles, calcularPotenciaInstalada,
  seleccionarInversor, calcularStrings, calcularAreaRequerida, calcularProduccion, calcularCobertura,
  calcularAhorro, calcularPeriodoSimpleRecuperacion, calcularReduccionCO2, generarAlertas,
  calcularPredimensionamiento,
} = require('../modules/motores-ingenieria/paneles-solares');

// ─── Datos de referencia reusados entre pruebas ────────────────────────────

const HSP_MONTERREY = { valor: 5.5, fuente: 'NREL NSRDB', ubicacion: 'Monterrey, NL', fecha_fuente: '2024-01-01' };
const HSP_SONORA = { valor: 6.0, fuente: 'NREL NSRDB', ubicacion: 'Hermosillo, Son', fecha_fuente: '2024-01-01' };
const PR_DEFAULT = { valor: 0.77, fuente: 'IEC 61724 — valor típico de referencia', anio: 2024 };
const FACTOR_SEPARACION = { valor: 1.4 };
const RATIO_DC_AC_OBJETIVO = { valor: 1.2 };
const FACTOR_CO2 = { valor: 0.444, unidad: 'kgCO2e/kWh', organismo: 'SENER/CENACE', anio: 2025 };

const PANEL_550W = {
  id: 'panel-550', specs: { potencia_wp: 550, voc: 49.5, vmp: 41.5, isc: 13.9, imp: 13.25, area_m2: 2.58, coef_temp_voc: -0.27 },
};
const PANEL_585W = {
  id: 'panel-585', specs: { potencia_wp: 585, voc: 51.2, vmp: 43.0, isc: 13.94, imp: 13.61, area_m2: 2.72, coef_temp_voc: -0.26 },
};

const INVERSOR_MONOFASICO_4KW = {
  id: 'inv-mono-4kw',
  specs: {
    potencia_ac_nominal_kw: 4, potencia_dc_max_kw: 6, voltaje_max_entrada_v: 550,
    rango_mppt_min_v: 90, rango_mppt_max_v: 480, corriente_max_por_mppt_a: 13.5,
    numero_mppt: 2, tipo_red: 'monofasica', voltaje_salida_v: 220,
  },
};
const INVERSOR_TRIFASICO_40KW = {
  id: 'inv-tri-40kw',
  specs: {
    potencia_ac_nominal_kw: 40, potencia_dc_max_kw: 52, voltaje_max_entrada_v: 1000,
    rango_mppt_min_v: 200, rango_mppt_max_v: 850, corriente_max_por_mppt_a: 26,
    numero_mppt: 4, tipo_red: 'trifasica', voltaje_salida_v: 380,
  },
};
const INVERSOR_FICHA_INCOMPLETA = {
  id: 'inv-incompleto',
  specs: { potencia_ac_nominal_kw: 4, tipo_red: 'monofasica' }, // sin rango_mppt_max_v, etc.
};

describe('motores-ingenieria/paneles-solares — fórmulas individuales', () => {
  describe('calcularConsumoAnual()', () => {
    test('usa historial de 12 meses cuando existe (más preciso que ×12)', () => {
      const historial = Array.from({ length: 12 }, (_, i) => ({ mes: `m${i}`, kwh: 500 + i }));
      const resultado = calcularConsumoAnual({ consumoMensualKwh: 999, historialConsumo: historial });
      const esperado = historial.reduce((a, m) => a + m.kwh, 0);
      expect(resultado).toEqual({ valor: esperado, metodo: 'historial_12_meses' });
    });

    test('sin historial, usa consumoMensualKwh × 12', () => {
      expect(calcularConsumoAnual({ consumoMensualKwh: 600 })).toEqual({ valor: 7200, metodo: 'estimado_mensual_x12' });
    });
  });

  describe('calcularPotenciaRequerida()', () => {
    test('fórmula: (consumoAnual × pctCobertura) / (HSP × 365 × PR)', () => {
      const resultado = calcularPotenciaRequerida({ consumoAnualKwh: 7200, pctCoberturaDeseado: 0.90, hsp: HSP_MONTERREY, performanceRatio: PR_DEFAULT });
      const esperado = (7200 * 0.90) / (5.5 * 365 * 0.77);
      expect(resultado.valor).toBeCloseTo(esperado, 6);
    });

    test('rechaza pctCoberturaDeseado fuera de [0,1] — nunca adivina si venía en 0-100', () => {
      expect(() => calcularPotenciaRequerida({ consumoAnualKwh: 7200, pctCoberturaDeseado: 90, hsp: HSP_MONTERREY, performanceRatio: PR_DEFAULT }))
        .toThrow(/decimal entre 0 y 1/);
    });

    test('lanza si falta HSP', () => {
      expect(() => calcularPotenciaRequerida({ consumoAnualKwh: 7200, pctCoberturaDeseado: 0.9, hsp: null, performanceRatio: PR_DEFAULT })).toThrow(/HSP/);
    });

    test('lanza si falta Performance Ratio', () => {
      expect(() => calcularPotenciaRequerida({ consumoAnualKwh: 7200, pctCoberturaDeseado: 0.9, hsp: HSP_MONTERREY, performanceRatio: null })).toThrow(/Performance Ratio/);
    });
  });

  describe('calcularNumeroPaneles() / calcularPotenciaInstalada()', () => {
    test('redondea hacia arriba (nunca menos paneles de los necesarios)', () => {
      const resultado = calcularNumeroPaneles(4.188, PANEL_550W.specs);
      expect(resultado).toEqual({ valor: 8, incompleto: false }); // CEIL(4188/550) = 8
    });

    test('marca incompleto si el panel no tiene potencia_wp en su ficha técnica', () => {
      const resultado = calcularNumeroPaneles(4.2, {});
      expect(resultado.incompleto).toBe(true);
    });

    test('potencia instalada = numeroPaneles × potencia_wp / 1000 (siempre ≥ la requerida por el redondeo)', () => {
      expect(calcularPotenciaInstalada(8, PANEL_550W.specs)).toBeCloseTo(4.4, 6);
    });
  });

  describe('seleccionarInversor() — ficha técnica real, no solo ratio DC/AC', () => {
    test('descarta un inversor con ficha técnica incompleta, con motivo explícito', () => {
      const resultado = seleccionarInversor({
        potenciaInstaladaKwp: 4.4, tipoAlimentacion: 'monofasica', voltajeSitio: 220,
        catalogoInversores: [INVERSOR_FICHA_INCOMPLETA], ratioDcAcObjetivo: RATIO_DC_AC_OBJETIVO.valor,
      });
      expect(resultado.incompleto).toBe(true);
      expect(resultado.descartados[0].motivo).toMatch(/Ficha técnica incompleta/);
    });

    test('descarta por tipo de red incompatible', () => {
      const resultado = seleccionarInversor({
        potenciaInstaladaKwp: 4.4, tipoAlimentacion: 'trifasica', voltajeSitio: 220,
        catalogoInversores: [INVERSOR_MONOFASICO_4KW], ratioDcAcObjetivo: RATIO_DC_AC_OBJETIVO.valor,
      });
      expect(resultado.incompleto).toBe(true);
      expect(resultado.descartados[0].motivo).toMatch(/Tipo de red incompatible/);
    });

    test('descarta si la potencia instalada excede la potencia DC máxima admitida', () => {
      const resultado = seleccionarInversor({
        potenciaInstaladaKwp: 100, tipoAlimentacion: 'monofasica', voltajeSitio: 220,
        catalogoInversores: [INVERSOR_MONOFASICO_4KW], ratioDcAcObjetivo: RATIO_DC_AC_OBJETIVO.valor,
      });
      expect(resultado.incompleto).toBe(true);
      expect(resultado.descartados[0].motivo).toMatch(/Potencia DC instalada excede/);
    });

    test('elige el inversor compatible correcto de entre varios candidatos', () => {
      const resultado = seleccionarInversor({
        potenciaInstaladaKwp: 4.4, tipoAlimentacion: 'monofasica', voltajeSitio: 220,
        catalogoInversores: [INVERSOR_TRIFASICO_40KW, INVERSOR_MONOFASICO_4KW], ratioDcAcObjetivo: RATIO_DC_AC_OBJETIVO.valor,
      });
      expect(resultado.incompleto).toBe(false);
      expect(resultado.inversorSeleccionado.id).toBe('inv-mono-4kw');
      expect(resultado.ratioDcAc).toBeCloseTo(4.4 / 4, 6);
    });
  });

  describe('calcularStrings() — validación eléctrica preliminar', () => {
    test('marca incompleto si falta cualquier dato técnico (panel, inversor o temperatura)', () => {
      expect(calcularStrings({ panelSpecs: {}, inversorSpecs: INVERSOR_MONOFASICO_4KW.specs, temperaturaMinSitio: 5, numeroPaneles: 8 }).incompleto).toBe(true);
      expect(calcularStrings({ panelSpecs: PANEL_550W.specs, inversorSpecs: {}, temperaturaMinSitio: 5, numeroPaneles: 8 }).incompleto).toBe(true);
      expect(calcularStrings({ panelSpecs: PANEL_550W.specs, inversorSpecs: INVERSOR_MONOFASICO_4KW.specs, temperaturaMinSitio: null, numeroPaneles: 8 }).incompleto).toBe(true);
    });

    test('valida Voc corregido por temperatura, Vmp en rango MPPT, y corriente por MPPT — caso compatible', () => {
      const resultado = calcularStrings({ panelSpecs: PANEL_550W.specs, inversorSpecs: INVERSOR_MONOFASICO_4KW.specs, temperaturaMinSitio: 5, numeroPaneles: 8 });
      expect(resultado.incompleto).toBe(false);
      expect(resultado.panelesPorString).toBe(10);
      expect(resultado.numeroStrings).toBe(1);
      expect(resultado.dentroDeLimiteCorriente).toBe(true);
    });

    test('marca advertencia si la corriente total por MPPT excede el límite del inversor', () => {
      const inversorCorrienteBaja = { specs: { ...INVERSOR_MONOFASICO_4KW.specs, corriente_max_por_mppt_a: 1 } };
      const resultado = calcularStrings({ panelSpecs: PANEL_550W.specs, inversorSpecs: inversorCorrienteBaja.specs, temperaturaMinSitio: 5, numeroPaneles: 8 });
      expect(resultado.incompleto).toBe(false);
      expect(resultado.dentroDeLimiteCorriente).toBe(false);
      expect(resultado.advertencia).toMatch(/excede el límite/);
    });
  });

  describe('calcularAreaRequerida()', () => {
    test('incluye el factor de separación entre filas', () => {
      const resultado = calcularAreaRequerida(8, PANEL_550W.specs, FACTOR_SEPARACION);
      expect(resultado.valor).toBeCloseTo(8 * 2.58 * 1.4, 6);
    });

    test('marca incompleto si el panel no tiene área en su ficha técnica', () => {
      expect(calcularAreaRequerida(8, {}, FACTOR_SEPARACION).incompleto).toBe(true);
    });
  });

  describe('calcularProduccion()', () => {
    test('con HSP mensual real: distribuye por mes, NUNCA divide la anual entre 12', () => {
      const hspConMensual = { valor: 5.5, hsp_mensual: { enero: 4.8, febrero: 5.2 } };
      const resultado = calcularProduccion({ potenciaInstaladaKwp: 4.4, hsp: hspConMensual, performanceRatio: PR_DEFAULT });
      expect(resultado.estimacionSimplificada).toBe(false);
      expect(resultado.mensual.enero).toBeCloseTo(4.4 * 4.8 * 30.4 * 0.77, 4);
      expect(resultado.mensual.enero).not.toBeCloseTo(resultado.anual / 12, 2); // confirma que NO es el reparto simplista
    });

    test('sin HSP mensual: promedio simple, etiquetado explícitamente como estimación simplificada', () => {
      const resultado = calcularProduccion({ potenciaInstaladaKwp: 4.4, hsp: HSP_MONTERREY, performanceRatio: PR_DEFAULT });
      expect(resultado.estimacionSimplificada).toBe(true);
      expect(resultado.mensual).toBeNull();
      expect(resultado.promedioMensual).toBeCloseTo(resultado.anual / 12, 6);
    });
  });

  describe('calcularCobertura()', () => {
    test('producción / consumo × 100', () => {
      expect(calcularCobertura(6808, 7200)).toBeCloseTo((6808 / 7200) * 100, 4);
    });
  });

  describe('calcularAhorro() — nunca solo un número, siempre con metadatos', () => {
    test('marca incompleto si falta el importe o el consumo facturado', () => {
      expect(calcularAhorro({ produccionMensualKwh: 500, consumoMensualKwh: 600, importeRecibo: null, consumoFacturadoKwh: 600 }).incompleto).toBe(true);
    });

    test('usa el costo efectivo real (importe/consumo), guarda todos los metadatos de la aproximación', () => {
      const resultado = calcularAhorro({ produccionMensualKwh: 567, consumoMensualKwh: 600, importeRecibo: 2400, consumoFacturadoKwh: 600, periodo: 'mensual', incluyeCargosFijos: false });
      expect(resultado.incompleto).toBe(false);
      expect(resultado.metadatos.costoEfectivoKwh).toBeCloseTo(4.0, 6);
      expect(resultado.metadatos.incluyeCargosFijos).toBe(false);
      expect(resultado.metadatos.advertencia).toMatch(/no simula la estructura escalonada/);
      expect(resultado.ahorroMensualEstimado).toBeCloseTo(567 * 4.0, 6);
    });

    test('nunca compensa más de lo que el cliente consume (MIN de producción y consumo)', () => {
      const resultado = calcularAhorro({ produccionMensualKwh: 900, consumoMensualKwh: 600, importeRecibo: 2400, consumoFacturadoKwh: 600 });
      expect(resultado.ahorroMensualEstimado).toBeCloseTo(600 * 4.0, 6); // no 900 × 4.0
    });
  });

  describe('calcularPeriodoSimpleRecuperacion() — nunca se llama "ROI financiero"', () => {
    test('inversión / ahorro anual, etiquetado explícitamente', () => {
      const resultado = calcularPeriodoSimpleRecuperacion(95000, 27234);
      expect(resultado.etiqueta).toBe('Periodo simple de recuperación');
      expect(resultado.valor).toBeCloseTo(95000 / 27234, 6);
    });

    test('incompleto si no hay ahorro anual', () => {
      expect(calcularPeriodoSimpleRecuperacion(95000, 0).incompleto).toBe(true);
    });
  });

  describe('calcularReduccionCO2() — factor configurable con fuente, nunca hardcodeado silenciosamente', () => {
    test('produccion × factor, conserva la fuente del factor usado', () => {
      const resultado = calcularReduccionCO2(6808, FACTOR_CO2);
      expect(resultado.valor).toBeCloseTo(6808 * 0.444, 6);
      expect(resultado.fuente.organismo).toBe('SENER/CENACE');
    });
  });

  describe('generarAlertas() — bloqueos', () => {
    test('bloquea si falta consumo', () => {
      const alertas = generarAlertas({ infoTecnica: {}, hsp: HSP_MONTERREY, panelSeleccionado: PANEL_550W, inversorSeleccionado: INVERSOR_MONOFASICO_4KW, areaRequerida: null, coberturaPct: 90, strings: null });
      expect(alertas.some(a => a.tipo === 'consumo_faltante' && a.severidad === 'bloqueo')).toBe(true);
    });

    test('bloquea si el área disponible es menor a la requerida', () => {
      const alertas = generarAlertas({
        infoTecnica: { consumoMensualKwh: 600, areaDisponibleM2: 10, tipoAlimentacion: 'monofasica', voltajeSitio: 220 },
        hsp: HSP_MONTERREY, panelSeleccionado: PANEL_550W, inversorSeleccionado: INVERSOR_MONOFASICO_4KW,
        areaRequerida: { valor: 28.9 }, coberturaPct: 90, strings: null,
      });
      expect(alertas.some(a => a.tipo === 'area_insuficiente')).toBe(true);
    });

    test('bloquea si la cobertura estimada es anormalmente alta (>150%)', () => {
      const alertas = generarAlertas({
        infoTecnica: { consumoMensualKwh: 600, tipoAlimentacion: 'monofasica', voltajeSitio: 220 },
        hsp: HSP_MONTERREY, panelSeleccionado: PANEL_550W, inversorSeleccionado: INVERSOR_MONOFASICO_4KW,
        areaRequerida: { valor: 10 }, coberturaPct: 200, strings: null,
      });
      expect(alertas.some(a => a.tipo === 'cobertura_anormal')).toBe(true);
    });

    test('sin problemas, no genera alertas', () => {
      const alertas = generarAlertas({
        infoTecnica: { consumoMensualKwh: 600, areaDisponibleM2: 40, tipoAlimentacion: 'monofasica', voltajeSitio: 220 },
        hsp: HSP_MONTERREY, panelSeleccionado: PANEL_550W, inversorSeleccionado: INVERSOR_MONOFASICO_4KW,
        areaRequerida: { valor: 28.9 }, coberturaPct: 94, strings: { incompleto: false, dentroDeLimiteCorriente: true },
      });
      expect(alertas).toEqual([]);
    });
  });
});

describe('calcularPredimensionamiento() — 3 casos completos', () => {
  test('CASO 1 — residencial monofásico: cálculo completo, sin bloqueos', () => {
    const resultado = calcularPredimensionamiento({
      infoTecnica: {
        consumoMensualKwh: 600, pctCoberturaDeseado: 0.90, importePromedioRecibo: 2400,
        tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 40, incluyeCargosFijos: false,
      },
      hsp: HSP_MONTERREY,
      parametros: { performance_ratio: PR_DEFAULT, factor_separacion_filas: FACTOR_SEPARACION, ratio_dc_ac_objetivo: RATIO_DC_AC_OBJETIVO, factor_emision_co2: FACTOR_CO2 },
      panelSeleccionado: PANEL_550W,
      catalogoInversores: [INVERSOR_MONOFASICO_4KW, INVERSOR_TRIFASICO_40KW],
      temperaturaMinSitio: 5,
      inversionNeta: 95000,
    });

    expect(resultado.estado_calculo).toBe('completo');
    expect(resultado.alertas).toEqual([]);
    expect(resultado.resultados.numero_paneles.valor).toBe(8);
    expect(resultado.resultados.potencia_instalada_kwp).toBeCloseTo(4.4, 6);
    expect(resultado.resultados.potencia_requerida_kwp.valor).not.toBeCloseTo(resultado.resultados.potencia_instalada_kwp, 3); // las 3 potencias NUNCA son iguales/sobrescritas
    expect(resultado.resultados.potencia_ac_inversor_kw).toBe(4);
    expect(resultado.resultados.inversor_seleccionado.inversorSeleccionado.id).toBe('inv-mono-4kw');
    expect(resultado.resultados.strings.numeroStrings).toBe(1);
    expect(resultado.resultados.cobertura_pct).toBeGreaterThan(80);
    expect(resultado.resultados.cobertura_pct).toBeLessThan(110);
    expect(resultado.resultados.ahorro.incompleto).toBe(false);
    expect(resultado.resultados.periodo_simple_recuperacion.etiqueta).toBe('Periodo simple de recuperación');
    expect(resultado.resultados.reduccion_co2.valor).toBeGreaterThan(0);
    expect(resultado.aviso).toMatch(/Predimensionamiento/);
  });

  test('CASO 2 — comercial trifásico: cálculo completo, sin bloqueos', () => {
    const resultado = calcularPredimensionamiento({
      infoTecnica: {
        consumoMensualKwh: 8000, pctCoberturaDeseado: 0.80, importePromedioRecibo: 32000,
        tipoAlimentacion: 'trifasica', voltajeSitio: 380, areaDisponibleM2: 350, incluyeCargosFijos: true,
      },
      hsp: HSP_SONORA,
      parametros: { performance_ratio: PR_DEFAULT, factor_separacion_filas: FACTOR_SEPARACION, ratio_dc_ac_objetivo: RATIO_DC_AC_OBJETIVO, factor_emision_co2: FACTOR_CO2 },
      panelSeleccionado: PANEL_585W,
      catalogoInversores: [INVERSOR_MONOFASICO_4KW, INVERSOR_TRIFASICO_40KW],
      temperaturaMinSitio: 10,
      inversionNeta: 950000,
    });

    expect(resultado.estado_calculo).toBe('completo');
    expect(resultado.alertas).toEqual([]);
    expect(resultado.resultados.inversor_seleccionado.inversorSeleccionado.id).toBe('inv-tri-40kw');
    expect(resultado.resultados.potencia_ac_inversor_kw).toBe(40);
    expect(resultado.resultados.numero_paneles.valor).toBeGreaterThan(70);
    expect(resultado.resultados.strings.numeroStrings).toBeGreaterThan(1);
    expect(resultado.resultados.cobertura_pct).toBeGreaterThan(70);
    expect(resultado.resultados.cobertura_pct).toBeLessThan(90);
    expect(resultado.resultados.ahorro.incompleto).toBe(false);
  });

  test('CASO 3 — bloqueado: área disponible insuficiente para el sistema requerido', () => {
    const resultado = calcularPredimensionamiento({
      infoTecnica: {
        consumoMensualKwh: 600, pctCoberturaDeseado: 0.90, importePromedioRecibo: 2400,
        tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 10, // insuficiente: se requieren ~28.9 m²
      },
      hsp: HSP_MONTERREY,
      parametros: { performance_ratio: PR_DEFAULT, factor_separacion_filas: FACTOR_SEPARACION, ratio_dc_ac_objetivo: RATIO_DC_AC_OBJETIVO, factor_emision_co2: FACTOR_CO2 },
      panelSeleccionado: PANEL_550W,
      catalogoInversores: [INVERSOR_MONOFASICO_4KW],
      temperaturaMinSitio: 5,
      inversionNeta: 95000,
    });

    expect(resultado.estado_calculo).toBe('bloqueado');
    expect(resultado.alertas.some(a => a.tipo === 'area_insuficiente' && a.severidad === 'bloqueo')).toBe(true);
  });

  test('CASO 3b — bloqueado: catálogo sin ningún inversor con ficha técnica compatible', () => {
    const resultado = calcularPredimensionamiento({
      infoTecnica: {
        consumoMensualKwh: 600, pctCoberturaDeseado: 0.90, importePromedioRecibo: 2400,
        tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 40,
      },
      hsp: HSP_MONTERREY,
      parametros: { performance_ratio: PR_DEFAULT, factor_separacion_filas: FACTOR_SEPARACION, ratio_dc_ac_objetivo: RATIO_DC_AC_OBJETIVO, factor_emision_co2: FACTOR_CO2 },
      panelSeleccionado: PANEL_550W,
      catalogoInversores: [INVERSOR_FICHA_INCOMPLETA, INVERSOR_TRIFASICO_40KW], // ninguno compatible con monofásico 4.4kW
      temperaturaMinSitio: 5,
      inversionNeta: 95000,
    });

    expect(resultado.estado_calculo).toBe('bloqueado');
    expect(resultado.alertas.some(a => a.tipo === 'ficha_tecnica_incompleta')).toBe(true);
    expect(resultado.resultados.strings).toBeNull(); // nunca se llega a calcular strings sin inversor
  });
});
