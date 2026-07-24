/**
 * TARA Matrix™ — Tests: AuditLogger
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - Constructor: requiere Supabase client
 *   - log(): fire-and-forget, validación, normalización, fallo silencioso
 *   - Helpers: logAICall, logDecision, logAccion, logChannelEvent, logError, logWorkflow
 *   - flush() y getBufferSize()
 *   - TARA nunca se cae si Supabase falla
 */

'use strict';

const { AuditLogger, TIPOS_VALIDOS } = require('../modules/audit-logger');

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function makeSupabaseClient(opts = {}) {
  const insert = opts.insertFn || jest.fn().mockResolvedValue({ error: null });
  const from   = jest.fn(() => ({ insert }));
  return { _insert: insert, _from: from, from };
}

function makeEntry(overrides = {}) {
  return {
    company_id:    'company-uuid-001',
    tipo:          'error',
    canal:         'whatsapp',
    identificador: '+5218112345678',
    payload:       { mensaje: 'test' },
    latencia_ms:   150,
    costo_usd:     0.000023,
    tokens_total:  600,
    session_id:    'session-uuid-001',
    ...overrides,
  };
}

function makeCtx(overrides = {}) {
  return {
    company_id: 'company-uuid-001',
    canal:      'whatsapp',
    cliente: {
      identificador:   '+5218112345678',
      nombre:          'Carlos López',
      etapa_actual:    'Calificacion',
      campos_faltantes: ['num_empleados'],
    },
    conversacion: {
      workflow_actual:      'captacion_datos',
      workflow_paso_actual: 'pedir_empresa',
    },
    ...overrides,
  };
}

function makeAIInput() {
  return {
    system_prompt:  'Eres TARA...',
    mensaje_actual: '¿Cuánto cuesta el rack selectivo?',
    modelo:         'gpt-4o-mini',
    temperatura:    0.6,
    max_tokens:     700,
    memoria_corta:  [],
  };
}

