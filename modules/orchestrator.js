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

const { randomUUID }  = require('crypto');
const { ActionRunner } = require('./action-runner');

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

    // FASE 4A — WorkflowEngine M5 (opcional: null-safe en todo el flujo)
    this._workflow = deps.workflowEngine || null;

    // FASE 4B / ANEXO A (TA.4) — Action Runner (M8)
    this._actualizarScore  = deps.actualizarScore   || null;
    this._crearOportunidad = deps.crearOportunidad  || null;
    this._actionRunner     = deps.actionRunner      || this._crearActionRunnerPorDefecto();
  }

  /**
   * Cuando no se inyecta un ActionRunner explícito (caso de la mayoría de los
   * tests y de código previo a TA.4), se arma uno mínimo que registra
   * 'crear_oportunidad' usando la función inyectada — mismo comportamiento
   * observable que el stub anterior, ahora enrutado por el mecanismo genérico.
   */
  _crearActionRunnerPorDefecto() {
    const runner = new ActionRunner();
    if (this._crearOportunidad) {
      runner.registrar('crear_oportunidad', (parametros, ctx) =>
        this._crearOportunidad(
          ctx.clienteRaw.id,
          ctx.company_id,
          ctx.aiOutput.categoria_principal || null,
          ctx.mensaje_actual,
          ctx.aiOutput.intenciones || []
        )
      );
    }
    return runner;
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
    // let porque WorkflowEngine puede reemplazar respuesta_texto en el paso 8
    let aiOutput = aiResult.ok ? aiResult.value : {
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

    // ── 8. WorkflowEngine M5 (FASE 4A) ────────────────────────────────────
    if (this._workflow && clienteRaw?.id) {
      const wfResult = await this._paso('workflow', timings, () =>
        this._manejarWorkflow(message.content, clienteRaw, aiOutput, company_id, ctx, sessionId)
      );
      if (wfResult.ok && wfResult.value !== null) {
        aiOutput = { ...aiOutput, respuesta_texto: wfResult.value };
      }
    }

    // ── 9. Acciones propuestas (stub FASE 4B) ──────────────────────────────
    await this._paso('acciones', timings, () =>
      this._ejecutarAcciones(aiOutput.acciones_propuestas, ctx, clienteRaw, aiOutput, sessionId)
    );

    // ── 10. Guardar conversación ───────────────────────────────────────────
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

    // ── 11. Auditoría ─────────────────────────────────────────────────────
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
  // WORKFLOW ENGINE — M5 (FASE 4A)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Decide si el turno pertenece a un workflow activo o activa uno nuevo.
   * Retorna el texto final a enviar, o null si el flujo normal no cambia.
   *
   * @param {string} mensajeCliente
   * @param {Object} clienteRaw
   * @param {Object} aiOutput
   * @param {string} company_id
   * @param {Object} ctx        - contexto de auditoría (para _ejecutarAcciones)
   * @param {string} sessionId
   * @returns {Promise<string|null>}
   */
  async _manejarWorkflow(mensajeCliente, clienteRaw, aiOutput, company_id, ctx, sessionId) {
    const intenciones = aiOutput.intenciones || [];

    // ── Caso A: sesión de workflow activa ────────────────────────────────────
    const sesion = await this._workflow.obtenerSesionActiva(company_id, clienteRaw.id);

    if (sesion) {
      // El cliente quiere cancelar el flujo
      if (intenciones.includes('cancelar_flujo')) {
        await this._workflow.abandonar(sesion.id, sesion.current_node);
        console.log(`⬜ [workflow] sesión ${sesion.id.slice(0, 8)} abandonada en nodo "${sesion.current_node}"`);
        return null; // el AI ya generó una respuesta apropiada
      }

      const nodo = await this._workflow.obtenerNodoActual(sesion);
      if (!nodo) return null;

      // Campo requerido pero respuesta vacía → re-preguntar
      if (nodo.campo && !nodo.es_opcional && !mensajeCliente.trim()) {
        return nodo.pregunta;
      }

      // Punto 2: usar el valor extraído por la IA cuando el campo fue capturado explícitamente;
      // fallback al mensaje crudo si no hay valor extraído o es null.
      const valorExtraido = nodo.campo ? (aiOutput.datos_extraidos || {})[nodo.campo] : undefined;
      const valorParaNodo = (valorExtraido != null && String(valorExtraido).trim() !== '')
        ? String(valorExtraido).trim()
        : mensajeCliente.trim();

      const resultado = await this._workflow.avanzar(sesion, nodo, valorParaNodo);

      if (resultado.completado) {
        console.log(`✅ [workflow] sesión ${sesion.id.slice(0, 8)} completada`);
        if (nodo.acciones?.length) {
          await this._ejecutarAcciones(nodo.acciones, ctx, clienteRaw, aiOutput, sessionId);
        }
        return aiOutput.respuesta_texto;
      }

      console.log(`➡️  [workflow] sesión ${sesion.id.slice(0, 8)} avanzó a "${resultado.siguiente_nodo?.nombre}"`);

      // Bug #4: merge datos del turno actual con historial de captured_fields
      const datosMergeados = this._mergeDatosAutoAvance(
        aiOutput.datos_extraidos || {},
        resultado.sesion.captured_fields || {}
      );
      // Pre-save para turnos futuros (fire-and-forget, no bloquea el flujo)
      this._workflow.preSalvarDatosExtraidos(resultado.sesion.id, aiOutput.datos_extraidos || {})
        .catch(e => console.warn(`⚠️  preSalvarDatosExtraidos: ${e.message}`));

      const { completado: autoCompletadoA, siguiente_nodo: nextNode, nodo_completado: nodoCompletadoA } =
        await this._avanzarSaltandoRespondidos(resultado.sesion, resultado.siguiente_nodo, datosMergeados);

      if (autoCompletadoA) {
        console.log(`✅ [workflow] sesión ${sesion.id.slice(0, 8)} completada (auto-advance)`);
        if (nodoCompletadoA?.acciones?.length) {
          await this._ejecutarAcciones(nodoCompletadoA.acciones, ctx, clienteRaw, aiOutput, sessionId);
        }
        return aiOutput.respuesta_texto;
      }
      if (!nextNode) return null;
      if (nextNode.modo_respuesta === 'full_ai')    return aiOutput.respuesta_texto;
      if (nextNode.modo_respuesta === 'prepend_ai') {
        const transicion = this._extraerTransicion(aiOutput.respuesta_texto);
        return transicion ? `${transicion} ${nextNode.pregunta}` : nextNode.pregunta;
      }
      return nextNode.pregunta;
    }

    // ── Caso B: sin sesión activa — ¿las intenciones activan un workflow? ─────

    // Bug #1: no reactivar si hay sesión completada en las últimas 24 horas
    const completadaReciente = await this._workflow.tieneSesionCompletadaReciente(company_id, clienteRaw.id, 24);
    if (completadaReciente) return null;

    const workflow = await this._workflow.evaluar(company_id, intenciones);
    if (!workflow) return null; // flujo conversacional normal, sin cambios

    const nuevaSesion = await this._workflow.iniciarSesion(
      company_id,
      clienteRaw.id,
      null, // conversation_id: se deja null (disponible post-save en FASE 5)
      workflow.id
    );

    const nodoInicio = await this._workflow.obtenerNodoActual(nuevaSesion);
    if (!nodoInicio) return null;

    console.log(`🟢 [workflow] "${workflow.nombre}" iniciado — sesión ${nuevaSesion.id.slice(0, 8)}`);

    // Auto-advance past nodes whose campo the client already provided in this message
    const { completado: autoCompletadoB, sesion: sesionFinalB, siguiente_nodo: nodoReal, nodo_completado: nodoCompletadoB } =
      await this._avanzarSaltandoRespondidos(nuevaSesion, nodoInicio, aiOutput.datos_extraidos || {});

    if (autoCompletadoB) {
      if (nodoCompletadoB?.acciones?.length) {
        await this._ejecutarAcciones(nodoCompletadoB.acciones, ctx, clienteRaw, aiOutput, sessionId);
      }
      return aiOutput.respuesta_texto;
    }

    // Bug #4: pre-save datos extraídos para nodos no alcanzados aún
    this._workflow.preSalvarDatosExtraidos(sesionFinalB.id, aiOutput.datos_extraidos || {})
      .catch(e => console.warn(`⚠️  preSalvarDatosExtraidos: ${e.message}`));

    if (!nodoReal) return null;

    if (nodoReal.modo_respuesta === 'full_ai')    return aiOutput.respuesta_texto;
    if (nodoReal.modo_respuesta === 'prepend_ai') {
      const transicion = this._extraerTransicion(aiOutput.respuesta_texto);
      return transicion ? `${transicion} ${nodoReal.pregunta}` : nodoReal.pregunta;
    }
    return nodoReal.pregunta;
  }

  /**
   * Extrae hasta 2 oraciones declarativas de un texto para usarlas como transición.
   * Descarta oraciones interrogativas — la siguiente pregunta viene del nodo workflow.
   * Usado en modo_respuesta 'prepend_ai'.
   */
  _extraerTransicion(texto) {
    if (!texto) return '';
    const oraciones    = texto.match(/[^.!?]+[.!?]+/g) || [];
    const declarativas = oraciones.filter(o => !o.trimEnd().endsWith('?'));
    return declarativas.slice(0, 1).join(' ').trim();
  }

  /**
   * Avanza automáticamente por nodos cuyo campo ya fue extraído por la IA del mensaje.
   * Llama a avanzar() por cada nodo omitible; se detiene en el primero sin dato.
   *
   * @param {Object} sesion   - sesión workflow actual
   * @param {Object|null} nodo - nodo a evaluar
   * @param {Object} datos    - aiOutput.datos_extraidos
   * @returns {Promise<{completado: boolean, sesion: Object, siguiente_nodo: Object|null, nodo_completado: Object|null}>}
   */
  async _avanzarSaltandoRespondidos(sesion, nodo, datos) {
    let currentSesion = sesion;
    let currentNodo   = nodo;

    while (currentNodo) {
      const { campo } = currentNodo;
      if (!campo) break;
      const valor = datos[campo] != null ? String(datos[campo]).trim() : '';
      if (!valor) break;

      const resultado = await this._workflow.avanzar(currentSesion, currentNodo, valor);
      console.log(`⏭️  [workflow] auto-avanzó "${currentNodo.nombre}" → "${valor}"`);

      if (resultado.completado) {
        return { completado: true, sesion: resultado.sesion, siguiente_nodo: null, nodo_completado: currentNodo };
      }

      currentSesion = resultado.sesion;
      currentNodo   = resultado.siguiente_nodo;
    }

    return { completado: false, sesion: currentSesion, siguiente_nodo: currentNodo };
  }

  /**
   * Bug #4 — Combina datos del turno actual con datos acumulados en captured_fields.
   * Los valores explícitos del turno actual tienen precedencia sobre el historial;
   * el historial (captured_fields) llena los huecos que el turno actual dejó vacíos.
   *
   * @param {Object} datosExtraidos  — aiOutput.datos_extraidos del mensaje actual
   * @param {Object} capturedFields  — sesion.captured_fields (historial acumulado)
   * @returns {Object}
   */
  _mergeDatosAutoAvance(datosExtraidos, capturedFields) {
    const merged = { ...capturedFields };
    for (const [k, v] of Object.entries(datosExtraidos)) {
      if (v != null && String(v).trim() !== '') merged[k] = v;
    }
    return merged;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCIONES — ActionRunner (M8, ANEXO A TA.4)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ejecuta las acciones propuestas por el AI Engine, despachando cada una
   * por su `tipo` a través del ActionRunner (M8).
   */
  async _ejecutarAcciones(acciones, ctx, clienteRaw, aiOutput, sessionId) {
    if (!Array.isArray(acciones) || acciones.length === 0) return;
    if (!clienteRaw?.id) return;

    const handlerCtx = { ...ctx, clienteRaw, aiOutput };

    for (const accion of acciones) {
      try {
        const resultado = await this._actionRunner.ejecutar(accion, handlerCtx);
        if (resultado?.error) {
          this._log.logAccion(ctx, accion.tipo, accion.parametros, { error: resultado.error }, { session_id: sessionId });
        } else {
          this._log.logAccion(ctx, accion.tipo, accion.parametros, { exito: true }, { session_id: sessionId });
        }
      } catch (err) {
        this._log.logAccion(ctx, accion.tipo, accion.parametros, { error: err.message }, { session_id: sessionId });
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
  const { ContextBuilder }  = require('./context-builder');
  const { PromptBuilder }   = require('./prompt-builder');
  const { AIEngine }        = require('./ai-engine');
  const { AuditLogger }     = require('./audit-logger');
  const { WorkflowEngine }  = require('./workflow-engine');
  const { OpenAIProvider }  = require('../adapters/ai/openai-provider');
  const { MockProvider }    = require('../adapters/ai/mock-provider');
  const { SchedulingEngine }       = require('./scheduling-engine');
  const { obtenerProviderParaEmpresa } = require('./google-auth');
  const { MockCalendarProvider }   = require('../adapters/calendar/mock-calendar-provider');

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

  // ANEXO A (TA.4) — 'crear_oportunidad' migra al mecanismo genérico de
  // ActionRunner.
  // ANEXO A (TA.6) — acciones de agenda, resolviendo un SchedulingEngine por
  // empresa (cada empresa tiene su propia cuenta de Google — no hay un solo
  // CalendarProvider global como sí lo hay para AIProvider). Si la empresa
  // no ha conectado Google todavía, se usa MockCalendarProvider como
  // fallback seguro — la agenda interna sigue funcionando, solo sin sync
  // externo, en vez de romper el turno completo.
  const crearOportunidad = overrides.crearOportunidad || crearOportunidadSiCorresponde;

  async function schedulingEngineParaEmpresa(company_id) {
    const provider = (await obtenerProviderParaEmpresa(supabase, company_id)) || new MockCalendarProvider();
    return new SchedulingEngine(supabase, provider);
  }

  const actionRunner = overrides.actionRunner || (() => {
    const runner = new ActionRunner();

    runner.registrar('crear_oportunidad', (parametros, ctx) =>
      crearOportunidad(
        ctx.clienteRaw.id,
        ctx.company_id,
        ctx.aiOutput.categoria_principal || null,
        ctx.mensaje_actual,
        ctx.aiOutput.intenciones || []
      )
    );

    runner.registrar('consultar_disponibilidad', async (parametros, ctx) => {
      const scheduling = await schedulingEngineParaEmpresa(ctx.company_id);
      return scheduling.consultarDisponibilidad(ctx.company_id, {
        asesorId:        parametros.asesorId,
        fecha:           new Date(parametros.fecha),
        duracionMinutos: parametros.duracionMinutos,
      });
    });

    runner.registrar('agendar_cita', async (parametros, ctx) => {
      const scheduling = await schedulingEngineParaEmpresa(ctx.company_id);
      return scheduling.agendarCita(ctx.company_id, {
        clienteId:        ctx.clienteRaw.id,
        asesorId:         parametros.asesorId,
        inicio:           new Date(parametros.inicio),
        fin:              new Date(parametros.fin),
        origenWorkflowId: parametros.origenWorkflowId,
      });
    });

    runner.registrar('reagendar_cita', async (parametros, ctx) => {
      const scheduling = await schedulingEngineParaEmpresa(ctx.company_id);
      return scheduling.reagendarCita(
        { id: parametros.citaId },
        new Date(parametros.nuevoInicio),
        new Date(parametros.nuevoFin)
      );
    });

    runner.registrar('cancelar_cita', async (parametros, ctx) => {
      const scheduling = await schedulingEngineParaEmpresa(ctx.company_id);
      return scheduling.cancelarCita({ id: parametros.citaId });
    });

    return runner;
  })();

  return new Orchestrator({
    contextBuilder:       overrides.contextBuilder    || new ContextBuilder(),
    promptBuilder:        overrides.promptBuilder     || new PromptBuilder(),
    aiEngine:             overrides.aiEngine          || engine,
    auditLogger:          overrides.auditLogger       || new AuditLogger(supabase),
    workflowEngine:       overrides.workflowEngine    || new WorkflowEngine(supabase),
    obtenerConfigEmpresa: overrides.obtenerConfigEmpresa || obtenerConfigEmpresa,
    obtenerOCrearCliente: overrides.obtenerOCrearCliente || obtenerOCrearCliente,
    obtenerHistorial:     overrides.obtenerHistorial     || obtenerHistorial,
    guardarConversacion:  overrides.guardarConversacion  || guardarConversacion,
    actionRunner,
    actualizarScore:      overrides.actualizarScore      || actualizarScoreInteres,
  });
}

module.exports = { Orchestrator, crearOrchestrator, RESPUESTA_EMERGENCIA };
