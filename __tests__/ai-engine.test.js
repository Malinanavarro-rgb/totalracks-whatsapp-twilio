/**
 * TARA Matrix™ — Tests: AI Provider Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - Contrato de la interfaz AIProvider
 *   - OpenAIProvider: procesar(), calcularCosto(), parseo de respuestas
 *   - MockProvider: comportamiento normal, detección de intención, fallo forzado
 *   - AIEngine: registro, selección, cadena de fallbacks
 */

'use strict';

const { AIProvider, FALLBACK_OUTPUT } = require('../adapters/ai/ai-provider');
const { OpenAIProvider, CLASIFICACIONES_VALIDAS } = require('../adapters/ai/openai-provider');
const { MockProvider }                = require('../adapters/ai/mock-provider');
const { AIEngine }                    = require('../modules/ai-engine');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAIInput(overrides = {}) {
  return {
    system_prompt:  'Eres TARA, un asistente comercial. Responde en JSON.',
    memoria_corta:  [],
    mensaje_actual: 'Hola, ¿cuánto cuesta el rack selectivo?',
    temperatura:    0.6,
    max_tokens:     700,
    modelo:         'gpt-4o-mini',
    ...overrides,
  };
}

function makeOpenAIResponse(content, overrides = {}) {
  return {
    choices: [{
      message: { content },
    }],
    usage: {
      prompt_tokens:     500,
      completion_tokens: 100,
    },
    model: 'gpt-4o-mini',
    ...overrides,
  };
}

const VALID_JSON_RESPONSE = JSON.stringify({
  respuesta_tara:      'Con gusto te ayudo con una cotización.',
  clasificacion_contexto: 'prospecto',
  categoria_principal: 'Rack Selectivo',
  datos_extraidos:     { tipo: 'selectivo' },
  intenciones:         ['solicitud_cotizacion', 'interes_compra'],
  sentimiento:         'Muy interesado',
  etapa_sugerida:      'Calificacion',
  acciones_propuestas: [{ tipo: 'crear_oportunidad', parametros: {} }],
});

const AI_OUTPUT_FIELDS = [
  'respuesta_texto', 'clasificacion_contexto', 'categoria_principal', 'datos_extraidos',
  'intenciones', 'sentimiento', 'etapa_sugerida', 'acciones_propuestas',
  'confianza', 'tokens_entrada', 'tokens_salida',
  'modelo_utilizado', 'proveedor_utilizado', 'latencia_ms',
];

// ═════════════════════════════════════════════════════════════════════════════
// INTERFAZ BASE — AIProvider
// ═════════════════════════════════════════════════════════════════════════════

