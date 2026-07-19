'use strict';

const { registrarPago, listarPagos, IVA_TASA_MX } = require('../modules/billing-engine/pagos');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resultado) {
  const db = { from: jest.fn(() => crearBuilder(resultado)) };
  return db;
}

const ORG_ID = 'org-1';

describe('billing-engine/pagos', () => {
  describe('registrarPago()', () => {
    test('calcula IVA automático (16%) si no se da explícito', async () => {
      let insertado;
      const db = { from: jest.fn(() => {
        const b = crearBuilder({ data: { id: 'pago-1' }, error: null });
        b.insert = jest.fn((payload) => { insertado = payload[0]; return b; });
        return b;
      }) };

      await registrarPago(db, { organizationId: ORG_ID, proveedor: 'manual', subtotalCentavos: 100000, estado: 'paid' });

      expect(insertado.subtotal_centavos).toBe(100000);
      expect(insertado.iva_centavos).toBe(16000);
      expect(insertado.total_centavos).toBe(116000);
    });

    test('respeta iva/total explícitos si se dan (ej. proveedor real con su propio desglose)', async () => {
      let insertado;
      const db = { from: jest.fn(() => {
        const b = crearBuilder({ data: { id: 'pago-1' }, error: null });
        b.insert = jest.fn((payload) => { insertado = payload[0]; return b; });
        return b;
      }) };

      await registrarPago(db, {
        organizationId: ORG_ID, proveedor: 'stripe', subtotalCentavos: 299000, ivaCentavos: 0, totalCentavos: 299000, estado: 'paid',
      });

      expect(insertado.iva_centavos).toBe(0);
      expect(insertado.total_centavos).toBe(299000);
    });

    test('lanza si Supabase falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      await expect(registrarPago(db, { organizationId: ORG_ID, proveedor: 'manual', subtotalCentavos: 100, estado: 'paid' })).rejects.toThrow(/fallo/);
    });
  });

  describe('listarPagos()', () => {
    test('devuelve el historial ordenado', async () => {
      const pagos = [{ id: 'pago-1' }];
      const db = crearMockDb({ data: pagos, error: null });
      expect(await listarPagos(db, ORG_ID)).toEqual(pagos);
    });

    test('arreglo vacío si Supabase falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      expect(await listarPagos(db, ORG_ID)).toEqual([]);
    });
  });

  test('IVA_TASA_MX es 16%', () => {
    expect(IVA_TASA_MX).toBe(0.16);
  });
});
