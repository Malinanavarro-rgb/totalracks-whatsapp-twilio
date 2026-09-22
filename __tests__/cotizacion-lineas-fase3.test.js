'use strict';

const {
  recalcularTotales, agregarLinea, actualizarLinea, eliminarLinea, aplicarCalculoALineas, aplicarBomALineas, IVA_DEFAULT,
} = require('../modules/cotizacion-lineas');

function crearBuilder(resultado = { data: null, error: null }) {
  return {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
}

function crearMockDb(...resultados) {
  let idx = 0;
  return { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
}

function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    cotizacion_lineas: { data: [], error: null },
    cotizaciones: { data: null, error: null },
    calculos_ingenieria: { data: null, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

describe('recalcularTotales()', () => {
  test('suma subtotales con descuento aplicado y calcula IVA al 16%', async () => {
    const db = crearMockDb(
      { data: [{ cantidad: 2, precio_unitario: 100, descuento_pct: 10 }, { cantidad: 1, precio_unitario: 500, descuento_pct: 0 }], error: null },
      { data: null, error: null },
    );
    const totales = await recalcularTotales(db, 1);
    // (2*100*0.9) + (1*500*1) = 180 + 500 = 680
    expect(totales.subtotal).toBe(680);
    expect(totales.iva).toBeCloseTo(680 * IVA_DEFAULT, 6);
    expect(totales.total).toBeCloseTo(680 + 680 * IVA_DEFAULT, 6);
  });

  test('sin líneas, todo en 0 (no lanza)', async () => {
    const db = crearMockDb({ data: [], error: null }, { data: null, error: null });
    const totales = await recalcularTotales(db, 1);
    expect(totales).toEqual({ subtotal: 0, iva: 0, total: 0 });
  });

  test('escribe los totales de vuelta en cotizaciones', async () => {
    const db = crearMockDb({ data: [{ cantidad: 1, precio_unitario: 100, descuento_pct: 0 }], error: null }, { data: null, error: null });
    await recalcularTotales(db, 42);
    const builderCotizaciones = db.from.mock.results[1].value;
    expect(builderCotizaciones.update).toHaveBeenCalledWith({ subtotal: 100, iva: 16, total: 116 });
  });
});

describe('agregarLinea()', () => {
  test('calcula el subtotal de la línea con descuento y recalcula totales', async () => {
    const db = crearMockDb(
      { data: { id: 'linea-1', subtotal: 270 }, error: null }, // insert
      { data: [], error: null },                               // recalcularTotales: select lineas
      { data: null, error: null },                              // recalcularTotales: update cotizaciones
    );
    const linea = await agregarLinea(db, { companyId: 'c1', cotizacionId: 1, descripcion: 'Panel', cantidad: 3, precioUnitario: 100, descuentoPct: 10 });
    const builderInsert = db.from.mock.results[0].value;
    expect(builderInsert.insert).toHaveBeenCalledWith([expect.objectContaining({ subtotal: 270, descripcion: 'Panel' })]);
    expect(linea.id).toBe('linea-1');
  });

  test('lanza si faltan datos requeridos', async () => {
    const db = crearMockDb();
    await expect(agregarLinea(db, { companyId: 'c1', cotizacionId: 1 })).rejects.toThrow('son requeridos');
  });

  test('default: cantidad=1, precio=0, origen=manual', async () => {
    const db = crearMockDb({ data: { id: 'l1' }, error: null }, { data: [], error: null }, { data: null, error: null });
    await agregarLinea(db, { companyId: 'c1', cotizacionId: 1, descripcion: 'Transporte' });
    const builderInsert = db.from.mock.results[0].value;
    expect(builderInsert.insert).toHaveBeenCalledWith([expect.objectContaining({ cantidad: 1, precio_unitario: 0, origen: 'manual', subtotal: 0 })]);
  });
});

describe('actualizarLinea()', () => {
  test('recalcula el subtotal de la línea con los valores nuevos, manteniendo los no cambiados', async () => {
    const db = crearMockDb(
      { data: { id: 'l1', cotizacion_id: 5, cantidad: 2, precio_unitario: 100, descuento_pct: 0 }, error: null }, // existente
      { data: { id: 'l1' }, error: null },                                                                        // update
      { data: [], error: null }, { data: null, error: null },                                                     // recalcularTotales
    );
    await actualizarLinea(db, { companyId: 'c1', lineaId: 'l1', cambios: { cantidad: 5 } });
    const builderUpdate = db.from.mock.results[1].value;
    // cantidad nueva (5) * precio existente (100) * (1 - 0) = 500
    expect(builderUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ cantidad: 5, subtotal: 500 }));
  });

  test('línea inexistente (o de otra empresa) → 404', async () => {
    const db = crearMockDb({ data: null, error: null });
    await expect(actualizarLinea(db, { companyId: 'c1', lineaId: 'l1', cambios: {} })).rejects.toMatchObject({ status: 404 });
  });
});

describe('eliminarLinea()', () => {
  test('borra y recalcula totales de la cotización dueña', async () => {
    const db = crearMockDb(
      { data: { cotizacion_id: 7 }, error: null },
      { data: null, error: null },
      { data: [], error: null }, { data: null, error: null },
    );
    await eliminarLinea(db, { companyId: 'c1', lineaId: 'l1' });
    const builderDelete = db.from.mock.results[1].value;
    expect(builderDelete.delete).toHaveBeenCalled();
  });

  test('línea inexistente → 404, nunca intenta borrar', async () => {
    const db = crearMockDb({ data: null, error: null });
    await expect(eliminarLinea(db, { companyId: 'c1', lineaId: 'l1' })).rejects.toMatchObject({ status: 404 });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe('aplicarCalculoALineas() — Alina 2026-08-04: ahora usa el paquete comercial, no suma el catálogo', () => {
  test('ya existe línea calculado_automatico → no duplica, devuelve []', async () => {
    const db = crearMockDbPorTabla({ cotizacion_lineas: { data: { id: 'existente' }, error: null } });
    const resultado = await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(resultado).toEqual([]);
  });

  test('sin paquete_recomendado_id (técnico excedió el catálogo) → no crea nada, devuelve []', async () => {
    const db = crearMockDbPorTabla({
      cotizacion_lineas: { data: null, error: null },
      cotizaciones: { data: { paquete_recomendado_id: null }, error: null },
    });
    const resultado = await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(resultado).toEqual([]);
  });

  test('con paquete recomendado → crea UNA sola línea con el precio autorizado (no el recomendado, si ya fue ajustado)', async () => {
    let contadorInsert = 0;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'cotizaciones') {
          return crearBuilder({ data: { paquete_recomendado_id: 'pkg-12', precio_paquete_recomendado: 94000, precio_final_autorizado: 90000 }, error: null });
        }
        if (tabla === 'paquetes_solares') {
          return crearBuilder({ data: { id: 'pkg-12', nombre: 'Paquete 12 paneles', componentes_incluidos: ['monitoreo', 'estructura de aluminio'], precio_contado: 94000 }, error: null });
        }
        const builder = crearBuilder({ data: null, error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null }); // "¿ya existe línea?" → no
        builder.single = jest.fn().mockImplementation(() => Promise.resolve({ data: { id: `linea-${++contadorInsert}` }, error: null }));
        builder.then = (resolve) => resolve({ data: [], error: null });
        return builder;
      }),
    };

    const lineas = await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(lineas).toHaveLength(1); // UNA sola línea, no una por componente
    expect(lineas[0].id).toBe('linea-1');
  });

  test('el precio de la línea usa precio_final_autorizado cuando existe, no precio_paquete_recomendado', async () => {
    let payloadCapturado = null;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'cotizaciones') {
          return crearBuilder({ data: { paquete_recomendado_id: 'pkg-12', precio_paquete_recomendado: 94000, precio_final_autorizado: 90000 }, error: null });
        }
        if (tabla === 'paquetes_solares') {
          return crearBuilder({ data: { id: 'pkg-12', nombre: 'Paquete 12 paneles', componentes_incluidos: [], precio_contado: 94000 }, error: null });
        }
        const builder = crearBuilder({ data: null, error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        builder.insert = jest.fn((rows) => { payloadCapturado = rows[0]; return builder; });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'linea-1' }, error: null });
        builder.then = (resolve) => resolve({ data: [], error: null });
        return builder;
      }),
    };

    await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(payloadCapturado.precio_unitario).toBe(90000); // autorizado, NO el recomendado (94000)
  });

  test('sin precio_final_autorizado todavía, usa precio_paquete_recomendado', async () => {
    let payloadCapturado = null;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'cotizaciones') {
          return crearBuilder({ data: { paquete_recomendado_id: 'pkg-8', precio_paquete_recomendado: 64000, precio_final_autorizado: null }, error: null });
        }
        if (tabla === 'paquetes_solares') {
          return crearBuilder({ data: { id: 'pkg-8', nombre: 'Paquete 8 paneles', componentes_incluidos: [], precio_contado: 64000 }, error: null });
        }
        const builder = crearBuilder({ data: null, error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        builder.insert = jest.fn((rows) => { payloadCapturado = rows[0]; return builder; });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'linea-1' }, error: null });
        builder.then = (resolve) => resolve({ data: [], error: null });
        return builder;
      }),
    };

    await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(payloadCapturado.precio_unitario).toBe(64000);
  });
});

