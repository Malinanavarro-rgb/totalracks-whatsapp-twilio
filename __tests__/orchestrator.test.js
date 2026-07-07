/**
 * TARA Matrix™ — Orchestrator Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   1. Constructor — validación de dependencias
 *   2. procesarMensaje() — flujo completo con mocks
 *   3. Manejo de errores — cada paso puede fallar de forma segura
 *   4. Métricas de latencia — timings incluidos en el resultado
 *   5. Auditoría — AuditLogger recibe los eventos correctos
 *   6. Integración real — ContextBuilder + PromptBuilder + AIEngine(Mock)
 */

'use strict';

const { Orchestrator, RESPUESTA_EMERGENCIA } = require('../modules/orchestrator');
const { ContextBuilder }  = require('../modules/context-builder');
const { PromptBuilder }   = require('../modules/prompt-builder');
const { AIEngine }        = require('../modules/ai-engine');
const { MockProvider }    = require('../adapters/ai/mock-provider');

// ═════════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═════════════════════════════════════════════════════════════════════════════

function makeEmpresaRaw() {
  return {
    company: {
      id:          'company-uuid-001',
      nombre:      'Total Racks',
      descripcion: 'Empresa especializada en sistemas de almacenamiento industrial.',
      slug:        'total-racks',
      estado:      'activo',
    },
    personality: {
      nombre_asistente:    'TARA',
      cargo:              'Especialista en almacenamiento',
      tono:               'profesional y directo',
      objetivo:           'Agendar visita técnica o generar cotización formal.',
      modelo:             'gpt-4o-mini',
      temperatura:        0.6,
      max_tokens:         700,
      skills:             [{ nombre: 'cotizar', activo: true }, { nombre: 'agendar_visita', activo: true }],
      campos_requeridos:  ['nombre', 'empresa', 'ciudad'],
      reglas:             [{ texto: 'Máximo 2 preguntas por respuesta', etapas: [] }],
      max_turnos_memoria: 6,
      kb_max_secciones:   3,
    },
    knowledge: [
      { categoria: 'PRODUCTOS', contenido: 'Rack Selectivo: hasta 1,500 kg por nivel.' },
      { categoria: 'PRECIOS',   contenido: 'Precio base: $45,000 MXN más IVA.' },
    ],
  };
}

function makeCliente() {
  return {
    id:            42,
    telefono:      '+5218112345678',
    nombre:        'Carlos López',
    ciudad:        'Monterrey',
    fuente:        'WhatsApp',
    estado:        'Calificacion',
    score_interes: 45,
  };
}

function makeHistorial() {
  return [
    { mensaje_cliente: '¿Tienen racks selectivos?', respuesta_tara: 'Sí, disponemos de Rack Selectivo con capacidad de 1,500 kg por nivel.' },
  ];
}

function makeMessage(overrides = {}) {
  return {
    id:                'msg-uuid-001',
    company_id:        'company-uuid-001', // coincide con el mock de obtenerConfigEmpresa
    channel:           'whatsapp',
    from:              '+5218112345678',
    incoming_endpoint: 'whatsapp:+14155238886',
    content:           '¿Cuánto cuesta el rack selectivo?',
    timestamp:         new Date('2026-06-28T10:00:00Z'),
    raw_metadata:      { MessageSid: 'SM_test123', NumMedia: '0' },
    ...overrides,
  };
}

/** Crea un AuditLogger mock que captura todas las llamadas. */
function makeAuditLogger() {
  return {
    log:              jest.fn(),
    logAICall:        jest.fn(),
    logDecision:      jest.fn(),
    logAccion:        jest.fn(),
    logChannelEvent:  jest.fn(),
    logWorkflow:      jest.fn(),
    logError:         jest.fn(),
    flush:            jest.fn().mockResolvedValue(undefined),
    getBufferSize:    jest.fn().mockReturnValue(0),
  };
}

/** Crea todas las dependencias FASE 1 como mocks satisfechos. */
function makeDeps(overrides = {}) {
  const auditLogger = makeAuditLogger();

  return {
    contextBuilder:       new ContextBuilder(),
    promptBuilder:        new PromptBuilder(),
    aiEngine:             makeMockAIEngine(),
    auditLogger,

    obtenerConfigEmpresa: jest.fn().mockResolvedValue(makeEmpresaRaw()),
    obtenerOCrearCliente: jest.fn().mockResolvedValue(makeCliente()),
    obtenerHistorial:     jest.fn().mockResolvedValue(makeHistorial()),
    guardarConversacion:  jest.fn().mockResolvedValue(undefined),
    crearOportunidad:     jest.fn().mockResolvedValue(undefined),
    actualizarScore:      jest.fn().mockResolvedValue(undefined),

    ...overrides,
  };
}

