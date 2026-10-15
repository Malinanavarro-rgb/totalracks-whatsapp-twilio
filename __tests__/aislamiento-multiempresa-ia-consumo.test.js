'use strict';

const { registrarConsumoIA } = require('../modules/ia-consumo');

function crearMockDb() {
  const insertados = [];
  return {
    _insertados: insertados,
    from: jest.fn((tabla) => ({
      insert: jest.fn((filas) => { insertados.push({ tabla, filas }); return Promise.resolve({ data: filas, error: null }); }),
    })),
  };
}

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';

describe('aislamiento multiempresa — ia_consumo_logs', () => {
  test('cada llamada queda atribuida a su propia empresa — nunca se mezclan ni se infieren de otra', async () => {
    const db = crearMockDb();

    await registrarConsumoIA(db, { companyId: COMPANY_A, proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion', tokensEntrada: 100, tokensSalida: 50, resultado: 'exito' });
    await registrarConsumoIA(db, { companyId: COMPANY_B, proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion', tokensEntrada: 200, tokensSalida: 80, resultado: 'exito' });

    expect(db._insertados).toHaveLength(2);
    expect(db._insertados[0].filas[0].company_id).toBe(COMPANY_A);
    expect(db._insertados[1].filas[0].company_id).toBe(COMPANY_B);
    // Ninguna fila de A debe traer datos de tokens de B ni viceversa.
    expect(db._insertados[0].filas[0].tokens_entrada).toBe(100);
    expect(db._insertados[1].filas[0].tokens_entrada).toBe(200);
  });

  test('llamada de alcance "plataforma" (Panel Maestro, sin empresa) → company_id null, nunca se le asigna una empresa real por accidente', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, { companyId: null, proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'modo_operador', tokensEntrada: 10, tokensSalida: 10, resultado: 'exito' });

    expect(db._insertados[0].filas[0].company_id).toBeNull();
  });

  test('el INSERT nunca incluye un filtro ni valor que permita a una empresa leer o sobrescribir el registro de otra (solo escribe su propia fila, una por llamada)', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, { companyId: COMPANY_A, proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion', tokensEntrada: 10, tokensSalida: 10, resultado: 'exito' });

    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith('ia_consumo_logs');
    expect(db._insertados[0].filas).toHaveLength(1); // una fila por llamada, nunca un batch que pudiera mezclar empresas
  });
});
