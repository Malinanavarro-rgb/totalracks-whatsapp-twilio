'use strict';

const {
  TIPOS_MOVIMIENTO, registrarMovimiento, obtenerSaldo, listarSaldos, listarMovimientos,
  reservarMaterialInstalacion, consumirMaterialInstalacion,
} = require('../modules/inventario');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb({ productos = { data: { id: 'panel-1' }, error: null }, sucursales = { data: { id: 'suc-1' }, error: null }, rpcResultado = { data: [{ movimiento_id: 'mov-1', existencia_fisica: 10, reservado: 0, disponible: 10 }], error: null }, tablas = {} } = {}) {
  const defaults = { productos, sucursales, inventario_saldos: { data: null, error: null }, inventario_movimientos: { data: [], error: null } };
  const resultados = { ...defaults, ...tablas };
  return {
    from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })),
    rpc: jest.fn().mockResolvedValue(rpcResultado),
  };
}

const COMPANY_A = 'company-aaaa';

describe('TIPOS_MOVIMIENTO', () => {
  test('los 6 tipos pedidos', () => {
    expect(TIPOS_MOVIMIENTO).toEqual(['entrada', 'salida', 'reserva', 'liberacion', 'ajuste', 'devolucion']);
  });
});

describe('registrarMovimiento() — validaciones', () => {
  test('tipo no reconocido → 400, nunca toca producto/sucursal/rpc', async () => {
    const db = crearMockDb();
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'invento', cantidad: 5 }))
      .rejects.toMatchObject({ status: 400 });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('cantidad 0 → 400', async () => {
    const db = crearMockDb();
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'entrada', cantidad: 0 })).rejects.toMatchObject({ status: 400 });
  });

  test('cantidad NaN → 400', async () => {
    const db = crearMockDb();
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'entrada', cantidad: NaN })).rejects.toMatchObject({ status: 400 });
  });

  test('cantidad negativa en un tipo que no es "ajuste" → 400', async () => {
    const db = crearMockDb();
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'entrada', cantidad: -5 })).rejects.toMatchObject({ status: 400 });
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'salida', cantidad: -5 })).rejects.toMatchObject({ status: 400 });
  });

  test('ajuste negativo → permitido', async () => {
    const db = crearMockDb();
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'ajuste', cantidad: -3, motivo: 'conteo físico' })).resolves.toBeTruthy();
  });

  test('ajuste SIN motivo → 400, nunca se corrige en silencio', async () => {
    const db = crearMockDb();
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'ajuste', cantidad: 3 })).rejects.toMatchObject({ status: 400 });
  });

  test('producto inexistente o de otra empresa → 404, nunca llama al rpc', async () => {
    const db = crearMockDb({ productos: { data: null, error: null } });
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p-x', sucursalId: 's1', tipo: 'entrada', cantidad: 5 })).rejects.toMatchObject({ status: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('sucursal inexistente o de otra empresa → 404', async () => {
    const db = crearMockDb({ sucursales: { data: null, error: null } });
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's-x', tipo: 'entrada', cantidad: 5 })).rejects.toMatchObject({ status: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('registrarMovimiento() — llamada al RPC atómico', () => {
  test('pasa todos los parámetros correctos al RPC', async () => {
    const db = crearMockDb();
    await registrarMovimiento(db, {
      companyId: COMPANY_A, productoId: 'panel-1', sucursalId: 'suc-1', tipo: 'entrada', cantidad: 20,
      proyectoId: 'proy-1', usuarioId: 'user-1', referencia: 'Compra #5', observaciones: 'nota',
    });
    expect(db.rpc).toHaveBeenCalledWith('registrar_movimiento_inventario', {
      p_company_id: COMPANY_A, p_producto_id: 'panel-1', p_sucursal_id: 'suc-1', p_tipo: 'entrada', p_cantidad: 20,
      p_proyecto_id: 'proy-1', p_usuario_id: 'user-1', p_referencia: 'Compra #5', p_motivo: null, p_observaciones: 'nota',
    });
  });

  test('éxito → devuelve movimiento_id/existencia_fisica/reservado/disponible', async () => {
    const db = crearMockDb({ rpcResultado: { data: [{ movimiento_id: 'mov-9', existencia_fisica: 15, reservado: 5, disponible: 10 }], error: null } });
    const r = await registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'entrada', cantidad: 5 });
    expect(r).toEqual({ movimiento_id: 'mov-9', existencia_fisica: 15, reservado: 5, disponible: 10 });
  });

  test('el RPC responde un objeto único (no arreglo) → también funciona', async () => {
    const db = crearMockDb({ rpcResultado: { data: { movimiento_id: 'mov-1', existencia_fisica: 1, reservado: 0, disponible: 1 }, error: null } });
    const r = await registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'entrada', cantidad: 1 });
    expect(r.movimiento_id).toBe('mov-1');
  });

  test('el RPC rechaza (RAISE EXCEPTION de Postgres, ej. existencia insuficiente) → 409 con el mensaje real, nunca 500 genérico', async () => {
    const db = crearMockDb({ rpcResultado: { data: null, error: { message: 'Existencia insuficiente (física actual: 3, movimiento: 10)' } } });
    await expect(registrarMovimiento(db, { companyId: COMPANY_A, productoId: 'p1', sucursalId: 's1', tipo: 'salida', cantidad: 10 }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('Existencia insuficiente') });
  });
});

