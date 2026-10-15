'use strict';

const { listarModulosEmpresa, activarModulo } = require('../modules/modulos-empresa');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

/** Cada llamada a .from() consume el siguiente resultado de la lista, en orden. */
function crearMockDb(...resultados) {
  let idx = 0;
  return { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-aaaa';
const ORG_A = 'org-aaaa';

const CATALOGO = [
  { codigo: 'crm', nombre: 'CRM', categoria: 'ventas', dependencias: [] },
  { codigo: 'cotizaciones', nombre: 'Cotizaciones', categoria: 'ventas', dependencias: ['crm'] },
];

describe('modulos-empresa', () => {
  describe('listarModulosEmpresa()', () => {
    test('módulo sin fila en modulos_empresa se muestra "activo" (mismo criterio de fallback que modulo-engine.js)', async () => {
      const db = crearMockDb(
        { data: CATALOGO, error: null },      // modulos_catalogo
        { data: [], error: null },            // modulos_empresa (sin filas)
        { data: null, error: null },          // suscripciones (sin plan resuelto)
      );
      const resultado = await listarModulosEmpresa(db, { companyId: COMPANY_A, organizationId: ORG_A });
      expect(resultado.find((m) => m.codigo === 'crm').estado).toBe('activo');
      // Sin dato de plan todavía: incluido_en_plan = true para todos, nunca se interpreta como "ningún módulo".
      expect(resultado.every((m) => m.incluido_en_plan)).toBe(true);
    });

    test('módulo con fila "inactivo" se refleja tal cual, y queda excluido de incluido_en_plan si el plan no lo trae', async () => {
      const db = crearMockDb(
        { data: CATALOGO, error: null },
        { data: [{ modulo_codigo: 'cotizaciones', estado: 'inactivo' }], error: null },
        { data: { planes: { limites: { modulos: { incluidos: ['crm'] } } } }, error: null },
      );
      const resultado = await listarModulosEmpresa(db, { companyId: COMPANY_A, organizationId: ORG_A });
      const cotizaciones = resultado.find((m) => m.codigo === 'cotizaciones');
      expect(cotizaciones.estado).toBe('inactivo');
      expect(cotizaciones.incluido_en_plan).toBe(false);
      expect(resultado.find((m) => m.codigo === 'crm').incluido_en_plan).toBe(true);
    });
  });

  describe('activarModulo()', () => {
    test('módulo que no existe en el catálogo: 404', async () => {
      const db = crearMockDb({ data: null, error: null }); // modulos_catalogo: no encontrado
      await expect(activarModulo(db, { companyId: COMPANY_A, organizationId: ORG_A, moduloCodigo: 'inexistente', activadoPor: 'u-1' }))
        .rejects.toMatchObject({ status: 404 });
    });

    test('módulo no incluido en el plan vigente: 403, nunca escribe modulos_empresa', async () => {
      const db = crearMockDb(
        { data: { codigo: 'cotizaciones', nombre: 'Cotizaciones', dependencias: [] }, error: null }, // modulos_catalogo
        { data: { planes: { limites: { modulos: { incluidos: ['crm'] } } } }, error: null },          // suscripciones
      );
      await expect(activarModulo(db, { companyId: COMPANY_A, organizationId: ORG_A, moduloCodigo: 'cotizaciones', activadoPor: 'u-1' }))
        .rejects.toMatchObject({ status: 403 });
      expect(db.from).not.toHaveBeenCalledWith('modulos_empresa');
    });

    test('dependencia explícitamente "inactivo": 409, no activa el módulo pedido', async () => {
      const db = crearMockDb(
        { data: { codigo: 'cotizaciones', nombre: 'Cotizaciones', dependencias: ['crm'] }, error: null }, // modulos_catalogo
        { data: { planes: { limites: { modulos: { incluidos: ['crm', 'cotizaciones'] } } } }, error: null }, // suscripciones
        { data: [{ modulo_codigo: 'crm', estado: 'inactivo' }], error: null },                              // dependencias
      );
      await expect(activarModulo(db, { companyId: COMPANY_A, organizationId: ORG_A, moduloCodigo: 'cotizaciones', activadoPor: 'u-1' }))
        .rejects.toThrow(/Primero activa/);
    });

    test('dependencia sin fila (activa por default) + incluido en el plan: activa correctamente', async () => {
      const db = crearMockDb(
        { data: { codigo: 'cotizaciones', nombre: 'Cotizaciones', dependencias: ['crm'] }, error: null },
        { data: { planes: { limites: { modulos: { incluidos: ['crm', 'cotizaciones'] } } } }, error: null },
        { data: [], error: null }, // dependencias: sin fila
        { data: { company_id: COMPANY_A, modulo_codigo: 'cotizaciones', estado: 'activo' }, error: null }, // upsert
        { data: null, error: null }, // companies.update (module_engine_configurado_en)
      );
      const resultado = await activarModulo(db, { companyId: COMPANY_A, organizationId: ORG_A, moduloCodigo: 'cotizaciones', activadoPor: 'u-1' });
      expect(resultado.estado).toBe('activo');
    });
  });
});
