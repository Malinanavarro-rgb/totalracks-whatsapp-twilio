'use strict';

const { armarPropuestas, generarPropuestasCotizacion } = require('../modules/propuestas-solares');

// Cálculo real de Nort Energy (Jinko Tiger Neo 550, 600 kWh/mes, Monterrey, 90 % cobertura):
// 8 paneles técnicos, 4.4 kWp, ~6,801 kWh/año de producción.
function calculoBase(over = {}) {
  return {
    resultados: {
      consumo_anual_kwh: { valor: 7200 },
      numero_paneles: { valor: 8 },
      potencia_instalada_kwp: 4.4,
      produccion: { anual: 6801 },
      ...over.resultados,
    },
    datos_entrada: { consumoMensualKwh: 600, importePromedioRecibo: 2400, incluyeCargosFijos: false, ...over.datos_entrada },
  };
}

const PAQUETES = [
  { id: 'p4', nombre: 'Paquete 4 paneles', cantidad_paneles: 4, precio_contado: 33990 },
  { id: 'p6', nombre: 'Paquete 6 paneles', cantidad_paneles: 6, precio_contado: 53990 },
  { id: 'p8', nombre: 'Paquete 8 paneles', cantidad_paneles: 8, precio_contado: 63990 },
  { id: 'p10', nombre: 'Paquete 10 paneles', cantidad_paneles: 10, precio_contado: 83990 },
];

const porTipo = (r, tipo) => r.propuestas.find((p) => p.tipo === tipo);

describe('armarPropuestas() — selección de las 3', () => {
  test('económica = el paquete anterior, recomendada = el más chico que alcanza, ampliada = el siguiente', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase() });
    expect(r.propuestas.map((p) => [p.tipo, p.paquete.id])).toEqual([['economica', 'p6'], ['recomendada', 'p8'], ['ampliada', 'p10']]);
    expect(r.numero_paneles_tecnico).toBe(8);
    expect(r.motivo).toBeNull();
  });

  test('la recomendada sigue la MISMA regla que seleccionarPaqueteRecomendado (más chico con cantidad >= técnico, nunca redondea hacia abajo)', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase({ resultados: { numero_paneles: { valor: 7 } } }) });
    expect(porTipo(r, 'recomendada').paquete.id).toBe('p8'); // 7 paneles → el de 8, no el de 6
  });

  test('paquetes desordenados → igual se ordenan por cantidad', () => {
    const r = armarPropuestas({ paquetes: [PAQUETES[3], PAQUETES[0], PAQUETES[2], PAQUETES[1]], calculo: calculoBase() });
    expect(r.propuestas.map((p) => p.paquete.id)).toEqual(['p6', 'p8', 'p10']);
  });

  test('si la recomendada es el paquete MÁS CHICO → no hay económica (no se inventa uno)', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase({ resultados: { numero_paneles: { valor: 3 }, potencia_instalada_kwp: 1.65, produccion: { anual: 2550 } } }) });
    expect(r.propuestas.map((p) => p.tipo)).toEqual(['recomendada', 'ampliada']);
  });

  test('si la recomendada es el paquete MÁS GRANDE → no hay ampliada', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase({ resultados: { numero_paneles: { valor: 10 }, potencia_instalada_kwp: 5.5, produccion: { anual: 8500 } } }) });
    expect(r.propuestas.map((p) => p.tipo)).toEqual(['economica', 'recomendada']);
  });

  test('ningún paquete alcanza el número técnico → sin propuestas y con motivo (paquete a la medida)', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase({ resultados: { numero_paneles: { valor: 25 } } }) });
    expect(r.propuestas).toEqual([]);
    expect(r.motivo).toMatch(/a la medida/);
  });

  test('sin paquetes vigentes → sin propuestas', () => {
    const r = armarPropuestas({ paquetes: [], calculo: calculoBase() });
    expect(r.propuestas).toEqual([]);
    expect(r.motivo).toMatch(/Ningún paquete/);
  });

  test('cálculo sin número de paneles (bloqueado/sin panel) → sin propuestas y con motivo, nunca inventa', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: { resultados: { numero_paneles: { valor: null, incompleto: true } }, datos_entrada: {} } });
    expect(r.propuestas).toEqual([]);
    expect(r.numero_paneles_tecnico).toBeNull();
    expect(r.motivo).toMatch(/número de paneles/);
  });

  test('calculo undefined no lanza', () => {
    expect(armarPropuestas({ paquetes: PAQUETES, calculo: undefined }).propuestas).toEqual([]);
  });
});