function makeAIOutput(overrides = {}) {
  return {
    respuesta_texto:     'El rack selectivo tiene precio base de $45,000 MXN.',
    clasificacion_contexto: 'prospecto',
    categoria_principal: 'Rack Selectivo',
    intenciones:         ['cotizacion', 'precio'],
    sentimiento:         'Muy interesado',
    etapa_sugerida:      'Calificacion',
    acciones_propuestas: [{ tipo: 'crear_oportunidad', parametros: {} }],
    confianza:           0.95,
    tokens_entrada:      500,
    tokens_salida:       100,
    modelo_utilizado:    'gpt-4o-mini',
    proveedor_utilizado: 'openai',
    latencia_ms:         320,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// CONSTRUCTOR
// ═════════════════════════════════════════════════════════════════════════════

describe('AuditLogger — constructor', () => {
  test('instancia correctamente con cliente válido', () => {
    const db = makeSupabaseClient();
    expect(() => new AuditLogger(db)).not.toThrow();
  });

  test('lanza error si no se provee cliente de Supabase', () => {
    expect(() => new AuditLogger()).toThrow('requiere un cliente de Supabase');
    expect(() => new AuditLogger(null)).toThrow('requiere un cliente de Supabase');
  });

  test('getBufferSize() inicia en 0', () => {
    const logger = new AuditLogger(makeSupabaseClient());
    expect(logger.getBufferSize()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TIPOS_VALIDOS
// ═════════════════════════════════════════════════════════════════════════════

describe('TIPOS_VALIDOS', () => {
  test.each(['ai_call', 'decision', 'accion', 'channel_event', 'workflow', 'error'])(
    '"%s" está en TIPOS_VALIDOS',
    (tipo) => {
      expect(TIPOS_VALIDOS.has(tipo)).toBe(true);
    }
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// log() — MÉTODO NÚCLEO
// ═════════════════════════════════════════════════════════════════════════════

describe('log()', () => {
  let db;
  let logger;

  beforeEach(() => {
    db     = makeSupabaseClient();
    logger = new AuditLogger(db);
  });

  // ── Fire-and-forget ────────────────────────────────────────────────────────
  describe('fire-and-forget', () => {
    test('retorna undefined (no awaitable)', () => {
      const resultado = logger.log(makeEntry());
      expect(resultado).toBeUndefined();
    });

    test('escribe en Supabase después de flush()', async () => {
      logger.log(makeEntry());
      await logger.flush();
      expect(db._insert).toHaveBeenCalledTimes(1);
    });

    test('llama a from("decision_logs")', async () => {
      logger.log(makeEntry());
      await logger.flush();
      expect(db._from).toHaveBeenCalledWith('decision_logs');
    });

    test('buffer se vacía después de flush()', async () => {
      logger.log(makeEntry());
      logger.log(makeEntry());
      await logger.flush();
      expect(logger.getBufferSize()).toBe(0);
    });

    test('múltiples logs se procesan en paralelo', async () => {
      for (let i = 0; i < 5; i++) {
        logger.log(makeEntry({ tipo: 'error' }));
      }
      await logger.flush();
      expect(db._insert).toHaveBeenCalledTimes(5);
    });
  });

  // ── Normalización ──────────────────────────────────────────────────────────
  describe('normalización de campos', () => {
    test('redondea latencia_ms a entero', async () => {
      logger.log(makeEntry({ latencia_ms: 123.7 }));
      await logger.flush();
      const registro = db._insert.mock.calls[0][0][0];
      expect(registro.latencia_ms).toBe(124);
    });

    test('redondea tokens_total a entero', async () => {
      logger.log(makeEntry({ tokens_total: 599.9 }));
      await logger.flush();
      const registro = db._insert.mock.calls[0][0][0];
      expect(registro.tokens_total).toBe(600);
    });

    test('formatea costo_usd a 6 decimales', async () => {
      logger.log(makeEntry({ costo_usd: 0.0000234567 }));
      await logger.flush();
      const registro = db._insert.mock.calls[0][0][0];
      expect(registro.costo_usd.toString()).toMatch(/^\d+\.\d{1,6}$/);
    });

    test('campos opcionales ausentes → null en Supabase', async () => {
      logger.log({ company_id: 'co-1', tipo: 'error' });
      await logger.flush();
      const registro = db._insert.mock.calls[0][0][0];
      expect(registro.canal).toBeNull();
      expect(registro.identificador).toBeNull();
      expect(registro.latencia_ms).toBeNull();
      expect(registro.costo_usd).toBeNull();
      expect(registro.tokens_total).toBeNull();
      expect(registro.error).toBeNull();
      expect(registro.session_id).toBeNull();
    });

    test('payload undefined → objeto vacío en Supabase', async () => {
      logger.log({ company_id: 'co-1', tipo: 'error', payload: undefined });
      await logger.flush();
      const registro = db._insert.mock.calls[0][0][0];
      expect(registro.payload).toEqual({});
    });

    test('company_id, tipo y canal se propagan sin alteración', async () => {
      logger.log(makeEntry({ tipo: 'ai_call', canal: 'telegram' }));
      await logger.flush();
      const registro = db._insert.mock.calls[0][0][0];
      expect(registro.company_id).toBe('company-uuid-001');
      expect(registro.tipo).toBe('ai_call');
      expect(registro.canal).toBe('telegram');
    });
  });

  // ── Validación síncrona ────────────────────────────────────────────────────
  describe('validación de entrada', () => {
    test('entrada sin company_id → descartada, no llama Supabase', async () => {
      logger.log({ tipo: 'error' });
      await logger.flush();
      expect(db._insert).not.toHaveBeenCalled();
    });

    test('entrada sin tipo → descartada, no llama Supabase', async () => {
      logger.log({ company_id: 'co-1' });
      await logger.flush();
      expect(db._insert).not.toHaveBeenCalled();
    });

    test('entrada null → no lanza, no llama Supabase', async () => {
      expect(() => logger.log(null)).not.toThrow();
      await logger.flush();
      expect(db._insert).not.toHaveBeenCalled();
    });
  });

  // ── Fallo silencioso ───────────────────────────────────────────────────────
  describe('fallo silencioso de Supabase', () => {
    test('no lanza aunque Supabase falle', async () => {
      const dbFallido = makeSupabaseClient({
        insertFn: jest.fn().mockResolvedValue({ error: { message: 'DB connection refused' } }),
      });
      const loggerFallido = new AuditLogger(dbFallido);

      expect(() => loggerFallido.log(makeEntry())).not.toThrow();
      await expect(loggerFallido.flush()).resolves.not.toThrow();
    });

    test('fallo de Supabase vacía el buffer igualmente', async () => {
      const dbFallido = makeSupabaseClient({
        insertFn: jest.fn().mockRejectedValue(new Error('Network timeout')),
      });
      const loggerFallido = new AuditLogger(dbFallido);

      loggerFallido.log(makeEntry());
      await loggerFallido.flush();
      expect(loggerFallido.getBufferSize()).toBe(0);
    });

    test('TARA sigue respondiendo después de N fallos del logger', async () => {
      const dbFallido = makeSupabaseClient({
        insertFn: jest.fn().mockRejectedValue(new Error('Supabase down')),
      });
      const loggerFallido = new AuditLogger(dbFallido);

      for (let i = 0; i < 10; i++) {
        expect(() => loggerFallido.log(makeEntry())).not.toThrow();
      }
      await expect(loggerFallido.flush()).resolves.toBeUndefined();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS SEMÁNTICOS
// ═════════════════════════════════════════════════════════════════════════════

describe('logAICall()', () => {
  let db, logger;
  beforeEach(() => { db = makeSupabaseClient(); logger = new AuditLogger(db); });

  test('tipo es "ai_call"', async () => {
    logger.logAICall(makeCtx(), makeAIInput(), makeAIOutput());
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].tipo).toBe('ai_call');
  });

  test('payload contiene modelo, proveedor, confianza, sentimiento', async () => {
    logger.logAICall(makeCtx(), makeAIInput(), makeAIOutput());
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.modelo).toBe('gpt-4o-mini');
    expect(payload.proveedor).toBe('openai');
    expect(payload.confianza).toBe(0.95);
    expect(payload.sentimiento).toBe('Muy interesado');
  });

  test('payload contiene clasificacion_contexto (auditoría de "no vender sin evidencia")', async () => {
    logger.logAICall(makeCtx(), makeAIInput(), makeAIOutput({ clasificacion_contexto: 'numero_equivocado' }));
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.clasificacion_contexto).toBe('numero_equivocado');
  });

  test('tokens_total = tokens_entrada + tokens_salida', async () => {
    logger.logAICall(makeCtx(), makeAIInput(), makeAIOutput());
    await logger.flush();
    const registro = db._insert.mock.calls[0][0][0];
    expect(registro.tokens_total).toBe(600); // 500 + 100
  });

  test('latencia_ms viene de aiOutput', async () => {
    logger.logAICall(makeCtx(), makeAIInput(), makeAIOutput({ latencia_ms: 450 }));
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].latencia_ms).toBe(450);
  });

  test('costo_usd viene de opts', async () => {
    logger.logAICall(makeCtx(), makeAIInput(), makeAIOutput(), { costo_usd: 0.000075 });
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].costo_usd).toBeDefined();
  });

  test('acciones_count refleja las acciones propuestas', async () => {
    const output = makeAIOutput({ acciones_propuestas: [{ tipo: 'a' }, { tipo: 'b' }] });
    logger.logAICall(makeCtx(), makeAIInput(), output);
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].payload.acciones_count).toBe(2);
  });

  test('campos_faltantes se incluyen en payload', async () => {
    logger.logAICall(makeCtx(), makeAIInput(), makeAIOutput());
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.campos_faltantes).toEqual(['num_empleados']);
  });
});

describe('logDecision()', () => {
  let db, logger;
  beforeEach(() => { db = makeSupabaseClient(); logger = new AuditLogger(db); });

  test('tipo es "decision"', async () => {
    logger.logDecision(makeCtx(), 'workflow-engine', 'avanzar_a_cotizacion', 'cliente aceptó precio');
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].tipo).toBe('decision');
  });

  test('payload contiene modulo, decision y razon', async () => {
    logger.logDecision(makeCtx(), 'decision-engine', 'crear_oportunidad', 'intención cotizacion detectada');
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.modulo).toBe('decision-engine');
    expect(payload.decision).toBe('crear_oportunidad');
    expect(payload.razon).toBe('intención cotizacion detectada');
  });

  test('payload incluye etapa_cliente y workflow_actual', async () => {
    logger.logDecision(makeCtx(), 'mod', 'decision', 'razón');
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.etapa_cliente).toBe('Calificacion');
    expect(payload.workflow_actual).toBe('captacion_datos');
  });
});

describe('logAccion()', () => {
  let db, logger;
  beforeEach(() => { db = makeSupabaseClient(); logger = new AuditLogger(db); });

  test('tipo es "accion"', async () => {
    logger.logAccion(makeCtx(), 'crear_oportunidad', {}, { exito: true, id: 'op-123' });
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].tipo).toBe('accion');
  });

  test('payload contiene tipo_accion y exito:true cuando el resultado es exitoso', async () => {
    logger.logAccion(makeCtx(), 'crear_oportunidad', { categoria: 'Rack' }, { exito: true });
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.tipo_accion).toBe('crear_oportunidad');
    expect(payload.exito).toBe(true);
  });

  test('exito:false cuando resultado.error está presente', async () => {
    logger.logAccion(makeCtx(), 'enviar_cotizacion', {}, { error: 'Timeout' });
    await logger.flush();
    const registro = db._insert.mock.calls[0][0][0];
    expect(registro.payload.exito).toBe(false);
    expect(registro.error).toBe('Timeout');
  });

  test('parametros se incluyen en payload', async () => {
    const params = { producto: 'Rack Selectivo', cantidad: 3 };
    logger.logAccion(makeCtx(), 'crear_cotizacion', params, { exito: true });
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].payload.parametros).toEqual(params);
  });
});

