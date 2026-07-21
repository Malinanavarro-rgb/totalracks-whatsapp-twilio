/**
 * TARA Matrix™ — Tests: PromptBuilder
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - Bloques individuales: contenido, omisión cuando vacío, datos correctos
 *   - PromptBuilder.construir(): orden, separación, contexto completo y mínimo
 *   - Activación y desactivación de bloques
 *   - construirBloque() y listarBloques()
 *   - schema_json: compatibilidad con OpenAIProvider, capacidades dinámicas
 *   - Agnosticismo: el source no contiene lógica de negocio
 *   - Integración: PromptBuilder → ContextBuilder → AIEngine
 */

'use strict';

const {
  PromptBuilder,
  ORDEN_DEFAULT,
  MAPA_BLOQUES,
  bloque_identidad,
  bloque_objetivo,
  bloque_etapa_cliente,
  bloque_knowledge_base,
  bloque_skills,
  bloque_resumen_cliente,
  bloque_campos_pendientes,
  bloque_reglas,
  bloque_capacidades,
  bloque_schema_json,
} = require('../modules/prompt-builder');

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function makeCtx(overrides = {}) {
  return {
    company_id:    'company-uuid-001',
    canal:         'whatsapp',
    mensaje_actual: '¿Cuánto cuesta el rack selectivo?',
    timestamp:     new Date(),

    cliente: {
      identificador:       '+5218112345678',
      nombre:              'Carlos López',
      etapa_actual:        'Calificacion',
      categoria_principal: 'Rack Selectivo',
      datos:               { empresa: 'LogisMex' },
      resumen:             null,
      campos_faltantes:    ['num_empleados'],
    },

    empresa: {
      nombre:             'Total Racks',
      personalidad:       'Eres TARA, especialista en almacenamiento industrial de Total Racks. Habla con experiencia y seguridad. Nunca reveles que eres IA. Tono: directo y profesional.',
      objetivo_principal: 'Agendar una visita técnica o generar una cotización formal.',
      idioma:             'es',
      zona_horaria:       'America/Monterrey',
    },

    ia: {
      modelo:      'gpt-4o-mini',
      temperatura: 0.6,
      max_tokens:  700,
    },

    conversacion: {
      objetivo_actual:      'Agendar una visita técnica o generar una cotización formal.',
      etapa_objetivo:       'Negociacion',
      workflow_actual:      null,
      workflow_paso_actual: null,
      reglas_aplicables: [
        'Máximo 2 preguntas por respuesta',
        'No ofrecer descuento sin autorización',
      ],
    },

    knowledge: {
      base_completa:        'Rack Selectivo\nCapacidad: 1,500kg por nivel...',
      secciones_relevantes: 'Rack Selectivo\nCapacidad: 1,500kg por nivel. Precio base $45,000 MXN.',
      skills_activos:       ['cotizar', 'agendar'],
      capacidades:          ['crear_oportunidad', 'crear_tarea'],
    },

    memoria: {
      corta: [
        { mensaje_cliente: 'Necesito racks', respuesta_tara: '¿Qué tipo de producto almacenas?' },
      ],
      resumen_largo: null,
    },

    optimizacion: {
      tokens_estimados: 450,
      nivel_compresion: 'ninguna',
      campos_omitidos:  [],
    },

    ...overrides,
  };
}

