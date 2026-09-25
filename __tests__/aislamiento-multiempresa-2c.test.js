'use strict';

/**
 * Aislamiento multiempresa — Subfase 2C (Instalaciones, Alina, 2026-09-23).
 * Mismo criterio que aislamiento-multiempresa-2a/2b: un usuario de la
 * Empresa A intenta leer/escribir una instalación real de la Empresa B por
 * ID directo — nunca debe funcionar.
 */

const { obtenerInstalacion, actualizarEstadoInstalacion, actualizarChecklistItem, crearInstalacion } = require('../modules/instalaciones');

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

const INSTALACION_DE_EMPRESA_B = { id: 'inst-empresa-b', company_id: EMPRESA_B, proyecto_id: 'proy-b', estado: 'programada', checklist: [{ clave: 'x', etiqueta: 'X', completado: false }] };
const PROYECTO_DE_EMPRESA_B = { id: 'proy-b', company_id: EMPRESA_B, tipo: 'venta', cliente_id: 500, config_vendida: {} };

describe('Aislamiento multiempresa — 2C (instalaciones)', () => {
  test('Empresa A pide una instalación real de la Empresa B por ID directo → null, nunca los datos ajenos', async () => {
    const resolver = crearTablaConAislamientoReal([INSTALACION_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    expect(await obtenerInstalacion(db, EMPRESA_A, 'inst-empresa-b')).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su instalación (control positivo)', async () => {
    const resolver = crearTablaConAislamientoReal([INSTALACION_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const r = await obtenerInstalacion(db, EMPRESA_B, 'inst-empresa-b');
    expect(r.id).toBe('inst-empresa-b');
  });

  test('Empresa A intenta cambiar el ESTADO de una instalación real de la Empresa B → 404, nunca la modifica', async () => {
    const resolver = crearTablaConAislamientoReal([INSTALACION_DE_EMPRESA_B]);
    let seIntentoActualizar = false;
    const db = {
      from: jest.fn(() => {
        const b = crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }));
        const updateOriginal = b.update;
        b.update = jest.fn((p) => { seIntentoActualizar = true; return updateOriginal(p); });
        return b;
      }),
    };

    await expect(actualizarEstadoInstalacion(db, { companyId: EMPRESA_A, instalacionId: 'inst-empresa-b', estado: 'entregada', usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
    expect(seIntentoActualizar).toBe(false);
  });

  test('Empresa A intenta marcar un ítem del checklist de una instalación real de la Empresa B → 404, nunca lo modifica', async () => {
    const resolver = crearTablaConAislamientoReal([INSTALACION_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarChecklistItem(db, { companyId: EMPRESA_A, instalacionId: 'inst-empresa-b', clave: 'x', completado: true, usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A intenta CREAR una instalación sobre un proyecto real de la Empresa B → 404, nunca inserta', async () => {
    const resolverProyectos = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'proyectos') return crearBuilderAislado((f) => resolverProyectos({ id: f.id, company_id: f.company_id, tipo: f.tipo }));
        if (tabla === 'instalaciones') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearInstalacion(db, { companyId: EMPRESA_A, proyectoId: 'proy-b', usuarioId: 'user-empresa-a' })).rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });
});
