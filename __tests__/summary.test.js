'use strict';

const mockMaybeSingle = jest.fn();
const mockEq = jest.fn().mockReturnThis();
const mockSelect = jest.fn().mockReturnThis();
const mockFrom = jest.fn().mockReturnValue({ select: mockSelect, eq: mockEq, maybeSingle: mockMaybeSingle });

jest.mock('../modules/clients', () => ({ supabaseServicio: { from: (...args) => mockFrom(...args) } }));

const { generarResumenCliente } = require('../modules/summary');

beforeEach(() => jest.clearAllMocks());

describe('summary.generarResumenCliente()', () => {
  test('arma el resumen con los campos presentes', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { nombre: 'Juan', empresa: 'ACME', ciudad: 'Monterrey', estado: 'Calificado', score_interes: 60 },
    });

    const resumen = await generarResumenCliente(5);
    expect(resumen).toBe('Cliente: Juan | Empresa: ACME | Ciudad: Monterrey | Estado: Calificado | Interés: 60/100');
  });

  test('sin cliente encontrado, devuelve mensaje por default', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    expect(await generarResumenCliente(999)).toBe('Cliente sin historial previo.');
  });

  test('con companyId, agrega el filtro eq(company_id) además de eq(id)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { nombre: 'Ana', estado: 'Nuevo', score_interes: 0 } });

    await generarResumenCliente(5, 'company-A');

    expect(mockEq).toHaveBeenCalledWith('id', 5);
    expect(mockEq).toHaveBeenCalledWith('company_id', 'company-A');
  });

  test('sin companyId, no filtra por empresa', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { nombre: 'Ana', estado: 'Nuevo', score_interes: 0 } });

    await generarResumenCliente(5);

    expect(mockEq).toHaveBeenCalledTimes(1);
    expect(mockEq).toHaveBeenCalledWith('id', 5);
  });

  test('error en la consulta no lanza, devuelve mensaje por default', async () => {
    mockMaybeSingle.mockRejectedValue(new Error('boom'));
    expect(await generarResumenCliente(5)).toBe('Cliente sin historial previo.');
  });
});
