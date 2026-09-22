'use strict';

const { calcularMargenSobreVenta, calcularMarkupSobreCosto, costoTotalProducto, calcularRentabilidadCotizacion } = require('../modules/rentabilidad');

function crearBuilder(resultado = { data: null, error: null }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
}

const COMPANY_A = 'company-a';

describe('calcularMargenSobreVenta() — (precio - costo) / precio', () => {
  test('caso clásico de confusión: markup del 50% NO es margen del 50% — es 33.3%', () => {
    // costo 100, precio 150 (50% de markup sobre el costo)
    expect(calcularMargenSobreVenta(150, 100)).toBeCloseTo(33.333, 2);
  });

  test('venta al mismo costo → 0% margen', () => {
    expect(calcularMargenSobreVenta(100, 100)).toBe(0);
  });

  test('venta por debajo del costo → margen negativo, nunca se oculta', () => {
    expect(calcularMargenSobreVenta(80, 100)).toBe(-25);
  });

  test('precio 0 o negativo → null, no divide entre cero', () => {
    expect(calcularMargenSobreVenta(0, 100)).toBeNull();
    expect(calcularMargenSobreVenta(-50, 100)).toBeNull();
  });

  test('costo o precio null/NaN → null', () => {
    expect(calcularMargenSobreVenta(null, 100)).toBeNull();
    expect(calcularMargenSobreVenta(100, null)).toBeNull();
    expect(calcularMargenSobreVenta(NaN, 100)).toBeNull();
  });

  test('costo 0 (regalo/muestra) es válido — 100% de margen', () => {
    expect(calcularMargenSobreVenta(100, 0)).toBe(100);
  });
});

describe('calcularMarkupSobreCosto() — (precio - costo) / costo', () => {
  test('mismo caso clásico desde el otro lado: 33.3% de margen es 50% de markup', () => {
    expect(calcularMarkupSobreCosto(150, 100)).toBeCloseTo(50, 6);
  });

  test('venta al mismo costo → 0% markup', () => {
    expect(calcularMarkupSobreCosto(100, 100)).toBe(0);
  });

  test('venta por debajo del costo → markup negativo', () => {
    expect(calcularMarkupSobreCosto(80, 100)).toBe(-20);
  });

  test('costo 0 → null (el markup sobre un costo de 0 es indefinido, no infinito ni 0)', () => {
    expect(calcularMarkupSobreCosto(100, 0)).toBeNull();
  });

  test('costo negativo o null → null', () => {
    expect(calcularMarkupSobreCosto(100, -10)).toBeNull();
    expect(calcularMarkupSobreCosto(100, null)).toBeNull();
  });

  test('precio 0 es válido (se vendió a pérdida total) — -100% de markup', () => {
    expect(calcularMarkupSobreCosto(0, 100)).toBe(-100);
  });
});

describe('costoTotalProducto()', () => {
  test('usa costo_interno_nort_energy si está capturado, sin sumar nada más', () => {
    expect(costoTotalProducto({ costo_interno_nort_energy: 5000, costo_proveedor: 1, costo_instalacion: 1, costo_materiales: 1 })).toBe(5000);
  });

  test('sin costo_interno_nort_energy, con los 3 desglosados → suma', () => {
    expect(costoTotalProducto({ costo_proveedor: 3000, costo_instalacion: 800, costo_materiales: 200 })).toBe(4000);
  });

  test('desglose PARCIAL (falta uno) → null, nunca una suma subestimada', () => {
    expect(costoTotalProducto({ costo_proveedor: 3000, costo_instalacion: 800 })).toBeNull();
    expect(costoTotalProducto({ costo_proveedor: 3000 })).toBeNull();
  });

  test('sin ningún dato de costo → null', () => {
    expect(costoTotalProducto({})).toBeNull();
    expect(costoTotalProducto(null)).toBeNull();
  });

  test('costo_interno_nort_energy = 0 es válido (ej. equipo donado) y gana sobre el desglose', () => {
    expect(costoTotalProducto({ costo_interno_nort_energy: 0, costo_proveedor: 999 })).toBe(0);
  });
});

