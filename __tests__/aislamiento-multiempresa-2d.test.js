'use strict';

/**
 * Aislamiento multiempresa — Subfase 2D (Equipos instalados, Alina,
 * 2026-09-25). Mismo criterio que 2a/2b/2c: un usuario de la Empresa A
 * intenta leer/escribir un equipo real de la Empresa B por ID directo —
 * nunca debe funcionar. Completa el patrón dedicado que 2A/2B/2C ya tenían
 * (2D lo cubría solo indirecto en equipos-instalados.test.js).
 */

const { obtenerEquipoInstalado, crearEquipoInstalado, actualizarEquipoInstalado } = require('../modules/equipos-instalados');

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
    update: jest.fn(() => builder),
    eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    single: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    then: (resolve) => resolve(resolverFila(filtros)),
  };
  return builder;
}

const EQUIPO_DE_EMPRESA_B = { id: 'eq-empresa-b', company_id: EMPRESA_B, proyecto_id: 'proy-b', instalacion_id: 'inst-b' };
const INSTALACION_DE_EMPRESA_B = { id: 'inst-b', company_id: EMPRESA_B, proyecto_id: 'proy-b' };

describe('Aislamiento multiempresa — 2D (equipos instalados)', () => {
  test('Empresa A pide un equipo real de la Empresa B por ID directo → null, nunca los datos ajenos', async () => {
    const resolver = crearTablaConAislamientoReal([EQUIPO_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    expect(await obtenerEquipoInstalado(db, EMPRESA_A, 'eq-empresa-b')).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su equipo (control positivo)', async () => {
    const resolver = crearTablaConAislamientoReal([EQUIPO_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const r = await obtenerEquipoInstalado(db, EMPRESA_B, 'eq-empresa-b');
    expect(r.id).toBe('eq-empresa-b');
  });

  test('Empresa A intenta REGISTRAR un equipo sobre una instalación real de la Empresa B → 404, nunca inserta', async () => {
    const resolverInstalaciones = crearTablaConAislamientoReal([INSTALACION_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'instalaciones') return crearBuilderAislado((f) => resolverInstalaciones({ id: f.id, company_id: f.company_id, proyecto_id: f.proyecto_id }));
        if (tabla === 'equipos_instalados') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearEquipoInstalado(db, { companyId: EMPRESA_A, proyectoId: 'proy-b', instalacionId: 'inst-b', tipoEquipo: 'panel', usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('Empresa A intenta ACTUALIZAR un equipo real de la Empresa B → 404 (el UPDATE...WHERE company_id nunca afecta la fila ajena, mismo patrón atómico que el resto del sistema)', async () => {
    // El UPDATE de Postgres siempre "corre", pero su WHERE company_id=EMPRESA_A
    // nunca hace match con una fila de EMPRESA_B — por eso el mock, igual que
    // Supabase real, regresa data:null y el código lo trata como 404.
    const resolver = crearTablaConAislamientoReal([EQUIPO_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarEquipoInstalado(db, { companyId: EMPRESA_A, equipoId: 'eq-empresa-b', cambios: { marca: 'Suplantado' } }))
      .rejects.toMatchObject({ status: 404 });
  });
});
