'use strict';

const { listarModulosCatalogo } = require('../modules/modulos-catalogo');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resultado) {
  return { from: jest.fn(() => crearBuilder(resultado)) };
}

describe('modulos-catalogo', () => {
  describe('listarModulosCatalogo()', () => {
    test('devuelve el catálogo tal cual lo da Supabase', async () => {
      const catalogo = [{ codigo: 'crm', nombre: 'CRM' }, { codigo: 'tickets', nombre: 'Tickets' }];
      const db = crearMockDb({ data: catalogo, error: null });
      const resultado = await listarModulosCatalogo(db);
      expect(resultado).toEqual(catalogo);
    });

    test('error de Supabase: devuelve arreglo vacío, nunca lanza', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      await expect(listarModulosCatalogo(db)).resolves.toEqual([]);
    });
  });
});
