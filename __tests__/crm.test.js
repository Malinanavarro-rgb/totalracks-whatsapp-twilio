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

  // Bug real 2026-07-30 (Empresa Demo Paneles Solares): 'solicitud_cotizacion'/
  // 'interes_compra' (los valores REALES del catálogo de intenciones) nunca
  // creaban oportunidad — el código comparaba contra 'cotizacion'/'precio',
  // que no existen en ningún catálogo. Un mensaje sin ninguna palabra clave
  // de TRIGGERS_OPORTUNIDAD, pero con la intención real, debe crear la
  // oportunidad igual.
  test('crea oportunidad cuando la intención es "solicitud_cotizacion", aunque el mensaje no tenga palabras clave', async () => {
    prepararResultados(
      { data: [], error: null },
      { data: { nombre: 'Nuevo' }, error: null },
      { data: null, error: null },
    );

    await crearOportunidadSiCorresponde(1, COMPANY_A, 'Energía solar', 'una casa de 2 pisos, son 5 climas', ['interes_compra', 'solicitud_cotizacion']);

    expect(mockLlamadas).toEqual(['oportunidades', 'pipeline_etapas', 'oportunidades']);
  });

  test('crea oportunidad cuando la intención es "interes_compra", aunque el mensaje no tenga palabras clave', async () => {
    prepararResultados(
      { data: [], error: null },
      { data: { nombre: 'Nuevo' }, error: null },
      { data: null, error: null },
    );

    await crearOportunidadSiCorresponde(1, COMPANY_A, 'Energía solar', 'me gustaría saber más', ['interes_compra']);

    expect(mockLlamadas).toEqual(['oportunidades', 'pipeline_etapas', 'oportunidades']);
  });

  test('sin palabra clave y sin intención relevante, no crea oportunidad (ej. "cotizacion"/"precio" ya no cuentan, no existen en el catálogo real)', async () => {
    await crearOportunidadSiCorresponde(1, COMPANY_A, 'Energía solar', 'una casa de 2 pisos, son 5 climas', ['consulta_general']);
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