describe('obtenerSaldo()', () => {
  test('sin movimientos nunca registrados → 0/0/0, nunca null', async () => {
    const db = crearMockDb({ tablas: { inventario_saldos: { data: null, error: null } } });
    expect(await obtenerSaldo(db, COMPANY_A, 'p1', 's1')).toEqual({ existencia_fisica: 0, reservado: 0, disponible: 0 });
  });

  test('con saldo real → disponible = existencia - reservado', async () => {
    const db = crearMockDb({ tablas: { inventario_saldos: { data: { existencia_fisica: 20, reservado: 8 }, error: null } } });
    expect(await obtenerSaldo(db, COMPANY_A, 'p1', 's1')).toEqual({ existencia_fisica: 20, reservado: 8, disponible: 12 });
  });
});

describe('listarSaldos()', () => {
  test('calcula disponible por cada fila', async () => {
    const db = crearMockDb({ tablas: { inventario_saldos: { data: [{ producto_id: 'p1', existencia_fisica: 10, reservado: 3, productos: { tipo: 'panel_solar' } }], error: null } } });
    const r = await listarSaldos(db, COMPANY_A);
    expect(r[0].disponible).toBe(7);
  });

  test('filtra por tipoProducto (client-side, sobre el join con productos)', async () => {
    const db = crearMockDb({ tablas: { inventario_saldos: { data: [
      { producto_id: 'p1', existencia_fisica: 10, reservado: 0, productos: { tipo: 'panel_solar' } },
      { producto_id: 'p2', existencia_fisica: 5, reservado: 0, productos: { tipo: 'inversor' } },
    ], error: null } } });
    const r = await listarSaldos(db, COMPANY_A, { tipoProducto: 'inversor' });
    expect(r).toHaveLength(1);
    expect(r[0].producto_id).toBe('p2');
  });

  test('filtra por sucursalId si se da', async () => {
    const db = crearMockDb({ tablas: { inventario_saldos: { data: [], error: null } } });
    await listarSaldos(db, COMPANY_A, { sucursalId: 'suc-1' });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'inventario_saldos').value;
    expect(builder.eq).toHaveBeenCalledWith('sucursal_id', 'suc-1');
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDb({ tablas: { inventario_saldos: { data: null, error: { message: 'boom' } } } });
    expect(await listarSaldos(db, COMPANY_A)).toEqual([]);
  });
});

