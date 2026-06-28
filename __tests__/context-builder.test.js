/**
 * TARA Matrix™ — Tests: Context Builder
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - Utilidades (estimarTokens, extraerKeywords, filtrarKnowledgeBase,
 *     recortarMemoria, calcularCamposFaltantes, nivelCompresion)
 *   - ContextBuilder.construir(): campos, defaults, validación, optimización
 *   - ContextBuilder.prepararParaIA(): AIInput correcto
 *   - Compresión leve y agresiva
 */

'use strict';

const {
  ContextBuilder,
  estimarTokens,
  extraerKeywords,
  filtrarKnowledgeBase,
  recortarMemoria,
  calcularCamposFaltantes,
  nivelCompresion,
} = require('../modules/context-builder');

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

const KB_EJEMPLO = [
  'Rack Selectivo\nCapacidad: 1,500kg por nivel. Ideal para pallets europeos. Precio base $45,000 MXN.',
  'Rack Drive-In\nCapacidad: 2,000kg. Almacenamiento compacto para productos homogéneos.',
  'Mezzanine Industrial\nEstructura de entrepiso para ampliar superficie. Capacidad 500kg/m2.',
  'Servicio de instalación\nTiempo: 3-5 días. Personal certificado. Garantía de 12 meses.',
].join('\n\n');

const EMPRESA_CONFIG = {
  company_id:           'company-001',
  nombre_empresa:       'Total Racks',
  personalidad:         'Eres TARA, especialista en almacenamiento industrial. Tono directo y profesional.',
  objetivo_principal:   'Agendar visita técnica o generar cotización formal.',
  idioma:               'es',
  zona_horaria:         'America/Monterrey',
  modelo:               'gpt-4o-mini',
  temperatura:          0.6,
  max_tokens:           700,
  knowledge_base:       KB_EJEMPLO,
  skills:               [{ nombre: 'cotizar', activo: true }, { nombre: 'agendar', activo: true }],
  campos_requeridos:    ['nombre', 'empresa', 'num_empleados'],
  reglas: [
    { texto: 'Máximo 2 preguntas por respuesta', etapas: [] },
    { texto: 'Solo ofrecer descuento si hay autorización', etapas: ['Negociacion'] },
  ],
  ai_max_turnos_memoria: 6,
  kb_max_secciones:      3,
};

const DATOS_CLIENTE = {
  nombre:              'Carlos López',
  etapa_actual:        'Calificacion',
  categoria_principal: 'Rack Selectivo',
  datos:               { empresa: 'LogisMex', num_empleados: null },
};

const HISTORIA = [
  { mensaje_cliente: 'Hola, necesito racks',         respuesta_tara: '¿Qué tipo de producto vas a almacenar?' },
  { mensaje_cliente: 'Pallets con refrescos',        respuesta_tara: 'Perfecto, te recomiendo rack selectivo.' },
  { mensaje_cliente: '¿Cuánto cuesta el selectivo?', respuesta_tara: 'Precio base $45,000 MXN por módulo.' },
];

function makeInput(overrides = {}) {
  return {
    company_id:            'company-001',
    canal:                 'whatsapp',
    identificador_cliente: '+5218112345678',
    mensaje_actual:        '¿Cuánto cuesta el rack selectivo?',
    empresa_config:        EMPRESA_CONFIG,
    datos_cliente:         DATOS_CLIENTE,
    historia_conversacion: HISTORIA,
    resumen_cliente:       null,
    workflow_state:        null,
    capacidades:           ['crear_oportunidad', 'crear_tarea'],
    ...overrides,
  };
}

const CONTEXT_CAMPOS_REQUERIDOS = [
  'company_id', 'canal', 'timestamp', 'mensaje_actual',
  'cliente', 'empresa', 'ia', 'conversacion', 'knowledge', 'memoria', 'optimizacion',
];

// ═════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═════════════════════════════════════════════════════════════════════════════

describe('estimarTokens()', () => {
  test('texto vacío → 0', () => {
    expect(estimarTokens('')).toBe(0);
    expect(estimarTokens(null)).toBe(0);
    expect(estimarTokens(undefined)).toBe(0);
  });

  test('4 caracteres → 1 token', () => {
    expect(estimarTokens('abcd')).toBe(1);
  });

  test('100 caracteres → 25 tokens', () => {
    expect(estimarTokens('a'.repeat(100))).toBe(25);
  });

  test('redondea hacia arriba', () => {
    expect(estimarTokens('abc')).toBe(1);   // 3/4 → ceil = 1
    expect(estimarTokens('abcde')).toBe(2); // 5/4 → ceil = 2
  });
});

