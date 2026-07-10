'use strict';

const mockMaybeSingle = jest.fn();
const mockOrder       = jest.fn();
const mockEq2         = jest.fn(() => ({ maybeSingle: mockMaybeSingle, order: mockOrder }));
const mockEq1         = jest.fn(() => ({ eq: mockEq2, maybeSingle: mockMaybeSingle, order: mockOrder }));
const mockSelect      = jest.fn(() => ({ eq: mockEq1 }));
const mockFrom        = jest.fn(() => ({ select: mockSelect }));

jest.mock('../modules/clients', () => ({ supabaseServicio: { from: (...args) => mockFrom(...args) } }));

const { obtenerConfigEmpresa, invalidarCache } = require('../modules/config');

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

beforeEach(() => {
  jest.clearAllMocks();
  invalidarCache(COMPANY_A);

  // companies: .select().eq('id').eq('estado','activo').maybeSingle()
  mockMaybeSingle.mockResolvedValueOnce({ data: { id: COMPANY_A, nombre: 'Total Racks' } });
  // personalities: .select().eq('company_id').maybeSingle()
  mockMaybeSingle.mockResolvedValueOnce({ data: { nombre_asistente: 'TARA' } });
  // knowledge_base: .select().eq('company_id').order('categoria')
  mockOrder.mockResolvedValueOnce({ data: [{ categoria: 'SERVICIOS', contenido: '...' }] });
});

describe('config.obtenerConfigEmpresa()', () => {
  test('lanza error si companyId no se provee', async () => {
    await expect(obtenerConfigEmpresa()).rejects.toThrow('companyId es requerido');
  });

  test('arma company/personality/knowledge desde Supabase', async () => {
    const resultado = await obtenerConfigEmpresa(COMPANY_A);
    expect(resultado.company.nombre).toBe('Total Racks');
    expect(resultado.personality.nombre_asistente).toBe('TARA');
    expect(resultado.knowledge).toHaveLength(1);
  });

  test('lanza error si la empresa no existe o está inactiva', async () => {
    mockMaybeSingle.mockReset();
    mockMaybeSingle.mockResolvedValueOnce({ data: null });
    await expect(obtenerConfigEmpresa(COMPANY_A)).rejects.toThrow('Empresa no encontrada o inactiva');
  });

  test('segunda llamada usa caché — no vuelve a consultar Supabase', async () => {
    await obtenerConfigEmpresa(COMPANY_A);
    mockFrom.mockClear();

    await obtenerConfigEmpresa(COMPANY_A);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('invalidarCache() fuerza una nueva consulta', async () => {
    await obtenerConfigEmpresa(COMPANY_A);
    invalidarCache(COMPANY_A);

    mockMaybeSingle.mockResolvedValueOnce({ data: { id: COMPANY_A, nombre: 'Total Racks' } });
    mockMaybeSingle.mockResolvedValueOnce({ data: { nombre_asistente: 'TARA v2' } });
    mockOrder.mockResolvedValueOnce({ data: [] });

    const resultado = await obtenerConfigEmpresa(COMPANY_A);
    expect(resultado.personality.nombre_asistente).toBe('TARA v2');
  });
});