describe('logChannelEvent()', () => {
  let db, logger;
  beforeEach(() => { db = makeSupabaseClient(); logger = new AuditLogger(db); });

  test('tipo es "channel_event"', async () => {
    logger.logChannelEvent(makeCtx(), 'mensaje_recibido');
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].tipo).toBe('channel_event');
  });

  test('subtipo se asigna al payload', async () => {
    logger.logChannelEvent(makeCtx(), 'mensaje_enviado', { preview: 'Hola...' });
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.subtipo).toBe('mensaje_enviado');
    expect(payload.preview).toBe('Hola...');
  });

  test('error de canal se propaga al campo error', async () => {
    logger.logChannelEvent(makeCtx(), 'error_canal', { error: 'Twilio 503' });
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].error).toBe('Twilio 503');
  });
});

describe('logError()', () => {
  let db, logger;
  beforeEach(() => { db = makeSupabaseClient(); logger = new AuditLogger(db); });

  test('tipo es "error"', async () => {
    logger.logError(makeCtx(), 'openai-provider', new Error('API key inválida'));
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].tipo).toBe('error');
  });

  test('payload contiene modulo, mensaje y tipo_error', async () => {
    const err = new TypeError('Cannot read property of undefined');
    logger.logError(makeCtx(), 'context-builder', err);
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.modulo).toBe('context-builder');
    expect(payload.tipo_error).toBe('TypeError');
    expect(payload.mensaje).toBe('Cannot read property of undefined');
  });

  test('campo error del registro contiene el mensaje', async () => {
    logger.logError(makeCtx(), 'crm', new Error('Supabase timeout'));
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].error).toBe('Supabase timeout');
  });

  test('maneja objetos que no son Error', async () => {
    logger.logError(makeCtx(), 'unknown', 'string de error');
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.mensaje).toBe('string de error');
  });

  test('stack se incluye truncado (máx 5 líneas)', async () => {
    const err = new Error('Error con stack');
    logger.logError(makeCtx(), 'mod', err);
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    if (payload.stack) {
      const lineas = payload.stack.split('\n');
      expect(lineas.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('logWorkflow()', () => {
  let db, logger;
  beforeEach(() => { db = makeSupabaseClient(); logger = new AuditLogger(db); });

  test('tipo es "workflow"', async () => {
    logger.logWorkflow(makeCtx(), 'inicio');
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].tipo).toBe('workflow');
  });

  test('payload contiene evento, workflow y paso_actual del contexto', async () => {
    logger.logWorkflow(makeCtx(), 'paso_completado', { paso_siguiente: 'pedir_num_empleados' });
    await logger.flush();
    const { payload } = db._insert.mock.calls[0][0][0];
    expect(payload.evento).toBe('paso_completado');
    expect(payload.workflow).toBe('captacion_datos');
    expect(payload.paso_actual).toBe('pedir_empresa');
    expect(payload.paso_siguiente).toBe('pedir_num_empleados');
  });

  test('etapa_cliente se incluye en payload', async () => {
    logger.logWorkflow(makeCtx(), 'fin');
    await logger.flush();
    expect(db._insert.mock.calls[0][0][0].payload.etapa_cliente).toBe('Calificacion');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// flush() y getBufferSize()
// ═════════════════════════════════════════════════════════════════════════════

describe('flush() y getBufferSize()', () => {
  test('flush() resuelve aunque no haya pendientes', async () => {
    const logger = new AuditLogger(makeSupabaseClient());
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  test('flush() espera todos los writes aunque alguno falle', async () => {
    let llamadas = 0;
    const insertFn = jest.fn().mockImplementation(() => {
      llamadas++;
      if (llamadas === 2) return Promise.reject(new Error('fallo'));
      return Promise.resolve({ error: null });
    });
    const logger = new AuditLogger(makeSupabaseClient({ insertFn }));

    logger.log(makeEntry());
    logger.log(makeEntry());
    logger.log(makeEntry());

    await expect(logger.flush()).resolves.toBeUndefined();
    expect(logger.getBufferSize()).toBe(0);
  });

  test('getBufferSize() baja a 0 después de flush()', async () => {
    const logger = new AuditLogger(makeSupabaseClient());
    logger.log(makeEntry());
    logger.log(makeEntry());
    await logger.flush();
    expect(logger.getBufferSize()).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXTO MÍNIMO — helpers funcionan con ctx parcial
// ═════════════════════════════════════════════════════════════════════════════

describe('Resiliencia con contexto parcial', () => {
  let db, logger;
  beforeEach(() => { db = makeSupabaseClient(); logger = new AuditLogger(db); });

  const ctxMinimo = { company_id: 'co-1', canal: 'api', cliente: null, conversacion: null };

  test('logDecision funciona con contexto mínimo (sin cliente)', async () => {
    expect(() => logger.logDecision(ctxMinimo, 'mod', 'dec', 'raz')).not.toThrow();
    await logger.flush();
    expect(db._insert).toHaveBeenCalledTimes(1);
  });

  test('logError funciona con contexto mínimo', async () => {
    expect(() => logger.logError(ctxMinimo, 'mod', new Error('x'))).not.toThrow();
    await logger.flush();
    expect(db._insert).toHaveBeenCalledTimes(1);
  });

  test('logChannelEvent funciona con contexto mínimo', async () => {
    expect(() => logger.logChannelEvent(ctxMinimo, 'mensaje_recibido')).not.toThrow();
    await logger.flush();
    expect(db._insert).toHaveBeenCalledTimes(1);
  });
});