/** Crea un AIEngine con MockProvider — nunca lanza, siempre responde. */
function makeMockAIEngine() {
  const mock   = new MockProvider({ latencia_ms: 5 });
  const engine = new AIEngine(mock);
  return engine;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. CONSTRUCTOR
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — constructor', () => {
  it('crea correctamente con todas las deps inyectadas', () => {
    const deps = makeDeps();
    expect(() => new Orchestrator(deps)).not.toThrow();
  });

  const requeridos = [
    'contextBuilder', 'promptBuilder', 'aiEngine', 'auditLogger',
    'obtenerConfigEmpresa', 'obtenerOCrearCliente',
    'obtenerHistorial', 'guardarConversacion',
  ];

  it.each(requeridos)('lanza si falta "%s"', (campo) => {
    const deps = makeDeps();
    delete deps[campo];
    expect(() => new Orchestrator(deps)).toThrow(`dependencia requerida faltante — "${campo}"`);
  });

  it('acepta deps opcionales (crearOportunidad, actualizarScore) sin lanzar', () => {
    const deps = makeDeps();
    delete deps.crearOportunidad;
    delete deps.actualizarScore;
    expect(() => new Orchestrator(deps)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CAMINO FELIZ
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — camino feliz', () => {
  let orchestrator;
  let deps;
  let resultado;

  beforeEach(async () => {
    deps         = makeDeps();
    orchestrator = new Orchestrator(deps);
    resultado    = await orchestrator.procesarMensaje(makeMessage());
  });

  it('retorna respuesta_texto no vacía', () => {
    expect(typeof resultado.respuesta_texto).toBe('string');
    expect(resultado.respuesta_texto.length).toBeGreaterThan(0);
  });

  it('retorna session_id con formato UUID', () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(resultado.session_id).toMatch(uuidRe);
  });

  it('retorna ai_output con campos canónicos', () => {
    expect(resultado.ai_output).toMatchObject({
      respuesta_texto:     expect.any(String),
      categoria_principal: expect.any(String),
      intenciones:         expect.any(Array),
      sentimiento:         expect.any(String),
      confianza:           expect.any(Number),
    });
  });

  it('retorna timings con total_ms', () => {
    expect(resultado.timings).toBeDefined();
    expect(typeof resultado.timings.total_ms).toBe('number');
    expect(resultado.timings.total_ms).toBeGreaterThanOrEqual(0);
  });

  it('llama a obtenerConfigEmpresa exactamente una vez', () => {
    expect(deps.obtenerConfigEmpresa).toHaveBeenCalledTimes(1);
  });

  it('llama a obtenerOCrearCliente con el número del mensaje', () => {
    expect(deps.obtenerOCrearCliente).toHaveBeenCalledWith('+5218112345678', 'company-uuid-001');
  });

  it('llama a obtenerHistorial con el id del cliente', () => {
    expect(deps.obtenerHistorial).toHaveBeenCalledWith(42);
  });

  it('llama a guardarConversacion con los datos del turno', () => {
    expect(deps.guardarConversacion).toHaveBeenCalledWith(
      42,                                  // cliente.id
      'company-uuid-001',                  // company_id del mensaje
      '¿Cuánto cuesta el rack selectivo?', // mensaje
      expect.any(String),                // respuesta del AI
      expect.any(String),                // categoria_principal
      expect.any(Array),                 // intenciones
      expect.any(String),                // sentimiento
    );
  });

  it('llama a auditLogger.logChannelEvent (mensaje recibido)', () => {
    const calls = deps.auditLogger.logChannelEvent.mock.calls;
    const recibidos = calls.filter(([, tipo]) => tipo === 'mensaje_recibido');
    expect(recibidos.length).toBeGreaterThanOrEqual(1);
  });

  it('llama a auditLogger.logChannelEvent (mensaje enviado)', () => {
    const calls = deps.auditLogger.logChannelEvent.mock.calls;
    const enviados = calls.filter(([, tipo]) => tipo === 'mensaje_enviado');
    expect(enviados.length).toBeGreaterThanOrEqual(1);
  });

  it('llama a auditLogger.logAICall exactamente una vez', () => {
    expect(deps.auditLogger.logAICall).toHaveBeenCalledTimes(1);
  });

  it('los session_ids son únicos entre llamadas', async () => {
    const r2 = await orchestrator.procesarMensaje(makeMessage());
    expect(resultado.session_id).not.toBe(r2.session_id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. TIMINGS POR MÓDULO
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — timings', () => {
  it('incluye timing de cada paso del flujo', async () => {
    const deps = makeDeps();
    const orch = new Orchestrator(deps);
    const { timings } = await orch.procesarMensaje(makeMessage());

    const pasos = ['config_ms', 'crm_ms', 'historial_ms', 'context_ms', 'prompt_ms', 'ai_ms', 'total_ms'];
    for (const paso of pasos) {
      expect(timings).toHaveProperty(paso);
      expect(typeof timings[paso]).toBe('number');
      expect(timings[paso]).toBeGreaterThanOrEqual(0);
    }
  });

  it('total_ms >= suma de pasos principales', async () => {
    const deps = makeDeps();
    const orch = new Orchestrator(deps);
    const { timings } = await orch.procesarMensaje(makeMessage());

    const suma = (timings.config_ms || 0)
      + (timings.crm_ms     || 0)
      + (timings.historial_ms || 0)
      + (timings.context_ms  || 0)
      + (timings.prompt_ms   || 0)
      + (timings.ai_ms       || 0);

    expect(timings.total_ms).toBeGreaterThanOrEqual(suma);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. MANEJO DE ERRORES
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — errores y fallbacks', () => {

  describe('fallo de obtenerConfigEmpresa', () => {
    it('retorna respuesta de emergencia sin lanzar', async () => {
      const deps = makeDeps({
        obtenerConfigEmpresa: jest.fn().mockRejectedValue(new Error('Supabase no disponible')),
      });
      const orch = new Orchestrator(deps);
      const resultado = await orch.procesarMensaje(makeMessage());

      expect(resultado.respuesta_texto).toBe(RESPUESTA_EMERGENCIA);
      expect(resultado.ai_output).toBeNull();
      expect(resultado.session_id).toBeTruthy();
    });

    it('incluye timings parciales en la respuesta de emergencia', async () => {
      const deps = makeDeps({
        obtenerConfigEmpresa: jest.fn().mockRejectedValue(new Error('timeout')),
      });
      const orch = new Orchestrator(deps);
      const { timings } = await orch.procesarMensaje(makeMessage());

      expect(timings.config_ms).toBeGreaterThanOrEqual(0);
      expect(timings.total_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('fallo de obtenerOCrearCliente', () => {
    let resultado;
    let deps;

    beforeEach(async () => {
      deps = makeDeps({
        obtenerOCrearCliente: jest.fn().mockRejectedValue(new Error('CRM no disponible')),
      });
      const orch = new Orchestrator(deps);
      resultado = await orch.procesarMensaje(makeMessage());
    });

    it('continúa el flujo y retorna respuesta válida', () => {
      expect(typeof resultado.respuesta_texto).toBe('string');
      expect(resultado.respuesta_texto.length).toBeGreaterThan(0);
    });

    it('no llama a guardarConversacion (sin id de cliente)', () => {
      expect(deps.guardarConversacion).not.toHaveBeenCalled();
    });

    it('registra el error en auditLogger', () => {
      expect(deps.auditLogger.logError).toHaveBeenCalledWith(
        expect.objectContaining({ company_id: 'company-uuid-001' }),
        'crm.obtenerCliente',
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe('fallo de obtenerHistorial', () => {
    it('continúa con historial vacío y retorna respuesta válida', async () => {
      const deps = makeDeps({
        obtenerHistorial: jest.fn().mockRejectedValue(new Error('timeout en historial')),
      });
      const orch = new Orchestrator(deps);
      const resultado = await orch.procesarMensaje(makeMessage());

      expect(resultado.respuesta_texto).not.toBe(RESPUESTA_EMERGENCIA);
      expect(deps.auditLogger.logError).toHaveBeenCalled();
    });
  });

  describe('fallo de ContextBuilder', () => {
    it('retorna respuesta de emergencia', async () => {
      const ctxBroken = {
        construir:    jest.fn().mockImplementation(() => { throw new Error('campo requerido faltante'); }),
        prepararParaIA: jest.fn(),
      };
      const deps = makeDeps({ contextBuilder: ctxBroken });
      const orch = new Orchestrator(deps);
      const resultado = await orch.procesarMensaje(makeMessage());

      expect(resultado.respuesta_texto).toBe(RESPUESTA_EMERGENCIA);
      expect(deps.auditLogger.logError).toHaveBeenCalledWith(
        expect.any(Object),
        'context-builder',
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe('fallo de PromptBuilder', () => {
    it('retorna respuesta de emergencia', async () => {
      const promptBroken = {
        construir: jest.fn().mockImplementation(() => { throw new Error('prompt vacío'); }),
      };
      const deps = makeDeps({ promptBuilder: promptBroken });
      const orch = new Orchestrator(deps);
      const resultado = await orch.procesarMensaje(makeMessage());

      expect(resultado.respuesta_texto).toBe(RESPUESTA_EMERGENCIA);
      expect(deps.auditLogger.logError).toHaveBeenCalledWith(
        expect.any(Object),
        'prompt-builder',
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe('fallo de guardarConversacion', () => {
    it('no bloquea la respuesta al cliente', async () => {
      const deps = makeDeps({
        guardarConversacion: jest.fn().mockRejectedValue(new Error('CRM write timeout')),
      });
      const orch = new Orchestrator(deps);
      const resultado = await orch.procesarMensaje(makeMessage());

      expect(resultado.respuesta_texto).not.toBe(RESPUESTA_EMERGENCIA);
      expect(resultado.ai_output).not.toBeNull();
    });

    it('registra el error en auditLogger', async () => {
      const deps = makeDeps({
        guardarConversacion: jest.fn().mockRejectedValue(new Error('CRM write timeout')),
      });
      const orch = new Orchestrator(deps);
      await orch.procesarMensaje(makeMessage());

      expect(deps.auditLogger.logError).toHaveBeenCalledWith(
        expect.any(Object),
        'crm.guardarConversacion',
        expect.any(Error),
        expect.any(Object),
      );
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. MAPEADORES INTERNOS
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — mapeadores', () => {
  let orch;

  beforeEach(() => {
    orch = new Orchestrator(makeDeps());
  });

  describe('_mapearEmpresaConfig()', () => {
    it('mapea company_id correctamente', () => {
      const { company_id } = orch._mapearEmpresaConfig(makeEmpresaRaw());
      expect(company_id).toBe('company-uuid-001');
    });

    it('construye knowledge_base con categorías en mayúsculas', () => {
      const { knowledge_base } = orch._mapearEmpresaConfig(makeEmpresaRaw());
      expect(knowledge_base).toContain('[PRODUCTOS]');
      expect(knowledge_base).toContain('[PRECIOS]');
    });

    it('usa defaults si personality es null', () => {
      const raw = { ...makeEmpresaRaw(), personality: null };
      const conf = orch._mapearEmpresaConfig(raw);
      expect(conf.modelo).toBe('gpt-4o-mini');
      expect(conf.temperatura).toBe(0.6);
      expect(conf.idioma).toBe('es');
    });

    it('usa defaults si knowledge es array vacío', () => {
      const raw = { ...makeEmpresaRaw(), knowledge: [] };
      const { knowledge_base } = orch._mapearEmpresaConfig(raw);
      expect(knowledge_base).toBe('');
    });
  });

  describe('_mapearPersonalidad()', () => {
    it('incluye nombre, cargo y empresa', () => {
      const { personality, company } = makeEmpresaRaw();
      const str = orch._mapearPersonalidad(personality, company);
      expect(str).toContain('TARA');
      expect(str).toContain('Especialista en almacenamiento');
      expect(str).toContain('Total Racks');
    });

    it('incluye restricción de no revelar que es IA', () => {
      const { personality, company } = makeEmpresaRaw();
      const str = orch._mapearPersonalidad(personality, company);
      expect(str.toLowerCase()).toContain('ia');
    });

    it('retorna string vacío si personality es null', () => {
      const { company } = makeEmpresaRaw();
      expect(orch._mapearPersonalidad(null, company)).toBe('');
    });

    it('no contiene términos de negocio específicos', () => {
      const { personality, company } = makeEmpresaRaw();
      const str = orch._mapearPersonalidad(personality, company);
      // No debe mencionar productos/precios/CRM (eso va en bloques del prompt)
      expect(str).not.toContain('Rack Selectivo');
      expect(str).not.toContain('$45,000');
    });
  });

  describe('_mapearDatosCliente()', () => {
    it('retorna null si no hay cliente', () => {
      expect(orch._mapearDatosCliente(null)).toBeNull();
    });

    it('mapea nombre correctamente', () => {
      const datos = orch._mapearDatosCliente(makeCliente());
      expect(datos.nombre).toBe('Carlos López');
    });

    it('retorna nombre=null si cliente.nombre es "Sin nombre"', () => {
      const datos = orch._mapearDatosCliente({ ...makeCliente(), nombre: 'Sin nombre' });
      expect(datos.nombre).toBeNull();
    });

    it('mapea estado → etapa_actual', () => {
      const datos = orch._mapearDatosCliente(makeCliente());
      expect(datos.etapa_actual).toBe('Calificacion');
    });

    it('usa "Nuevo" como default si no hay estado', () => {
      const datos = orch._mapearDatosCliente({ ...makeCliente(), estado: null });
      expect(datos.etapa_actual).toBe('Nuevo');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. INTEGRACIÓN CON MÓDULOS FASE 2 REALES
// ═════════════════════════════════════════════════════════════════════════════

describe('Integración — Orchestrator + FASE 2 (real) + FASE 1 (mock)', () => {
  let orchestrator;
  let deps;

  beforeEach(() => {
    deps = makeDeps();
    orchestrator = new Orchestrator(deps);
  });

  it('completa el flujo de extremo a extremo sin lanzar', async () => {
    await expect(orchestrator.procesarMensaje(makeMessage())).resolves.not.toThrow();
  });

  it('el prompt generado incluye la identidad de TARA', async () => {
    let systemPrompt;
    const promptSpy = jest.spyOn(deps.promptBuilder, 'construir').mockImplementation((ctx) => {
      systemPrompt = deps.promptBuilder.constructor.prototype.construir.call(deps.promptBuilder, ctx);
      return systemPrompt;
    });

    // Restaurar mock y usar la real
    promptSpy.mockRestore();

    const logAISpy = jest.spyOn(deps.auditLogger, 'logAICall');
    await orchestrator.procesarMensaje(makeMessage());

    // El prompt llega al AI Engine como system_content en aiInput
    // Verificamos que el AILogger recibió un input
    expect(logAISpy).toHaveBeenCalled();
    const aiInputUsado = logAISpy.mock.calls[0][1]; // segundo argumento = aiInput
    expect(aiInputUsado.system_prompt).toContain('## IDENTIDAD');
    expect(aiInputUsado.system_prompt).toContain('## FORMATO DE RESPUESTA');
  });

  it('el contexto tiene company_id correcto', async () => {
    const logChannelSpy = jest.spyOn(deps.auditLogger, 'logChannelEvent');
    await orchestrator.procesarMensaje(makeMessage());

    const ctxUsado = logChannelSpy.mock.calls[0][0]; // primer argumento = ctx
    expect(ctxUsado.company_id).toBe('company-uuid-001');
  });

  it('el contexto tiene canal y cliente del mensaje', async () => {
    const logChannelSpy = jest.spyOn(deps.auditLogger, 'logChannelEvent');
    await orchestrator.procesarMensaje(makeMessage());

    const ctxUsado = logChannelSpy.mock.calls[0][0];
    expect(ctxUsado.canal).toBe('whatsapp');
    expect(ctxUsado.cliente.identificador).toBe('+5218112345678');
  });

  it('procesa mensaje sin historial (cliente nuevo)', async () => {
    deps.obtenerHistorial.mockResolvedValue([]);
    const resultado = await orchestrator.procesarMensaje(makeMessage());
    expect(resultado.respuesta_texto.length).toBeGreaterThan(0);
  });

  it('procesa mensaje con historial previo', async () => {
    deps.obtenerHistorial.mockResolvedValue(makeHistorial());
    const resultado = await orchestrator.procesarMensaje(makeMessage());
    expect(resultado.respuesta_texto.length).toBeGreaterThan(0);
  });

  it('respuestas distintas por session son independientes', async () => {
    const r1 = await orchestrator.procesarMensaje(makeMessage({ content: 'Hola' }));
    const r2 = await orchestrator.procesarMensaje(makeMessage({ content: '¿Cuánto cuesta?' }));
    expect(r1.session_id).not.toBe(r2.session_id);
  });

  it('cliente sin nombre recibe contexto válido', async () => {
    deps.obtenerOCrearCliente.mockResolvedValue({ ...makeCliente(), nombre: 'Sin nombre' });
    const resultado = await orchestrator.procesarMensaje(makeMessage());
    expect(resultado.respuesta_texto.length).toBeGreaterThan(0);
  });

  it('knowledge base vacío no rompe el flujo', async () => {
    deps.obtenerConfigEmpresa.mockResolvedValue({ ...makeEmpresaRaw(), knowledge: [] });
    const resultado = await orchestrator.procesarMensaje(makeMessage());
    expect(resultado.respuesta_texto.length).toBeGreaterThan(0);
  });

  it('múltiples procesarMensaje en paralelo no interfieren', async () => {
    const mensajes = [
      makeMessage({ from: '+521111', content: '¿Precio?' }),
      makeMessage({ from: '+522222', content: 'Quiero una cotización' }),
      makeMessage({ from: '+523333', content: 'Disponibilidad' }),
    ];

    const resultados = await Promise.all(mensajes.map(m => orchestrator.procesarMensaje(m)));

    const sessionIds = resultados.map(r => r.session_id);
    const unicos = new Set(sessionIds);
    expect(unicos.size).toBe(3);

    for (const r of resultados) {
      expect(r.respuesta_texto.length).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. STUB DE ACCIONES (FASE 4)
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — acciones propuestas (stub FASE 4)', () => {
  it('llama a crearOportunidad cuando AI propone crear_oportunidad', async () => {
    // Inyectamos un AI Engine mock que propone la acción
    const mockAI = {
      procesar: jest.fn().mockResolvedValue({
        respuesta_texto:     'Perfecto, genero su cotización.',
        categoria_principal: 'Rack Selectivo',
        datos_extraidos:     {},
        intenciones:         ['cotizacion'],
        sentimiento:         'Muy interesado',
        etapa_sugerida:      'Negociacion',
        acciones_propuestas: [{ tipo: 'crear_oportunidad', parametros: {} }],
        confianza:           0.9,
        tokens_entrada:      100,
        tokens_salida:       50,
        modelo_utilizado:    'mock',
        proveedor_utilizado: 'mock',
        latencia_ms:         5,
      }),
    };

    const deps = makeDeps({ aiEngine: mockAI });
    const orch = new Orchestrator(deps);
    await orch.procesarMensaje(makeMessage());

    expect(deps.crearOportunidad).toHaveBeenCalledWith(
      42,                  // cliente.id
      'company-uuid-001',  // company_id del mensaje
      'Rack Selectivo',    // aiOutput.categoria_principal (del mock de AI)
      expect.any(String),  // ctx.mensaje_actual
      expect.any(Array),   // aiOutput.intenciones
    );
  });

  it('no llama a crearOportunidad si acciones_propuestas está vacío', async () => {
    const mockAI = {
      procesar: jest.fn().mockResolvedValue({
        respuesta_texto:     'Aquí tiene la información.',
        categoria_principal: 'Rack Selectivo',
        datos_extraidos:     {},
        intenciones:         ['consulta'],
        sentimiento:         'Neutral',
        etapa_sugerida:      null,
        acciones_propuestas: [],
        confianza:           0.7,
        tokens_entrada:      80,
        tokens_salida:       40,
        modelo_utilizado:    'mock',
        proveedor_utilizado: 'mock',
        latencia_ms:         5,
      }),
    };

    const deps = makeDeps({ aiEngine: mockAI });
    const orch = new Orchestrator(deps);
    await orch.procesarMensaje(makeMessage());

    expect(deps.crearOportunidad).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. WORKFLOW ENGINE — Integración con Orchestrator (FASE 4A)
// ═════════════════════════════════════════════════════════════════════════════

// ── Helpers de integración ────────────────────────────────────────────────────

/** WorkflowEngine mock con todos los métodos en null-safe por defecto. */
function makeWorkflowEngine(overrides = {}) {
  return {
    evaluar:                       jest.fn().mockResolvedValue(null),
    obtenerSesionActiva:           jest.fn().mockResolvedValue(null),
    obtenerNodoActual:             jest.fn().mockResolvedValue(null),
    iniciarSesion:                 jest.fn().mockResolvedValue(null),
    avanzar:                       jest.fn().mockResolvedValue(null),
    abandonar:                     jest.fn().mockResolvedValue(null),
    tieneSesionCompletadaReciente: jest.fn().mockResolvedValue(false),   // Bug #1
    preSalvarDatosExtraidos:       jest.fn().mockResolvedValue(undefined), // Bug #4
    ...overrides,
  };
}

/** AI Engine que devuelve intenciones controladas sin llamar a OpenAI. */
function makeAIConIntenciones(intenciones, respuesta = 'Respuesta de prueba.') {
  return {
    procesar: jest.fn().mockResolvedValue({
      respuesta_texto:     respuesta,
      categoria_principal: 'Test',
      datos_extraidos:     {},
      intenciones,
      sentimiento:         'Neutral',
      etapa_sugerida:      null,
      acciones_propuestas: [],
      confianza:           0.8,
      tokens_entrada:      50,
      tokens_salida:       30,
      modelo_utilizado:    'mock-test',
      proveedor_utilizado: 'mock-test',
      latencia_ms:         0,
    }),
  };
}

const sesionEnProceso = {
  id:              'ses-integracion-01',
  company_id:      'company-uuid-001',
  cliente_id:      42,
  workflow_id:     'wf-test-001',
  current_node:    'empresa',
  status:          'activo',
  captured_fields: { nombre_contacto: 'Luis' },
  total_turnos:    1,
};

const nodoIntermedio = {
  nombre:         'empresa',
  es_inicio:      false,
  es_fin:         false,
  pregunta:       '¿A qué empresa perteneces?',
  campo:          'empresa',
  tipo_campo:     'text',
  es_opcional:    false,
  siguiente_nodo: 'tipo_proyecto',
  modo_respuesta: 'replace_ai',
};

const nodoSiguiente = {
  nombre:   'tipo_proyecto',
  pregunta: '¿Qué tipo de proyecto tienes en mente?',
  es_fin:   false,
  modo_respuesta: 'replace_ai',
};

const nodoInicio = {
  nombre:         'nombre_contacto',
  es_inicio:      true,
  es_fin:         false,
  pregunta:       '¿Cuál es tu nombre?',
  campo:          'nombre_contacto',
  tipo_campo:     'text',
  es_opcional:    false,
  siguiente_nodo: 'empresa',
  modo_respuesta: 'prepend_ai',
};

const workflowDescubrimiento = {
  id:            'wf-test-001',
  nombre:        'Descubrimiento Comercial',
  trigger:       'intent',
  trigger_value: 'solicitud_cotizacion',
  prioridad:     1,
};

// ── Tests de los 4 caminos del WorkflowEngine ─────────────────────────────────

describe('Orchestrator + WorkflowEngine — 4 caminos de _manejarWorkflow', () => {

  test('Caso A: sesión activa + cancelar_flujo → abandona y conserva respuesta AI', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      abandonar:           jest.fn().mockResolvedValue({ ...sesionEnProceso, status: 'abandonado' }),
    });
    const aiEngine = makeAIConIntenciones(['cancelar_flujo'], 'Entendido, quedamos en contacto.');
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'ya no me interesa' }));

    expect(wfEngine.abandonar).toHaveBeenCalledWith('ses-integracion-01', 'empresa');
    expect(resultado.respuesta_texto).toBe('Entendido, quedamos en contacto.');
    expect(wfEngine.iniciarSesion).not.toHaveBeenCalled();
    expect(wfEngine.evaluar).not.toHaveBeenCalled();
  });

  test('Caso B: sesión activa + respuesta normal → avanza al siguiente nodo', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio),
      avanzar:             jest.fn().mockResolvedValue({
        sesion:         { ...sesionEnProceso, current_node: 'tipo_proyecto', total_turnos: 2 },
        completado:     false,
        siguiente_nodo: nodoSiguiente,
      }),
    });
    const aiEngine = makeAIConIntenciones(['consulta_general'], 'Respuesta AI ignorada.');
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'ACME Construcciones' }));

    expect(wfEngine.avanzar).toHaveBeenCalled();
    expect(resultado.respuesta_texto).toBe('¿Qué tipo de proyecto tienes en mente?');
    expect(wfEngine.iniciarSesion).not.toHaveBeenCalled();
    expect(wfEngine.evaluar).not.toHaveBeenCalled();
  });

  test('Caso C: sin sesión + intent match → activa workflow con transición AI + primera pregunta', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(null),
      evaluar:             jest.fn().mockResolvedValue(workflowDescubrimiento),
      iniciarSesion:       jest.fn().mockResolvedValue({ ...sesionEnProceso, current_node: 'nombre_contacto' }),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoInicio),
    });
    // 1 oración: la transición toma solo la primera declarativa, luego la pregunta del nodo
    const aiEngine = makeAIConIntenciones(
      ['solicitud_cotizacion'],
      'Con gusto te ayudaré con tu cotización. Iniciemos el proceso.'
    );
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'quiero una cotización' }));

    expect(wfEngine.iniciarSesion).toHaveBeenCalledWith(
      'company-uuid-001', 42, null, 'wf-test-001'
    );
    expect(resultado.respuesta_texto).toContain('Con gusto te ayudaré con tu cotización.');
    expect(resultado.respuesta_texto).toContain('¿Cuál es tu nombre?');
  });

  test('Caso B-prepend: sesión activa + siguiente nodo prepend_ai → transición AI + pregunta', async () => {
    const nodoSiguientePrepend = {
      nombre:         'tipo_proyecto',
      pregunta:       '¿Qué van a almacenar?',
      es_fin:         false,
      modo_respuesta: 'prepend_ai',
    };
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio),
      avanzar:             jest.fn().mockResolvedValue({
        sesion:         { ...sesionEnProceso, current_node: 'tipo_proyecto', total_turnos: 2 },
        completado:     false,
        siguiente_nodo: nodoSiguientePrepend,
      }),
    });
    // 1 oración: solo la primera declarativa llega al cliente
    const aiEngine = makeAIConIntenciones(
      ['consulta_general'],
      'Perfecto, ACME Construcciones. Es un proyecto interesante.'
    );
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'ACME Construcciones' }));

    expect(resultado.respuesta_texto).toContain('Perfecto, ACME Construcciones.');
    expect(resultado.respuesta_texto).toContain('¿Qué van a almacenar?');
  });

  test('Auto-advance Caso B: datos ya detectados en mensaje inicial → salta nodos respondidos', async () => {
    const nodoTipoProyecto = {
      nombre:         'tipo_proyecto',
      pregunta:       '¿Qué van a almacenar? Cuéntame sobre la mercancía.',
      campo:          'tipo_proyecto',
      es_fin:         false,
      modo_respuesta: 'prepend_ai',
    };
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(null),
      evaluar:             jest.fn().mockResolvedValue(workflowDescubrimiento),
      iniciarSesion:       jest.fn().mockResolvedValue({ ...sesionEnProceso, current_node: 'nombre_contacto', captured_fields: {} }),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoInicio),
      avanzar: jest.fn()
        .mockResolvedValueOnce({  // avanza nombre_contacto → empresa
          sesion:         { ...sesionEnProceso, current_node: 'empresa', captured_fields: { nombre_contacto: 'Carlos' } },
          completado:     false,
          siguiente_nodo: nodoIntermedio,
        })
        .mockResolvedValueOnce({  // avanza empresa → tipo_proyecto
          sesion:         { ...sesionEnProceso, current_node: 'tipo_proyecto', captured_fields: { nombre_contacto: 'Carlos', empresa: 'Distribuidora Norte' } },
          completado:     false,
          siguiente_nodo: nodoTipoProyecto,
        }),
    });
    const aiEngine = {
      procesar: jest.fn().mockResolvedValue({
        respuesta_texto:     'Carlos, para tarimas de 800 kg te recomiendo rack selectivo.',
        categoria_principal: 'Test',
        datos_extraidos:     { nombre_contacto: 'Carlos', empresa: 'Distribuidora Norte' },
        intenciones:         ['solicitud_cotizacion'],
        sentimiento:         'Neutral',
        etapa_sugerida:      null,
        acciones_propuestas: [],
        confianza:           0.9,
        tokens_entrada:      80,
        tokens_salida:       40,
        modelo_utilizado:    'mock-test',
        proveedor_utilizado: 'mock-test',
        latencia_ms:         0,
      }),
    };
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({
      content: 'Soy Carlos de Distribuidora Norte, necesito racks para tarimas de 800 kg, unas 300 posiciones',
    }));

    // avanzar llamado 2 veces: auto-skip nombre_contacto y empresa
    expect(wfEngine.avanzar).toHaveBeenCalledTimes(2);
    expect(wfEngine.avanzar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ current_node: 'nombre_contacto' }),
      nodoInicio,
      'Carlos'
    );
    expect(wfEngine.avanzar).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ current_node: 'empresa' }),
      nodoIntermedio,
      'Distribuidora Norte'
    );
    // No repite preguntas ya respondidas
    expect(resultado.respuesta_texto).not.toContain('¿Con quién tengo el gusto?');
    expect(resultado.respuesta_texto).not.toContain('¿Para qué empresa');
    // Pregunta el primer campo no respondido
    expect(resultado.respuesta_texto).toContain('¿Qué van a almacenar?');
  });

  test('_extraerTransicion filtra preguntas de la IA — solo pasa oraciones declarativas', async () => {
    const nodoEmpresaPrepend = {
      nombre:         'empresa',
      pregunta:       '¿Para qué empresa o proyecto es?',
      campo:          'empresa',
      es_fin:         false,
      modo_respuesta: 'prepend_ai',
    };
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio),
      avanzar:             jest.fn().mockResolvedValue({
        sesion:         { ...sesionEnProceso, current_node: 'empresa', total_turnos: 2 },
        completado:     false,
        siguiente_nodo: nodoEmpresaPrepend,
      }),
    });
    // La IA genera una pregunta propia — no debe colarse en la transición
    const aiEngine = makeAIConIntenciones(
      ['consulta_general'],
      'Entendido, Carlos. ¿Cuál es el nombre de tu empresa?'
    );
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'Carlos' }));

    // La pregunta propia de la IA queda filtrada
    expect(resultado.respuesta_texto).not.toContain('¿Cuál es el nombre de tu empresa?');
    // Solo aparece la pregunta del nodo workflow
    expect(resultado.respuesta_texto).toContain('¿Para qué empresa o proyecto es?');
    // La transición declarativa sí llega
    expect(resultado.respuesta_texto).toContain('Entendido, Carlos.');
  });

  test('Caso D: sin sesión + sin match de intención → flujo conversacional normal', async () => {
    const respuestaAI = 'Disponemos de rack selectivo desde $45,000 MXN.';
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(null),
      evaluar:             jest.fn().mockResolvedValue(null),
    });
    const aiEngine = makeAIConIntenciones(['consulta_general'], respuestaAI);
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage());

    expect(resultado.respuesta_texto).toBe(respuestaAI);
    expect(wfEngine.iniciarSesion).not.toHaveBeenCalled();
    expect(wfEngine.avanzar).not.toHaveBeenCalled();
  });
});

