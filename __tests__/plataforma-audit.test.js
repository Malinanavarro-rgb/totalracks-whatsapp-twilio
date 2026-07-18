'use strict';

const { registrarEvento, listarEventos } = require('../modules/plataforma-audit');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resultado) {
  return { from: jest.fn(() => crearBuilder(resultado)) };
}

describe('plataforma-audit', () => {
  describe('registrarEvento()', () => {
    test('inserta con los campos dados, sin lanzar aunque Supabase falle', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo de red' } });
      await expect(registrarEvento(db, { adminId: 'a-1', accion: 'suspender_empresa', organizationId: 'org-1' })).resolves.toBeUndefined();
    });

    test('éxito: no lanza', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(registrarEvento(db, { adminId: 'a-1', accion: 'reactivar_empresa' })).resolves.toBeUndefined();
    });
  });

  describe('listarEventos()', () => {
    test('devuelve las filas ordenadas por fecha descendente', async () => {
      const eventos = [{ id: 1, accion: 'suspender_empresa' }];
      const db = crearMockDb({ data: eventos, error: null });
      const resultado = await listarEventos(db);
      expect(resultado).toEqual(eventos);
    });

    test('error de Supabase: devuelve arreglo vacío', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      const resultado = await listarEventos(db);
      expect(resultado).toEqual([]);
    });
  });
});