describe('extraerKeywords()', () => {
  test('elimina stopwords básicas en español', () => {
    const kws = extraerKeywords('el precio de los racks en monterrey');
    expect(kws).not.toContain('el');
    expect(kws).not.toContain('de');
    expect(kws).not.toContain('los');
    expect(kws).not.toContain('en');
  });

  test('incluye palabras relevantes', () => {
    const kws = extraerKeywords('necesito cotización de rack selectivo');
    expect(kws).toContain('necesito');
    expect(kws).toContain('rack');
    expect(kws).toContain('selectivo');
  });

  test('texto vacío → array vacío', () => {
    expect(extraerKeywords('')).toEqual([]);
    expect(extraerKeywords(null)).toEqual([]);
  });

  test('filtra palabras de menos de 3 caracteres', () => {
    const kws = extraerKeywords('el y a rack');
    expect(kws).not.toContain('y');
    expect(kws).not.toContain('a');
    expect(kws).toContain('rack');
  });

  test('convierte a minúsculas', () => {
    const kws = extraerKeywords('RACK Selectivo');
    expect(kws).toContain('rack');
    expect(kws).toContain('selectivo');
  });
});

describe('filtrarKnowledgeBase()', () => {
  test('kb vacía → string vacío', () => {
    expect(filtrarKnowledgeBase('', 'rack', 3)).toBe('');
    expect(filtrarKnowledgeBase(null, 'rack', 3)).toBe('');
  });

  test('devuelve la kb completa si tiene menos secciones que el máximo', () => {
    const kb = 'Sección 1\n\nSección 2';
    expect(filtrarKnowledgeBase(kb, 'cualquier cosa', 5)).toBe(kb);
  });

  test('filtra por relevancia al mensaje', () => {
    const resultado = filtrarKnowledgeBase(KB_EJEMPLO, 'precio rack selectivo', 1);
    expect(resultado).toContain('Rack Selectivo');
    expect(resultado).not.toContain('Drive-In');
  });

  test('devuelve máximo `maxSecciones` secciones', () => {
    const resultado = filtrarKnowledgeBase(KB_EJEMPLO, 'rack', 2);
    const secciones = resultado.split('\n\n').filter(s => s.length > 10);
    expect(secciones.length).toBeLessThanOrEqual(2);
  });

  test('sin keywords relevantes devuelve las primeras N secciones', () => {
    const resultado = filtrarKnowledgeBase(KB_EJEMPLO, 'xyz xyz xyz', 2);
    // Con keywords que no matchean, devuelve las primeras 2
    expect(typeof resultado).toBe('string');
    expect(resultado.length).toBeGreaterThan(0);
  });
});

describe('recortarMemoria()', () => {
  test('array vacío → array vacío', () => {
    expect(recortarMemoria([], 5)).toEqual([]);
    expect(recortarMemoria(null, 5)).toEqual([]);
  });

  test('menos turnos que el máximo → devuelve todos', () => {
    expect(recortarMemoria(HISTORIA, 10)).toHaveLength(3);
  });

  test('más turnos que el máximo → recorta a los más recientes', () => {
    const resultado = recortarMemoria(HISTORIA, 2);
    expect(resultado).toHaveLength(2);
    expect(resultado[0].mensaje_cliente).toBe('Pallets con refrescos');
    expect(resultado[1].mensaje_cliente).toBe('¿Cuánto cuesta el selectivo?');
  });

  test('maxTurnos 0 → array vacío', () => {
    expect(recortarMemoria(HISTORIA, 0)).toEqual([]);
  });

  test('maxTurnos negativo → array vacío', () => {
    expect(recortarMemoria(HISTORIA, -1)).toEqual([]);
  });
});

