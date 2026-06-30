/**
 * TARA Matrix™ — Orchestrator
 * ─────────────────────────────────────────────────────────────────────────────
 * Cerebro operativo del Core. Único punto de entrada para el procesamiento
 * de mensajes entrantes.
 *
 * Responsabilidades:
 *   - Coordinar el orden correcto de ejecución entre todos los módulos
 *   - Medir latencia de cada paso
 *   - Manejar errores con fallbacks seguros
 *   - Iniciar auditoría en cada turno
 *   - Mapear entre los formatos de FASE 1 (CRM, Config) y FASE 2 (Core)
 *
 * Lo que NO hace:
 *   - No toma decisiones comerciales
 *   - No conoce productos, servicios ni canales específicos
 *   - No contiene lógica de negocio
 *   - No llama a Supabase ni a ninguna API directamente
 *
 * Todos los módulos se comunican exclusivamente a través del Orchestrator.
 * Ningún módulo llama a otro directamente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Flujo:
 *
 *   Message → Config → CRM → ContextBuilder → PromptBuilder
 *          → AIEngine → Acciones → Guardar → AuditLogger → Resultado
 *
 * Garantía de disponibilidad:
 *   Cualquier fallo en cualquier paso produce una respuesta de emergencia.
 *   El servidor NUNCA se cae por un error interno.
 *
 * @module modules/orchestrator
 */

'use strict';

const { randomUUID } = require('crypto');

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═════════════════════════════════════════════════════════════════════════════

const RESPUESTA_EMERGENCIA = '¿Puedes repetir tu mensaje? Tuve un momento técnico.';

// Capacidades disponibles en FASE 2.
// FASE 4 (Action Runner) hará esto dinámico desde empresa_config.
const CAPACIDADES_FASE2 = ['crear_oportunidad'];

// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═════════════════════════════════════════════════════════════════════════════