describe('armarPropuestas() — números por propuesta', () => {
  test('la recomendada reproduce el cálculo original (misma producción y cobertura que el motor)', () => {
    const rec = porTipo(armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase() }), 'recomendada');
    expect(rec.kwp).toBeCloseTo(4.4, 5);
    expect(rec.produccion_anual_kwh).toBeCloseTo(6801, 3);
    expect(rec.cobertura_pct).toBeCloseTo((6801 / 7200) * 100, 3);
  });

  test('la producción escala linealmente con los kWp del paquete', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase() });
    expect(porTipo(r, 'economica').produccion_anual_kwh).toBeCloseTo(6801 * (6 / 8), 3);
    expect(porTipo(r, 'ampliada').produccion_anual_kwh).toBeCloseTo(6801 * (10 / 8), 3);
  });

  test('ahorro = kWh compensados × costo efectivo del recibo (mismas fórmulas del motor)', () => {
    const rec = porTipo(armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase() }), 'recomendada');
    const costoKwh = 2400 / 600;
    expect(rec.ahorro_anual).toBeCloseTo((6801 / 12) * costoKwh * 12, 2);
    expect(rec.ahorro_acumulado).toEqual({ 5: rec.ahorro_anual * 5, 10: rec.ahorro_anual * 10, 20: rec.ahorro_anual * 20 });
  });

  test('periodo de recuperación = precio de contado del PAQUETE / ahorro anual', () => {
    const rec = porTipo(armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase() }), 'recomendada');
    expect(rec.periodo_recuperacion_anios).toBeCloseTo(63990 / rec.ahorro_anual, 5);
  });

  test('ampliada que produce MÁS que el consumo: el ahorro se topa en el consumo y se marca excede_consumo (no paga más por energía que no se usa)', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase() });
    const amp = porTipo(r, 'ampliada');
    expect(amp.cobertura_pct).toBeGreaterThan(100);
    expect(amp.excede_consumo).toBe(true);
    expect(amp.ahorro_anual).toBeCloseTo(600 * 12 * (2400 / 600), 2); // tope: consumo × costo efectivo
    expect(amp.periodo_recuperacion_anios).toBeGreaterThan(porTipo(r, 'recomendada').periodo_recuperacion_anios);
    expect(porTipo(r, 'recomendada').excede_consumo).toBe(false);
  });
});

describe('armarPropuestas() — de dónde sale el kWp del paquete', () => {
  test('paquete SIN potencia registrada (caso real de Nort Energy) → estimada con el panel del cálculo, y queda marcada', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase() });
    const eco = porTipo(r, 'economica');
    expect(eco.kwp).toBeCloseTo(3.3, 5); // 6 paneles × 550 W
    expect(eco.kwp_fuente).toBe('estimada_con_panel_del_calculo');
  });

  test('paquete con potencia_total_kwp registrada → usa ese dato, marcado como registrado', () => {
    const paquetes = PAQUETES.map((p) => (p.id === 'p8' ? { ...p, potencia_total_kwp: 4.96 } : p));
    const rec = porTipo(armarPropuestas({ paquetes, calculo: calculoBase() }), 'recomendada');
    expect(rec.kwp).toBe(4.96);
    expect(rec.kwp_fuente).toBe('registrada');
    expect(rec.produccion_anual_kwh).toBeCloseTo(6801 * (4.96 / 4.4), 3);
  });

  test('paquete con potencia por panel × cantidad → registrado', () => {
    const paquetes = PAQUETES.map((p) => (p.id === 'p8' ? { ...p, potencia_panel_wp: 620 } : p));
    const rec = porTipo(armarPropuestas({ paquetes, calculo: calculoBase() }), 'recomendada');
    expect(rec.kwp).toBeCloseTo(4.96, 5);
    expect(rec.kwp_fuente).toBe('registrada');
  });
});

