'use strict';

/**
 * Aislamiento multiempresa — Subfase 2I (Mantenimiento/Postventa, Alina,
 * 2026-09-28). Mismo criterio que 2A-2H: un usuario de la Empresa A
 * intenta leer/escribir un recurso real de la Empresa B por ID directo —
 * nunca debe funcionar.
 */

jest.mock('../modules/instalaciones', () => ({ obtenerChecklistConfig: jest.fn().mockResolvedValue([]) }));
jest.mock('../modules/agenda', () => ({ schedulingEngineParaEmpresa: jest.fn() }));

const { schedulingEngineParaEmpresa } = require('../modules/agenda');
const { obtenerMantenimiento, crearMantenimiento, actualizarMantenimiento, programarSiguienteMantenimiento } = require('../modules/mantenimientos');
const { obtenerTicket, crearTicket, actualizarTicket, actualizarEstadoTicket } = require('../modules/tickets');

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

const MANTENIMIENTO_DE_EMPRESA_B = { id: 'mant-b', company_id: EMPRESA_B, proyecto_id: 'proy-b', tecnico_id: 'tec-b' };
const PROYECTO_DE_EMPRESA_B = { id: 'proy-b', company_id: EMPRESA_B, cliente_id: 999 };
const TICKET_DE_EMPRESA_B = { id: 'tick-b', company_id: EMPRESA_B, cliente_id: 999, estado: 'abierto' };
const CLIENTE_DE_EMPRESA_B = { id: 999, company_id: EMPRESA_B };

beforeEach(() => { schedulingEngineParaEmpresa.mockReset(); });

describe('Aislamiento multiempresa — 2I (mantenimiento)', () => {
  test('Empresa A pide un mantenimiento real de la Empresa B por ID directo → null', async () => {
    const resolver = crearTablaConAislamientoReal([MANTENIMIENTO_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    expect(await obtenerMantenimiento(db, EMPRESA_A, 'mant-b')).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su mantenimiento (control positivo)', async () => {
    const resolver = crearTablaConAislamientoReal([MANTENIMIENTO_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const r = await obtenerMantenimiento(db, EMPRESA_B, 'mant-b');
    expect(r.id).toBe('mant-b');
  });

  test('Empresa A intenta CREAR un mantenimiento sobre un proyecto real de la Empresa B → 404, nunca inserta', async () => {
    const resolverProyectos = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'proyectos') return crearBuilderAislado((f) => resolverProyectos({ id: f.id, company_id: f.company_id }));
        if (tabla === 'mantenimientos') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearMantenimiento(db, { companyId: EMPRESA_A, proyectoId: 'proy-b', tipo: 'preventivo' })).rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('Empresa A intenta ACTUALIZAR un mantenimiento real de la Empresa B → 404, nunca lo modifica', async () => {
    const resolver = crearTablaConAislamientoReal([MANTENIMIENTO_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarMantenimiento(db, { companyId: EMPRESA_A, mantenimientoId: 'mant-b', cambios: { notas: 'suplantado' } })).rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A intenta PROGRAMAR LA SIGUIENTE visita de un mantenimiento real de la Empresa B → 404, nunca llama al scheduling engine', async () => {
    const resolver = crearTablaConAislamientoReal([MANTENIMIENTO_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(programarSiguienteMantenimiento(db, { companyId: EMPRESA_A, mantenimientoId: 'mant-b', inicio: new Date(), fin: new Date() }))
      .rejects.toMatchObject({ status: 404 });
    expect(schedulingEngineParaEmpresa).not.toHaveBeenCalled();
  });
});

describe('Aislamiento multiempresa — 2I (tickets)', () => {
  test('Empresa A pide un ticket real de la Empresa B por ID directo → null', async () => {
    const resolver = crearTablaConAislamientoReal([TICKET_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    expect(await obtenerTicket(db, EMPRESA_A, 'tick-b')).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su ticket (control positivo)', async () => {
    const resolver = crearTablaConAislamientoReal([TICKET_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const r = await obtenerTicket(db, EMPRESA_B, 'tick-b');
    expect(r.id).toBe('tick-b');
  });

  test('Empresa A intenta CREAR un ticket sobre un cliente real de la Empresa B → 404, nunca inserta', async () => {
    const resolverClientes = crearTablaConAislamientoReal([CLIENTE_DE_EMPRESA_B]);
    let seIntentoInsertar = false;
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'clientes') return crearBuilderAislado((f) => resolverClientes({ id: f.id, company_id: f.company_id }));
        if (tabla === 'tickets') {
          const b = crearBuilderAislado(() => ({ data: [], error: null }));
          const insertOriginal = b.insert;
          b.insert = jest.fn((p) => { seIntentoInsertar = true; return insertOriginal(p); });
          return b;
        }
        return crearBuilderAislado(() => ({ data: [], error: null }));
      }),
    };

    await expect(crearTicket(db, { companyId: EMPRESA_A, clienteId: 999, asunto: 'x', categoria: 'general' })).rejects.toMatchObject({ status: 404 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('Empresa A intenta ACTUALIZAR un ticket real de la Empresa B → 404, nunca lo modifica', async () => {
    const resolver = crearTablaConAislamientoReal([TICKET_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarTicket(db, { companyId: EMPRESA_A, ticketId: 'tick-b', cambios: { asunto: 'suplantado' } })).rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A intenta cambiar el ESTADO de un ticket real de la Empresa B → 404, nunca lo modifica', async () => {
    const resolver = crearTablaConAislamientoReal([TICKET_DE_EMPRESA_B]);
    const db = { from: jest.fn(() => crearBuilderAislado((f) => resolver({ id: f.id, company_id: f.company_id }))) };

    await expect(actualizarEstadoTicket(db, { companyId: EMPRESA_A, ticketId: 'tick-b', estado: 'en_proceso' })).rejects.toMatchObject({ status: 404 });
  });
});
