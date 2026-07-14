'use strict';

const mockResultados = [];
let mockIdx = 0;
const mockLlamadas = [];

function mockCrearBuilder(resultado) {
  return {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    neq:         jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    single:      jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
}

const mockFrom = jest.fn((tabla) => {
  mockLlamadas.push(tabla);
  return mockCrearBuilder(mockResultados[mockIdx++] ?? { data: null, error: null });
});

jest.mock('../modules/clients', () => ({ supabaseServicio: { from: (...args) => mockFrom(...args) } }));

const { crearOportunidadSiCorresponde } = require('../modules/crm');

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

function prepararResultados(...resultados) {
  mockResultados.length = 0;
  mockResultados.push(...resultados);
  mockIdx = 0;
  mockLlamadas.length = 0;
}

beforeEach(() => {
  jest.clearAllMocks();
  prepararResultados();
});

describe('crm.crearOportunidadSiCorresponde() — Fase Demo Comercial', () => {
  test('no hace ninguna consulta si el mensaje no amerita crear oportunidad', async () => {
    await crearOportunidadSiCorresponde(1, COMPANY_A, 'Uniformes', 'hola, buenos días', []);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('ya existe una oportunidad activa → no crea otra', async () => {
    prepararResultados({ data: [{ id: 99 }], error: null });

    await crearOportunidadSiCorresponde(1, COMPANY_A, 'Uniformes', 'quiero una cotización', []);

    expect(mockLlamadas).toEqual(['oportunidades']);
  });

  test('usa la primera etapa configurada (por orden) como estado inicial, no "Calificado" hardcodeado', async () => {
    prepararResultados(
      { data: [], error: null },                          // sin oportunidades existentes
      { data: { nombre: 'Solicitud nueva' }, error: null }, // primera etapa del pipeline de la empresa
      { data: null, error: null },                          // insert
    );

    await crearOportunidadSiCorresponde(1, COMPANY_A, 'Uniformes', 'quiero una cotización', []);

    expect(mockLlamadas).toEqual(['oportunidades', 'pipeline_etapas', 'oportunidades']);
    const builderInsert = mockFrom.mock.results[2].value;
    expect(builderInsert.insert).toHaveBeenCalledWith([expect.objectContaining({ estado: 'Solicitud nueva' })]);
  });

  test('sin companyId, usa "Calificado" sin consultar pipeline_etapas', async () => {
    prepararResultados(
      { data: [], error: null },
      { data: null, error: null },
    );

    await crearOportunidadSiCorresponde(1, null, 'Uniformes', 'quiero una cotización', []);

    expect(mockLlamadas).toEqual(['oportunidades', 'oportunidades']);
    const builderInsert = mockFrom.mock.results[1].value;
    expect(builderInsert.insert).toHaveBeenCalledWith([expect.objectContaining({ estado: 'Calificado' })]);
  });

  test('empresa sin etapas activas configuradas → usa "Calificado" como último recurso', async () => {
    prepararResultados(
      { data: [], error: null },
      { data: null, error: null }, // pipeline_etapas: sin filas
      { data: null, error: null },
    );

    await crearOportunidadSiCorresponde(1, COMPANY_A, 'Uniformes', 'quiero una cotización', []);

    const builderInsert = mockFrom.mock.results[2].value;
    expect(builderInsert.insert).toHaveBeenCalledWith([expect.objectContaining({ estado: 'Calificado' })]);
  });
});