describe('armarPropuestas() — datos faltantes: null con motivo, nunca un número inventado', () => {
  test('sin importe de recibo → sin ahorro ni recuperación, pero sí producción y cobertura', () => {
    const rec = porTipo(armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase({ datos_entrada: { importePromedioRecibo: null } }) }), 'recomendada');
    expect(rec.cobertura_pct).not.toBeNull();
    expect(rec.ahorro_anual).toBeNull();
    expect(rec.periodo_recuperacion_anios).toBeNull();
    expect(rec.motivos.join(' ')).toMatch(/importe del recibo/);
  });

  test('paquete sin precio de contado → sin recuperación, con motivo', () => {
    const paquetes = PAQUETES.map((p) => (p.id === 'p8' ? { ...p, precio_contado: null } : p));
    const rec = porTipo(armarPropuestas({ paquetes, calculo: calculoBase() }), 'recomendada');
    expect(rec.ahorro_anual).not.toBeNull();
    expect(rec.periodo_recuperacion_anios).toBeNull();
    expect(rec.motivos.join(' ')).toMatch(/recuperación/);
  });

  test('cálculo sin potencia instalada / producción → no se puede escalar: todo null con motivo', () => {
    const r = armarPropuestas({ paquetes: PAQUETES, calculo: calculoBase({ resultados: { potencia_instalada_kwp: null, produccion: null } }) });
    r.propuestas.forEach((p) => {
      expect(p.produccion_anual_kwh).toBeNull();
      expect(p.motivos.length).toBeGreaterThan(0);
    });
  });
});

// ─── generarPropuestasCotizacion (con DB mockeada por tabla) ─────────────────

function crearBuilder(resultado) {
  const b = {
    select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return b;
}

function crearDb(porTabla) {
  const builders = {};
  return {
    builders,
    from: jest.fn((tabla) => { builders[tabla] = crearBuilder(porTabla[tabla] ?? { data: null, error: null }); return builders[tabla]; }),
  };
}

describe('generarPropuestasCotizacion()', () => {
  test('cotización inexistente o de otra empresa → null (filtra por company_id)', async () => {
    const db = crearDb({ cotizaciones: { data: null, error: null } });
    expect(await generarPropuestasCotizacion(db, { companyId: 'empresa-a', cotizacionId: 99 })).toBeNull();
    expect(db.builders.cotizaciones.eq).toHaveBeenCalledWith('company_id', 'empresa-a');
  });

  test('cotización sin cálculo de ingeniería → sin propuestas y con motivo, sin tocar paquetes', async () => {
    const db = crearDb({ cotizaciones: { data: { id: 1, calculo_ingenieria_id: null, paquete_recomendado_id: null }, error: null } });
    const r = await generarPropuestasCotizacion(db, { companyId: 'empresa-a', cotizacionId: 1 });
    expect(r.propuestas).toEqual([]);
    expect(r.motivo).toMatch(/todavía no tiene un cálculo/);
    expect(db.from).not.toHaveBeenCalledWith('paquetes_solares');
  });

  test('con cálculo: solo paquetes ACTIVOS y VIGENTES de la empresa, y devuelve el recomendado actual de la cotización', async () => {
    const db = crearDb({
      cotizaciones: { data: { id: 1, calculo_ingenieria_id: 'calc-1', paquete_recomendado_id: 'p8' }, error: null },
      calculos_ingenieria: { data: calculoBase(), error: null },
      paquetes_solares: { data: PAQUETES, error: null },
    });
    const r = await generarPropuestasCotizacion(db, { companyId: 'empresa-a', cotizacionId: 1 });

    expect(r.propuestas.map((p) => p.tipo)).toEqual(['economica', 'recomendada', 'ampliada']);
    expect(r.paquete_recomendado_actual_id).toBe('p8');
    const paq = db.builders.paquetes_solares;
    expect(paq.eq).toHaveBeenCalledWith('company_id', 'empresa-a');
    expect(paq.eq).toHaveBeenCalledWith('activo', true);
    expect(paq.lte).toHaveBeenCalledWith('vigencia_desde', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(paq.or).toHaveBeenCalledWith(expect.stringMatching(/^vigencia_hasta\.is\.null,vigencia_hasta\.gte\.\d{4}-\d{2}-\d{2}$/));
  });
});
