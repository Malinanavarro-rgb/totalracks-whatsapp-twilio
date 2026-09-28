'use strict';

/**
 * Aislamiento multiempresa — Subfase 2E (Trámites CFE, Alina, 2026-09-28).
 * Mismo criterio que 2A/2B/2C/2D/2G: un usuario de la Empresa A intenta
 * leer/escribir un trámite CFE real de la Empresa B por ID directo —
 * nunca debe funcionar.
 */

const { obtenerTramiteCfe, crearTramiteCfe, actualizarTramiteCfe, actualizarEstadoTramiteCfe } = require('../modules/tramites-cfe');

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
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    single: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    then: (resolve) => resolve(resolverFila(filtros)),
  };
  return builder;
}

const TRAMITE_DE_EMPRESA_B = { id: 'tram-b', company_id: EMPRESA_B, proyecto_id: 'proy-b', estado: 'pendiente' };
const PROYECTO_DE_EMPRESA_B = { id: 'proy-b', company_id: EMPRESA_B, cliente_id: 999 };

describe('Aislamiento multiempresa — 2E (trámites CFE)', () => {
  test('Empresa A pide un trámite real de la Empresa B por ID directo → null, nunca los datos ajenos', async () => {
    const resolver = crearTablaConAislamientoReal([TRAMITE_DE_EMPRESA_B]);
    const db = {
      from: jest.fn((tabla) => (tabla === 'companies'
        ? crearBuilderAislado(() => ({ data: { umbral_dias_alerta_cfe: null }, error: null }))
        : crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id })))),
    };

    expect(await obtenerTramiteCfe(db, EMPRESA_A, 'tram-b')).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su trámite (control positivo)', async () => {
    const resolver = crearTablaConAislamientoReal([TRAMITE_DE_EMPRESA_B]);
    const db = {
      from: jest.fn((tabla) => (tabla === 'companies'
        ? crearBuilderAislado(() => ({ data: { umbral_dias_alerta_cfe: null }, error: null }))
        : crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id })))),
    };

    const r = await obtenerTramiteCfe(db, EMPRESA_B, 'tram-b');
    expect(r.id).toBe('tram-b');
  });

  test('Empresa A intenta CREAR un trámite sobre un proyecto real de la Empresa B → 404, nunca inserta', async () => {
    const resolverProyectos = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'proyectos') return crearBuilderAislado((f) => resolverProyectos({ id: f.id, company_id: f.company_id }));
        if (tabla === 'tramites_cfe') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearTramiteCfe(db, { companyId: EMPRESA_A, proyectoId: 'proy-b', usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('Empresa A intenta ACTUALIZAR un trámite real de la Empresa B → 404, nunca lo modifica', async () => {
    const resolver = crearTablaConAislamientoReal([TRAMITE_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarTramiteCfe(db, { companyId: EMPRESA_A, tramiteId: 'tram-b', cambios: { folio_cfe: 'suplantado' } }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A intenta cambiar el ESTADO de un trámite real de la Empresa B → 404, nunca lo modifica', async () => {
    const resolver = crearTablaConAislamientoReal([TRAMITE_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarEstadoTramiteCfe(db, { companyId: EMPRESA_A, tramiteId: 'tram-b', estado: 'ingresado_cfe' }))
      .rejects.toMatchObject({ status: 404 });
  });
});