// Contexto mínimo: solo los campos requeridos por PromptBuilder
function makeCtxMinimo() {
  return {
    empresa:      { personalidad: 'Eres un asistente.', objetivo_principal: 'Ayudar.', idioma: 'es' },
    cliente:      { nombre: null, etapa_actual: null, categoria_principal: null, resumen: null, campos_faltantes: [] },
    conversacion: { objetivo_actual: null, etapa_objetivo: null, reglas_aplicables: [] },
    knowledge:    { secciones_relevantes: '', skills_activos: [], capacidades: [] },
    memoria:      { resumen_largo: null },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// BLOQUES INDIVIDUALES
// ═════════════════════════════════════════════════════════════════════════════

describe('bloque_identidad()', () => {
  test('incluye el texto de personalidad', () => {
    const result = bloque_identidad(makeCtx());
    expect(result).toContain('TARA');
    expect(result).toContain('especialista');
  });

  test('comienza con ## IDENTIDAD', () => {
    const result = bloque_identidad(makeCtx());
    expect(result).toMatch(/^## IDENTIDAD/);
  });

  test('devuelve null si personalidad está vacía', () => {
    expect(bloque_identidad({ empresa: { personalidad: '' } })).toBeNull();
    expect(bloque_identidad({ empresa: { personalidad: null } })).toBeNull();
    expect(bloque_identidad({ empresa: {} })).toBeNull();
    expect(bloque_identidad({})).toBeNull();
  });
});

describe('bloque_objetivo()', () => {
  test('usa objetivo_actual de conversacion si existe', () => {
    const ctx = makeCtx({
      conversacion: {
        ...makeCtx().conversacion,
        objetivo_actual: 'Cerrar venta este mes.',
      },
    });
    const result = bloque_objetivo(ctx);
    expect(result).toContain('Cerrar venta este mes.');
  });

  test('cae back a objetivo_principal de empresa si no hay objetivo_actual', () => {
    const ctx = makeCtx();
    ctx.conversacion.objetivo_actual = null;
    const result = bloque_objetivo(ctx);
    expect(result).toContain('visita técnica');
  });

  test('comienza con ## OBJETIVO', () => {
    expect(bloque_objetivo(makeCtx())).toMatch(/^## OBJETIVO/);
  });

  test('devuelve null si no hay objetivo en ninguna fuente', () => {
    const ctx = { empresa: {}, conversacion: {} };
    expect(bloque_objetivo(ctx)).toBeNull();
  });
});

describe('bloque_etapa_cliente()', () => {
  test('incluye nombre, etapa_actual y categoria_principal', () => {
    const result = bloque_etapa_cliente(makeCtx());
    expect(result).toContain('Carlos López');
    expect(result).toContain('Calificacion');
    expect(result).toContain('Rack Selectivo');
  });

  test('incluye etapa_objetivo de conversacion', () => {
    const result = bloque_etapa_cliente(makeCtx());
    expect(result).toContain('Negociacion');
  });

  test('comienza con ## ETAPA COMERCIAL', () => {
    expect(bloque_etapa_cliente(makeCtx())).toMatch(/^## ETAPA COMERCIAL/);
  });

  test('devuelve null si todos los campos de etapa están vacíos', () => {
    const ctx = {
      cliente:      { nombre: null, etapa_actual: null, categoria_principal: null },
      conversacion: { etapa_objetivo: null },
    };
    expect(bloque_etapa_cliente(ctx)).toBeNull();
  });

  test('funciona con solo el nombre del cliente', () => {
    const ctx = {
      cliente:      { nombre: 'Ana', etapa_actual: null, categoria_principal: null },
      conversacion: { etapa_objetivo: null },
    };
    const result = bloque_etapa_cliente(ctx);
    expect(result).not.toBeNull();
    expect(result).toContain('Ana');
  });

  test('trata el placeholder "Sin nombre" (default de crm.js) como nombre desconocido', () => {
    const ctx = {
      cliente:      { nombre: 'Sin nombre', etapa_actual: null, categoria_principal: null },
      conversacion: { etapa_objetivo: null },
    };
    // Sin ningún otro campo con valor, el bloque completo debe omitirse —
    // así el modelo recibe la señal correcta de "no sé el nombre todavía"
    // en vez de "Cliente: Sin nombre" (que rompería "pregúntalo una sola vez").
    expect(bloque_etapa_cliente(ctx)).toBeNull();
  });

  test('"Sin nombre" no aparece en el bloque aunque sí haya otros campos', () => {
    const ctx = {
      cliente:      { nombre: 'Sin nombre', etapa_actual: 'Nuevo', categoria_principal: null },
      conversacion: { etapa_objetivo: null },
    };
    const result = bloque_etapa_cliente(ctx);
    expect(result).not.toContain('Sin nombre');
    expect(result).toContain('Nuevo');
  });
});

describe('bloque_knowledge_base()', () => {
  test('incluye las secciones relevantes', () => {
    const result = bloque_knowledge_base(makeCtx());
    expect(result).toContain('1,500kg');
  });

  test('comienza con ## CONOCIMIENTO', () => {
    expect(bloque_knowledge_base(makeCtx())).toMatch(/^## CONOCIMIENTO/);
  });

  test('devuelve null si secciones_relevantes está vacío', () => {
    const ctx = makeCtx();
    ctx.knowledge.secciones_relevantes = '';
    expect(bloque_knowledge_base(ctx)).toBeNull();
  });

  test('devuelve null si knowledge no existe en ctx', () => {
    expect(bloque_knowledge_base({})).toBeNull();
  });
});

describe('bloque_skills()', () => {
  test('lista los skills activos', () => {
    const result = bloque_skills(makeCtx());
    expect(result).toContain('cotizar');
    expect(result).toContain('agendar');
  });

  test('comienza con ## HABILIDADES', () => {
    expect(bloque_skills(makeCtx())).toMatch(/^## HABILIDADES/);
  });

  test('devuelve null si skills_activos es array vacío', () => {
    const ctx = makeCtx();
    ctx.knowledge.skills_activos = [];
    expect(bloque_skills(ctx)).toBeNull();
  });

  test('devuelve null si skills_activos no existe', () => {
    expect(bloque_skills({ knowledge: {} })).toBeNull();
    expect(bloque_skills({})).toBeNull();
  });
});

describe('bloque_resumen_cliente()', () => {
  test('incluye el resumen si existe en cliente.resumen', () => {
    const ctx = makeCtx();
    ctx.cliente.resumen = 'Interesado en rack selectivo. Empresa: LogisMex. Capacidad: 200 pallets.';
    const result = bloque_resumen_cliente(ctx);
    expect(result).toContain('Interesado en rack selectivo');
    expect(result).toMatch(/^## HISTORIAL DEL CLIENTE/);
  });

  test('usa memoria.resumen_largo si cliente.resumen no existe', () => {
    const ctx = makeCtx();
    ctx.cliente.resumen = null;
    ctx.memoria.resumen_largo = 'Resumen desde memoria larga.';
    const result = bloque_resumen_cliente(ctx);
    expect(result).toContain('Resumen desde memoria larga.');
  });

  test('devuelve null si no hay resumen en ninguna fuente', () => {
    const ctx = makeCtx();
    ctx.cliente.resumen = null;
    ctx.memoria.resumen_largo = null;
    expect(bloque_resumen_cliente(ctx)).toBeNull();
  });
});

describe('bloque_campos_pendientes()', () => {
  test('lista los campos faltantes', () => {
    const result = bloque_campos_pendientes(makeCtx());
    expect(result).toContain('num_empleados');
    expect(result).toMatch(/^## INFORMACIÓN PENDIENTE/);
  });

  test('incluye instrucción de captura natural', () => {
    const result = bloque_campos_pendientes(makeCtx());
    expect(result).toContain('de forma natural');
    expect(result).toContain('Máximo uno por respuesta');
  });

  test('devuelve null si campos_faltantes es array vacío', () => {
    const ctx = makeCtx();
    ctx.cliente.campos_faltantes = [];
    expect(bloque_campos_pendientes(ctx)).toBeNull();
  });

  test('devuelve null si cliente no existe en ctx', () => {
    expect(bloque_campos_pendientes({})).toBeNull();
  });

  test('lista múltiples campos correctamente', () => {
    const ctx = makeCtx();
    ctx.cliente.campos_faltantes = ['nombre', 'empresa', 'ciudad'];
    const result = bloque_campos_pendientes(ctx);
    expect(result).toContain('nombre');
    expect(result).toContain('empresa');
    expect(result).toContain('ciudad');
  });
});

describe('bloque_reglas()', () => {
  test('numera y lista las reglas aplicables', () => {
    const result = bloque_reglas(makeCtx());
    expect(result).toContain('1. Máximo 2 preguntas por respuesta');
    expect(result).toContain('2. No ofrecer descuento sin autorización');
    expect(result).toMatch(/^## REGLAS/);
  });

  test('devuelve null si reglas_aplicables es array vacío', () => {
    const ctx = makeCtx();
    ctx.conversacion.reglas_aplicables = [];
    expect(bloque_reglas(ctx)).toBeNull();
  });

  test('devuelve null si conversacion no existe en ctx', () => {
    expect(bloque_reglas({})).toBeNull();
  });
});

describe('bloque_capacidades()', () => {
  test('lista las capacidades disponibles', () => {
    const result = bloque_capacidades(makeCtx());
    expect(result).toContain('crear_oportunidad');
    expect(result).toContain('crear_tarea');
    expect(result).toMatch(/^## ACCIONES DISPONIBLES/);
  });

  test('menciona acciones_propuestas', () => {
    const result = bloque_capacidades(makeCtx());
    expect(result).toContain('acciones_propuestas');
  });

  test('devuelve null si capacidades es array vacío', () => {
    const ctx = makeCtx();
    ctx.knowledge.capacidades = [];
    expect(bloque_capacidades(ctx)).toBeNull();
  });
});

describe('bloque_schema_json()', () => {
  test('siempre devuelve un string no vacío', () => {
    const result = bloque_schema_json(makeCtx());
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(100);
  });

  test('comienza con ## FORMATO DE RESPUESTA', () => {
    expect(bloque_schema_json(makeCtx())).toMatch(/^## FORMATO DE RESPUESTA/);
  });

  test('incluye todos los campos canónicos de AIOutput', () => {
    const result = bloque_schema_json(makeCtx());
    expect(result).toContain('"respuesta_texto"');
    expect(result).toContain('"categoria_principal"');
    expect(result).toContain('"datos_extraidos"');
    expect(result).toContain('"intenciones"');
    expect(result).toContain('"sentimiento"');
    expect(result).toContain('"etapa_sugerida"');
    expect(result).toContain('"acciones_propuestas"');
  });

  test('usa "respuesta_texto" (nombre canónico FASE 2, no "respuesta_tara")', () => {
    const result = bloque_schema_json(makeCtx());
    expect(result).toContain('"respuesta_texto"');
    expect(result).not.toContain('"respuesta_tara"');
  });

  test('incluye las capacidades como tipos de acción válidos', () => {
    const result = bloque_schema_json(makeCtx());
    expect(result).toContain('"crear_oportunidad"');
    expect(result).toContain('"crear_tarea"');
  });

  test('usa tipo genérico si no hay capacidades', () => {
    const ctx = makeCtx();
    ctx.knowledge.capacidades = [];
    const result = bloque_schema_json(ctx);
    expect(result).toContain('"nombre_accion"');
  });

  test('incluye el idioma de la empresa', () => {
    const ctx = makeCtx();
    ctx.empresa.idioma = 'en';
    const result = bloque_schema_json(ctx);
    expect(result).toContain('idioma: en');
  });

  test('incluye instrucción de JSON puro (sin markdown)', () => {
    const result = bloque_schema_json(makeCtx());
    expect(result).toContain('JSON válido');
    expect(result).toContain('Sin markdown');
  });

  test('funciona con ctx mínimo (sin empresa, sin knowledge)', () => {
    expect(() => bloque_schema_json({})).not.toThrow();
    expect(bloque_schema_json({})).toContain('"respuesta_texto"');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER — construir()
// ═════════════════════════════════════════════════════════════════════════════

describe('PromptBuilder.construir()', () => {
  let builder;
  beforeEach(() => { builder = new PromptBuilder(); });

  test('devuelve un string no vacío con contexto completo', () => {
    const prompt = builder.construir(makeCtx());
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(200);
  });

  test('lanza error si ctx es null o undefined', () => {
    expect(() => builder.construir(null)).toThrow('ctx es requerido');
    expect(() => builder.construir(undefined)).toThrow('ctx es requerido');
  });

  test('lanza error si bloques_activos está vacío (prompt vacío)', () => {
    // schema_json siempre produce contenido, así que la única forma de
    // obtener un prompt vacío es configurar bloques_activos como [].
    const builderVacio = new PromptBuilder({ bloques_activos: [] });
    expect(() => builderVacio.construir(makeCtx())).toThrow('prompt vacío');
  });

  test('incluye schema_json siempre (está en ORDEN_DEFAULT)', () => {
    const prompt = builder.construir(makeCtx());
    expect(prompt).toContain('## FORMATO DE RESPUESTA');
    expect(prompt).toContain('"respuesta_texto"');
  });

  test('schema_json es el último bloque del prompt', () => {
    const prompt = builder.construir(makeCtx());
    const posSchema     = prompt.lastIndexOf('## FORMATO DE RESPUESTA');
    const posKnowledge  = prompt.lastIndexOf('## CONOCIMIENTO');
    expect(posSchema).toBeGreaterThan(posKnowledge);
  });

  test('identidad aparece antes que objetivo', () => {
    const prompt = builder.construir(makeCtx());
    const posIdentidad = prompt.indexOf('## IDENTIDAD');
    const posObjetivo  = prompt.indexOf('## OBJETIVO');
    expect(posIdentidad).toBeLessThan(posObjetivo);
  });

  test('bloques vacíos no aparecen en el prompt', () => {
    const ctx = makeCtx();
    ctx.cliente.resumen = null;
    ctx.memoria.resumen_largo = null;
    const prompt = builder.construir(ctx);
    expect(prompt).not.toContain('## HISTORIAL DEL CLIENTE');
  });

  test('bloques sin datos no dejan secciones vacías', () => {
    const ctx = makeCtx();
    ctx.knowledge.skills_activos = [];
    ctx.knowledge.capacidades = [];
    const prompt = builder.construir(ctx);
    expect(prompt).not.toContain('## HABILIDADES');
    expect(prompt).not.toContain('## ACCIONES DISPONIBLES');
  });

  test('bloques se separan con doble salto de línea por defecto', () => {
    const prompt = builder.construir(makeCtx());
    expect(prompt).toContain('\n\n');
  });

  test('separador personalizado funciona', () => {
    const builderCustom = new PromptBuilder({ separador: '\n---\n' });
    const prompt = builderCustom.construir(makeCtx());
    expect(prompt).toContain('\n---\n');
  });

  test('contexto mínimo (solo identidad) produce prompt válido', () => {
    const ctx = makeCtxMinimo();
    const prompt = builder.construir(ctx);
    expect(prompt).toContain('## IDENTIDAD');
    expect(prompt).toContain('## FORMATO DE RESPUESTA');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVACIÓN Y DESACTIVACIÓN DE BLOQUES
// ═════════════════════════════════════════════════════════════════════════════

describe('Activación y desactivación de bloques', () => {
  test('solo los bloques especificados se incluyen', () => {
    const builder = new PromptBuilder({
      bloques_activos: ['identidad', 'schema_json'],
    });
    const prompt = builder.construir(makeCtx());

    expect(prompt).toContain('## IDENTIDAD');
    expect(prompt).toContain('## FORMATO DE RESPUESTA');
    expect(prompt).not.toContain('## OBJETIVO');
    expect(prompt).not.toContain('## CONOCIMIENTO');
    expect(prompt).not.toContain('## REGLAS');
  });

  test('desactivar schema_json lo excluye del prompt', () => {
    const sinSchema = new PromptBuilder({
      bloques_activos: ORDEN_DEFAULT.filter(b => b !== 'schema_json'),
    });
    const prompt = sinSchema.construir(makeCtx());
    expect(prompt).not.toContain('## FORMATO DE RESPUESTA');
  });

  test('solo knowledge_base produce prompt válido', () => {
    const builder = new PromptBuilder({ bloques_activos: ['knowledge_base', 'schema_json'] });
    const prompt  = builder.construir(makeCtx());
    expect(prompt).toContain('## CONOCIMIENTO');
    expect(prompt).toContain('## FORMATO DE RESPUESTA');
  });

  test('bloque desconocido se ignora con warn (no lanza)', () => {
    const builder = new PromptBuilder({
      bloques_activos: ['identidad', 'bloque_inexistente', 'schema_json'],
    });
    expect(() => builder.construir(makeCtx())).not.toThrow();
    const prompt = builder.construir(makeCtx());
    expect(prompt).toContain('## IDENTIDAD');
  });

  test('orden de bloques respeta la configuración', () => {
    const builder = new PromptBuilder({
      bloques_activos: ['schema_json', 'identidad'],
    });
    const prompt = builder.construir(makeCtx());
    const posSchema    = prompt.indexOf('## FORMATO DE RESPUESTA');
    const posIdentidad = prompt.indexOf('## IDENTIDAD');
    expect(posSchema).toBeLessThan(posIdentidad);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// construirBloque() y listarBloques()
// ═════════════════════════════════════════════════════════════════════════════

describe('PromptBuilder.construirBloque()', () => {
  let builder;
  beforeEach(() => { builder = new PromptBuilder(); });

  test('construye un bloque individual correctamente', () => {
    const bloque = builder.construirBloque('identidad', makeCtx());
    expect(bloque).toContain('## IDENTIDAD');
    expect(bloque).toContain('TARA');
  });

  test('devuelve null para bloques con datos vacíos', () => {
    const ctx = makeCtx();
    ctx.knowledge.skills_activos = [];
    expect(builder.construirBloque('skills', ctx)).toBeNull();
  });

  test('lanza error para bloque desconocido', () => {
    expect(() => builder.construirBloque('bloque_inexistente', makeCtx()))
      .toThrow('bloque desconocido "bloque_inexistente"');
  });

  test('puede construir cada bloque del ORDEN_DEFAULT individualmente', () => {
    for (const nombre of ORDEN_DEFAULT) {
      expect(() => builder.construirBloque(nombre, makeCtx())).not.toThrow();
    }
  });
});

describe('PromptBuilder.listarBloques() y listarBloquesActivos()', () => {
  test('listarBloques() devuelve todos los bloques registrados', () => {
    const builder = new PromptBuilder();
    const lista = builder.listarBloques();
    for (const nombre of ORDEN_DEFAULT) {
      expect(lista).toContain(nombre);
    }
  });

  test('listarBloquesActivos() devuelve los bloques configurados', () => {
    const custom = new PromptBuilder({ bloques_activos: ['identidad', 'schema_json'] });
    expect(custom.listarBloquesActivos()).toEqual(['identidad', 'schema_json']);
  });

  test('listarBloquesActivos() no muta el array interno', () => {
    const builder = new PromptBuilder();
    const lista1 = builder.listarBloquesActivos();
    lista1.push('bloque_extra');
    const lista2 = builder.listarBloquesActivos();
    expect(lista2).not.toContain('bloque_extra');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ORDEN_DEFAULT y MAPA_BLOQUES
// ═════════════════════════════════════════════════════════════════════════════

describe('ORDEN_DEFAULT y MAPA_BLOQUES', () => {
  test('ORDEN_DEFAULT es un array de strings no vacío', () => {
    expect(Array.isArray(ORDEN_DEFAULT)).toBe(true);
    expect(ORDEN_DEFAULT.length).toBeGreaterThan(0);
  });

  test('schema_json es el último en ORDEN_DEFAULT', () => {
    expect(ORDEN_DEFAULT[ORDEN_DEFAULT.length - 1]).toBe('schema_json');
  });

  test('identidad es el primero en ORDEN_DEFAULT', () => {
    expect(ORDEN_DEFAULT[0]).toBe('identidad');
  });

  test('todos los nombres en ORDEN_DEFAULT tienen función en MAPA_BLOQUES', () => {
    for (const nombre of ORDEN_DEFAULT) {
      expect(MAPA_BLOQUES[nombre]).toBeDefined();
      expect(typeof MAPA_BLOQUES[nombre]).toBe('function');
    }
  });

  test('no hay duplicados en ORDEN_DEFAULT', () => {
    const unicos = new Set(ORDEN_DEFAULT);
    expect(unicos.size).toBe(ORDEN_DEFAULT.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AGNOSTICISMO
// ═════════════════════════════════════════════════════════════════════════════

describe('Agnosticismo del PromptBuilder', () => {
  test('el source no contiene lógica de ningún giro comercial', () => {
    const fs   = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../modules/prompt-builder.js'),
      'utf8'
    );
    const terminos = ['rack', 'barbería', 'dental', 'restaurant', 'selectivo', 'logistics'];
    for (const t of terminos) {
      expect(source.toLowerCase()).not.toContain(t);
    }
  });

  test('produce el mismo formato para cualquier tipo de empresa', () => {
    const builder  = new PromptBuilder();
    const ctxCafe  = makeCtx({
      empresa: {
        nombre:             'Café Central',
        personalidad:       'Eres Luisa, barista de Café Central.',
        objetivo_principal: 'Tomar el pedido del cliente.',
        idioma:             'es',
        zona_horaria:       'America/Mexico_City',
      },
    });
    const ctxTienda = makeCtx({
      empresa: {
        nombre:             'TechStore',
        personalidad:       'Eres Max, asesor tecnológico de TechStore.',
        objetivo_principal: 'Recomendar el dispositivo ideal.',
        idioma:             'en',
        zona_horaria:       'America/Chicago',
      },
    });

    // Ambos producen el mismo esquema de bloques — solo el contenido difiere
    const promptCafe  = builder.construir(ctxCafe);
    const promptTienda = builder.construir(ctxTienda);

    // Misma estructura de secciones
    const seccionesCafe  = promptCafe.match(/^## .+/gm)  || [];
    const seccionesTienda = promptTienda.match(/^## .+/gm) || [];
    expect(seccionesCafe).toEqual(seccionesTienda);

    // Contenido diferente
    expect(promptCafe).toContain('Luisa');
    expect(promptTienda).toContain('Max');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTEGRACIÓN: PromptBuilder + ContextBuilder → output compatible con AIEngine
// ═════════════════════════════════════════════════════════════════════════════

describe('Integración PromptBuilder → AIInput', () => {
  test('el prompt generado es un string válido para AIInput.system_prompt', () => {
    const { ContextBuilder } = require('../modules/context-builder');
    const cb     = new ContextBuilder({ max_tokens_contexto: 10000 });
    const pb     = new PromptBuilder();

    const ctx = cb.construir({
      company_id:            'co-001',
      canal:                 'whatsapp',
      identificador_cliente: '+5218112345678',
      mensaje_actual:        '¿Cuánto cuesta el rack selectivo?',
      empresa_config: {
        nombre_empresa:        'Total Racks',
        personalidad:          'Eres TARA, especialista en almacenamiento.',
        objetivo_principal:    'Generar cotización formal.',
        knowledge_base:        'Rack Selectivo\nPrecio base $45,000.',
        campos_requeridos:     ['nombre'],
        reglas:                [{ texto: 'Máximo 2 preguntas', etapas: [] }],
        skills:                [{ nombre: 'cotizar', activo: true }],
        capacidades:           ['crear_oportunidad'],
        modelo:                'gpt-4o-mini',
        temperatura:           0.6,
        max_tokens:            700,
        ai_max_turnos_memoria: 5,
        kb_max_secciones:      3,
      },
      datos_cliente:         { nombre: null, etapa_actual: 'Nuevo', datos: {} },
      historia_conversacion: [],
      resumen_cliente:       null,
      workflow_state:        null,
      capacidades:           ['crear_oportunidad'],
    });

    const systemPrompt = pb.construir(ctx);
    const aiInput      = cb.prepararParaIA(ctx, systemPrompt);

    expect(typeof aiInput.system_prompt).toBe('string');
    expect(aiInput.system_prompt.length).toBeGreaterThan(100);
    expect(aiInput.system_prompt).toContain('## IDENTIDAD');
    expect(aiInput.system_prompt).toContain('## FORMATO DE RESPUESTA');
    expect(aiInput.modelo).toBe('gpt-4o-mini');
    expect(Array.isArray(aiInput.memoria_corta)).toBe(true);
  });
});