describe('calcularRentabilidadCotizacion()', () => {
  function armarDb({ cotizacion = { id: 1 }, lineas = [], productos = [] } = {}) {
    return {
      from: jest.fn((tabla) => {
        if (tabla === 'cotizaciones') return crearBuilder({ data: cotizacion, error: null });
        if (tabla === 'cotizacion_lineas') return crearBuilder({ data: lineas, error: null });
        if (tabla === 'productos') return crearBuilder({ data: productos, error: null });
        return crearBuilder();
      }),
    };
  }

  test('cotización inexistente o de otra empresa → null', async () => {
    const db = armarDb({ cotizacion: null });
    expect(await calcularRentabilidadCotizacion(db, { companyId: COMPANY_A, cotizacionId: 999 })).toBeNull();
  });

  test('sin líneas → agregado en 0, sin lanzar', async () => {
    const db = armarDb({ lineas: [] });
    const r = await calcularRentabilidadCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.lineas).toEqual([]);
    expect(r.agregado).toEqual({ total_venta: 0, total_costo_conocido: null, margen_sobre_venta_pct: null, markup_sobre_costo_pct: null });
  });

  test('línea con producto_id y costo conocido → margen/markup calculados, agregado correcto', async () => {
    const db = armarDb({
      lineas: [{ id: 'l1', descripcion: 'Jinko x8', producto_id: 'panel-1', cantidad: 8, precio_unitario: 3200, subtotal: 25600 }],
      productos: [{ id: 'panel-1', costo_interno_nort_energy: null, costo_proveedor: 2000, costo_instalacion: 300, costo_materiales: 100 }],
    });
    const r = await calcularRentabilidadCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });

    expect(r.lineas[0].costo_unitario).toBe(2400); // 2000+300+100
    expect(r.lineas[0].costo_total).toBe(19200); // 2400 × 8
    expect(r.lineas[0].margen_sobre_venta_pct).toBeCloseTo(25, 5); // (25600-19200)/25600
    expect(r.agregado.total_venta).toBe(25600);
    expect(r.agregado.total_costo_conocido).toBe(19200);
    expect(r.lineas_sin_costo).toBe(0);
  });

  test('línea manual (sin producto_id) → costo null, se excluye del agregado, no cuenta como costo 0', async () => {
    const db = armarDb({
      lineas: [
        { id: 'l1', descripcion: 'Panel', producto_id: 'panel-1', cantidad: 8, precio_unitario: 3200, subtotal: 25600 },
        { id: 'l2', descripcion: 'Instalación (mano de obra, manual)', producto_id: null, cantidad: 1, precio_unitario: 5000, subtotal: 5000 },
      ],
      productos: [{ id: 'panel-1', costo_interno_nort_energy: 2400 }],
    });
    const r = await calcularRentabilidadCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });

    const lineaManual = r.lineas.find((l) => l.id === 'l2');
    expect(lineaManual.costo_unitario).toBeNull();
    expect(lineaManual.margen_sobre_venta_pct).toBeNull();
    expect(r.agregado.total_venta).toBe(30600); // 25600 + 5000, SÍ incluye la línea manual en venta
    expect(r.agregado.total_costo_conocido).toBe(19200); // pero el costo NO cuenta los 5000 de la línea sin costo
    expect(r.lineas_sin_costo).toBe(1);
  });

  test('TODAS las líneas sin costo conocido → agregado de costo/margen en null (nunca 0% falso)', async () => {
    const db = armarDb({
      lineas: [{ id: 'l1', descripcion: 'Concepto libre', producto_id: null, cantidad: 1, precio_unitario: 1000, subtotal: 1000 }],
      productos: [],
    });
    const r = await calcularRentabilidadCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.agregado.total_costo_conocido).toBeNull();
    expect(r.agregado.margen_sobre_venta_pct).toBeNull();
  });

  test('producto con desglose de costo PARCIAL → línea queda sin costo, nunca subestima', async () => {
    const db = armarDb({
      lineas: [{ id: 'l1', descripcion: 'Inversor', producto_id: 'inv-1', cantidad: 1, precio_unitario: 9500, subtotal: 9500 }],
      productos: [{ id: 'inv-1', costo_interno_nort_energy: null, costo_proveedor: 6000 }], // falta instalación y materiales
    });
    const r = await calcularRentabilidadCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(r.lineas[0].costo_unitario).toBeNull();
    expect(r.lineas_sin_costo).toBe(1);
  });

  test('nunca consulta productos si ninguna línea tiene producto_id', async () => {
    const db = armarDb({ lineas: [{ id: 'l1', descripcion: 'Libre', producto_id: null, cantidad: 1, precio_unitario: 100, subtotal: 100 }] });
    await calcularRentabilidadCotizacion(db, { companyId: COMPANY_A, cotizacionId: 1 });
    expect(db.from).not.toHaveBeenCalledWith('productos');
  });
});