// ── Resiliencia ───────────────────────────────────────────────────────────────

describe('Orchestrator + WorkflowEngine — resiliencia', () => {

  test('WorkflowEngine lanza excepción inesperada → conversación no se interrumpe', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockRejectedValue(new Error('Supabase timeout en workflow')),
    });
    const respuestaAI = 'Aquí están los precios.';
    const aiEngine = makeAIConIntenciones(['consulta_general'], respuestaAI);
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage());

    // El error queda registrado en el log del proceso
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Orchestrator[workflow]'),
      expect.any(String)
    );
    // La conversación continúa y el usuario recibe la respuesta del AI
    expect(resultado.respuesta_texto).toBe(respuestaAI);
    expect(resultado.session_id).toBeTruthy();
    consoleSpy.mockRestore();
  });

  test('sin WorkflowEngine inyectado → comportamiento idéntico a FASE 3', async () => {
    const respuestaAI = 'Respuesta sin ningún workflow activo.';
    const aiEngine = makeAIConIntenciones(['consulta_general'], respuestaAI);
    const deps = makeDeps({ aiEngine });
    // workflowEngine no está en deps → this._workflow = null
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage());

    expect(resultado.respuesta_texto).toBe(respuestaAI);
    expect(resultado.timings.workflow_ms).toBeUndefined(); // paso workflow nunca corrió
    expect(deps.guardarConversacion).toHaveBeenCalledTimes(1);
  });

  test('sesión activa existente → el Orchestrator no intenta iniciar un segundo workflow', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio),
      avanzar:             jest.fn().mockResolvedValue({
        sesion: sesionEnProceso, completado: false, siguiente_nodo: nodoSiguiente,
      }),
    });
    const aiEngine = makeAIConIntenciones(['solicitud_cotizacion']); // intent que activaría otro workflow
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    await orch.procesarMensaje(makeMessage({ content: 'ACME' }));

    expect(wfEngine.evaluar).not.toHaveBeenCalled();       // no busca workflow nuevo
    expect(wfEngine.iniciarSesion).not.toHaveBeenCalled(); // no crea segunda sesión
    expect(wfEngine.avanzar).toHaveBeenCalledTimes(1);     // solo avanza la sesión activa
  });
});

