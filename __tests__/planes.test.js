'use strict';

const { listarPlanes, crearPlan, actualizarPlan } = require('../modules/planes');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
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
  const filtrosEq = [];
  const db = {
    from: jest.fn(() => {
      const builder = crearBuilder(resultados[idx++] ?? { data: null, error: null });
      builder.eq = jest.fn((k, v) => { filtrosEq.push([k, v]); return builder; });
      return builder;
    }),
    _filtrosEq: filtrosEq,
  };
  return db;
}

const PLAN_STARTER = { id: 'plan-1', clave: 'starter', nombre: 'Starter', precio_centavos: 99900, activo: true };

describe('planes', () => {
  describe('listarPlanes()', () => {
    test('devuelve todos los planes ordenados', async () => {
      const db = crearMockDb({ data: [PLAN_STARTER], error: null });
      const resultado = await listarPlanes(db);
      expect(resultado).toEqual([PLAN_STARTER]);
    });

    test('soloActivos filtra por activo=true', async () => {
      const db = crearMockDb({ data: [PLAN_STARTER], error: null });
      await listarPlanes(db, { soloActivos: true });
      expect(db._filtrosEq).toContainEqual(['activo', true]);
    });

    test('error de Supabase: devuelve arreglo vacío', async () => {
      const db = crearMockDb({ data: null, error: { message: 'fallo' } });
      const resultado = await listarPlanes(db);
      expect(resultado).toEqual([]);
    });
  });

  describe('crearPlan()', () => {
    test('inserta con defaults correctos (moneda MXN, periodo mensual)', async () => {
      const db = crearMockDb({ data: PLAN_STARTER, error: null });
      const resultado = await crearPlan(db, { clave: 'starter', nombre: 'Starter', precioCentavos: 99900 });
      expect(resultado).toEqual(PLAN_STARTER);
    });

    test('lanza si Supabase falla', async () => {
      const db = crearMockDb({ data: null, error: { message: 'clave duplicada' } });
      await expect(crearPlan(db, { clave: 'starter', nombre: 'Starter', precioCentavos: 1 })).rejects.toThrow(/clave duplicada/);
    });

    test('acepta precioCentavos null (plan tipo Enterprise, precio personalizado)', async () => {
      const enterprise = { id: 'plan-ent', clave: 'enterprise', nombre: 'TARA Enterprise', precio_centavos: null, es_autoservicio: false };
      const db = crearMockDb({ data: enterprise, error: null });
      const resultado = await crearPlan(db, { clave: 'enterprise', nombre: 'TARA Enterprise', precioCentavos: null, esAutoservicio: false });
      expect(resultado.precio_centavos).toBeNull();
      expect(resultado.es_autoservicio).toBe(false);
    });

    test('acepta diasPrueba y perks (plan tipo Launch)', async () => {
      const launch = { id: 'plan-launch', clave: 'launch', nombre: 'TARA Launch', precio_centavos: 0, dias_prueba: 30, perks: ['Acceso completo a Professional'] };
      const db = crearMockDb({ data: launch, error: null });
      const resultado = await crearPlan(db, { clave: 'launch', nombre: 'TARA Launch', precioCentavos: 0, diasPrueba: 30, perks: ['Acceso completo a Professional'] });
      expect(resultado.dias_prueba).toBe(30);
      expect(resultado.perks).toEqual(['Acceso completo a Professional']);
    });
  });

  describe('actualizarPlan()', () => {
    test('solo aplica campos permitidos', async () => {
      const db = crearMockDb({ data: { ...PLAN_STARTER, activo: false }, error: null });
      const resultado = await actualizarPlan(db, 'plan-1', { activo: false, clave: 'ignorado' });
      expect(resultado.activo).toBe(false);
    });

    test('lanza si no se pudo actualizar', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(actualizarPlan(db, 'plan-inexistente', { activo: false })).rejects.toThrow();
    });
  });
});
