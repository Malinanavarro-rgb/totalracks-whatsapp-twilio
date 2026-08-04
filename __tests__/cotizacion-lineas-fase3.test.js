'use strict';

const {
  recalcularTotales, agregarLinea, actualizarLinea, eliminarLinea, aplicarCalculoALineas, IVA_DEFAULT,
} = require('../modules/cotizacion-lineas');

function crearBuilder(resultado = { data: null, error: null }) {
  return {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
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

describe('aplicarCalculoALineas()', () => {
  test('ya existen líneas calculado_automatico → no duplica, devuelve []', async () => {
    const db = crearMockDbPorTabla({ cotizacion_lineas: { data: { id: 'existente' }, error: null } });
    const resultado = await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(resultado).toEqual([]);
  });

  test('sin cálculo guardado → no crea nada, devuelve []', async () => {
    const db = crearMockDbPorTabla({ calculos_ingenieria: { data: null, error: null } });
    const resultado = await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(resultado).toEqual([]);
  });

  test('con cálculo completo → crea panel + inversor + 3 líneas pendientes de levantamiento', async () => {
    // cotizacion_lineas se usa para 3 cosas distintas en este flujo (chequeo
    // de existencia, insert de cada línea, select de recalcularTotales) —
    // un mock por nombre de tabla no distingue eso, así que aquí se
    // despacha por MÉTODO invocado en vez de por tabla.
    let contadorInsert = 0;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'calculos_ingenieria') {
          return crearBuilder({
            data: {
              version: 1,
              catalogo_usado: {
                panel: { id: 'panel-1', marca: 'Jinko', modelo: 'Tiger', precio: 3200, specs: { potencia_wp: 550 } },
                inversores_candidatos: [{ id: 'inv-1', marca: 'Growatt', modelo: 'MIN4000', precio: 9500 }],
              },
              resultados: { numero_paneles: { valor: 8 }, inversor_seleccionado: { inversorSeleccionado: { id: 'inv-1' } } },
            },
            error: null,
          });
        }
        if (tabla === 'cotizaciones') return crearBuilder({ data: null, error: null });
        // cotizacion_lineas: la primera vez es el chequeo "¿ya existe?" (null),
        // de ahí en adelante cada llamada es un INSERT nuevo (id único) o el
        // SELECT de recalcularTotales (array, no importa el contenido aquí).
        const builder = crearBuilder({ data: null, error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        builder.single = jest.fn().mockImplementation(() => Promise.resolve({ data: { id: `linea-${++contadorInsert}` }, error: null }));
        builder.then = (resolve) => resolve({ data: [], error: null });
        return builder;
      }),
    };

    const lineas = await aplicarCalculoALineas(db, { companyId: 'c1', cotizacionId: 1 });
    expect(lineas).toHaveLength(5); // panel + inversor + estructura + cableado + mano de obra
    expect(lineas.every(l => l.id?.startsWith('linea-'))).toBe(true);
  });
});
