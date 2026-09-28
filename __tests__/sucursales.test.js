'use strict';

const { listarSucursales } = require('../modules/sucursales');

function crearBuilder(resultado) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';

describe('listarSucursales()', () => {
  test('por default filtra solo activas', async () => {
    const db = { from: jest.fn(() => crearBuilder({ data: [], error: null })) };
    await listarSucursales(db, COMPANY_A);
    const builder = db.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('activo', true);
  });

  test('soloActivas:false → no filtra por activo', async () => {
    const db = { from: jest.fn(() => crearBuilder({ data: [], error: null })) };
    await listarSucursales(db, COMPANY_A, { soloActivas: false });
    const builder = db.from.mock.results[0].value;
    expect(builder.eq).not.toHaveBeenCalledWith('activo', true);
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = { from: jest.fn(() => crearBuilder({ data: null, error: { message: 'boom' } })) };
    expect(await listarSucursales(db, COMPANY_A)).toEqual([]);
  });

  test('aislamiento — siempre filtra por company_id, nunca trae sucursales de otra empresa', async () => {
    const filas = [
      { id: 'suc-a', company_id: COMPANY_A, nombre: 'Bodega A' },
      { id: 'suc-b', company_id: COMPANY_B, nombre: 'Bodega B' },
    ];
    const db = {
      from: jest.fn(() => {
        const filtros = {};
        const builder = {
          select: jest.fn(() => builder),
          eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
          order: jest.fn(() => builder),
          then: (resolve) => resolve({ data: filas.filter((f) => f.company_id === filtros.company_id), error: null }),
        };
        return builder;
      }),
    };
    const r = await listarSucursales(db, COMPANY_A, { soloActivas: false });
    expect(r).toEqual([{ id: 'suc-a', company_id: COMPANY_A, nombre: 'Bodega A' }]);
  });
});