describe('aplicarBomALineas() — 2026-09-22: alternativa desglosada panel+inversor, NO reemplaza el paquete', () => {
  const CALCULO_BASE = {
    resultados: { numero_paneles: { valor: 8 }, inversor_seleccionado: { inversorSeleccionado: { id: 'inv-1' } } },
    catalogo_usado: { panel: { id: 'panel-1' } },
  };

  function armarDb({ lineaExistente = null, cotizacion = { calculo_ingenieria_id: 'calc-1' }, calculo = CALCULO_BASE, productos = [
    { id: 'panel-1', tipo: 'panel_solar', marca: 'Jinko', modelo: 'Tiger Neo 550', precio: 3200 },
    { id: 'inv-1', tipo: 'inversor', marca: 'Growatt', modelo: 'MIN 4000TL-X', precio: 9500 },
  ] } = {}) {
    const inserts = [];
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'cotizacion_lineas') {
          const builder = crearBuilder({ data: lineaExistente, error: null });
          builder.maybeSingle = jest.fn().mockResolvedValue({ data: lineaExistente, error: null });
          builder.insert = jest.fn((rows) => { inserts.push(rows[0]); return builder; });
          builder.single = jest.fn().mockImplementation(() => Promise.resolve({ data: { id: `linea-${inserts.length}`, ...inserts[inserts.length - 1] }, error: null }));
          builder.then = (resolve) => resolve({ data: [], error: null }); // recalcularTotales: sin líneas previas para sumar
          return builder;
        }
        if (tabla === 'cotizaciones') return crearBuilder({ data: cotizacion, error: null });
        if (tabla === 'calculos_ingenieria') return crearBuilder({ data: calculo, error: null });
        if (tabla === 'productos') return crearBuilder({ data: productos, error: null });
        return crearBuilder();
      }),
    };
    return { db, inserts };
  }

  test('ya existe una línea automática (paquete o BOM) → no duplica, motivo claro', async () => {
    const { db } = armarDb({ lineaExistente: { id: 'existente' } });
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(r.lineas).toEqual([]);
    expect(r.motivo).toMatch(/ya tiene una línea automática/);
  });

  test('cotización inexistente → 404', async () => {
    const { db } = armarDb({ cotizacion: null });
    await expect(aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 999 })).rejects.toMatchObject({ status: 404 });
  });

  test('sin cálculo de ingeniería → sin líneas, con motivo', async () => {
    const { db } = armarDb({ cotizacion: { calculo_ingenieria_id: null } });
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(r.lineas).toEqual([]);
    expect(r.motivo).toMatch(/cálculo de ingeniería/);
  });

  test('cálculo sin número de paneles → sin líneas, con motivo, nunca inventa', async () => {
    const { db } = armarDb({ calculo: { resultados: { numero_paneles: { valor: null } }, catalogo_usado: {} } });
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(r.lineas).toEqual([]);
    expect(r.motivo).toMatch(/paneles/);
  });

  test('con panel + inversor y precio en catálogo → 2 líneas, cantidad y precio correctos, sin pendiente_levantamiento', async () => {
    const { db, inserts } = armarDb();
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });

    expect(r.lineas).toHaveLength(2);
    expect(r.motivo).toBeNull();
    expect(inserts[0]).toMatchObject({ producto_id: 'panel-1', cantidad: 8, precio_unitario: 3200, origen: 'calculado_automatico', pendiente_levantamiento: false });
    expect(inserts[1]).toMatchObject({ producto_id: 'inv-1', cantidad: 1, precio_unitario: 9500, origen: 'calculado_automatico', pendiente_levantamiento: false });
  });

  test('producto SIN precio en catálogo → línea igual se crea, precio 0 y pendiente_levantamiento:true (nunca inventa el precio)', async () => {
    const { db, inserts } = armarDb({ productos: [
      { id: 'panel-1', tipo: 'panel_solar', marca: 'LONGi', modelo: 'LR7-72HTH-615M', precio: null },
      { id: 'inv-1', tipo: 'inversor', marca: 'Growatt', modelo: 'MIN 4000TL-X', precio: 9500 },
    ] });
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });

    expect(r.lineas).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ producto_id: 'panel-1', precio_unitario: 0, pendiente_levantamiento: true });
    expect(inserts[1]).toMatchObject({ producto_id: 'inv-1', precio_unitario: 9500, pendiente_levantamiento: false });
  });

  test('sin inversor seleccionado por el motor → solo la línea del panel, no inventa un inversor', async () => {
    const { db, inserts } = armarDb({ calculo: { resultados: { numero_paneles: { valor: 8 }, inversor_seleccionado: null }, catalogo_usado: { panel: { id: 'panel-1' } } } });
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });

    expect(r.lineas).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].producto_id).toBe('panel-1');
  });

  test('el panel ya no existe en el catálogo (fue borrado desde que corrió el cálculo) → no lo inventa, se salta esa línea', async () => {
    const { db, inserts } = armarDb({ productos: [{ id: 'inv-1', tipo: 'inversor', marca: 'Growatt', modelo: 'MIN 4000TL-X', precio: 9500 }] });
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });

    expect(r.lineas).toHaveLength(1);
    expect(inserts[0].producto_id).toBe('inv-1');
  });

  test('ni panel ni inversor siguen en el catálogo → sin líneas, con motivo', async () => {
    const { db } = armarDb({ productos: [] });
    const r = await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(r.lineas).toEqual([]);
    expect(r.motivo).toMatch(/catálogo/);
  });

  test('la descripción usa marca + modelo del producto', async () => {
    const { db, inserts } = armarDb();
    await aplicarBomALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(inserts[0].descripcion).toBe('Jinko Tiger Neo 550');
    expect(inserts[1].descripcion).toBe('Growatt MIN 4000TL-X');
  });
});
