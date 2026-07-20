'use strict';

const {
  calcularMRR, calcularChurn, resumenUsoPorEmpresa, contarOrganizacionesPorEstado,
  contarPorEstadoSuscripcion, ingresoDelMes, pagosPendientes, proximosCobros, dashboardGlobal,
} = require('../modules/plataforma-analitica');

// Mock dispatchado por tabla — dashboardGlobal dispara varias consultas en
// paralelo (Promise.all), el orden entre ramas no es determinista.
function crearMockDb(resolvers) {
  const db = {
    from: jest.fn((tabla) => {
      const builder = {
        select: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
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
    test('suma solo suscripciones active/trial/past_due, ignorando canceladas', async () => {
      const db = crearMockDb({
        suscripciones: () => ({
          data: [
            { organization_id: 'org-1', estado: 'active', created_at: '2026-07-01', planes: PLAN_MENSUAL },
            { organization_id: 'org-2', estado: 'cancelled', created_at: '2026-07-01', planes: PLAN_MENSUAL },
            { organization_id: 'org-3', estado: 'trial', created_at: '2026-07-01', planes: { precio_centavos: 0, periodo: 'mensual' } },
          ],
          error: null,
        }),
      });

      const resultado = await calcularMRR(db);

      expect(resultado.mrrCentavos).toBe(100000); // solo org-1 (active) aporta; trial de Launch es $0
      expect(resultado.organizacionesActivas).toBe(2); // active + trial cuentan como "con acceso vigente"
      expect(resultado.arrCentavos).toBe(1200000);
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
            { organization_id: 'org-1', estado: 'cancelled', created_at: '2026-06-01', planes: PLAN_MENSUAL },
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
            { organization_id: 'org-1', estado: 'cancelled', fecha_cancelacion: haceUnaSemana, created_at: '2026-07-01' },
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

  describe('contarPorEstadoSuscripcion()', () => {
    test('cuenta por estado canónico de la suscripción vigente de cada organización', async () => {
      const db = crearMockDb({
        suscripciones: () => ({
          data: [
            { organization_id: 'org-1', estado: 'trial', created_at: '2026-07-10' },
            { organization_id: 'org-2', estado: 'active', created_at: '2026-07-01' },
            { organization_id: 'org-3', estado: 'past_due', created_at: '2026-07-01' },
            { organization_id: 'org-4', estado: 'cancelled', created_at: '2026-07-01' },
          ],
          error: null,
        }),
      });

      const conteo = await contarPorEstadoSuscripcion(db);
      expect(conteo).toEqual({ trial: 1, active: 1, past_due: 1, suspended: 0, cancelled: 1, expired: 0 });
    });
  });

  describe('ingresoDelMes()', () => {
    test('suma total_centavos de pagos pagados en el mes calendario actual', async () => {
      const db = crearMockDb({
        pagos: () => ({ data: [{ total_centavos: 299000 }, { total_centavos: 449000 }], error: null }),
      });
      expect(await ingresoDelMes(db)).toEqual({ ingresoCentavos: 748000 });
    });

    test('sin pagos: 0', async () => {
      const db = crearMockDb({ pagos: () => ({ data: [], error: null }) });
      expect(await ingresoDelMes(db)).toEqual({ ingresoCentavos: 0 });
    });
  });

  describe('pagosPendientes()', () => {
    test('lista solo las suscripciones vigentes en past_due', async () => {
      const db = crearMockDb({
        suscripciones: () => ({
          data: [
            { organization_id: 'org-1', estado: 'past_due', created_at: '2026-07-10', organizations: { nombre: 'SPAZIO' }, planes: { nombre: 'TARA Professional', precio_centavos: 299000 } },
            { organization_id: 'org-2', estado: 'active', created_at: '2026-07-01', organizations: { nombre: 'Total Racks' }, planes: { nombre: 'TARA Unlimited', precio_centavos: 449000 } },
          ],
          error: null,
        }),
      });

      const resultado = await pagosPendientes(db);
      expect(resultado.cantidad).toBe(1);
      expect(resultado.organizaciones[0].nombre).toBe('SPAZIO');
    });
  });

  describe('proximosCobros()', () => {
    test('incluye trials por vencer (fecha_prueba_fin) y suscripciones activas por renovar (fecha_periodo_actual_fin)', async () => {
      const enDosDias = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const enVeinteDias = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
      const db = crearMockDb({
        suscripciones: () => ({
          data: [
            { organization_id: 'org-1', estado: 'trial', fecha_prueba_fin: enDosDias, fecha_periodo_actual_fin: null, created_at: '2026-07-10', organizations: { nombre: 'SPAZIO' }, planes: { nombre: 'TARA Launch' } },
            { organization_id: 'org-2', estado: 'active', fecha_prueba_fin: null, fecha_periodo_actual_fin: enVeinteDias, created_at: '2026-07-01', organizations: { nombre: 'Total Racks' }, planes: { nombre: 'TARA Professional' } },
          ],
          error: null,
        }),
      });

      const resultado = await proximosCobros(db, 7);
      expect(resultado).toHaveLength(1);
      expect(resultado[0].nombre).toBe('SPAZIO');
    });
  });

  describe('dashboardGlobal()', () => {
    test('combina todas las métricas en un solo objeto', async () => {
      const db = crearMockDb({
        suscripciones: () => ({
          data: [{ organization_id: 'org-1', estado: 'active', created_at: '2026-07-01', planes: { ...PLAN_MENSUAL, nombre: 'TARA Professional' }, fecha_cancelacion: null, fecha_periodo_actual_fin: null, fecha_prueba_fin: null, organizations: { nombre: 'Total Racks' } }],
          error: null,
        }),
        pagos: () => ({ data: [], error: null }),
        decision_logs: () => ({ data: [], error: null }),
        companies: () => ({ data: [], error: null }),
        organizations: () => ({ data: [{ estado: 'activa' }], error: null }),
      });

      const resultado = await dashboardGlobal(db);

      expect(resultado).toEqual(expect.objectContaining({
        mrrCentavos: 100000,
        organizacionesActivas: 1,
        churnPct: 0,
        ingresoCentavos: 0,
        ticketPromedioCentavos: 100000,
        empresasPorUso: [],
        organizacionesPorEstado: { activa: 1 },
        clientesPorEstadoSuscripcion: { trial: 0, active: 1, past_due: 0, suspended: 0, cancelled: 0, expired: 0 },
      }));
      expect(resultado.pagosPendientes).toEqual({ cantidad: 0, organizaciones: [] });
      expect(resultado.proximosCobros).toEqual([]);
    });
  });
});
