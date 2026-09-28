'use strict';

/**
 * Aislamiento multiempresa — Subfase 2H (Garantías, Alina, 2026-09-28).
 * Mismo criterio que 2A/2B/2C/2D/2E/2G: un usuario de la Empresa A intenta
 * leer/escribir un recurso real de la Empresa B por ID directo — nunca
 * debe funcionar.
 */

const { obtenerGarantia, crearGarantiaDesdeEquipo, actualizarGarantia, crearReclamacion, actualizarEstadoReclamacion } = require('../modules/garantias');

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
    maybeSingle: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    single: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    then: (resolve) => resolve(resolverFila(filtros)),
  };
  return builder;
}

const GARANTIA_DE_EMPRESA_B = { id: 'gar-b', company_id: EMPRESA_B, equipo_instalado_id: 'eq-b' };
const EQUIPO_DE_EMPRESA_B = { id: 'eq-b', company_id: EMPRESA_B };
const RECLAMACION_DE_EMPRESA_B = { id: 'rec-b', company_id: EMPRESA_B, garantia_id: 'gar-b', estado: 'abierta' };

describe('Aislamiento multiempresa — 2H (garantías)', () => {
  test('Empresa A pide una garantía real de la Empresa B por ID directo → null, nunca los datos ajenos', async () => {
    const resolver = crearTablaConAislamientoReal([GARANTIA_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    expect(await obtenerGarantia(db, EMPRESA_A, 'gar-b')).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su garantía (control positivo)', async () => {
    const resolver = crearTablaConAislamientoReal([GARANTIA_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const r = await obtenerGarantia(db, EMPRESA_B, 'gar-b');
    expect(r.id).toBe('gar-b');
  });

  test('Empresa A intenta CREAR una garantía sobre un equipo real de la Empresa B → 404, nunca inserta', async () => {
    const resolverEquipos = crearTablaConAislamientoReal([EQUIPO_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'equipos_instalados') return crearBuilderAislado((f) => resolverEquipos({ id: f.id, company_id: f.company_id }));
        if (tabla === 'garantias') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearGarantiaDesdeEquipo(db, { companyId: EMPRESA_A, equipoInstaladoId: 'eq-b', usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('Empresa A intenta ACTUALIZAR una garantía real de la Empresa B → 404, nunca la modifica', async () => {
    const resolver = crearTablaConAislamientoReal([GARANTIA_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarGarantia(db, { companyId: EMPRESA_A, garantiaId: 'gar-b', cambios: { proveedor: 'suplantado' } }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A intenta CREAR una reclamación sobre una garantía real de la Empresa B → 404, nunca inserta', async () => {
    const resolverGarantias = crearTablaConAislamientoReal([GARANTIA_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'garantias') return crearBuilderAislado((f) => resolverGarantias({ id: f.id, company_id: f.company_id }));
        if (tabla === 'garantia_reclamaciones') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearReclamacion(db, { companyId: EMPRESA_A, garantiaId: 'gar-b', descripcion: 'intento ajeno' }))
      .rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('Empresa A intenta cambiar el ESTADO de una reclamación real de la Empresa B → 404, nunca la modifica', async () => {
    const resolver = crearTablaConAislamientoReal([RECLAMACION_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarEstadoReclamacion(db, { companyId: EMPRESA_A, reclamacionId: 'rec-b', estado: 'en_revision' }))
      .rejects.toMatchObject({ status: 404 });
  });
});