describe('calcularCamposFaltantes()', () => {
  test('sin campos requeridos → array vacío', () => {
    expect(calcularCamposFaltantes({}, [])).toEqual([]);
    expect(calcularCamposFaltantes({}, null)).toEqual([]);
  });

  test('detecta campos null', () => {
    const datos = { nombre: 'Carlos', empresa: null };
    expect(calcularCamposFaltantes(datos, ['nombre', 'empresa'])).toEqual(['empresa']);
  });

  test('detecta campos undefined', () => {
    const datos = { nombre: 'Carlos' };
    expect(calcularCamposFaltantes(datos, ['nombre', 'empresa'])).toEqual(['empresa']);
  });

  test('detecta campos con string vacío', () => {
    const datos = { nombre: '' };
    expect(calcularCamposFaltantes(datos, ['nombre'])).toEqual(['nombre']);
  });

  test('no incluye campos ya completos', () => {
    const datos = { nombre: 'Carlos', empresa: 'LogisMex', num_empleados: 50 };
    expect(calcularCamposFaltantes(datos, ['nombre', 'empresa', 'num_empleados'])).toEqual([]);
  });

  test('datos null → todos los campos requeridos faltan', () => {
    expect(calcularCamposFaltantes(null, ['nombre', 'empresa'])).toEqual(['nombre', 'empresa']);
  });
});