// ── Consistencia de identificadores ──────────────────────────────────────────

describe('Orchestrator + WorkflowEngine — consistencia de IDs', () => {

  test('company_id, cliente_id y conversation_id son consistentes en la activación', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(null),
      evaluar:             jest.fn().mockResolvedValue(workflowDescubrimiento),
      iniciarSesion:       jest.fn().mockResolvedValue({ ...sesionEnProceso, current_node: 'nombre_contacto' }),
      obtenerNodoActual:   jest.fn().mockResolvedValue({ ...nodoInicio, modo_respuesta: 'replace_ai' }),
    });
    const aiEngine = makeAIConIntenciones(['solicitud_cotizacion']);
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    await orch.procesarMensaje(makeMessage());

    const [companyId, clienteId, conversationId] = wfEngine.iniciarSesion.mock.calls[0];
    expect(companyId).toBe('company-uuid-001'); // igual que message.company_id
    expect(clienteId).toBe(42);                 // igual que cliente.id de makeCliente()
    expect(conversationId).toBeNull();           // null documentado en FASE 4A
  });

  test('evaluar() recibe el company_id correcto del mensaje', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(null),
      evaluar:             jest.fn().mockResolvedValue(null),
    });
    const aiEngine = makeAIConIntenciones(['solicitud_cotizacion']);
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    await orch.procesarMensaje(makeMessage());

    expect(wfEngine.evaluar).toHaveBeenCalledWith(
      'company-uuid-001',
      expect.arrayContaining(['solicitud_cotizacion'])
    );
  });
});

