'use strict';

const mockEjecutarTool = jest.fn();

jest.mock('../modules/operador-tools', () => ({
  ejecutarTool: (...args) => mockEjecutarTool(...args),
  CATALOGO_TOOLS: [{ type: 'function', function: { name: 'tareas_abiertas', parameters: {} } }],
}));

const { preguntar, MAX_ITERACIONES_TOOLS } = require('../modules/operador-engine');

function respuestaTextoDirecta(texto, tokens = 100) {
  return {
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: texto, tool_calls: undefined } }],
    usage: { total_tokens: tokens },
  };
}

function respuestaConToolCall(nombreTool, args, id = 'call_1') {
  return {
    choices: [{
      finish_reason: 'tool_calls',
      message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: nombreTool, arguments: JSON.stringify(args) } }] },
    }],
    usage: { total_tokens: 50 },
  };
}

const ALCANCE_EMPRESA = { nivel: 'empresa', company_id: 'company-1' };

describe('operador-engine', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('preguntar()', () => {
    test('sin tool calls: regresa la respuesta directa del modelo', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaTextoDirecta('No hay tareas pendientes.')) } } };

      const resultado = await preguntar({ supabase: {}, openaiClient, pregunta: '¿Qué tareas hay?', alcance: ALCANCE_EMPRESA });

      expect(resultado.respuesta_texto).toBe('No hay tareas pendientes.');
      expect(resultado.iteraciones).toBe(1);
      expect(resultado.tools_usadas).toEqual([]);
      expect(mockEjecutarTool).not.toHaveBeenCalled();
    });

    test('con un tool call: ejecuta la tool con el alcance dado y produce una segunda llamada al modelo', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn() } } };
      openaiClient.chat.completions.create
        .mockResolvedValueOnce(respuestaConToolCall('tareas_abiertas', { limite: 5 }))
        .mockResolvedValueOnce(respuestaTextoDirecta('Tienes 3 tareas abiertas.'));
      mockEjecutarTool.mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 't3' }]);

      const resultado = await preguntar({ supabase: { marcador: true }, openaiClient, pregunta: '¿Qué tareas hay?', alcance: ALCANCE_EMPRESA });

      expect(mockEjecutarTool).toHaveBeenCalledWith('tareas_abiertas', { limite: 5 }, { marcador: true }, ALCANCE_EMPRESA);
      expect(resultado.respuesta_texto).toBe('Tienes 3 tareas abiertas.');
      expect(resultado.tools_usadas).toEqual(['tareas_abiertas']);
      expect(resultado.iteraciones).toBe(2);
      expect(openaiClient.chat.completions.create).toHaveBeenCalledTimes(2);
    });

    test('el resultado de la tool se inyecta como mensaje role:"tool" en la siguiente llamada', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn() } } };
      openaiClient.chat.completions.create
        .mockResolvedValueOnce(respuestaConToolCall('tareas_abiertas', {}, 'call_abc'))
        .mockResolvedValueOnce(respuestaTextoDirecta('listo'));
      mockEjecutarTool.mockResolvedValue([{ id: 'x' }]);

      await preguntar({ supabase: {}, openaiClient, pregunta: 'hola', alcance: ALCANCE_EMPRESA });

      const segundaLlamada = openaiClient.chat.completions.create.mock.calls[1][0];
      const mensajeTool = segundaLlamada.messages.find(m => m.role === 'tool');
      expect(mensajeTool).toBeDefined();
      expect(mensajeTool.tool_call_id).toBe('call_abc');
      expect(JSON.parse(mensajeTool.content)).toEqual([{ id: 'x' }]);
    });

    test('tope de iteraciones: nunca hace más de MAX_ITERACIONES_TOOLS llamadas', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaConToolCall('tareas_abiertas', {})) } } };
      mockEjecutarTool.mockResolvedValue([]);

      const resultado = await preguntar({ supabase: {}, openaiClient, pregunta: 'pregunta compleja', alcance: ALCANCE_EMPRESA });

      expect(openaiClient.chat.completions.create).toHaveBeenCalledTimes(MAX_ITERACIONES_TOOLS);
      expect(resultado.respuesta_texto).toMatch(/demasiados pasos/i);
      expect(resultado.iteraciones).toBe(MAX_ITERACIONES_TOOLS);
    });

    test('si ejecutarTool lanza, el error se inyecta como resultado de la tool y no interrumpe el flujo', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn() } } };
      openaiClient.chat.completions.create
        .mockResolvedValueOnce(respuestaConToolCall('tareas_abiertas', {}))
        .mockResolvedValueOnce(respuestaTextoDirecta('no pude consultar eso'));
      mockEjecutarTool.mockRejectedValue(new Error('tool desconocida'));

      const resultado = await preguntar({ supabase: {}, openaiClient, pregunta: 'x', alcance: ALCANCE_EMPRESA });

      expect(resultado.respuesta_texto).toBe('no pude consultar eso');
      const segundaLlamada = openaiClient.chat.completions.create.mock.calls[1][0];
      const mensajeTool = segundaLlamada.messages.find(m => m.role === 'tool');
      expect(JSON.parse(mensajeTool.content)).toEqual({ error: 'tool desconocida' });
    });

    test('si el cliente OpenAI lanza, regresa una respuesta de emergencia sin lanzar', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn().mockRejectedValue(new Error('rate limit')) } } };
      const resultado = await preguntar({ supabase: {}, openaiClient, pregunta: 'x', alcance: ALCANCE_EMPRESA });
      expect(resultado.respuesta_texto).toMatch(/problema técnico/i);
      expect(resultado.error).toBe('rate limit');
    });

    test('lanza si no se provee alcance — nunca corre sin alcance definido', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn() } } };
      await expect(preguntar({ supabase: {}, openaiClient, pregunta: 'x', alcance: null }))
        .rejects.toThrow(/alcance requerido/);
      expect(openaiClient.chat.completions.create).not.toHaveBeenCalled();
    });

    test('el alcance se pasa intacto a ejecutarTool incluso en la organizacion/plataforma', async () => {
      const openaiClient = { chat: { completions: { create: jest.fn() } } };
      openaiClient.chat.completions.create
        .mockResolvedValueOnce(respuestaConToolCall('tareas_abiertas', {}))
        .mockResolvedValueOnce(respuestaTextoDirecta('ok'));
      mockEjecutarTool.mockResolvedValue([]);

      const alcancePlataforma = { nivel: 'plataforma' };
      await preguntar({ supabase: {}, openaiClient, pregunta: 'x', alcance: alcancePlataforma });

      expect(mockEjecutarTool).toHaveBeenCalledWith('tareas_abiertas', {}, {}, alcancePlataforma);
    });
  });
});
