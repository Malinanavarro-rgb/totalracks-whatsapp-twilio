'use strict';

const { crearOrganizacionConCompany, listarOrganizaciones, obtenerOrganizacion } = require('../modules/organizaciones');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => {
      llamadas.push(tabla);
      return crearBuilder(resultados[idx++] ?? { data: null, error: null });
    }),
    _llamadas: llamadas,
  };
  return db;
}

const ORG_1 = { id: 'org-1', nombre: 'Sugar Salon', estado: 'activa' };
const COMPANY_1 = { id: 'company-1', nombre: 'Sugar Salon', organization_id: 'org-1' };

describe('organizaciones', () => {
  describe('crearOrganizacionConCompany()', () => {
    test('crea la organization y luego la company con organization_id', async () => {
      const db = crearMockDb(
        { data: ORG_1, error: null },
        { data: COMPANY_1, error: null }
      );

      const resultado = await crearOrganizacionConCompany(db, { nombre: 'Sugar Salon', slug: 'sugar-salon' });

      expect(db._llamadas).toEqual(['organizations', 'companies']);
      expect(resultado).toEqual({ organization: ORG_1, company: COMPANY_1 });
    });

    test('si el INSERT de company falla, borra la organization recién creada (compensación)', async () => {
      const db = crearMockDb(
        { data: ORG_1, error: null },
        { data: null, error: { message: 'slug duplicado' } },
        { data: null, error: null } // el DELETE de compensación
      );

      await expect(
        crearOrganizacionConCompany(db, { nombre: 'Sugar Salon', slug: 'sugar-salon' })
      ).rejects.toThrow(/slug duplicado/);

      expect(db._llamadas).toEqual(['organizations', 'companies', 'organizations']);
    });

    test('si el INSERT de organization falla, no intenta crear la company', async () => {
      const db = crearMockDb({ data: null, error: { message: 'nombre requerido' } });

      await expect(
        crearOrganizacionConCompany(db, { nombre: '', slug: 'x' })
      ).rejects.toThrow(/nombre requerido/);

      expect(db._llamadas).toEqual(['organizations']);
    });
  });

  describe('listarOrganizaciones()', () => {
    test('devuelve la lista con companies embebidas', async () => {
      const db = crearMockDb({ data: [ORG_1], error: null });
      const resultado = await listarOrganizaciones(db);
      expect(resultado).toEqual([ORG_1]);
    });

    test('error de Supabase: devuelve arreglo vacío, nunca lanza', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      const resultado = await listarOrganizaciones(db);
      expect(resultado).toEqual([]);
    });
  });

  describe('obtenerOrganizacion()', () => {
    test('devuelve la organización si existe', async () => {
      const db = crearMockDb({ data: ORG_1, error: null });
      const resultado = await obtenerOrganizacion(db, 'org-1');
      expect(resultado).toEqual(ORG_1);
    });

    test('devuelve null si no existe', async () => {
      const db = crearMockDb({ data: null, error: null });
      const resultado = await obtenerOrganizacion(db, 'org-inexistente');
      expect(resultado).toBeNull();
    });
  });
});
