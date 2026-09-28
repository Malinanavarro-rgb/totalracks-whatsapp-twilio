'use strict';

/**
 * Aislamiento multiempresa — Subfase 2G (Compras y proveedores, Alina,
 * 2026-09-25). Mismo criterio que 2A/2B/2C/2D: un usuario de la Empresa A
 * intenta leer/escribir un recurso real de la Empresa B por ID directo —
 * nunca debe funcionar.
 */

const { obtenerOrdenCompra, crearOrdenCompra, actualizarOrdenCompra, actualizarEstadoOrdenCompra, recibirOrdenCompra, actualizarProveedor } = require('../modules/compras');

const EMPRESA_A = 'empresa-a-0001';
const EMPRESA_B = 'empresa-b-0002';

function crearTablaConAislamientoReal(filas) {
  return (filtros) => {
    const fila = filas.find((f) => Object.entries(filtros).every(([k, v]) => f[k] === v));
    return { data: fila || null, error: null };
  };
}

function crearBuilderAislado(resolverFila) {
  const filtros = {};
  const builder = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn((p) => { builder._updatePayload = p; return builder; }),
    eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
    in: jest.fn(() => builder),
    is: jest.fn((campo, valor) => { filtros[`${campo}__is`] = valor; return builder; }),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    single: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    then: (resolve) => resolve(resolverFila(filtros)),
  };
  return builder;
}

const ORDEN_DE_EMPRESA_B = { id: 'orden-b', company_id: EMPRESA_B, proveedor_id: 'prov-b', sucursal_id: 'suc-b', estado: 'confirmada', numero_orden: 'OC-2026-0001' };
const PROVEEDOR_DE_EMPRESA_B = { id: 'prov-b', company_id: EMPRESA_B };

describe('Aislamiento multiempresa — 2G (compras y proveedores)', () => {
  test('Empresa A pide una orden real de la Empresa B por ID directo → null, nunca los datos ajenos', async () => {
    const resolver = crearTablaConAislamientoReal([ORDEN_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    expect(await obtenerOrdenCompra(db, EMPRESA_A, 'orden-b')).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su orden (control positivo)', async () => {
    const resolver = crearTablaConAislamientoReal([ORDEN_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const r = await obtenerOrdenCompra(db, EMPRESA_B, 'orden-b');
    expect(r.id).toBe('orden-b');
  });

  test('Empresa A intenta CREAR una orden usando un proveedor real de la Empresa B → 404, nunca inserta', async () => {
    const resolverProveedores = crearTablaConAislamientoReal([PROVEEDOR_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'proveedores') return crearBuilderAislado((f) => resolverProveedores({ id: f.id, company_id: f.company_id }));
        if (tabla === 'ordenes_compra') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearOrdenCompra(db, { companyId: EMPRESA_A, proveedorId: 'prov-b', sucursalId: 'suc-a', items: [{ productoId: 'p1', cantidad: 1 }] }))
      .rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('Empresa A intenta ACTUALIZAR una orden real de la Empresa B → 404 (el UPDATE...WHERE company_id nunca afecta la fila ajena)', async () => {
    const resolver = crearTablaConAislamientoReal([ORDEN_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarOrdenCompra(db, { companyId: EMPRESA_A, ordenId: 'orden-b', cambios: { notas: 'suplantado' } }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A intenta cambiar el ESTADO de una orden real de la Empresa B → 404, nunca la modifica', async () => {
    const resolver = crearTablaConAislamientoReal([ORDEN_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarEstadoOrdenCompra(db, { companyId: EMPRESA_A, ordenId: 'orden-b', estado: 'cancelada' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A intenta RECIBIR una orden real de la Empresa B → 404, nunca genera movimientos de inventario', async () => {
    const resolver = crearTablaConAislamientoReal([ORDEN_DE_EMPRESA_B]);
    const db = {
      from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))),
      rpc: jest.fn(),
    };

    await expect(recibirOrdenCompra(db, { companyId: EMPRESA_A, ordenId: 'orden-b', usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('Empresa A intenta ACTUALIZAR un proveedor real de la Empresa B → 404', async () => {
    const resolver = crearTablaConAislamientoReal([PROVEEDOR_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarProveedor(db, { companyId: EMPRESA_A, proveedorId: 'prov-b', cambios: { nombre: 'suplantado' } }))
      .rejects.toMatchObject({ status: 404 });
  });
});
