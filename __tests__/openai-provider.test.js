/**
 * TARA Matrix™ — adapters/ai/openai-provider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Corrección del incidente "Carlos González" / Nort Energy (Alina, 2026-10-16):
 * Bug B — normalizarOutput() descartaba datos_contacto en silencio desde que
 * se agregó el campo al schema del modelo (prompt-builder.js), por lo que
 * clientes.motivo_consulta nunca se llegó a persistir en TODA la plataforma
 * (confirmado con un conteo real en Supabase: 0 filas). Estas pruebas cubren
 * la corrección y agregan un contrato que detecte una regresión futura del
 * mismo tipo (un campo nuevo en el schema del modelo que el normalizador
 * olvide incluir).
 *
 * @module __tests__/openai-provider.test
 */

'use strict';

const { OpenAIProvider, INTENCIONES_VALIDAS } = require('../adapters/ai/openai-provider');

function makeOpenAIClientConRespuesta(jsonRespuesta) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(jsonRespuesta) } }],
          usage:   { prompt_tokens: 100, completion_tokens: 50 },
          model:   'gpt-4o-mini',
        }),
      },
    },
  };
}

function makeInput(overrides = {}) {
  return {
    system_prompt:  'Eres TARA.',
    mensaje_actual: 'Hola',
    memoria_corta:  [],
    modelo:         'gpt-4o-mini',
    ...overrides,
  };
}

describe('OpenAIProvider.procesar() — datos_contacto (Bug B, 2026-10-16)', () => {
  test('el modelo reporta nombre+motivo en este turno → ambos llegan intactos al AIOutput', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Mucho gusto, Carlos.',
      datos_contacto:  { nombre: 'Carlos González', motivo: 'Cotizar paneles solares' },
      intenciones:     ['solicitud_cotizacion'],
      acciones_propuestas: [],
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.datos_contacto).toEqual({ nombre: 'Carlos González', motivo: 'Cotizar paneles solares' });
  });

  test('el modelo no reporta datos_contacto este turno (campo ausente) → null, nunca undefined ni error', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Claro, cuéntame más.',
      intenciones:     ['consulta_general'],
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.datos_contacto).toBeNull();
  });

  test('datos_contacto con nombre/motivo ambos null (el modelo los mandó explícitamente) → null, no un objeto vacío', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Entendido.',
      datos_contacto:  { nombre: null, motivo: null },
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.datos_contacto).toBeNull();
  });

  test('el modelo manda un tipo inesperado en datos_contacto (no objeto) → se descarta, nunca se reenvía crudo', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Ok.',
      datos_contacto:  'Carlos González', // string suelto, no {nombre, motivo}
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.datos_contacto).toBeNull();
  });

  test('nombre/motivo con tipos no-string dentro de datos_contacto se descartan campo a campo (nunca se confía ciego en el modelo)', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Ok.',
      datos_contacto:  { nombre: 12345, motivo: 'Cotizar paneles' },
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.datos_contacto).toEqual({ nombre: null, motivo: 'Cotizar paneles' });
  });

  test('solo nombre, sin motivo este turno → motivo null, nombre intacto', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Mucho gusto.',
      datos_contacto:  { nombre: 'Carlos González' },
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.datos_contacto).toEqual({ nombre: 'Carlos González', motivo: null });
  });
});

describe('INTENCIONES_VALIDAS — sincronización con prompt-builder.js (2026-10-16)', () => {
  test('incluye solicitud_visita_tecnica (antes faltaba, desincronizado del schema real que ve el modelo)', () => {
    expect(INTENCIONES_VALIDAS.has('solicitud_visita_tecnica')).toBe(true);
  });

  test('no se alteraron las demás 6 intenciones ya existentes', () => {
    const esperadas = ['interes_compra', 'solicitud_cotizacion', 'soporte', 'seguimiento', 'cancelar_flujo', 'consulta_general'];
    for (const valor of esperadas) {
      expect(INTENCIONES_VALIDAS.has(valor)).toBe(true);
    }
  });

  test('una intención fuera de catálogo sigue normalizando a consulta_general (sin regresión)', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Ok.',
      intenciones:     ['intencion_inventada_por_el_modelo'],
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.intenciones).toEqual(['consulta_general']);
  });

  test('solicitud_visita_tecnica ahora pasa intacta (antes se habría normalizado a consulta_general por desincronización)', async () => {
    const client = makeOpenAIClientConRespuesta({
      respuesta_texto: 'Claro, coordinamos la visita.',
      intenciones:     ['solicitud_visita_tecnica'],
    });
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    expect(output.intenciones).toEqual(['solicitud_visita_tecnica']);
  });
});

describe('Contrato schema del modelo ↔ normalizarOutput() — detecta pérdidas silenciosas futuras de campos estructurados (2026-10-16)', () => {
  // Campos estructurados del schema que el modelo puede devolver (ver
  // modules/prompt-builder.js::bloque_schema_json) que el Core de verdad
  // consume más adelante (Orchestrator/ActionRunner) — si se agrega uno
  // nuevo al schema y normalizarOutput() no lo incluye, esta prueba falla
  // en vez de descubrirse meses después con un conteo de Supabase en 0,
  // como pasó con datos_contacto.
  const CAMPOS_ESTRUCTURADOS_ESPERADOS = [
    'datos_extraidos', 'datos_contacto', 'acciones_propuestas',
    'clasificacion_contexto', 'intenciones', 'categoria_principal',
  ];

  test('normalizarOutput() (vía procesar()) incluye todos los campos estructurados del contrato, incluso cuando el modelo no los mandó', async () => {
    const client = makeOpenAIClientConRespuesta({ respuesta_texto: 'Ok.' }); // respuesta mínima, sin ningún campo estructurado
    const provider = new OpenAIProvider(client);

    const output = await provider.procesar(makeInput());

    for (const campo of CAMPOS_ESTRUCTURADOS_ESPERADOS) {
      expect(output).toHaveProperty(campo);
    }
  });

  test('el schema real que ve el modelo (prompt-builder.js) declara los mismos campos estructurados que este contrato exige', () => {
    const { PromptBuilder } = require('../modules/prompt-builder');
    const pb = new PromptBuilder();
    const prompt = pb.construir({
      company_id: 'c1', canal: 'whatsapp', identificador_cliente: '+5210000000000',
      mensaje_actual: 'hola', empresa_config: {
        company_id: 'c1', nombre_empresa: 'Test', personalidad: '', objetivo_principal: '',
        idioma: 'es', zona_horaria: 'America/Monterrey', modelo: 'gpt-4o-mini',
        temperatura: 0.6, max_tokens: 700, knowledge_base: '', skills: [],
        campos_requeridos: [], reglas: [], ai_max_turnos_memoria: 8, kb_max_secciones: 3, capacidades: [],
      },
      datos_cliente: null, historia_conversacion: [], resumen_cliente: null,
      workflow_state: null, capacidades: [],
    });
    const texto = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    for (const campo of CAMPOS_ESTRUCTURADOS_ESPERADOS) {
      expect(texto).toContain(`"${campo}"`);
    }
  });
});
