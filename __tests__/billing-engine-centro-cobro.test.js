'use strict';

const { resumenPorOrganizacion, TIPO_CAMBIO_USD_MXN } = require('../modules/billing-engine/centro-cobro');

function crearMockDb(resolvers) {
  return {
    from: jest.fn((tabla) => {
      const builder = { select: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis() };
      builder.then = (resolve) => {
        const fn = resolvers[tabla];
        resolve(fn ? fn() : { data: null, error: null });
      };
      return builder;
    }),
  };
}

describe('billing-engine/centro-cobro', () => {
  describe('resumenPorOrganizacion()', () => {
    test('calcula ingreso, costo (convertido a MXN) y margen para cada organización', async () => {
      const db = crearMockDb({
        organizations: () => ({
          data: [{ id: 'org-1', nombre: 'Sugar Salon', estado: 'activo', companies: [{ id: 'c-1', nombre: 'Sugar Salon' }] }],
          error: null,
        }),
        suscripciones: () => ({
          data: [{
            organization_id: 'org-1', estado: 'active', fecha_periodo_actual_fin: '2026-08-01T00:00:00Z',
            cancelar_al_fin_periodo: false, created_at: '2026-07-01T00:00:00Z',
            planes: { clave: 'professional', nombre: 'THERA Professional', precio_centavos: 299000, periodo: 'mensual' },
          }],
          error: null,
        }),
        decision_logs: () => ({ data: [{ company_id: 'c-1', costo_usd: 10 }], error: null }),
      });

      const [fila] = await resumenPorOrganizacion(db, { desde: '2026-07-01', hasta: '2026-07-31' });

      expect(fila.nombre).toBe('Sugar Salon');
      expect(fila.plan).toBe('THERA Professional');
      expect(fila.ingresoCentavos).toBe(299000);
      expect(fila.costoUsd).toBe(10);
      expect(fila.costoCentavosMxn).toBe(Math.round(10 * TIPO_CAMBIO_USD_MXN * 100));
      expect(fila.margenCentavos).toBe(299000 - Math.round(10 * TIPO_CAMBIO_USD_MXN * 100));
    });

    test('organización sin suscripción vigente: ingreso 0, plan null, margen negativo si hay costo', async () => {
      const db = crearMockDb({
        organizations: () => ({ data: [{ id: 'org-2', nombre: 'GREEN LUX', estado: 'suspendido', companies: [{ id: 'c-2', nombre: 'GREEN LUX' }] }], error: null }),
        suscripciones: () => ({ data: [], error: null }),
        decision_logs: () => ({ data: [{ company_id: 'c-2', costo_usd: 5 }], error: null }),
      });

      const [fila] = await resumenPorOrganizacion(db, { desde: '2026-07-01', hasta: '2026-07-31' });

      expect(fila.plan).toBeNull();
      expect(fila.ingresoCentavos).toBe(0);
      expect(fila.margenCentavos).toBeLessThan(0);
    });

    test('organización con suscripción pero sin consumo de IA: costo 0, margen = ingreso', async () => {
      const db = crearMockDb({
        organizations: () => ({ data: [{ id: 'org-3', nombre: 'SPAZIO', estado: 'activo', companies: [{ id: 'c-3', nombre: 'SPAZIO' }] }], error: null }),
        suscripciones: () => ({
          data: [{ organization_id: 'org-3', estado: 'trial', fecha_periodo_actual_fin: null, created_at: '2026-07-01', planes: { nombre: 'THERA Launch', precio_centavos: 0, periodo: 'mensual' } }],
          error: null,
        }),
        decision_logs: () => ({ data: [], error: null }),
      });

      const [fila] = await resumenPorOrganizacion(db, { desde: '2026-07-01', hasta: '2026-07-31' });

      expect(fila.costoUsd).toBe(0);
      expect(fila.margenCentavos).toBe(0);
    });
  });
});
