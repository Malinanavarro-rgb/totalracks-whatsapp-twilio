'use strict';

const mockCreate = jest.fn();
jest.mock('../modules/clients', () => ({
  openai: { chat: { completions: { create: (...args) => mockCreate(...args) } } },
}));

const mockObtenerHistorial = jest.fn();
jest.mock('../modules/conversaciones', () => ({
  obtenerHistorial: (...args) => mockObtenerHistorial(...args),
}));

const { responderSobreCliente } = require('../modules/asistente-consultas');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockSupabase(...resultados) {
  let idx = 0;
  return { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

beforeEach(() => jest.clearAllMocks());

describe('asistente-consultas.responderSobreCliente()', () => {
  test('arma el contexto con cliente, oportunidad, captured_fields e historial, y llama a OpenAI', async () => {
    mockObtenerHistorial.mockResolvedValue([
      { de: 'cliente', texto: 'Quiero uniformes para mi equipo' },
      { de: 'tara', texto: '¿Qué deporte practican?' },
    ]);
    const supabase = crearMockSupabase(
      { data: { nombre: 'Rayados FC', empresa: null }, error: null },
      { data: [{ estado: 'Cotización enviada', descripcion: 'Uniforme de fútbol', presupuesto_estimado: 62000, presupuesto_confirmado: null }], error: null },
      { data: { captured_fields: { deporte: 'fútbol', cantidad: '25' } }, error: null },
    );
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '  Sí, ya puedes enviar la cotización.  ' } }] });

    const respuesta = await responderSobreCliente(supabase, COMPANY_A, 20, '¿ya puedo enviar la cotización?');

    expect(respuesta).toBe('Sí, ya puedes enviar la cotización.');
    expect(mockObtenerHistorial).toHaveBeenCalledWith(supabase, COMPANY_A, 20);

    const llamada = mockCreate.mock.calls[0][0];
    expect(llamada.messages[1].content).toContain('Rayados FC');
    expect(llamada.messages[1].content).toContain('Cotización enviada');
    expect(llamada.messages[1].content).toContain('fútbol');
    expect(llamada.messages[1].content).toContain('Quiero uniformes para mi equipo');
    expect(llamada.messages[1].content).toContain('¿ya puedo enviar la cotización?');
  });

  test('sin oportunidad ni captured_fields, arma un contexto honesto sin inventar datos', async () => {
    mockObtenerHistorial.mockResolvedValue([]);
    const supabase = crearMockSupabase(
      { data: { nombre: 'Cliente Nuevo' }, error: null },
      { data: [], error: null },
      { data: null, error: null },
    );
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Todavía no hay información suficiente.' } }] });

    await responderSobreCliente(supabase, COMPANY_A, 21, '¿qué pasó con este cliente?');

    const contexto = mockCreate.mock.calls[0][0].messages[1].content;
    expect(contexto).toContain('Sin oportunidad registrada todavía.');
    expect(contexto).toContain('(sin mensajes todavía)');
  });

  test('si OpenAI falla, devuelve un mensaje honesto en vez de tronar', async () => {
    mockObtenerHistorial.mockResolvedValue([]);
    const supabase = crearMockSupabase(
      { data: { nombre: 'Cliente X' }, error: null },
      { data: [], error: null },
      { data: null, error: null },
    );
    mockCreate.mockRejectedValue(new Error('timeout'));

    const respuesta = await responderSobreCliente(supabase, COMPANY_A, 22, '¿qué prioridad tiene?');
    expect(respuesta).toBe('No pude generar una respuesta en este momento — intenta de nuevo en unos segundos.');
  });
});
