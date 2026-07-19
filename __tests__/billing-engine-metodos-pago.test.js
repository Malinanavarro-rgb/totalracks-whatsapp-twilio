'use strict';

const { registrarMetodoPago, obtenerMetodoPagoVigente, listarMetodosPago } = require('../modules/billing-engine/metodos-pago');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
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
    from: jest.fn((tabla) => { llamadas.push(tabla); return crearBuilder(resultados[idx++] ?? { data: null, error: null }); }),
    _llamadas: llamadas,
  };
  return db;
}

const ORG_ID = 'org-1';
const METODO = { id: 'mp-1', organization_id: ORG_ID, proveedor: 'stripe', token: 'tok_abc', ultimos4: '4242', marca: 'Visa' };

describe('billing-engine/metodos-pago', () => {
  describe('registrarMetodoPago()', () => {
    test('marca como reemplazado el método vigente anterior y crea uno nuevo', async () => {
      const db = crearMockDb(
        { data: null, error: null }, // update (marcar reemplazado)
        { data: METODO, error: null } // insert
      );

      const resultado = await registrarMetodoPago(db, { organizationId: ORG_ID, proveedor: 'stripe', token: 'tok_abc', ultimos4: '4242', marca: 'Visa' });

      expect(db._llamadas).toEqual(['metodos_pago', 'metodos_pago']);
      expect(resultado).toEqual(METODO);
    });

    test('lanza si el INSERT falla', async () => {
      const db = crearMockDb({ data: null, error: null }, { data: null, error: { message: 'fallo' } });
      await expect(registrarMetodoPago(db, { organizationId: ORG_ID, proveedor: 'stripe', token: 'x' })).rejects.toThrow(/fallo/);
    });
  });

  describe('obtenerMetodoPagoVigente()', () => {
    test('devuelve el método activo más reciente', async () => {
      const db = crearMockDb({ data: METODO, error: null });
      expect(await obtenerMetodoPagoVigente(db, ORG_ID)).toEqual(METODO);
    });

    test('null si no hay ninguno', async () => {
      const db = crearMockDb({ data: null, error: null });
      expect(await obtenerMetodoPagoVigente(db, ORG_ID)).toBeNull();
    });
  });

  describe('listarMetodosPago()', () => {
    test('devuelve el histórico completo', async () => {
      const db = crearMockDb({ data: [METODO], error: null });
      expect(await listarMetodosPago(db, ORG_ID)).toEqual([METODO]);
    });

    test('arreglo vacío si Supabase falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      expect(await listarMetodosPago(db, ORG_ID)).toEqual([]);
    });
  });
});