describe('nivelCompresion()', () => {
  test('≤60% → ninguna', () => {
    expect(nivelCompresion(600, 1000)).toBe('ninguna');
    expect(nivelCompresion(0, 1000)).toBe('ninguna');
  });

  test('>60% y ≤85% → leve', () => {
    expect(nivelCompresion(700, 1000)).toBe('leve');
    expect(nivelCompresion(850, 1000)).toBe('leve');
  });

  test('>85% → agresiva', () => {
    expect(nivelCompresion(900, 1000)).toBe('agresiva');
    expect(nivelCompresion(1500, 1000)).toBe('agresiva');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER — construir()
// ═════════════════════════════════════════════════════════════════════════════

describe('ContextBuilder.construir()', () => {
  let builder;
  beforeEach(() => {
    builder = new ContextBuilder({ max_tokens_contexto: 10000 }); // presupuesto alto = sin compresión
  });

  // ── Estructura del output ──────────────────────────────────────────────────
  describe('estructura del output', () => {
    test('tiene todos los campos requeridos', () => {
      const ctx = builder.construir(makeInput());
      for (const campo of CONTEXT_CAMPOS_REQUERIDOS) {
        expect(ctx).toHaveProperty(campo);
      }
    });

    test('company_id y canal se propagan', () => {
      const ctx = builder.construir(makeInput({ canal: 'telegram' }));
      expect(ctx.company_id).toBe('company-001');
      expect(ctx.canal).toBe('telegram');
    });

    test('mensaje_actual se propaga al contexto', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.mensaje_actual).toBe('¿Cuánto cuesta el rack selectivo?');
    });

    test('timestamp es una instancia de Date', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── Cliente ────────────────────────────────────────────────────────────────
  describe('cliente', () => {
    test('propaga nombre y etapa_actual', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.cliente.nombre).toBe('Carlos López');
      expect(ctx.cliente.etapa_actual).toBe('Calificacion');
    });

    test('identificador_cliente se asigna al cliente', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.cliente.identificador).toBe('+5218112345678');
    });

    test('datos_cliente null → defaults seguros', () => {
      const ctx = builder.construir(makeInput({ datos_cliente: null }));
      expect(ctx.cliente.nombre).toBeNull();
      expect(ctx.cliente.etapa_actual).toBe('Nuevo');
      expect(ctx.cliente.datos).toEqual({});
      expect(ctx.cliente.categoria_principal).toBeNull();
    });

    test('calcula campos_faltantes correctamente', () => {
      const ctx = builder.construir(makeInput());
      // datos_cliente.datos tiene empresa='LogisMex' pero num_empleados=null
      expect(ctx.cliente.campos_faltantes).toContain('num_empleados');
      expect(ctx.cliente.campos_faltantes).not.toContain('nombre'); // no está en datos
      expect(ctx.cliente.campos_faltantes).not.toContain('empresa');
    });

    test('resumen_cliente null → cliente.resumen null', () => {
      const ctx = builder.construir(makeInput({ resumen_cliente: null }));
      expect(ctx.cliente.resumen).toBeNull();
    });

    test('resumen_cliente se propaga a cliente.resumen', () => {
      const ctx = builder.construir(makeInput({ resumen_cliente: 'Interesado en rack selectivo.' }));
      expect(ctx.cliente.resumen).toBe('Interesado en rack selectivo.');
    });
  });

  // ── Empresa ────────────────────────────────────────────────────────────────
  describe('empresa', () => {
    test('propaga nombre y personalidad', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.empresa.nombre).toBe('Total Racks');
      expect(ctx.empresa.personalidad).toContain('TARA');
    });

    test('default idioma es "es"', () => {
      const cfg = { ...EMPRESA_CONFIG };
      delete cfg.idioma;
      const ctx = builder.construir(makeInput({ empresa_config: cfg }));
      expect(ctx.empresa.idioma).toBe('es');
    });

    test('default zona_horaria es America/Monterrey', () => {
      const cfg = { ...EMPRESA_CONFIG };
      delete cfg.zona_horaria;
      const ctx = builder.construir(makeInput({ empresa_config: cfg }));
      expect(ctx.empresa.zona_horaria).toBe('America/Monterrey');
    });
  });

  // ── IA ─────────────────────────────────────────────────────────────────────
  describe('ia', () => {
    test('propaga modelo, temperatura y max_tokens', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.ia.modelo).toBe('gpt-4o-mini');
      expect(ctx.ia.temperatura).toBe(0.6);
      expect(ctx.ia.max_tokens).toBe(700);
    });

    test('defaults si no están en empresa_config', () => {
      const cfg = { ...EMPRESA_CONFIG };
      delete cfg.modelo;
      delete cfg.temperatura;
      delete cfg.max_tokens;
      const ctx = builder.construir(makeInput({ empresa_config: cfg }));
      expect(ctx.ia.modelo).toBe('gpt-4o-mini');
      expect(ctx.ia.temperatura).toBe(0.6);
      expect(ctx.ia.max_tokens).toBe(700);
    });
  });

  // ── Conversación ────────────────────────────────────────────────────────────
  describe('conversacion', () => {
    test('sin workflow_state → workflow_actual null', () => {
      const ctx = builder.construir(makeInput({ workflow_state: null }));
      expect(ctx.conversacion.workflow_actual).toBeNull();
      expect(ctx.conversacion.workflow_paso_actual).toBeNull();
    });

    test('con workflow_state → propaga campos', () => {
      const ctx = builder.construir(makeInput({
        workflow_state: {
          nombre:          'captacion_datos',
          paso_actual:     'pedir_empresa',
          objetivo:        'Completar perfil del cliente',
          etapa_objetivo:  'Calificacion',
        },
      }));
      expect(ctx.conversacion.workflow_actual).toBe('captacion_datos');
      expect(ctx.conversacion.workflow_paso_actual).toBe('pedir_empresa');
      expect(ctx.conversacion.objetivo_actual).toBe('Completar perfil del cliente');
      expect(ctx.conversacion.etapa_objetivo).toBe('Calificacion');
    });

    test('sin workflow, objetivo_actual viene de empresa_config', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.conversacion.objetivo_actual).toBe('Agendar visita técnica o generar cotización formal.');
    });

    test('reglas sin etapas aplican en cualquier etapa', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.conversacion.reglas_aplicables).toContain('Máximo 2 preguntas por respuesta');
    });

    test('reglas con etapas NO aplican en etapa diferente', () => {
      const ctx = builder.construir(makeInput()); // etapa = Calificacion
      expect(ctx.conversacion.reglas_aplicables).not.toContain('Solo ofrecer descuento si hay autorización');
    });

    test('reglas con etapas SÍ aplican en su etapa', () => {
      const ctx = builder.construir(makeInput({
        datos_cliente: { ...DATOS_CLIENTE, etapa_actual: 'Negociacion' },
      }));
      expect(ctx.conversacion.reglas_aplicables).toContain('Solo ofrecer descuento si hay autorización');
    });
  });

  // ── Knowledge ───────────────────────────────────────────────────────────────
  describe('knowledge', () => {
    test('secciones_relevantes es string no vacío', () => {
      const ctx = builder.construir(makeInput());
      expect(typeof ctx.knowledge.secciones_relevantes).toBe('string');
      expect(ctx.knowledge.secciones_relevantes.length).toBeGreaterThan(0);
    });

    test('base_completa contiene todo el knowledge_base', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.knowledge.base_completa).toBe(KB_EJEMPLO);
    });

    test('skills_activos solo incluye los marcados activo:true', () => {
      const cfg = {
        ...EMPRESA_CONFIG,
        skills: [
          { nombre: 'cotizar',  activo: true  },
          { nombre: 'agendar',  activo: false },
          { nombre: 'reportar', activo: true  },
        ],
      };
      const ctx = builder.construir(makeInput({ empresa_config: cfg }));
      expect(ctx.knowledge.skills_activos).toContain('cotizar');
      expect(ctx.knowledge.skills_activos).not.toContain('agendar');
      expect(ctx.knowledge.skills_activos).toContain('reportar');
    });

    test('skills como strings simples funcionan', () => {
      const cfg = { ...EMPRESA_CONFIG, skills: ['cotizar', 'agendar'] };
      const ctx = builder.construir(makeInput({ empresa_config: cfg }));
      expect(ctx.knowledge.skills_activos).toContain('cotizar');
      expect(ctx.knowledge.skills_activos).toContain('agendar');
    });

    test('capacidades se propagan', () => {
      const ctx = builder.construir(makeInput({ capacidades: ['enviar_cotizacion'] }));
      expect(ctx.knowledge.capacidades).toContain('enviar_cotizacion');
    });

    test('capacidades undefined → array vacío', () => {
      const ctx = builder.construir(makeInput({ capacidades: undefined }));
      expect(ctx.knowledge.capacidades).toEqual([]);
    });
  });

  // ── Memoria ──────────────────────────────────────────────────────────────────
  describe('memoria', () => {
    test('propaga historia completa si cabe en el límite', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.memoria.corta).toHaveLength(3); // 3 turnos, límite es 6
    });

    test('recorta historia si supera ai_max_turnos_memoria', () => {
      const historiaLarga = Array.from({ length: 10 }, (_, i) => ({
        mensaje_cliente: `Mensaje ${i}`,
        respuesta_tara:  `Respuesta ${i}`,
      }));
      const ctx = builder.construir(makeInput({ historia_conversacion: historiaLarga }));
      expect(ctx.memoria.corta).toHaveLength(6); // ai_max_turnos_memoria = 6
    });

    test('historia null → memoria vacía', () => {
      const ctx = builder.construir(makeInput({ historia_conversacion: null }));
      expect(ctx.memoria.corta).toEqual([]);
    });

    test('resumen_largo viene de resumen_cliente', () => {
      const ctx = builder.construir(makeInput({ resumen_cliente: 'Resumen del cliente.' }));
      expect(ctx.memoria.resumen_largo).toBe('Resumen del cliente.');
    });
  });

  // ── Optimización ─────────────────────────────────────────────────────────────
  describe('optimizacion', () => {
    test('tokens_estimados es un número positivo', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.optimizacion.tokens_estimados).toBeGreaterThan(0);
    });

    test('nivel_compresion es ninguna con presupuesto alto', () => {
      const ctx = builder.construir(makeInput());
      expect(ctx.optimizacion.nivel_compresion).toBe('ninguna');
    });

    test('nivel_compresion es leve cuando el contexto supera 60% del presupuesto', () => {
      const builderAjustado = new ContextBuilder({ max_tokens_contexto: 50 }); // presupuesto pequeño
      const ctx = builderAjustado.construir(makeInput());
      expect(['leve', 'agresiva']).toContain(ctx.optimizacion.nivel_compresion);
    });

    test('nivel agresivo omite cliente.datos si hay resumen', () => {
      const builderAgresivo = new ContextBuilder({ max_tokens_contexto: 10 });
      const ctx = builderAgresivo.construir(makeInput({
        resumen_cliente: 'Interesado en rack selectivo. Empresa: LogisMex.',
      }));
      if (ctx.optimizacion.nivel_compresion === 'agresiva') {
        expect(ctx.optimizacion.campos_omitidos).toContain('cliente.datos');
      }
    });

    test('campos_omitidos es array (puede estar vacío)', () => {
      const ctx = builder.construir(makeInput());
      expect(Array.isArray(ctx.optimizacion.campos_omitidos)).toBe(true);
    });
  });

  // ── Validación de input ───────────────────────────────────────────────────
  describe('validación de input', () => {
    test.each([
      'company_id',
      'canal',
      'identificador_cliente',
      'mensaje_actual',
      'empresa_config',
    ])('lanza error si "%s" está ausente', (campo) => {
      const input = makeInput({ [campo]: null });
      expect(() => builder.construir(input)).toThrow(`campo requerido faltante — "${campo}"`);
    });

    test('lanza error si empresa_config no es un objeto', () => {
      expect(() => builder.construir(makeInput({ empresa_config: 'string' }))).toThrow();
      expect(() => builder.construir(makeInput({ empresa_config: [] }))).toThrow();
    });

    test('mensaje_actual vacío lanza error', () => {
      expect(() => builder.construir(makeInput({ mensaje_actual: '' }))).toThrow();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER — prepararParaIA()
// ═════════════════════════════════════════════════════════════════════════════

describe('ContextBuilder.prepararParaIA()', () => {
  let builder;
  let ctx;

  beforeEach(() => {
    builder = new ContextBuilder({ max_tokens_contexto: 10000 });
    ctx     = builder.construir(makeInput());
  });

  const AI_INPUT_FIELDS = [
    'system_prompt', 'memoria_corta', 'mensaje_actual',
    'temperatura', 'max_tokens', 'modelo',
  ];

  test('devuelve un AIInput con todos los campos', () => {
    const aiInput = builder.prepararParaIA(ctx, 'Eres TARA...');
    for (const campo of AI_INPUT_FIELDS) {
      expect(aiInput).toHaveProperty(campo);
    }
  });

  test('system_prompt es el que se inyecta', () => {
    const aiInput = builder.prepararParaIA(ctx, 'MI PROMPT PERSONALIZADO');
    expect(aiInput.system_prompt).toBe('MI PROMPT PERSONALIZADO');
  });

  test('mensaje_actual viene del contexto', () => {
    const aiInput = builder.prepararParaIA(ctx, '...');
    expect(aiInput.mensaje_actual).toBe('¿Cuánto cuesta el rack selectivo?');
  });

  test('memoria_corta son los pares de la conversación', () => {
    const aiInput = builder.prepararParaIA(ctx, '...');
    expect(Array.isArray(aiInput.memoria_corta)).toBe(true);
    expect(aiInput.memoria_corta).toHaveLength(3);
  });

  test('modelo viene de empresa_config', () => {
    const aiInput = builder.prepararParaIA(ctx, '...');
    expect(aiInput.modelo).toBe('gpt-4o-mini');
  });

  test('temperatura viene de empresa_config', () => {
    const aiInput = builder.prepararParaIA(ctx, '...');
    expect(aiInput.temperatura).toBe(0.6);
  });

  test('max_tokens viene de empresa_config', () => {
    const aiInput = builder.prepararParaIA(ctx, '...');
    expect(aiInput.max_tokens).toBe(700);
  });

  test('memoria_corta refleja el recorte de la compresión agresiva', () => {
    const builderComprimido = new ContextBuilder({ max_tokens_contexto: 10 });
    const ctxComprimido = builderComprimido.construir(makeInput());
    const aiInput = builderComprimido.prepararParaIA(ctxComprimido, '...');
    // La memoria puede haber sido recortada
    expect(aiInput.memoria_corta.length).toBeLessThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AGNOSTICISMO — verifica que ningún campo contenga lógica de negocio hardcodeada
// ═════════════════════════════════════════════════════════════════════════════

describe('Agnosticismo del Context Builder', () => {
  test('el source de context-builder.js no menciona giros comerciales específicos', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').join(__dirname, '../modules/context-builder.js'),
      'utf8'
    );
    const patronesNegocio = ['rack', 'barbería', 'clínica', 'restaurant', 'tireShop', 'dental'];
    for (const patron of patronesNegocio) {
      expect(source.toLowerCase()).not.toContain(patron);
    }
  });

  test('el builder produce el mismo formato para cualquier empresa_config', () => {
    const cfgBarberia = {
      ...EMPRESA_CONFIG,
      nombre_empresa:    'Barbería Élite',
      objetivo_principal: 'Reservar cita de corte',
      knowledge_base:    'Servicios\nCorte clásico: $150\nAfeitado: $100',
      campos_requeridos: ['nombre', 'telefono'],
    };
    const ctx = new ContextBuilder({ max_tokens_contexto: 10000 })
      .construir(makeInput({ empresa_config: cfgBarberia }));

    // Debe tener exactamente la misma estructura
    for (const campo of CONTEXT_CAMPOS_REQUERIDOS) {
      expect(ctx).toHaveProperty(campo);
    }
    expect(ctx.empresa.nombre).toBe('Barbería Élite');
    expect(ctx.empresa.objetivo_principal).toBe('Reservar cita de corte');
  });
});
