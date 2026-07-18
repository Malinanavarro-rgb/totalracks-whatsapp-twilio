'use strict';

const {
  calcularMRR, calcularChurn, resumenUsoPorEmpresa, contarOrganizacionesPorEstado, dashboardGlobal,
} = require('../modules/plataforma-analitica');

// Mock dispatchado por tabla — dashboardGlobal dispara 4 consultas en
// paralelo (Promise.all), el orden entre ramas no es determinista.
function crearMockDb(resolvers) {
  const db = {
    from: jest.fn((tabla) => {
      const builder = {
        select: jest.fn().mockReturnThis(),
        gte:    jest.fn().mockReturnThis(),
        lte:    jest.fn().mockReturnThis(),
        order:  jest.fn().mockReturnThis(),
      };
      builder.then = (resolve) => {
        const fn = resolvers[tabla];
        resolve(fn ? fn() : { data: null, error: null });
      };
      return builder;
    }),
  };
  return db;
}

const PLAN_MENSUAL = { precio_centavos: 100000, periodo: 'mensual' };
const PLAN_ANUAL = { precio_centavos: 1200000, periodo: 'anual' }; // = 100000/mes normalizado

describe('plataforma-analitica', () => {
  describe('calcularMRR()', () => {
    test('suma solo suscripciones activas/trialing/past_due, ignorando canceladas', async () => {
      const db = crearMockDb({
        suscripciones: () => ({
          data: [
            { organization_id: 'org-1', estado: 'active', created_at: '2026-07-01', planes: PLAN_MENSUAL },
            { organization_id: 'org-2', estado: 'canceled', created_at: '2026-07-01', planes: PLAN_MENSUAL },
            { organization_id: 'org-3', estado: 'trialing', created_at: '2026-07-01', planes: PLAN_MENSUAL },
          ],
          error: null,
        }),
      });

      const resultado = await calcularMRR(db);

      expect(resultado.mrrCentavos).toBe(200000);
      expect(resultado.organizacionesActivas).toBe(2);
      expect(resultado.arrCentavos).toBe(2400000);
    });

    test('normaliza planes anuales a su equivalente mensual', async () => {
      const db = crearMockDb({
        suscripciones: () => ({ data: [{ organization_id: 'org-1', estado: 'active', created_at: '2026-07-01', planes: PLAN_ANUAL }], error: null }),
      });

      const resultado = await calcularMRR(db);
      expect(resultado.mrrCentavos).toBe(100000);
    });

    test('una organización con 2 filas de suscripción solo cuenta la más reciente', async () => {
      const db = crearMockDb({
        suscripciones: () => ({
          data: [
            { organization_id: 'org-1', estado: 'active', created_at: '2026-07-15', planes: PLAN_MENSUAL }, // más reciente, primero en el array
            { organization_id: 'org-1', estado: 'canceled', created_at: '2026-06-01', planes: PLAN_MENSUAL },
          ],
          error: null,
        }),
      });

      const resultado = await calcularMRR(db);
      expect(resultado.organizacionesActivas).toBe(1);
      expect(resultado.mrrCentavos).toBe(100000);
    });

    test('sin datos: 0 en todo, no lanza', async () => {
      const db = crearMockDb({ suscripciones: () => ({ data: null, error: { message: 'fallo' } }) });
      const resultado = await calcularMRR(db);
      expect(resultado).toEqual({ mrrCentavos: 0, arrCentavos: 0, organizacionesActivas: 0 });
    });
  });

  describe('calcularChurn()', () => {
    test('calcula el % de organizaciones canceladas en los últimos 30 días', async () => {
      const haceUnaSemana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const db = crearMockDb({
        suscripciones: () => ({
          data: [
            { organization_id: 'org-1', estado: 'canceled', fecha_cancelacion: haceUnaSemana, created_at: '2026-07-01' },
            { organization_id: 'org-2', estado: 'active', fecha_cancelacion: null, created_at: '2026-07-01' },
          ],
          error: null,
        }),
      });

      const resultado = await calcularChurn(db);
      expect(resultado.cancelacionesUltimos30Dias).toBe(1);
      expect(resultado.churnPct).toBe(50);
    });

    test('sin organizaciones: 0%, no divide por cero', async () => {
      const db = crearMockDb({ suscripciones: () => ({ data: [], error: null }) });
      const resultado = await calcularChurn(db);
      expect(resultado.churnPct).toBe(0);
    });
  });

  describe('resumenUsoPorEmpresa()', () => {
    test('agrupa costo/tokens por company_id y ordena por costo descendente', async () => {
      const db = crearMockDb({
        decision_logs: () => ({
          data: [
            { company_id: 'c-1', costo_usd: 1.5, tokens_total: 1000 },
            { company_id: 'c-2', costo_usd: 5.0, tokens_total: 2000 },
            { company_id: 'c-1', costo_usd: 0.5, tokens_total: 500 },
          ],
          error: null,
        }),
        companies: () => ({ data: [{ id: 'c-1', nombre: 'Sugar Salon' }, { id: 'c-2', nombre: 'Total Racks' }], error: null }),
      });

      const resultado = await resumenUsoPorEmpresa(db, { desde: '2026-07-01', hasta: '2026-07-31' });

      expect(resultado[0]).toEqual({ company_id: 'c-2', nombre: 'Total Racks', costoUsd: 5.0, tokens: 2000, eventos: 1 });
      expect(resultado[1]).toEqual({ company_id: 'c-1', nombre: 'Sugar Salon', costoUsd: 2.0, tokens: 1500, eventos: 2 });
    });

    test('sin logs: arreglo vacío', async () => {
      const db = crearMockDb({ decision_logs: () => ({ data: null, error: { message: 'fallo' } }) });
      expect(await resumenUsoPorEmpresa(db, { desde: 'x', hasta: 'y' })).toEqual([]);
    });
  });

  describe('contarOrganizacionesPorEstado()', () => {
    test('cuenta por estado', async () => {
      const db = crearMockDb({
        organizations: () => ({ data: [{ estado: 'activa' }, { estado: 'activa' }, { estado: 'suspendida' }], error: null }),
      });
      expect(await contarOrganizacionesPorEstado(db)).toEqual({ activa: 2, suspendida: 1 });
    });
  });

  describe('dashboardGlobal()', () => {
    test('combina las 4 métricas en un solo objeto', async () => {
      const db = crearMockDb({
        suscripciones: () => ({ data: [{ organization_id: 'org-1', estado: 'active', created_at: '2026-07-01', planes: PLAN_MENSUAL, fecha_cancelacion: null }], error: null }),
        decision_logs: () => ({ data: [], error: null }),
        companies: () => ({ data: [], error: null }),
        organizations: () => ({ data: [{ estado: 'activa' }], error: null }),
      });

      const resultado = await dashboardGlobal(db);

      expect(resultado).toEqual(expect.objectContaining({
        mrrCentavos: 100000,
        organizacionesActivas: 1,
        churnPct: 0,
        empresasPorUso: [],
        organizacionesPorEstado: { activa: 1 },
      }));
    });
  });
});
