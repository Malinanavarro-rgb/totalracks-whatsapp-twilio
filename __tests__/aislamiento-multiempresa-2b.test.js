'use strict';

/**
 * Aislamiento multiempresa — Subfase 2B (Cobranza, Alina, 2026-09-23).
 * Mismo criterio que aislamiento-multiempresa-2a.test.js: un usuario de la
 * Empresa A intenta leer/escribir cobranza de un proyecto real de la
 * Empresa B por ID directo — nunca debe funcionar.
 */

const { obtenerResumenCobranza, registrarAbono } = require('../modules/cobranza');

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
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
    order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    single: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    then: (resolve) => resolve(resolverFila(filtros)),
  };
  return builder;
}

const PROYECTO_DE_EMPRESA_B = { id: 'proy-empresa-b', company_id: EMPRESA_B, cotizacion_id: 77, cliente_id: 500, config_vendida: { total: 40716 } };
const PAGOS_CLIENTE_DE_EMPRESA_B = { id: 'pc-empresa-b', company_id: EMPRESA_B, proyecto_id: 'proy-empresa-b', total_vendido: 40716 };

describe('Aislamiento multiempresa — 2B (cobranza)', () => {
  test('Empresa A pide la cobranza de un proyecto real de la Empresa B → 404, nunca los datos ajenos', async () => {
    const resolverProyectos = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    const resolverPagosCliente = crearTablaConAislamientoReal([PAGOS_CLIENTE_DE_EMPRESA_B]);
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'pagos_cliente') return crearBuilderAislado((f) => resolverPagosCliente({ company_id: f.company_id, proyecto_id: f.proyecto_id }));
        if (tabla === 'proyectos') return crearBuilderAislado((f) => resolverProyectos({ id: f.id, company_id: f.company_id }));
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(obtenerResumenCobranza(db, EMPRESA_A, 'proy-empresa-b')).rejects.toMatchObject({ status: 404 });
  });

  test('Empresa B, con su propio company_id, SÍ ve su cobranza (control positivo)', async () => {
    const resolverProyectos = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    const resolverPagosCliente = crearTablaConAislamientoReal([PAGOS_CLIENTE_DE_EMPRESA_B]);
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'pagos_cliente') return crearBuilderAislado((f) => resolverPagosCliente({ company_id: f.company_id, proyecto_id: f.proyecto_id }));
        if (tabla === 'proyectos') return crearBuilderAislado((f) => resolverProyectos({ id: f.id, company_id: f.company_id }));
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    const r = await obtenerResumenCobranza(db, EMPRESA_B, 'proy-empresa-b');
    expect(r.id).toBe('pc-empresa-b');
  });

  test('Empresa A intenta REGISTRAR UN ABONO en un proyecto real de la Empresa B → 404, nunca inserta el abono', async () => {
    const resolverProyectos = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    let seIntentoInsertarAbono = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'proyectos') return crearBuilderAislado((f) => resolverProyectos({ id: f.id, company_id: f.company_id }));
        if (tabla === 'pagos_cliente') return crearBuilderAislado(() => ({ data: null, error: null })); // Empresa A nunca encuentra un pagos_cliente propio de este proyecto
        if (tabla === 'pagos_cliente_abonos') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertarAbono = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(registrarAbono(db, { companyId: EMPRESA_A, proyectoId: 'proy-empresa-b', monto: 5000, usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertarAbono).toBe(false);
  });
});