// ── Regresión: conversaciones libres sin workflow ─────────────────────────────

describe('Regresión — conversación libre sin workflow (igual que FASE 3)', () => {

  test('respuesta AI llega intacta al usuario cuando no hay workflow', async () => {
    const respuestaAI = 'El rack selectivo tiene capacidad de 1,500 kg por nivel.';
    const wfEngine = makeWorkflowEngine(); // todo null-safe por defecto
    const aiEngine = makeAIConIntenciones(['consulta_general'], respuestaAI);
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage());

    expect(resultado.respuesta_texto).toBe(respuestaAI);
    expect(resultado.ai_output.intenciones).toContain('consulta_general');
    expect(deps.guardarConversacion).toHaveBeenCalledTimes(1);
    expect(deps.auditLogger.logAICall).toHaveBeenCalledTimes(1);
    expect(wfEngine.iniciarSesion).not.toHaveBeenCalled();
    expect(wfEngine.avanzar).not.toHaveBeenCalled();
    expect(wfEngine.abandonar).not.toHaveBeenCalled();
  });

  test('múltiples turnos libres consecutivos no acumulan estado de workflow', async () => {
    const wfEngine = makeWorkflowEngine();
    const deps = makeDeps({ workflowEngine: wfEngine });
    const orch = new Orchestrator(deps);

    await orch.procesarMensaje(makeMessage({ content: '¿Qué productos tienen?' }));
    await orch.procesarMensaje(makeMessage({ content: '¿Cuánto cuesta el rack?' }));
    await orch.procesarMensaje(makeMessage({ content: '¿Tienen servicio de instalación?' }));

    // obtenerSesionActiva se llama una vez por turno, pero siempre devuelve null
    expect(wfEngine.obtenerSesionActiva).toHaveBeenCalledTimes(3);
    expect(wfEngine.iniciarSesion).not.toHaveBeenCalled();
    expect(wfEngine.avanzar).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. BUGS T4B.4+ — Correcciones de producción
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — Bug #1: no reactivar workflow completado', () => {

  test('sesión completada en últimas 24h → Caso B no evalúa ni activa nuevo workflow', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva:           jest.fn().mockResolvedValue(null),
      tieneSesionCompletadaReciente: jest.fn().mockResolvedValue(true), // completada reciente
      evaluar:                       jest.fn().mockResolvedValue(workflowDescubrimiento),
    });
    const respuestaAI = 'Claro, ¿en qué más puedo ayudarte?';
    const aiEngine = makeAIConIntenciones(['solicitud_cotizacion'], respuestaAI);
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'quiero otra cotización' }));

    expect(wfEngine.tieneSesionCompletadaReciente).toHaveBeenCalledWith('company-uuid-001', 42, 24);
    // El workflow NO se activa — evaluar ni iniciarSesion deben llamarse
    expect(wfEngine.evaluar).not.toHaveBeenCalled();
    expect(wfEngine.iniciarSesion).not.toHaveBeenCalled();
    // La respuesta AI pasa intacta al cliente
    expect(resultado.respuesta_texto).toBe(respuestaAI);
  });

  test('sesión completada hace más de 24h → Caso B puede activar nuevo workflow', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva:           jest.fn().mockResolvedValue(null),
      tieneSesionCompletadaReciente: jest.fn().mockResolvedValue(false), // fuera de ventana
      evaluar:                       jest.fn().mockResolvedValue(workflowDescubrimiento),
      iniciarSesion:                 jest.fn().mockResolvedValue({ ...sesionEnProceso, current_node: 'nombre_contacto' }),
      obtenerNodoActual:             jest.fn().mockResolvedValue({ ...nodoInicio, modo_respuesta: 'replace_ai' }),
    });
    const aiEngine = makeAIConIntenciones(['solicitud_cotizacion'], 'Entendido.');
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    await orch.procesarMensaje(makeMessage({ content: 'necesito nueva cotización' }));

    expect(wfEngine.evaluar).toHaveBeenCalled();
    expect(wfEngine.iniciarSesion).toHaveBeenCalled();
  });
});