describe('listarMovimientos()', () => {
  test('filtra por producto/sucursal/proyecto cuando se dan', async () => {
    const db = crearMockDb();
    await listarMovimientos(db, COMPANY_A, { productoId: 'p1', sucursalId: 's1', proyectoId: 'proy-1' });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'inventario_movimientos').value;
    expect(builder.eq).toHaveBeenCalledWith('producto_id', 'p1');
    expect(builder.eq).toHaveBeenCalledWith('sucursal_id', 's1');
    expect(builder.eq).toHaveBeenCalledWith('proyecto_id', 'proy-1');
  });

  test('límite default 100', async () => {
    const db = crearMockDb();
    await listarMovimientos(db, COMPANY_A);
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'inventario_movimientos').value;
    expect(builder.limit).toHaveBeenCalledWith(100);
  });

  test('error de DB → arreglo vacío', async () => {
    const db = crearMockDb({ tablas: { inventario_movimientos: { data: null, error: { message: 'boom' } } } });
    expect(await listarMovimientos(db, COMPANY_A)).toEqual([]);
  });
});

describe('reservarMaterialInstalacion()', () => {
  const INSTALACION = { id: 'inst-1', proyecto_id: 'proy-1', sucursal_id: 'suc-1' };

  test('instalación sin sucursal_id → 409, nunca intenta reservar', async () => {
    const db = crearMockDb();
    await expect(reservarMaterialInstalacion(db, { companyId: COMPANY_A, instalacion: { ...INSTALACION, sucursal_id: null }, items: [{ productoId: 'p1', cantidad: 8 }], usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 409 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('todos los ítems disponibles → reserva cada uno con el proyecto y la sucursal correctos', async () => {
    const db = crearMockDb();
    const r = await reservarMaterialInstalacion(db, { companyId: COMPANY_A, instalacion: INSTALACION, items: [{ productoId: 'panel-1', cantidad: 8 }, { productoId: 'inv-1', cantidad: 1 }], usuarioId: 'u1' });
    expect(r).toHaveLength(2);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenCalledWith('registrar_movimiento_inventario', expect.objectContaining({ p_tipo: 'reserva', p_proyecto_id: 'proy-1', p_sucursal_id: 'suc-1' }));
  });

  test('un ítem falla a medio camino (disponible insuficiente) → revierte los ya reservados con liberacion, y relanza el error original', async () => {
    const db = crearMockDb();
    let llamada = 0;
    db.rpc = jest.fn((fn, params) => {
      llamada += 1;
      if (llamada === 1) return Promise.resolve({ data: [{ movimiento_id: 'mov-1', existencia_fisica: 10, reservado: 8, disponible: 2 }], error: null }); // 1er ítem: ok
      if (llamada === 2) return Promise.resolve({ data: null, error: { message: 'Disponible insuficiente' } }); // 2do ítem: falla
      return Promise.resolve({ data: [{ movimiento_id: 'mov-rev', existencia_fisica: 10, reservado: 0, disponible: 10 }], error: null }); // reversión
    });

    await expect(reservarMaterialInstalacion(db, { companyId: COMPANY_A, instalacion: INSTALACION, items: [{ productoId: 'panel-1', cantidad: 8 }, { productoId: 'inv-1', cantidad: 100 }], usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 409 });

    expect(db.rpc).toHaveBeenCalledTimes(3); // reserva ok, reserva falla, liberacion de reversión
    expect(db.rpc.mock.calls[2][1]).toMatchObject({ p_tipo: 'liberacion', p_producto_id: 'panel-1', p_cantidad: 8 });
  });
});

describe('consumirMaterialInstalacion()', () => {
  const INSTALACION = { id: 'inst-1', proyecto_id: 'proy-1', sucursal_id: 'suc-1' };

  test('instalación sin sucursal_id → 409', async () => {
    const db = crearMockDb();
    await expect(consumirMaterialInstalacion(db, { companyId: COMPANY_A, instalacion: { ...INSTALACION, sucursal_id: null }, items: [{ productoId: 'p1', cantidad: 8 }], usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('por cada ítem, libera la reserva Y registra la salida (2 movimientos por ítem)', async () => {
    const db = crearMockDb();
    await consumirMaterialInstalacion(db, { companyId: COMPANY_A, instalacion: INSTALACION, items: [{ productoId: 'panel-1', cantidad: 8 }], usuarioId: 'u1' });
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_tipo: 'liberacion', p_cantidad: 8 });
    expect(db.rpc.mock.calls[1][1]).toMatchObject({ p_tipo: 'salida', p_cantidad: 8 });
  });
});