class Orchestrator {
  /**
   * @param {Object} deps - Todas las dependencias inyectadas
   *
   * Módulos FASE 2 (requeridos):
   * @param {import('./context-builder').ContextBuilder} deps.contextBuilder
   * @param {import('./prompt-builder').PromptBuilder}   deps.promptBuilder
   * @param {import('./ai-engine').AIEngine}             deps.aiEngine
   * @param {import('./audit-logger').AuditLogger}       deps.auditLogger
   *
   * Funciones FASE 1 (inyectables para testing):
   * @param {Function} deps.obtenerConfigEmpresa   - () → { company, personality, knowledge }
   * @param {Function} deps.obtenerOCrearCliente   - (telefono) → cliente
   * @param {Function} deps.obtenerHistorial       - (clienteId) → MessagePair[]
   * @param {Function} deps.guardarConversacion    - (id, msg, resp, cat, int, sent) → void
   * @param {Function} [deps.actualizarScore]      - (clienteId, scoreActual) → void
   * @param {Function} [deps.crearOportunidad]     - (clienteId, cat, msg, intenciones) → void
   */
  constructor(deps) {
    this._validarDeps(deps);

    // FASE 2
    this._ctx    = deps.contextBuilder;
    this._prompt = deps.promptBuilder;
    this._ai     = deps.aiEngine;
    this._log    = deps.auditLogger;

    // FASE 1
    this._obtenerConfig  = deps.obtenerConfigEmpresa;
    this._obtenerCliente = deps.obtenerOCrearCliente;
    this._obtenerHist    = deps.obtenerHistorial;
    this._guardarConv    = deps.guardarConversacion;

    // Stubs FASE 4 (Action Runner — opcionales)
    this._actualizarScore  = deps.actualizarScore   || null;
    this._crearOportunidad = deps.crearOportunidad  || null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MÉTODO PRINCIPAL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Procesa un mensaje entrante y retorna la respuesta del Core.
   * Nunca lanza — siempre devuelve OrchestratorResult.
   *
   * @param {import('../adapters/channels/channel-adapter').Message} message
   * @returns {Promise<OrchestratorResult>}
   *
   * @typedef {Object} OrchestratorResult
   * @property {string}      respuesta_texto
   * @property {string}      session_id
   * @property {Object}      timings
   * @property {Object|null} ai_output
   */
  async procesarMensaje(message) {
    const sessionId = randomUUID();
    const timings   = {};
    const t0        = Date.now();

    // ── 1. Config de empresa (sin esto no hay flujo) ───────────────────────
    const configResult = await this._paso('config', timings, () =>
      this._obtenerConfig(message.company_id)
    );
    if (!configResult.ok) {
      console.error('❌ Orchestrator: config no disponible —', configResult.error.message);
      return this._emergencia(sessionId, timings, t0);
    }

    const empresaRaw  = configResult.value;
    const company_id  = empresaRaw.company?.id;
    const empresaConf = this._mapearEmpresaConfig(empresaRaw);

    // ctx mínimo para logging antes de tener el contexto completo
    const ctxBase = {
      company_id,
      canal:   message.channel,
      cliente: { identificador: message.from },
      conversacion: null,
    };

    // ── 2. Cliente (fallo = continúa sin cliente) ──────────────────────────
    const clienteResult = await this._paso('crm', timings, () =>
      this._obtenerCliente(message.from, message.company_id)
    );
    if (!clienteResult.ok) {
      this._log.logError(ctxBase, 'crm.obtenerCliente', clienteResult.error, { session_id: sessionId });
    }
    const clienteRaw = clienteResult.ok ? clienteResult.value : null;

    // ── 3. Historial (fallo = historial vacío) ─────────────────────────────
    const histResult = await this._paso('historial', timings, () =>
      clienteRaw?.id ? this._obtenerHist(clienteRaw.id) : Promise.resolve([])
    );
    if (!histResult.ok) {
      this._log.logError(ctxBase, 'crm.obtenerHistorial', histResult.error, { session_id: sessionId });
    }
    const historia = histResult.ok ? (histResult.value || []) : [];

    // ── 4. Context Builder ─────────────────────────────────────────────────
    const ctxResult = this._pasoSync('context', timings, () =>
      this._ctx.construir({
        company_id,
        canal:                 message.channel,
        identificador_cliente: message.from,
        mensaje_actual:        message.content,
        empresa_config:        empresaConf,
        datos_cliente:         this._mapearDatosCliente(clienteRaw),
        historia_conversacion: historia,
        resumen_cliente:       null,   // FASE 6
        workflow_state:        null,   // FASE 5
        capacidades:           CAPACIDADES_FASE2,
      })
    );
    if (!ctxResult.ok) {
      this._log.logError(ctxBase, 'context-builder', ctxResult.error, { session_id: sessionId });
      return this._emergencia(sessionId, timings, t0);
    }
    const ctx = ctxResult.value;

    // Evento de canal ahora que tenemos ctx completo
    this._log.logChannelEvent(ctx, 'mensaje_recibido', {
      preview:     message.content.substring(0, 100),
      mensaje_sid: message.raw_metadata?.MessageSid || null,
    }, { session_id: sessionId });

    // ── 5. Prompt Builder ──────────────────────────────────────────────────
    const promptResult = this._pasoSync('prompt', timings, () =>
      this._prompt.construir(ctx)
    );
    if (!promptResult.ok) {
      this._log.logError(ctx, 'prompt-builder', promptResult.error, { session_id: sessionId });
      return this._emergencia(sessionId, timings, t0);
    }

    // ── 6. AIInput ─────────────────────────────────────────────────────────
    const aiInput = this._ctx.prepararParaIA(ctx, promptResult.value);

    // ── 7. AI Engine ───────────────────────────────────────────────────────
    const aiResult = await this._paso('ai', timings, () =>
      this._ai.procesar(aiInput)
    );
    // AIEngine nunca lanza — si falló igual devuelve FALLBACK_OUTPUT
    const aiOutput = aiResult.ok ? aiResult.value : {
      respuesta_texto:     RESPUESTA_EMERGENCIA,
      categoria_principal: 'Sin clasificar',
      intenciones:         ['consulta'],
      sentimiento:         'Neutral',
      etapa_sugerida:      null,
      acciones_propuestas: [],
      confianza:           0,
      tokens_entrada:      0,
      tokens_salida:       0,
      modelo_utilizado:    'fallback',
      proveedor_utilizado: 'none',
      latencia_ms:         0,
    };

    // ── 8. Acciones propuestas (stub FASE 4) ───────────────────────────────
    await this._paso('acciones', timings, () =>
      this._ejecutarAcciones(aiOutput.acciones_propuestas, ctx, clienteRaw, aiOutput, sessionId)
    );

    // ── 9. Guardar conversación ────────────────────────────────────────────
    if (clienteRaw?.id) {
      const saveResult = await this._paso('save', timings, () =>
        this._guardarConv(
          clienteRaw.id,
          message.company_id,
          message.content,
          aiOutput.respuesta_texto,
          aiOutput.categoria_principal,
          aiOutput.intenciones,
          aiOutput.sentimiento
        )
      );
      if (!saveResult.ok) {
        this._log.logError(ctx, 'crm.guardarConversacion', saveResult.error, { session_id: sessionId });
      }
    }

    // ── 10. Auditoría ──────────────────────────────────────────────────────
    timings.total_ms = Date.now() - t0;
    this._log.logAICall(ctx, aiInput, aiOutput, { session_id: sessionId });
    this._log.logChannelEvent(ctx, 'mensaje_enviado', {
      preview: aiOutput.respuesta_texto.substring(0, 100),
    }, { session_id: sessionId });

    console.log(`✅ [${sessionId.slice(0, 8)}] ${message.from} — ${timings.total_ms}ms — confianza:${aiOutput.confianza}`);

    return {
      respuesta_texto: aiOutput.respuesta_texto,
      session_id:      sessionId,
      timings,
      ai_output:       aiOutput,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAPEADORES — traducen entre FASE 1 y el Core
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Traduce la salida de obtenerConfigEmpresa() al formato que requiere ContextBuilder.
   * Este es el único lugar donde se hace esta traducción.
   */
  _mapearEmpresaConfig({ company, personality, knowledge }) {
    return {
      company_id:            company.id,
      nombre_empresa:        company.nombre                || '',
      personalidad:          this._mapearPersonalidad(personality, company),
      objetivo_principal:    personality?.objetivo         || '',
      idioma:                personality?.idioma           || 'es',
      zona_horaria:          personality?.zona_horaria     || 'America/Monterrey',
      modelo:                personality?.modelo           || 'gpt-4o-mini',
      temperatura:           personality?.temperatura      ?? 0.6,
      max_tokens:            personality?.max_tokens       ?? 700,
      knowledge_base:        this._mapearKnowledge(knowledge),
      skills:                personality?.skills           || [],
      campos_requeridos:     personality?.campos_requeridos || [],
      reglas:                personality?.reglas           || [],
      ai_max_turnos_memoria: personality?.max_turnos_memoria ?? 8,
      kb_max_secciones:      personality?.kb_max_secciones   ?? 3,
    };
  }

  /**
   * Construye el string de identidad del asistente.
   * Solo contiene identidad/tono/restricciones.
   * Objetivo, conocimiento y reglas son bloques separados en PromptBuilder.
   */
  _mapearPersonalidad(personality, company) {
    if (!personality) return '';

    const nombre = personality.nombre_asistente || 'TARA';
    const cargo  = personality.cargo            || 'Asistente Virtual';
    const tono   = personality.tono             || 'profesional y amable';

    return [
      `Eres ${nombre}, ${cargo} de ${company.nombre}.`,
      company.descripcion ? company.descripcion : null,
      `Tono de comunicación: ${tono}.`,
      'Nunca menciones que eres IA, bot, asistente virtual o inteligencia artificial.',
      'Evita frases genéricas: no uses "Gracias por tu mensaje", "Estoy aquí para ayudarte" ni "¿Puedes proporcionar más información?".',
      'Cuando tengas suficiente información, da tu recomendación con justificación concreta. No sigas pidiendo datos innecesarios.',
    ].filter(Boolean).join('\n');
  }

  /**
   * Convierte el array de knowledge (tabla knowledge_base de Supabase)
   * en un string estructurado para el ContextBuilder.
   */
  _mapearKnowledge(knowledge) {
    if (!Array.isArray(knowledge) || knowledge.length === 0) return '';
    return knowledge
      .map(k => `[${(k.categoria || '').toUpperCase()}]\n${k.contenido || ''}`)
      .join('\n\n');
  }

  /**
   * Traduce el objeto cliente de CRM al formato ClienteData del ContextBuilder.
   */
  _mapearDatosCliente(cliente) {
    if (!cliente) return null;
    return {
      nombre:              (cliente.nombre && cliente.nombre !== 'Sin nombre')
                             ? cliente.nombre
                             : null,
      etapa_actual:        cliente.estado       || 'Nuevo',
      categoria_principal: null,   // FASE 3: vendrá de la última conversación
      datos:               {},     // FASE 3: campos_extraidos acumulados
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCIONES (stub FASE 4 — Action Runner)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ejecuta las acciones propuestas por el AI Engine.
   * FASE 2: implementación mínima de compatibilidad con FASE 1.
   * FASE 4: el Action Runner completo reemplazará este método.
   */
  async _ejecutarAcciones(acciones, ctx, clienteRaw, aiOutput, sessionId) {
    if (!Array.isArray(acciones) || acciones.length === 0) return;
    if (!clienteRaw?.id) return;

    for (const accion of acciones) {
      if (accion.tipo === 'crear_oportunidad' && this._crearOportunidad) {
        try {
          await this._crearOportunidad(
            clienteRaw.id,
            ctx.company_id,
            aiOutput.categoria_principal || null,
            ctx.mensaje_actual,
            aiOutput.intenciones || []
          );
          this._log.logAccion(ctx, accion.tipo, accion.parametros, { exito: true }, { session_id: sessionId });
        } catch (err) {
          this._log.logAccion(ctx, accion.tipo, accion.parametros, { error: err.message }, { session_id: sessionId });
        }
      }
    }

    // Actualizar score de interés siempre que hay interacciones
    if (this._actualizarScore) {
      try {
        await this._actualizarScore(clienteRaw.id, clienteRaw.score_interes || 0);
      } catch (err) {
        this._log.logError(ctx, 'crm.actualizarScore', err, { session_id: sessionId });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS INTERNOS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Ejecuta un paso async y captura timing + errores sin lanzar. */
  async _paso(nombre, timings, fn) {
    const t = Date.now();
    try {
      const value = await fn();
      timings[`${nombre}_ms`] = Date.now() - t;
      return { ok: true, value };
    } catch (error) {
      timings[`${nombre}_ms`] = Date.now() - t;
      console.error(`❌ Orchestrator[${nombre}]:`, error.message);
      return { ok: false, error };
    }
  }

  /** Ejecuta un paso síncrono y captura timing + errores sin lanzar. */
  _pasoSync(nombre, timings, fn) {
    const t = Date.now();
    try {
      const value = fn();
      timings[`${nombre}_ms`] = Date.now() - t;
      return { ok: true, value };
    } catch (error) {
      timings[`${nombre}_ms`] = Date.now() - t;
      console.error(`❌ Orchestrator[${nombre}]:`, error.message);
      return { ok: false, error };
    }
  }

  /** Respuesta de emergencia cuando el flujo no puede continuar. */
  _emergencia(sessionId, timings, t0) {
    timings.total_ms = Date.now() - t0;
    return {
      respuesta_texto: RESPUESTA_EMERGENCIA,
      session_id:      sessionId,
      timings,
      ai_output:       null,
    };
  }

  _validarDeps(deps) {
    const requeridos = [
      'contextBuilder', 'promptBuilder', 'aiEngine', 'auditLogger',
      'obtenerConfigEmpresa', 'obtenerOCrearCliente',
      'obtenerHistorial', 'guardarConversacion',
    ];
    for (const dep of requeridos) {
      if (!deps[dep]) throw new Error(`Orchestrator: dependencia requerida faltante — "${dep}"`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// FACTORY — para uso en producción (server.js)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Crea y cablea un Orchestrator con todas las dependencias de producción.
 * Acepta overrides para testing o configuración especial.
 *
 * @param {Partial<ConstructorParameters<typeof Orchestrator>[0]>} [overrides]
 * @returns {Orchestrator}
 */
function crearOrchestrator(overrides = {}) {
  const { ContextBuilder } = require('./context-builder');
  const { PromptBuilder }  = require('./prompt-builder');
  const { AIEngine }       = require('./ai-engine');
  const { AuditLogger }    = require('./audit-logger');
  const { OpenAIProvider } = require('../adapters/ai/openai-provider');
  const { MockProvider }   = require('../adapters/ai/mock-provider');

  const { supabase, openai: openaiClient } = require('./clients');

  const {
    obtenerConfigEmpresa,
  }                    = require('./config');
  const {
    obtenerOCrearCliente,
    obtenerHistorial,
    guardarConversacion,
    crearOportunidadSiCorresponde,
    actualizarScoreInteres,
  }                    = require('./crm');

  const mock   = new MockProvider({ latencia_ms: 0 });
  const engine = new AIEngine(mock);
  engine.registerProvider(new OpenAIProvider(openaiClient));

  return new Orchestrator({
    contextBuilder:       overrides.contextBuilder    || new ContextBuilder(),
    promptBuilder:        overrides.promptBuilder     || new PromptBuilder(),
    aiEngine:             overrides.aiEngine          || engine,
    auditLogger:          overrides.auditLogger       || new AuditLogger(supabase),
    obtenerConfigEmpresa: overrides.obtenerConfigEmpresa || obtenerConfigEmpresa,
    obtenerOCrearCliente: overrides.obtenerOCrearCliente || obtenerOCrearCliente,
    obtenerHistorial:     overrides.obtenerHistorial     || obtenerHistorial,
    guardarConversacion:  overrides.guardarConversacion  || guardarConversacion,
    crearOportunidad:     overrides.crearOportunidad     || crearOportunidadSiCorresponde,
    actualizarScore:      overrides.actualizarScore      || actualizarScoreInteres,
  });
}

module.exports = { Orchestrator, crearOrchestrator, RESPUESTA_EMERGENCIA };
