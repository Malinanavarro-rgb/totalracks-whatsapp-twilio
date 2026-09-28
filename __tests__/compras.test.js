'use strict';

const {
  ESTADOS_ORDEN_COMPRA, generarFolioOrdenCompra,
  crearProveedor, listarProveedores, actualizarProveedor,
  crearOrdenCompra, obtenerOrdenCompra, listarOrdenesCompra, actualizarOrdenCompra, actualizarEstadoOrdenCompra, recibirOrdenCompra,
} = require('../modules/compras');

function crearBuilder(resolver) {
  const estado = { filtros: {}, insertPayload: null, updatePayload: null, inValues: null };
  const builder = {
    select: jest.fn(() => builder),
    insert: jest.fn((payload) => { estado.insertPayload = payload; return builder; }),
    update: jest.fn((payload) => { estado.updatePayload = payload; return builder; }),
    eq: jest.fn((campo, valor) => { estado.filtros[campo] = valor; return builder; }),
    in: jest.fn((campo, valores) => { estado.inValues = { campo, valores }; return builder; }),
    is: jest.fn((campo, valor) => { estado.filtros[`${campo}__is`] = valor; return builder; }),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resolver(estado))),
    single: jest.fn(() => Promise.resolve(resolver(estado))),
    then: (resolve, reject) => Promise.resolve(resolver(estado)).then(resolve, reject),
  };
  return builder;
}

/** Resolvers "felices" por default — cada test sobreescribe solo lo que necesita. */
function resolversFelices(overrides = {}) {
  return {
    companies: () => ({ data: { prefijo_orden_compra: null }, error: null }),
    proveedores: (e) => (e.insertPayload
      ? { data: { id: 'prov-nuevo', ...e.insertPayload[0] }, error: null }
      : { data: { id: 'prov-1', nombre: 'Proveedor Uno' }, error: null }),
    sucursales: () => ({ data: { id: 'suc-1', nombre: 'Bodega Central' }, error: null }),
    proyectos: () => ({ data: { id: 'proy-1' }, error: null }),
    productos: (e) => (e.inValues
      ? { data: e.inValues.valores.map((id) => ({ id })), error: null }
      : { data: { id: e.filtros.id || 'panel-1' }, error: null }),
    ordenes_compra: () => ({ data: null, error: null }),
    orden_compra_items: (e) => (e.insertPayload ? { data: null, error: null } : { data: [], error: null }),
    bitacora_decisiones: () => ({ data: null, error: null }),
    ...overrides,
  };
}

function crearMockDb(overrides = {}, rpcResultado = { data: [{ movimiento_id: 'mov-1', existencia_fisica: 10, reservado: 0, disponible: 10 }], error: null }) {
  const tablas = resolversFelices(overrides);
  return {
    from: jest.fn((tabla) => crearBuilder(tablas[tabla] || (() => ({ data: null, error: null })))),
    rpc: jest.fn().mockImplementation((fn) => {
      if (fn === 'incrementar_folio_orden_compra') return Promise.resolve({ data: 1, error: null });
      return Promise.resolve(rpcResultado);
    }),
  };
}

const COMPANY_A = 'company-aaaa';

describe('ESTADOS_ORDEN_COMPRA', () => {
  test('vocabulario esperado', () => {
    expect(ESTADOS_ORDEN_COMPRA).toEqual(['borrador', 'enviada', 'confirmada', 'recibida', 'cancelada']);
  });
});

describe('generarFolioOrdenCompra()', () => {
  test('sin prefijo configurado → usa "OC" default', async () => {
    const db = crearMockDb({ companies: () => ({ data: { prefijo_orden_compra: null }, error: null }) });
    const folio = await generarFolioOrdenCompra(db, COMPANY_A);
    expect(folio).toMatch(/^OC-\d{4}-0001$/);
  });

  test('con prefijo configurado → lo usa', async () => {
    const db = crearMockDb({ companies: () => ({ data: { prefijo_orden_compra: 'NE-OC' }, error: null }) });
    const folio = await generarFolioOrdenCompra(db, COMPANY_A);
    expect(folio).toMatch(/^NE-OC-\d{4}-0001$/);
  });
});