describe('Orchestrator — Bug #4: datos de turnos anteriores (captured_fields)', () => {

  test('campo pre-guardado en captured_fields → auto-advance lo usa aunque no esté en datos_extraidos del turno', async () => {
    // Escenario: sesión en nodo 'empresa'. En un turno anterior, tipo_proyecto
    // fue mencionado y pre-guardado en captured_fields. Este turno solo provee 'empresa'.
    const nodoTipoProyecto = {
      nombre:         'tipo_proyecto',
      pregunta:       '¿Qué van a almacenar?',
      campo:          'tipo_proyecto',
      es_fin:         false,
      modo_respuesta: 'replace_ai',
    };
    const nodoVolumen = {
      nombre:         'volumen_estimado',
      pregunta:       '¿Cuántas posiciones necesitas?',
      campo:          'volumen_estimado',
      es_fin:         false,
      modo_respuesta: 'replace_ai',
    };

    const sesionConPreSave = {
      ...sesionEnProceso,
      current_node:    'empresa',
      captured_fields: { nombre_contacto: 'Carlos', tipo_proyecto: 'papel' }, // pre-saved de turno anterior
    };

    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionConPreSave),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio), // nodo 'empresa', campo: 'empresa'
      avanzar: jest.fn()
        .mockResolvedValueOnce({  // avanza empresa → tipo_proyecto
          sesion: {
            ...sesionConPreSave,
            current_node:    'tipo_proyecto',
            captured_fields: { nombre_contacto: 'Carlos', tipo_proyecto: 'papel', empresa: 'Norte SA' },
          },
          completado:     false,
          siguiente_nodo: nodoTipoProyecto,
        })
        .mockResolvedValueOnce({  // auto-advance tipo_proyecto (vía captured_fields) → volumen_estimado
          sesion: {
            ...sesionConPreSave,
            current_node:    'volumen_estimado',
            captured_fields: { nombre_contacto: 'Carlos', tipo_proyecto: 'papel', empresa: 'Norte SA' },
          },
          completado:     false,
          siguiente_nodo: nodoVolumen,
        }),
    });

    // El mensaje actual solo menciona empresa — tipo_proyecto NO está en datos_extraidos
    const aiEngine = {
      procesar: jest.fn().mockResolvedValue({
        respuesta_texto:     'Norte SA, perfecto.',
        categoria_principal: 'Test',
        datos_extraidos:     { empresa: 'Norte SA' }, // solo empresa
        intenciones:         ['consulta_general'],
        sentimiento:         'Neutral',
        etapa_sugerida:      null,
        acciones_propuestas: [],
        confianza:           0.8,
        tokens_entrada:      50,
        tokens_salida:       30,
        modelo_utilizado:    'mock',
        proveedor_utilizado: 'mock',
        latencia_ms:         0,
      }),
    };

    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'Norte SA' }));

    // 2 llamadas: empresa (turno actual) + tipo_proyecto (auto-advance con captured_fields)
    expect(wfEngine.avanzar).toHaveBeenCalledTimes(2);
    // La segunda llamada usa el valor pre-guardado de tipo_proyecto
    expect(wfEngine.avanzar).toHaveBeenNthCalledWith(2, expect.anything(), nodoTipoProyecto, 'papel');
    // Pregunta el primer campo no pre-guardado
    expect(resultado.respuesta_texto).toBe('¿Cuántas posiciones necesitas?');
    // pre-save fue llamado con los datos del turno actual
    expect(wfEngine.preSalvarDatosExtraidos).toHaveBeenCalledWith(
      expect.any(String),
      { empresa: 'Norte SA' }
    );
  });
});

