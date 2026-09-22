'use strict';

const {
  listarPlanes, crearPlan, actualizarPlan, desactivarPlan, eliminarPlan, calcularPlan, simularFinanciamientoCotizacion,
} = require('../modules/planes-financiamiento');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  return { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
}

function crearMockDbPorTabla(overrides = {}) {
  const defaults = { cotizaciones: { data: null, error: null }, planes_financiamiento: { data: [], error: null } };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-a';

describe('crearPlan()', () => {
  test('sin nombre o tipo → 400', async () => {
    const db = crearMockDb();
    await expect(crearPlan(db, COMPANY_A, { nombre: 'X' })).rejects.toMatchObject({ status: 400 });
    await expect(crearPlan(db, COMPANY_A, { tipo: 'msi' })).rejects.toMatchObject({ status: 400 });
  });

  test('tipo inválido → 400', async () => {
    const db = crearMockDb();
    await expect(crearPlan(db, COMPANY_A, { nombre: 'X', tipo: 'otro' })).rejects.toMatchObject({ status: 400 });
  });

  test('msi/credito sin numero_parcialidades → 400', async () => {
    const db = crearMockDb();
    await expect(crearPlan(db, COMPANY_A, { nombre: '12 MSI', tipo: 'msi' })).rejects.toMatchObject({ status: 400 });
  });

  test('credito sin tasa_interes_anual_pct → 400 (usa msi si no lleva interés)', async () => {
    const db = crearMockDb();
    await expect(crearPlan(db, COMPANY_A, { nombre: 'Crédito', tipo: 'credito', numero_parcialidades: 24 })).rejects.toMatchObject({ status: 400 });
  });

  test('contado no requiere numero_parcialidades ni tasa', async () => {
    const db = crearMockDb({ data: { id: 'p1', tipo: 'contado' }, error: null });
    await expect(crearPlan(db, COMPANY_A, { nombre: 'Contado', tipo: 'contado' })).resolves.toMatchObject({ id: 'p1' });
  });

  test('msi válido → inserta con company_id', async () => {
    let insertado = null;
    const db = { from: jest.fn(() => { const b = crearBuilder({ data: { id: 'p1' }, error: null }); b.insert = jest.fn((rows) => { insertado = rows[0]; return b; }); return b; }) };
    await crearPlan(db, COMPANY_A, { nombre: '12 MSI', tipo: 'msi', numero_parcialidades: 12 });
    expect(insertado).toMatchObject({ company_id: COMPANY_A, nombre: '12 MSI', tipo: 'msi', numero_parcialidades: 12 });
  });
});

describe('actualizarPlan() / desactivarPlan() / eliminarPlan()', () => {
  test('actualizarPlan: no encontrado → 404', async () => {
    const db = crearMockDb({ data: null, error: null });
    await expect(actualizarPlan(db, COMPANY_A, 'p1', { nombre: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  test('desactivarPlan: pone activo:false', async () => {
    let payloadCapturado = null;
    const db = { from: jest.fn(() => { const b = crearBuilder({ data: { id: 'p1', activo: false }, error: null }); b.update = jest.fn((p) => { payloadCapturado = p; return b; }); return b; }) };
    await desactivarPlan(db, COMPANY_A, 'p1');
    expect(payloadCapturado.activo).toBe(false);
  });

  test('eliminarPlan: filtra por company_id', async () => {
    const db = crearMockDb({ data: null, error: null });
    await eliminarPlan(db, COMPANY_A, 'p1');
    const builder = db.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
  });
});

describe('listarPlanes()', () => {
  test('soloActivos filtra por activo:true', async () => {
    const db = crearMockDb({ data: [], error: null });
    await listarPlanes(db, COMPANY_A, { soloActivos: true });
    const builder = db.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('activo', true);
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDb({ data: null, error: { message: 'boom' } });
    expect(await listarPlanes(db, COMPANY_A)).toEqual([]);
  });
});

describe('calcularPlan()', () => {
  test('contado: sin mensualidad, total = monto, sin costo financiero', () => {
    const r = calcularPlan({ monto: 40716, plan: { tipo: 'contado' } });
    expect(r).toEqual({ mensualidad: null, total_a_pagar: 40716, costo_financiero: 0, incompleto: false, motivo: null });
  });

  test('msi: mensualidad = monto / parcialidades exacto, sin costo financiero', () => {
    const r = calcularPlan({ monto: 12000, plan: { tipo: 'msi', numero_parcialidades: 12 } });
    expect(r.mensualidad).toBe(1000);
    expect(r.total_a_pagar).toBe(12000);
    expect(r.costo_financiero).toBe(0);
  });

  test('credito: amortización francesa — verificado con una fórmula de referencia conocida (24 meses, 24% anual)', () => {
    const monto = 40716;
    const tasaAnual = 24;
    const n = 24;
    const i = tasaAnual / 100 / 12;
    const mensualidadEsperada = (monto * i) / (1 - (1 + i) ** -n);

    const r = calcularPlan({ monto, plan: { tipo: 'credito', numero_parcialidades: n, tasa_interes_anual_pct: tasaAnual } });
    expect(r.mensualidad).toBeCloseTo(mensualidadEsperada, 2);
    expect(r.total_a_pagar).toBeCloseTo(mensualidadEsperada * n, 2);
    expect(r.costo_financiero).toBeCloseTo(mensualidadEsperada * n - monto, 2);
    expect(r.costo_financiero).toBeGreaterThan(0); // con tasa > 0, el crédito siempre cuesta más que el monto
  });

  test('credito con tasa 0 mal configurada → se calcula como msi, nunca divide entre cero ni lanza', () => {
    const r = calcularPlan({ monto: 12000, plan: { tipo: 'credito', numero_parcialidades: 12, tasa_interes_anual_pct: 0 } });
    expect(r.mensualidad).toBe(1000);
    expect(r.costo_financiero).toBe(0);
    expect(r.incompleto).toBe(false);
  });

  test('msi/credito sin numero_parcialidades → incompleto, con motivo, nunca lanza', () => {
    const r = calcularPlan({ monto: 12000, plan: { tipo: 'msi', numero_parcialidades: null } });
    expect(r.incompleto).toBe(true);
    expect(r.mensualidad).toBeNull();
  });

  test('monto null/0/negativo → incompleto en cualquier tipo de plan, nunca inventa', () => {
    expect(calcularPlan({ monto: null, plan: { tipo: 'contado' } }).incompleto).toBe(true);
    expect(calcularPlan({ monto: 0, plan: { tipo: 'msi', numero_parcialidades: 6 } }).incompleto).toBe(true);
    expect(calcularPlan({ monto: -100, plan: { tipo: 'credito', numero_parcialidades: 6, tasa_interes_anual_pct: 10 } }).incompleto).toBe(true);
  });
});

describe('simularFinanciamientoCotizacion()', () => {
  test('cotización inexistente o de otra empresa → null', async () => {
    const db = crearMockDbPorTabla({ cotizaciones: { data: null, error: null } });
    expect(await simularFinanciamientoCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 })).toBeNull();
  });

  test('sin total ni precio_final_autorizado → sin planes, con motivo, nunca consulta planes', async () => {
    const db = crearMockDbPorTabla({ cotizaciones: { data: { id: 1, total: null, precio_final_autorizado: null }, error: null } });
    const r = await simularFinanciamientoCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.planes).toEqual([]);
    expect(r.motivo).toMatch(/total o precio final/);
    expect(db.from).not.toHaveBeenCalledWith('planes_financiamiento');
  });

  test('sin planes activos configurados → sin planes, con motivo honesto (no inventa uno)', async () => {
    const db = crearMockDbPorTabla({ cotizaciones: { data: { id: 1, total: 40716, precio_final_autorizado: null }, error: null }, planes_financiamiento: { data: [], error: null } });
    const r = await simularFinanciamientoCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.planes).toEqual([]);
    expect(r.motivo).toMatch(/no tiene planes de financiamiento configurados/);
  });

  test('usa precio_final_autorizado sobre total cuando ambos existen', async () => {
    const db = crearMockDbPorTabla({
      cotizaciones: { data: { id: 1, total: 45000, precio_final_autorizado: 40000 }, error: null },
      planes_financiamiento: { data: [{ id: 'p1', tipo: 'contado' }], error: null },
    });
    const r = await simularFinanciamientoCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.monto_base).toBe(40000);
    expect(r.planes[0].total_a_pagar).toBe(40000);
  });

  test('con varios planes activos calcula cada uno sobre el mismo monto base', async () => {
    const db = crearMockDbPorTabla({
      cotizaciones: { data: { id: 1, total: 12000, precio_final_autorizado: null }, error: null },
      planes_financiamiento: { data: [
        { id: 'contado', tipo: 'contado' },
        { id: 'msi12', tipo: 'msi', numero_parcialidades: 12 },
      ], error: null },
    });
    const r = await simularFinanciamientoCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.planes).toHaveLength(2);
    expect(r.planes.find((p) => p.plan.id === 'contado').total_a_pagar).toBe(12000);
    expect(r.planes.find((p) => p.plan.id === 'msi12').mensualidad).toBe(1000);
  });

  test('plan con anticipo_pct_minimo → financia solo el resto, nunca el total completo', async () => {
    const db = crearMockDbPorTabla({
      cotizaciones: { data: { id: 1, total: 100000, precio_final_autorizado: null }, error: null },
      planes_financiamiento: { data: [{ id: 'p1', tipo: 'msi', numero_parcialidades: 10, anticipo_pct_minimo: 20 }], error: null },
    });
    const r = await simularFinanciamientoCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.planes[0].monto_a_financiar).toBe(80000); // 100000 - 20%
    expect(r.planes[0].mensualidad).toBe(8000); // 80000 / 10
  });

  test('plan sin anticipo_pct_minimo → financia el monto completo', async () => {
    const db = crearMockDbPorTabla({
      cotizaciones: { data: { id: 1, total: 100000, precio_final_autorizado: null }, error: null },
      planes_financiamiento: { data: [{ id: 'p1', tipo: 'msi', numero_parcialidades: 10, anticipo_pct_minimo: null }], error: null },
    });
    const r = await simularFinanciamientoCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.planes[0].monto_a_financiar).toBe(100000);
  });
});