describe('crearProveedor()', () => {
  test('sin nombre → 400', async () => {
    const db = crearMockDb();
    await expect(crearProveedor(db, { companyId: COMPANY_A, nombre: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  test('con nombre → inserta y devuelve la fila', async () => {
    const db = crearMockDb();
    const r = await crearProveedor(db, { companyId: COMPANY_A, nombre: 'Suministros Solares SA', contactoEmail: 'ventas@ss.mx' });
    expect(r.nombre).toBe('Suministros Solares SA');
    expect(r.company_id).toBe(COMPANY_A);
    expect(r.contacto_email).toBe('ventas@ss.mx');
  });
});

describe('listarProveedores()', () => {
  test('por default filtra solo activos', async () => {
    const db = crearMockDb({ proveedores: () => ({ data: [], error: null }) });
    await listarProveedores(db, COMPANY_A);
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'proveedores').value;
    expect(builder.eq).toHaveBeenCalledWith('activo', true);
  });

  test('soloActivos:false → no filtra por activo', async () => {
    const db = crearMockDb({ proveedores: () => ({ data: [], error: null }) });
    await listarProveedores(db, COMPANY_A, { soloActivos: false });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'proveedores').value;
    expect(builder.eq).not.toHaveBeenCalledWith('activo', true);
  });
});

describe('actualizarProveedor()', () => {
  test('no encontrado → 404', async () => {
    const db = crearMockDb({ proveedores: () => ({ data: null, error: null }) });
    await expect(actualizarProveedor(db, { companyId: COMPANY_A, proveedorId: 'x', cambios: { nombre: 'Nuevo' } })).rejects.toMatchObject({ status: 404 });
  });

  test('solo aplica campos de la allowlist', async () => {
    const db = crearMockDb({ proveedores: (e) => ({ data: { id: 'prov-1', ...e.updatePayload }, error: null }) });
    await actualizarProveedor(db, { companyId: COMPANY_A, proveedorId: 'prov-1', cambios: { nombre: 'X', company_id: 'otra-empresa-colada' } });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'proveedores').value;
    expect(builder.update).toHaveBeenCalledWith({ nombre: 'X' });
  });
});

describe('crearOrdenCompra()', () => {
  const ITEMS = [{ productoId: 'panel-1', cantidad: 10, costoUnitario: 3500 }];

  test('sin ítems → 400', async () => {
    const db = crearMockDb();
    await expect(crearOrdenCompra(db, { companyId: COMPANY_A, proveedorId: 'prov-1', sucursalId: 'suc-1', items: [] })).rejects.toMatchObject({ status: 400 });
  });

  test('ítem sin productoId o cantidad inválida → 400', async () => {
    const db = crearMockDb();
    await expect(crearOrdenCompra(db, { companyId: COMPANY_A, proveedorId: 'prov-1', sucursalId: 'suc-1', items: [{ productoId: 'p1', cantidad: 0 }] }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('proveedor no existe/de otra empresa → 404', async () => {
    const db = crearMockDb({ proveedores: () => ({ data: null, error: null }) });
    await expect(crearOrdenCompra(db, { companyId: COMPANY_A, proveedorId: 'x', sucursalId: 'suc-1', items: ITEMS })).rejects.toMatchObject({ status: 404 });
  });

  test('sucursal no existe/de otra empresa → 404', async () => {
    const db = crearMockDb({ sucursales: () => ({ data: null, error: null }) });
    await expect(crearOrdenCompra(db, { companyId: COMPANY_A, proveedorId: 'prov-1', sucursalId: 'x', items: ITEMS })).rejects.toMatchObject({ status: 404 });
  });

  test('proyectoId dado pero no existe/de otra empresa → 404', async () => {
    const db = crearMockDb({ proyectos: () => ({ data: null, error: null }) });
    await expect(crearOrdenCompra(db, { companyId: COMPANY_A, proveedorId: 'prov-1', sucursalId: 'suc-1', proyectoId: 'x', items: ITEMS })).rejects.toMatchObject({ status: 404 });
  });

  test('un producto no pertenece a la empresa → 404, nunca inserta la orden', async () => {
    const db = crearMockDb({ productos: () => ({ data: [], error: null }) }); // ningún id devuelto → ninguno válido
    await expect(crearOrdenCompra(db, { companyId: COMPANY_A, proveedorId: 'prov-1', sucursalId: 'suc-1', items: ITEMS })).rejects.toMatchObject({ status: 404 });
    const builderOrdenes = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'ordenes_compra');
    expect(builderOrdenes).toBeUndefined();
  });

  test('éxito → genera folio, inserta la orden en borrador y sus ítems', async () => {
    const db = crearMockDb({
      ordenes_compra: (e) => ({ data: { id: 'orden-1', ...e.insertPayload?.[0] }, error: null }),
    });
    const r = await crearOrdenCompra(db, {
      companyId: COMPANY_A, proveedorId: 'prov-1', sucursalId: 'suc-1', items: ITEMS, notas: 'urgente', usuarioId: 'user-1',
    });
    expect(r.estado).toBe('borrador');
    expect(r.numero_orden).toMatch(/^OC-\d{4}-0001$/);
    expect(r.creado_por).toBe('user-1');

    const builderItems = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'orden_compra_items').value;
    expect(builderItems.insert).toHaveBeenCalledWith([{ orden_id: 'orden-1', producto_id: 'panel-1', cantidad: 10, costo_unitario: 3500 }]);
  });
});

describe('obtenerOrdenCompra() / listarOrdenesCompra() — enriquecimiento', () => {
  test('no encontrada → null', async () => {
    const db = crearMockDb({ ordenes_compra: () => ({ data: null, error: null }) });
    expect(await obtenerOrdenCompra(db, COMPANY_A, 'x')).toBeNull();
  });

  test('agrega proveedor_nombre/sucursal_nombre/items/total calculado', async () => {
    const db = crearMockDb({
      ordenes_compra: () => ({ data: { id: 'orden-1', proveedor_id: 'prov-1', sucursal_id: 'suc-1' }, error: null }),
      orden_compra_items: () => ({ data: [{ id: 'it-1', cantidad: 10, costo_unitario: 100 }, { id: 'it-2', cantidad: 2, costo_unitario: 50 }], error: null }),
    });
    const r = await obtenerOrdenCompra(db, COMPANY_A, 'orden-1');
    expect(r.proveedor_nombre).toBe('Proveedor Uno');
    expect(r.sucursal_nombre).toBe('Bodega Central');
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(1100); // 10*100 + 2*50
  });

  test('listarOrdenesCompra filtra por estado y proveedor cuando se dan', async () => {
    const db = crearMockDb({ ordenes_compra: () => ({ data: [], error: null }) });
    await listarOrdenesCompra(db, COMPANY_A, { estado: 'confirmada', proveedorId: 'prov-1' });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'ordenes_compra').value;
    expect(builder.eq).toHaveBeenCalledWith('estado', 'confirmada');
    expect(builder.eq).toHaveBeenCalledWith('proveedor_id', 'prov-1');
  });
});

describe('actualizarOrdenCompra()', () => {
  test('no encontrada → 404', async () => {
    const db = crearMockDb({ ordenes_compra: () => ({ data: null, error: null }) });
    await expect(actualizarOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'x', cambios: { notas: 'y' } })).rejects.toMatchObject({ status: 404 });
  });

  test('solo aplica campos editables (nunca estado/numero_orden vía este endpoint)', async () => {
    const db = crearMockDb({ ordenes_compra: (e) => ({ data: { id: 'orden-1', ...e.updatePayload }, error: null }) });
    await actualizarOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', cambios: { notas: 'actualizada', estado: 'recibida', numero_orden: 'HACKEADO' } });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'ordenes_compra').value;
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty('estado');
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty('numero_orden');
    expect(builder.update.mock.calls[0][0].notas).toBe('actualizada');
  });
});

describe('actualizarEstadoOrdenCompra()', () => {
  test('estado no reconocido → 400', async () => {
    const db = crearMockDb();
    await expect(actualizarEstadoOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', estado: 'inventado' })).rejects.toMatchObject({ status: 400 });
  });

  test('intentar poner "recibida" por aquí → 409, nunca llega a tocar la orden', async () => {
    const db = crearMockDb();
    await expect(actualizarEstadoOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', estado: 'recibida' })).rejects.toMatchObject({ status: 409 });
    expect(db.from).not.toHaveBeenCalled();
  });

  test('orden no encontrada → 404', async () => {
    const db = crearMockDb({ ordenes_compra: () => ({ data: null, error: null }) });
    await expect(actualizarEstadoOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'x', estado: 'enviada' })).rejects.toMatchObject({ status: 404 });
  });

  test('orden ya recibida → 409, no se puede recategorizar retroactivamente', async () => {
    const db = crearMockDb({ ordenes_compra: () => ({ data: { id: 'orden-1', estado: 'recibida' }, error: null }) });
    await expect(actualizarEstadoOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', estado: 'cancelada' })).rejects.toMatchObject({ status: 409 });
  });

  test('éxito → cambia estado y registra en bitácora', async () => {
    let filaActual = { id: 'orden-1', estado: 'borrador' };
    const db = crearMockDb({
      ordenes_compra: (e) => (e.updatePayload ? { data: { ...filaActual, ...e.updatePayload }, error: null } : { data: filaActual, error: null }),
    });
    const r = await actualizarEstadoOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', estado: 'enviada', usuarioId: 'user-1' });
    expect(r.estado).toBe('enviada');
    const builderBitacora = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'bitacora_decisiones').value;
    expect(builderBitacora.insert).toHaveBeenCalledWith([expect.objectContaining({ company_id: COMPANY_A, contexto: 'Compras', autor_id: 'user-1' })]);
  });
});

describe('recibirOrdenCompra()', () => {
  const ORDEN_BASE = { id: 'orden-1', estado: 'confirmada', sucursal_id: 'suc-1', proyecto_id: null, numero_orden: 'OC-2026-0001', recibida_en: null };
  const ITEMS = [{ id: 'it-1', producto_id: 'panel-1', cantidad: 10 }, { id: 'it-2', producto_id: 'inv-1', cantidad: 1 }];

  function dbParaRecibir({ ordenExtra = {}, items = ITEMS, claimExitosa = true } = {}) {
    return crearMockDb({
      ordenes_compra: (e) => {
        if (e.filtros['recibida_en__is'] !== undefined) {
          // el UPDATE...WHERE recibida_en IS NULL (el "claim")
          return claimExitosa ? { data: { ...ORDEN_BASE, ...ordenExtra, ...e.updatePayload }, error: null } : { data: null, error: null };
        }
        if (e.updatePayload) return { data: { ...ORDEN_BASE, ...ordenExtra, ...e.updatePayload }, error: null }; // liberar el mutex en el catch
        return { data: { ...ORDEN_BASE, ...ordenExtra }, error: null }; // SELECT inicial
      },
      orden_compra_items: (e) => {
        if (e.insertPayload) return { data: null, error: null };
        if (e.updatePayload) return { data: null, error: null }; // cantidad_recibida
        return { data: items, error: null }; // SELECT de ítems
      },
    });
  }

  test('orden no encontrada → 404', async () => {
    const db = crearMockDb({ ordenes_compra: () => ({ data: null, error: null }) });
    await expect(recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'x', usuarioId: 'u1' })).rejects.toMatchObject({ status: 404 });
  });

  test('orden cancelada → 409, nunca reclama ni llama al rpc', async () => {
    const db = dbParaRecibir({ ordenExtra: { estado: 'cancelada' } });
    await expect(recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', usuarioId: 'u1' })).rejects.toMatchObject({ status: 409 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('orden sin ítems → 409', async () => {
    const db = dbParaRecibir({ items: [] });
    await expect(recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', usuarioId: 'u1' })).rejects.toMatchObject({ status: 409 });
  });

  test('ya fue reclamada por otra llamada (recibida_en ya no es null) → 409, no duplica ningún movimiento', async () => {
    const db = dbParaRecibir({ claimExitosa: false });
    await expect(recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', usuarioId: 'u1' })).rejects.toMatchObject({ status: 409 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('éxito → un movimiento "entrada" por ítem, cantidad_recibida actualizada, bitácora registrada', async () => {
    const db = dbParaRecibir();
    const r = await recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', usuarioId: 'u1' });

    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_tipo: 'entrada', p_producto_id: 'panel-1', p_cantidad: 10, p_sucursal_id: 'suc-1', p_referencia: 'Orden de compra OC-2026-0001' });
    expect(db.rpc.mock.calls[1][1]).toMatchObject({ p_tipo: 'entrada', p_producto_id: 'inv-1', p_cantidad: 1 });

    const builderItems = db.from.mock.results.filter((_, i) => db.from.mock.calls[i][0] === 'orden_compra_items').map((r2) => r2.value);
    const updates = builderItems.filter((b) => b.update.mock.calls.length > 0);
    expect(updates).toHaveLength(2);

    const builderBitacora = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'bitacora_decisiones').value;
    expect(builderBitacora.insert).toHaveBeenCalledWith([expect.objectContaining({ contexto: 'Compras', autor_id: 'u1' })]);
    expect(r.estado).toBe('recibida');
  });

  test('recibir dos veces (llamando dos veces seguidas) no duplica la entrada de inventario', async () => {
    let yaReclamada = false;
    const db = crearMockDb({
      ordenes_compra: (e) => {
        if (e.filtros['recibida_en__is'] !== undefined) {
          if (yaReclamada) return { data: null, error: null };
          yaReclamada = true;
          return { data: { ...ORDEN_BASE, ...e.updatePayload }, error: null };
        }
        return { data: ORDEN_BASE, error: null };
      },
      orden_compra_items: (e) => (e.insertPayload || e.updatePayload ? { data: null, error: null } : { data: ITEMS, error: null }),
    });

    await recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', usuarioId: 'u1' });
    const llamadasRpcTrasElPrimero = db.rpc.mock.calls.length;

    await expect(recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', usuarioId: 'u1' })).rejects.toMatchObject({ status: 409 });
    expect(db.rpc.mock.calls.length).toBe(llamadasRpcTrasElPrimero); // ningún movimiento nuevo en el segundo intento
  });

  test('un ítem falla a medio camino → revierte con "salida" los ya registrados y libera recibida_en, relanza el error', async () => {
    const db = dbParaRecibir();
    let llamada = 0;
    db.rpc = jest.fn((fn, params) => {
      if (fn === 'incrementar_folio_orden_compra') return Promise.resolve({ data: 1, error: null });
      llamada += 1;
      if (llamada === 1) return Promise.resolve({ data: [{ movimiento_id: 'mov-1', existencia_fisica: 10, reservado: 0, disponible: 10 }], error: null }); // 1er ítem ok
      if (llamada === 2) return Promise.resolve({ data: null, error: { message: 'boom' } }); // 2do ítem falla
      return Promise.resolve({ data: [{ movimiento_id: 'mov-rev', existencia_fisica: 0, reservado: 0, disponible: 0 }], error: null }); // reversión
    });

    await expect(recibirOrdenCompra(db, { companyId: COMPANY_A, ordenId: 'orden-1', usuarioId: 'u1' })).rejects.toThrow();

    expect(db.rpc).toHaveBeenCalledTimes(3); // entrada ok (ítem 1), entrada falla (ítem 2), reversión salida (del ítem 1)
    expect(db.rpc.mock.calls[2][1]).toMatchObject({ p_tipo: 'salida', p_producto_id: 'panel-1', p_cantidad: 10 });

    // libera el mutex — la última actualización a ordenes_compra debe poner recibida_en en null
    const builderOrdenes = db.from.mock.results.filter((_, i) => db.from.mock.calls[i][0] === 'ordenes_compra').map((r) => r.value);
    const liberacion = builderOrdenes.find((b) => b.update.mock.calls.some((c) => c[0].recibida_en === null));
    expect(liberacion).toBeTruthy();
  });
});