describe('Orchestrator — Bug #5: _extraerTransicion retorna máximo 1 oración', () => {

  test('texto con 3 oraciones declarativas → solo la primera llega al cliente', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio),
      avanzar:             jest.fn().mockResolvedValue({
        sesion:         { ...sesionEnProceso, current_node: 'tipo_proyecto', total_turnos: 2 },
        completado:     false,
        siguiente_nodo: {
          nombre:         'tipo_proyecto',
          pregunta:       '¿Qué van a almacenar?',
          campo:          'tipo_proyecto',
          es_fin:         false,
          modo_respuesta: 'prepend_ai',
        },
      }),
    });
    // 3 oraciones declarativas: solo la primera debe aparecer
    const aiEngine = makeAIConIntenciones(
      ['consulta_general'],
      'Excelente empresa. Tienen gran trayectoria. Será un placer ayudarles.'
    );
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    const resultado = await orch.procesarMensaje(makeMessage({ content: 'ACME Construcciones' }));

    // Solo la primera oración
    expect(resultado.respuesta_texto).toContain('Excelente empresa.');
    // La segunda y tercera NO aparecen
    expect(resultado.respuesta_texto).not.toContain('Tienen gran trayectoria.');
    expect(resultado.respuesta_texto).not.toContain('Será un placer ayudarles.');
    // La pregunta del nodo workflow sí llega
    expect(resultado.respuesta_texto).toContain('¿Qué van a almacenar?');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Punto 2 — Calidad de datos: valor extraído vs. mensaje crudo