describe('AIProvider — contrato de interfaz', () => {
  let base;
  beforeEach(() => { base = new AIProvider(); });

  test('nombre lanza error si no está implementado', () => {
    expect(() => base.nombre).toThrow('debe implementar nombre');
  });

  test('modelos lanza error si no está implementado', () => {
    expect(() => base.modelos).toThrow('debe implementar modelos');
  });

  test('procesar() lanza error si no está implementado', async () => {
    await expect(base.procesar({})).rejects.toThrow('debe implementar procesar()');
  });

  test('calcularCosto() lanza error si no está implementado', () => {
    expect(() => base.calcularCosto(0, 0, 'gpt-4o-mini')).toThrow('debe implementar calcularCosto()');
  });

  test('FALLBACK_OUTPUT tiene todos los campos requeridos', () => {
    for (const campo of AI_OUTPUT_FIELDS) {
      expect(FALLBACK_OUTPUT).toHaveProperty(campo);
    }
  });

  test('FALLBACK_OUTPUT.confianza es 0', () => {
    expect(FALLBACK_OUTPUT.confianza).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OPENAI PROVIDER
// ═════════════════════════════════════════════════════════════════════════════

describe('OpenAIProvider', () => {
  let mockCreate;
  let mockClient;
  let provider;

  beforeEach(() => {
    mockCreate = jest.fn();
    mockClient = { chat: { completions: { create: mockCreate } } };
    provider   = new OpenAIProvider(mockClient);
  });

  // ── Identidad ───────────────────────────────────────────────────────────────
  describe('nombre y modelos', () => {
    test('nombre es "openai"', () => {
      expect(provider.nombre).toBe('openai');
    });

    test('modelos incluye gpt-4o-mini y gpt-4o', () => {
      expect(provider.modelos).toContain('gpt-4o-mini');
      expect(provider.modelos).toContain('gpt-4o');
    });

    test('modelos es un array de strings', () => {
      expect(Array.isArray(provider.modelos)).toBe(true);
      for (const m of provider.modelos) expect(typeof m).toBe('string');
    });
  });

  // ── procesar() ──────────────────────────────────────────────────────────────
  describe('procesar()', () => {
    test('devuelve AIOutput con todos los campos', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());

      for (const campo of AI_OUTPUT_FIELDS) {
        expect(output).toHaveProperty(campo);
      }
    });

    test('mapea respuesta_tara → respuesta_texto (compatibilidad FASE 1)', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());
      expect(output.respuesta_texto).toBe('Con gusto te ayudo con una cotización.');
    });

    test('extrae categoria_principal del JSON del modelo', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());
      expect(output.categoria_principal).toBe('Rack Selectivo');
    });

    test('extrae clasificacion_contexto del JSON del modelo cuando es válida', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());
      expect(output.clasificacion_contexto).toBe('prospecto');
    });

    test('clasificacion_contexto ausente se normaliza a "contexto_insuficiente", nunca a "prospecto" por defecto', async () => {
      const sinClasificacion = JSON.stringify({ respuesta_texto: 'Ok', categoria_principal: 'General' });
      mockCreate.mockResolvedValue(makeOpenAIResponse(sinClasificacion));
      const output = await provider.procesar(makeAIInput());
      expect(output.clasificacion_contexto).toBe('contexto_insuficiente');
    });

    test('clasificacion_contexto fuera de catálogo se normaliza a "contexto_insuficiente"', async () => {
      const invalida = JSON.stringify({ respuesta_texto: 'Ok', clasificacion_contexto: 'valor_inventado' });
      mockCreate.mockResolvedValue(makeOpenAIResponse(invalida));
      const output = await provider.procesar(makeAIInput());
      expect(output.clasificacion_contexto).toBe('contexto_insuficiente');
    });

    test('acepta cada una de las 8 categorías válidas del catálogo', async () => {
      for (const categoria of CLASIFICACIONES_VALIDAS) {
        mockCreate.mockResolvedValue(makeOpenAIResponse(JSON.stringify({
          respuesta_texto: 'Ok', clasificacion_contexto: categoria,
        })));
        const output = await provider.procesar(makeAIInput());
        expect(output.clasificacion_contexto).toBe(categoria);
      }
    });

    test('tokens_entrada y tokens_salida vienen de usage', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());
      expect(output.tokens_entrada).toBe(500);
      expect(output.tokens_salida).toBe(100);
    });

    test('proveedor_utilizado es "openai"', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());
      expect(output.proveedor_utilizado).toBe('openai');
    });

    test('latencia_ms es un número mayor a 0', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());
      expect(typeof output.latencia_ms).toBe('number');
      expect(output.latencia_ms).toBeGreaterThanOrEqual(0);
    });

    test('confianza es 0.95 cuando el JSON es perfecto', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const output = await provider.procesar(makeAIInput());
      expect(output.confianza).toBe(0.95);
    });

    test('incluye memoria_corta en los mensajes enviados a OpenAI', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const input = makeAIInput({
        memoria_corta: [
          { mensaje_cliente: 'Necesito racks', respuesta_tara: '¿Qué tipo?' },
        ],
      });
      await provider.procesar(input);

      const mensajes = mockCreate.mock.calls[0][0].messages;
      expect(mensajes).toHaveLength(4); // system + user + assistant + user actual
      expect(mensajes[1].role).toBe('user');
      expect(mensajes[1].content).toBe('Necesito racks');
      expect(mensajes[2].role).toBe('assistant');
    });

    test('usa response_format json_object', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      await provider.procesar(makeAIInput());

      const args = mockCreate.mock.calls[0][0];
      expect(args.response_format).toEqual({ type: 'json_object' });
    });

    test('maneja JSON embebido en texto (confianza 0.70)', async () => {
      const embebido = `Aquí está mi análisis: ${VALID_JSON_RESPONSE} Espero que ayude.`;
      mockCreate.mockResolvedValue(makeOpenAIResponse(embebido));
      const output = await provider.procesar(makeAIInput());

      expect(output.confianza).toBe(0.70);
      expect(output.respuesta_texto).toBe('Con gusto te ayudo con una cotización.');
    });

    test('maneja texto plano sin JSON (confianza 0.20)', async () => {
      mockCreate.mockResolvedValue(makeOpenAIResponse('Lo siento, no entendí tu solicitud.'));
      const output = await provider.procesar(makeAIInput());

      expect(output.confianza).toBe(0.20);
      expect(output.respuesta_texto).toBe('Lo siento, no entendí tu solicitud.');
    });

    test('usa campo respuesta_texto si el modelo lo devuelve con ese nombre', async () => {
      const conRespuestaTexto = JSON.stringify({
        respuesta_texto:     'Respuesta directa.',
        categoria_principal: 'General',
        intenciones:         ['consulta_general'],
        sentimiento:         'Neutral',
      });
      mockCreate.mockResolvedValue(makeOpenAIResponse(conRespuestaTexto));
      const output = await provider.procesar(makeAIInput());
      expect(output.respuesta_texto).toBe('Respuesta directa.');
    });

    test('defaults seguros para campos opcionales del modelo', async () => {
      const minimalJson = JSON.stringify({ respuesta_tara: 'Ok' });
      mockCreate.mockResolvedValue(makeOpenAIResponse(minimalJson));
      const output = await provider.procesar(makeAIInput());

      expect(output.categoria_principal).toBe('Sin clasificar');
      expect(output.clasificacion_contexto).toBe('contexto_insuficiente');
      expect(output.datos_extraidos).toEqual({});
      expect(output.intenciones).toEqual(['consulta_general']);
      expect(output.sentimiento).toBe('Neutral');
      expect(output.acciones_propuestas).toEqual([]);
    });

    test('propaga error de red de OpenAI', async () => {
      mockCreate.mockRejectedValue(new Error('OpenAI network error'));
      await expect(provider.procesar(makeAIInput())).rejects.toThrow('OpenAI network error');
    });
  });

  // ── calcularCosto() ─────────────────────────────────────────────────────────
  describe('calcularCosto()', () => {
    test('gpt-4o-mini: $0.15 input / $0.60 output por 1M tokens', () => {
      const costo = provider.calcularCosto(1_000_000, 1_000_000, 'gpt-4o-mini');
      expect(costo).toBeCloseTo(0.75, 5);
    });

    test('gpt-4o: $2.50 input / $10.00 output por 1M tokens', () => {
      const costo = provider.calcularCosto(1_000_000, 1_000_000, 'gpt-4o');
      expect(costo).toBeCloseTo(12.50, 5);
    });

    test('modelo desconocido usa precio de gpt-4o-mini', () => {
      const costo = provider.calcularCosto(1_000_000, 0, 'modelo-desconocido');
      expect(costo).toBeCloseTo(0.15, 5);
    });

    test('0 tokens → costo $0', () => {
      expect(provider.calcularCosto(0, 0, 'gpt-4o-mini')).toBe(0);
    });

    test('costo es proporcional a los tokens', () => {
      const costoMitad  = provider.calcularCosto(500_000, 0, 'gpt-4o-mini');
      const costoEntero = provider.calcularCosto(1_000_000, 0, 'gpt-4o-mini');
      expect(costoEntero).toBeCloseTo(costoMitad * 2, 10);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MOCK PROVIDER
// ═════════════════════════════════════════════════════════════════════════════

describe('MockProvider', () => {
  let mock;
  beforeEach(() => { mock = new MockProvider({ latencia_ms: 0 }); });

  test('nombre es "mock"', () => {
    expect(mock.nombre).toBe('mock');
  });

  test('modelos incluye "mock-v1"', () => {
    expect(mock.modelos).toContain('mock-v1');
  });

  test('devuelve AIOutput con todos los campos', async () => {
    const output = await mock.procesar(makeAIInput());
    for (const campo of AI_OUTPUT_FIELDS) {
      expect(output).toHaveProperty(campo);
    }
  });

  test('proveedor_utilizado es "mock"', async () => {
    const output = await mock.procesar(makeAIInput());
    expect(output.proveedor_utilizado).toBe('mock');
  });

  test('costo siempre es 0', () => {
    expect(mock.calcularCosto(999_999, 999_999, 'gpt-4o')).toBe(0);
  });

  test('detecta intención cotizacion cuando el mensaje pide precio', async () => {
    const output = await mock.procesar(makeAIInput({ mensaje_actual: 'cuánto cuesta el rack?' }));
    expect(output.intenciones).toContain('solicitud_cotizacion');
    expect(output.sentimiento).toBe('Muy interesado');
  });

  test('detecta intención agenda cuando el mensaje menciona cita', async () => {
    const output = await mock.procesar(makeAIInput({ mensaje_actual: 'quiero agendar una visita' }));
    expect(output.intenciones).toContain('seguimiento');
  });

  test('detecta sentimiento negativo', async () => {
    const output = await mock.procesar(makeAIInput({ mensaje_actual: 'no me interesa, muy caro' }));
    expect(output.sentimiento).toBe('Negativo');
  });

  test('defaultea a intención consulta para mensajes genéricos', async () => {
    const output = await mock.procesar(makeAIInput({ mensaje_actual: 'Hola' }));
    expect(output.intenciones).toContain('consulta_general');
  });

  test('shouldFail: lanza error cuando se configura', async () => {
    const failMock = new MockProvider({ shouldFail: true });
    await expect(failMock.procesar(makeAIInput())).rejects.toThrow('fallo forzado');
  });

  test('acciones_propuestas incluye crear_oportunidad para mensajes de cotizacion', async () => {
    const output = await mock.procesar(makeAIInput({ mensaje_actual: 'necesito cotizacion de racks' }));
    expect(output.acciones_propuestas).toContainEqual(
      expect.objectContaining({ tipo: 'crear_oportunidad' })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AI ENGINE
// ═════════════════════════════════════════════════════════════════════════════

describe('AIEngine', () => {
  let mockProvider;
  let engine;

  beforeEach(() => {
    mockProvider = new MockProvider({ latencia_ms: 0 });
    engine       = new AIEngine(mockProvider);
  });

  // ── Constructor ─────────────────────────────────────────────────────────────
  describe('constructor', () => {
    test('lanza error si no se provee MockProvider', () => {
      expect(() => new AIEngine()).toThrow('requiere un MockProvider');
      expect(() => new AIEngine(null)).toThrow('requiere un MockProvider');
    });

    test('inicializa con el mock registrado', () => {
      const proveedores = engine.listarProveedores();
      expect(proveedores.some(p => p.proveedor === 'mock')).toBe(true);
    });
  });

  // ── registerProvider ────────────────────────────────────────────────────────
  describe('registerProvider()', () => {
    test('primer proveedor real se convierte en fallback global', () => {
      const openai = new OpenAIProvider({ chat: { completions: { create: jest.fn() } } });
      engine.registerProvider(openai);

      const lista = engine.listarProveedores();
      const openaiEntry = lista.find(p => p.proveedor === 'openai');
      expect(openaiEntry.es_fallback).toBe(true);
    });

    test('segundo proveedor real no reemplaza el fallback', () => {
      const openai1 = new OpenAIProvider({ chat: { completions: { create: jest.fn() } } });
      const openai2 = new OpenAIProvider({ chat: { completions: { create: jest.fn() } } });
      engine.registerProvider(openai1);
      engine.registerProvider(openai2);

      // Debe haber solo un fallback
      const lista = engine.listarProveedores();
      expect(lista.filter(p => p.es_fallback).length).toBe(1);
    });
  });

  // ── resolverProveedor ───────────────────────────────────────────────────────
  describe('resolverProveedor()', () => {
    test('devuelve mock para modelo "mock-v1"', () => {
      const proveedor = engine.resolverProveedor('mock-v1');
      expect(proveedor.nombre).toBe('mock');
    });

    test('devuelve fallback para modelo desconocido cuando hay fallback', () => {
      const openai = new OpenAIProvider({ chat: { completions: { create: jest.fn() } } });
      engine.registerProvider(openai);

      const proveedor = engine.resolverProveedor('modelo-que-no-existe');
      expect(proveedor.nombre).toBe('openai');
    });

    test('devuelve mock para modelo desconocido si no hay fallback', () => {
      const proveedor = engine.resolverProveedor('modelo-que-no-existe');
      expect(proveedor.nombre).toBe('mock');
    });

    test('devuelve el proveedor correcto para gpt-4o-mini cuando está registrado', () => {
      const mockCreate = jest.fn().mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const openai = new OpenAIProvider({ chat: { completions: { create: mockCreate } } });
      engine.registerProvider(openai);

      const proveedor = engine.resolverProveedor('gpt-4o-mini');
      expect(proveedor.nombre).toBe('openai');
    });
  });

  // ── procesar() — camino feliz ───────────────────────────────────────────────
  describe('procesar() — camino feliz', () => {
    test('usa mock cuando el modelo es mock-v1', async () => {
      const output = await engine.procesar(makeAIInput({ modelo: 'mock-v1' }));
      expect(output.proveedor_utilizado).toBe('mock');
    });

    test('usa OpenAI cuando el modelo es gpt-4o-mini y está registrado', async () => {
      const mockCreate = jest.fn().mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const openai = new OpenAIProvider({ chat: { completions: { create: mockCreate } } });
      engine.registerProvider(openai);

      const output = await engine.procesar(makeAIInput({ modelo: 'gpt-4o-mini' }));
      expect(output.proveedor_utilizado).toBe('openai');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    test('devuelve AIOutput con todos los campos', async () => {
      const output = await engine.procesar(makeAIInput({ modelo: 'mock-v1' }));
      for (const campo of AI_OUTPUT_FIELDS) {
        expect(output).toHaveProperty(campo);
      }
    });
  });

  // ── procesar() — cadena de fallbacks ────────────────────────────────────────
  describe('procesar() — cadena de fallbacks', () => {
    test('fallback a mock cuando proveedor primario falla', async () => {
      const mockCreate = jest.fn().mockRejectedValue(new Error('Error de red'));
      const openai = new OpenAIProvider({ chat: { completions: { create: mockCreate } } });
      engine.registerProvider(openai);

      const output = await engine.procesar(makeAIInput({ modelo: 'gpt-4o-mini' }));
      // Debe responder desde el mock (proveedor de emergencia)
      expect(output.proveedor_utilizado).toBe('mock');
      expect(output.respuesta_texto).toBeDefined();
      expect(output.respuesta_texto.length).toBeGreaterThan(0);
    });

    test('devuelve FALLBACK_OUTPUT cuando mock también falla', async () => {
      const failMock = new MockProvider({ shouldFail: true, latencia_ms: 0 });
      const engineConFallo = new AIEngine(failMock);

      const output = await engineConFallo.procesar(makeAIInput({ modelo: 'mock-v1' }));
      expect(output.confianza).toBe(0);
      expect(output.proveedor_utilizado).toBe('none');
      expect(output.respuesta_texto).toContain('momento técnico');
    });

    test('no crashea cuando todos los proveedores fallan', async () => {
      const failMock = new MockProvider({ shouldFail: true, latencia_ms: 0 });
      const engineConFallo = new AIEngine(failMock);

      await expect(
        engineConFallo.procesar(makeAIInput({ modelo: 'mock-v1' }))
      ).resolves.toBeDefined();
    });
  });

  // ── listarProveedores ───────────────────────────────────────────────────────
  describe('listarProveedores()', () => {
    test('devuelve array', () => {
      expect(Array.isArray(engine.listarProveedores())).toBe(true);
    });

    test('cada entrada tiene proveedor, modelos y es_fallback', () => {
      const lista = engine.listarProveedores();
      for (const entrada of lista) {
        expect(entrada).toHaveProperty('proveedor');
        expect(entrada).toHaveProperty('modelos');
        expect(entrada).toHaveProperty('es_fallback');
      }
    });

    test('no duplica proveedores aunque tengan múltiples modelos', () => {
      const mockCreate = jest.fn().mockResolvedValue(makeOpenAIResponse(VALID_JSON_RESPONSE));
      const openai = new OpenAIProvider({ chat: { completions: { create: mockCreate } } });
      engine.registerProvider(openai);

      const lista = engine.listarProveedores();
      const nombres = lista.map(p => p.proveedor);
      expect(new Set(nombres).size).toBe(nombres.length);
    });
  });
});