// ═════════════════════════════════════════════════════════════════════════════

describe('Orchestrator — Punto 2: Case A usa valor extraído para avanzar()', () => {

  test('AI extrajo campo del nodo → avanzar recibe el valor limpio, no el mensaje crudo', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio), // campo: 'empresa'
      avanzar:             jest.fn().mockResolvedValue({
        sesion:         { ...sesionEnProceso, current_node: 'tipo_proyecto', total_turnos: 2 },
        completado:     false,
        siguiente_nodo: nodoSiguiente,
      }),
    });
    // El mensaje crudo es largo; el AI extrajo el valor limpio de empresa
    const aiEngine = {
      procesar: jest.fn().mockResolvedValue({
        respuesta_texto:     'Perfecto, Norte SA.',
        categoria_principal: 'Test',
        datos_extraidos:     { empresa: 'Norte SA' },
        intenciones:         ['consulta_general'],
        sentimiento:         'Neutral',
        etapa_sugerida:      null,
        acciones_propuestas: [],
        confianza:           0.8,
        tokens_entrada:      50,
        tokens_salida:       30,
        modelo_utilizado:    'mock',
        proveedor_utilizado: 'mock',
        latencia_ms:         0,
      }),
    };
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    await orch.procesarMensaje(makeMessage({
      content: 'soy de Norte SA, quedamos en Monterrey, quiero saber más sobre los racks',
    }));

    // avanzar debe recibir el valor extraído limpio, no el mensaje completo
    expect(wfEngine.avanzar).toHaveBeenCalledWith(
      expect.anything(),
      nodoIntermedio,
      'Norte SA'
    );
  });

  test('AI no extrajo el campo del nodo (null) → avanzar usa el mensaje crudo como fallback', async () => {
    const wfEngine = makeWorkflowEngine({
      obtenerSesionActiva: jest.fn().mockResolvedValue(sesionEnProceso),
      obtenerNodoActual:   jest.fn().mockResolvedValue(nodoIntermedio), // campo: 'empresa'
      avanzar:             jest.fn().mockResolvedValue({
        sesion:         { ...sesionEnProceso, current_node: 'tipo_proyecto', total_turnos: 2 },
        completado:     false,
        siguiente_nodo: nodoSiguiente,
      }),
    });
    // AI no pudo extraer empresa explícita
    const aiEngine = {
      procesar: jest.fn().mockResolvedValue({
        respuesta_texto:     'Entendido.',
        categoria_principal: 'Test',
        datos_extraidos:     { empresa: null },
        intenciones:         ['consulta_general'],
        sentimiento:         'Neutral',
        etapa_sugerida:      null,
        acciones_propuestas: [],
        confianza:           0.8,
        tokens_entrada:      50,
        tokens_salida:       30,
        modelo_utilizado:    'mock',
        proveedor_utilizado: 'mock',
        latencia_ms:         0,
      }),
    };
    const deps = makeDeps({ workflowEngine: wfEngine, aiEngine });
    const orch = new Orchestrator(deps);

    await orch.procesarMensaje(makeMessage({ content: 'no sé el nombre exacto todavía' }));

    // avanzar usa el mensaje crudo como fallback
    expect(wfEngine.avanzar).toHaveBeenCalledWith(
      expect.anything(),
      nodoIntermedio,
      'no sé el nombre exacto todavía'
    );
  });
});
