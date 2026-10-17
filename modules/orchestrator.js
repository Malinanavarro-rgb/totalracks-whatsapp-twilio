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
const { instruccionesDePersonalidad } = require('./personalidad-presets');
const { resolverEstadoIdentificacion, puedeEjecutarseAccionComercial, ACCIONES_REQUIEREN_IDENTIFICACION } = require('./identificacion-contacto');

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═════════════════════════════════════════════════════════════════════════════

const RESPUESTA_EMERGENCIA = '¿Puedes repetir tu mensaje? Tuve un momento técnico.';

// Capacidades disponibles en FASE 2.
// FASE 4 (Action Runner) hará esto dinámico desde empresa_config.
const CAPACIDADES_FASE2 = ['crear_oportunidad'];

// Acciones cuyo texto de confirmación nunca debe salir del modelo sin que
// la acción real haya corrido — si el modelo las propone fuera de las
// capacidades de la empresa, el texto se reemplaza (ver
// _textoDesdeResultadoDeAgenda), nunca se deja pasar la promesa sin respaldo.
const ACCIONES_SENSIBLES_DE_AGENDA = ['agendar_cita', 'agendar_cita_con_horario_solicitado', 'reagendar_cita', 'cancelar_cita'];

// Identificación obligatoria de contacto (Alina, 2026-10-16 — ver
// TARA_IDENTIFICACION_CONTACTO_DIAGNOSTICO_V1.md). Excepción puntual
// documentada a ADR-005, mismo criterio que ACCIONES_SENSIBLES_DE_AGENDA:
// estas 4 acciones son las únicas que "requieren identificar al cliente"
// (crean una oportunidad comercial real o comprometen un recurso) — nunca
// se bloquea la respuesta conversacional normal, solo estas acciones.
// PRIORIDAD 3 (incidente cotización 83, 2026-10-16): la lista en sí y la
// decisión de autorización ahora viven en modules/identificacion-contacto.js
// (puedeEjecutarseAccionComercial) — reexportada aquí, nunca duplicada.

/**
 * Backend nunca confía ciego en el modelo (pedido explícito): un valor de
 * datos_contacto solo cuenta si es texto real, no vacío, y no es el
 * placeholder "Sin nombre" (que el modelo podría ecoar sin querer).
 */
function _validarDatoContacto(valor) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  if (!limpio || limpio.toLowerCase() === 'sin nombre') return null;
  return limpio;
}

/**
 * Combina lo YA persistido (`clienteRaw` — la fuente de verdad) con lo que
 * el modelo reportó haberse dicho EN ESTE turno (`datosContacto`,
 * aiOutput.datos_contacto, ya pasado por _validarDatoContacto) — así una
 * identificación dada en el mismo mensaje donde se pide cotizar/agendar no
 * queda bloqueada hasta el siguiente turno. El estado final (sin_identificar/
 * parcial/identificado) es SIEMPRE el que deriva resolverEstadoIdentificacion()
 * desde modules/identificacion-contacto.js — una sola fuente de verdad, no
 * una copia de esa lógica aquí.
 *
 * `capturedFields` (opcional, Alina, 2026-10-16 — corrección del incidente
 * "Carlos González"/Nort Energy): un workflow puede tener su propio nodo
 * "preguntar_nombre" (campo `nombre`) — ese dato pasa por la MISMA validación
 * (_validarDatoContacto) y cuenta como identificación igual que si hubiera
 * llegado por conversación libre, para que no existan dos estados de
 * identificación independientes que puedan contradecirse. Precedencia:
 * datos_contacto (este turno, conversación libre) > capturedFields (dato de
 * workflow, puede venir de un turno anterior de la MISMA sesión) >
 * clienteRaw (ya persistido). `capturedFields` solo aporta nombre — ningún
 * workflow tiene hoy un nodo dedicado a "motivo_consulta".
 */
function _resolverIdentificacion(clienteRaw, datosContacto, capturedFields) {
  const nombre = _validarDatoContacto(datosContacto?.nombre)
    || _validarDatoContacto(capturedFields?.nombre)
    || (clienteRaw?.nombre && clienteRaw.nombre !== 'Sin nombre' ? clienteRaw.nombre : null);
  const motivo = _validarDatoContacto(datosContacto?.motivo) || clienteRaw?.motivo_consulta || null;
  return { nombre, motivo, estado: resolverEstadoIdentificacion({ nombre, motivoConsulta: motivo }) };
}

/**
 * Requisitos técnicos mínimos para ejecutar_motor_ingenieria — Alina,
 * 2026-10-16 ("una observación adicional" de la autorización del incidente
 * Carlos González, auditado y corregido 2026-10-16 tras tu pedido de
 * validación final): identificación comercial válida NO equivale a tener
 * los datos que el motor de ingeniería necesita para un predimensionamiento
 * con sentido matemático. Estos campos son EXACTAMENTE los que
 * generarAlertas() (modules/motores-ingenieria/paneles-solares.js) ya marca
 * como bloqueo cuando el cálculo no puede ni siquiera correr (consumo_faltante,
 * hsp_faltante, potencia_requerida_error) — no una lista inventada aquí.
 *
 * Auditoría (2026-10-16): la primera versión de este requisito exigía
 * también `importe_promedio_recibo` como obligatorio — INCORRECTO. El motor
 * real nunca lo exige para el cálculo base (línea 310-311 de
 * paneles-solares.js: solo consumoMensualKwh U historialConsumo bloquean;
 * importeRecibo solo alimenta calcularAhorro(), un dato complementario, no
 * un bloqueo). Corregido para no bloquear cotizaciones legítimas donde el
 * cliente dio su consumo en kWh pero no el importe de su recibo.
 *
 * tipo_alimentacion/voltaje_sitio quedan FUERA a propósito (igual que antes):
 * aunque el motor SÍ genera una alerta de bloqueo si faltan (red_desconocida),
 * el propio nodo del workflow invita explícitamente a responder "no sé" para
 * estos dos ("nuestro técnico puede verificarlo durante la visita") — es una
 * decisión de negocio ya existente de aceptar un cálculo con ese bloqueo
 * puntual y resolverlo en la visita técnica, no una omisión; replicarla aquí
 * como requisito duro introduciría una regla nueva que SÍ bloquearía
 * cotizaciones legítimas, exactamente lo que se pidió evitar.
 */
const CAMPOS_TECNICOS_REQUERIDOS_COTIZACION = ['ubicacion', 'pct_cobertura_deseado'];

/**
 * @param {Object} capturedFields
 * @returns {string[]} campos requeridos ausentes o vacíos. `consumo_mensual_kwh`
 *   se evalúa como alternativa real a `historial_consumo_kwh` (>=12 meses,
 *   mismo umbral que _historialConsumoOrNull en modules/cotizaciones.js) —
 *   igual que el motor: basta con cualquiera de los dos.
 */
function _camposTecnicosFaltantes(capturedFields) {
  const faltantes = CAMPOS_TECNICOS_REQUERIDOS_COTIZACION.filter(
    campo => !String(capturedFields?.[campo] ?? '').trim()
  );
  const tieneConsumoMensual = !!String(capturedFields?.consumo_mensual_kwh ?? '').trim();
  const tieneHistorial = Array.isArray(capturedFields?.historial_consumo_kwh) && capturedFields.historial_consumo_kwh.length >= 12;
  if (!tieneConsumoMensual && !tieneHistorial) faltantes.push('consumo_mensual_kwh');
  return faltantes;
}

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

    // ADR-012 — Asistente Oficial de TARA-OS (opcional: null-safe, cero
    // impacto en empresas que no lo usan). Resuelve datos reales de cuenta
    // de plataforma (plan, integraciones, tickets) a partir del teléfono de
    // quien escribe — nunca los inventa el modelo. Ver modules/cuenta-plataforma.js.
    this._obtenerEnriquecimientoCuenta = deps.obtenerEnriquecimientoCuenta || null;

    // TARA especialista solar (Alina, 2026-09-15 — mismo patrón de ADR-012:
    // opcional, null-safe, cero impacto en empresas que no lo usan).
    // Resuelve productos reales (marca/modelo/specs) que coinciden con el
    // mensaje actual, ANTES del turno de IA — nunca los inventa el modelo.
    // Ver modules/catalogo-tecnico.js.
    this._obtenerCatalogoTecnico = deps.obtenerCatalogoTecnico || null;

    // TARA experta en preguntas/dudas/objeciones (Alina, 2026-09-15 —
    // mismo patrón, opcional y null-safe). Resuelve preguntas frecuentes
    // reales (solar_faq) que coinciden con el mensaje actual. Ver
    // modules/faq-solar.js.
    this._obtenerFaqRelevante = deps.obtenerFaqRelevante || null;

    // FASE 4B / ANEXO A (TA.4) — Action Runner (M8)
    this._actualizarScore  = deps.actualizarScore   || null;
    this._crearOportunidad = deps.crearOportunidad  || null;
    this._actionRunner     = deps.actionRunner      || this._crearActionRunnerPorDefecto();

    // Nort Energy, auditoría 2026-10-14 (punto 8 del plan de corrección):
    // persiste aiOutput.clasificacion_contexto en el cliente — hoy ya se
    // calcula cada turno y se loguea (AuditLogger), pero se descartaba
    // después. Opcional y null-safe, mismo patrón que _actualizarScore —
    // corre SIEMPRE que hay un cliente, sin importar si el turno propuso
    // alguna acción (a diferencia de _actualizarScore, que vive dentro de
    // _ejecutarAcciones y por lo tanto nunca corre en turnos sin acciones —
    // justo los turnos personales/spam que más importa clasificar).
    this._actualizarClasificacion = deps.actualizarClasificacion || null;

    // Identificación obligatoria de contacto (Alina, 2026-10-16). Mismo
    // patrón que _actualizarClasificacion: opcional, null-safe, incondicional
    // por turno (corre tenga o no acciones el turno) — ver paso 11.5.
    this._actualizarIdentificacion = deps.actualizarIdentificacion || null;

    // Fase 1 de TARA AI Engine (2026-10-16): mide el costo real de cada
    // llamada — hoy AIProvider.calcularCosto() existe pero nunca se invoca.
    // Opcional, null-safe, mismo patrón — corre siempre que hubo un intento
    // de respuesta (con o sin acciones, con o sin cliente resuelto, a
    // diferencia de _actualizarClasificacion que requiere cliente).
    this._registrarConsumoIA = deps.registrarConsumoIA || null;
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
          ctx.aiOutput.intenciones || [],
          ctx.capturedFields,
          ctx.aiOutput.clasificacion_contexto || null
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

    // ADR-012 — enriquecimiento opcional con datos reales de cuenta de
    // plataforma (plan, integraciones, tickets — ver cuenta-plataforma.js).
    // Null-safe: si no está configurado, o si falla, o si el teléfono no
    // resuelve a ninguna cuenta (caso normal de un prospecto), el flujo
    // sigue exactamente igual que hoy — nunca bloquea ni rompe el turno.
    if (this._obtenerEnriquecimientoCuenta) {
      const enriquecimientoResult = await this._paso('cuenta_plataforma', timings, () =>
        this._obtenerEnriquecimientoCuenta(company_id, message.from)
      );
      if (enriquecimientoResult.ok && Array.isArray(enriquecimientoResult.value) && enriquecimientoResult.value.length > 0) {
        const extra = this._mapearKnowledge(enriquecimientoResult.value);
        empresaConf.knowledge_base = [empresaConf.knowledge_base, extra].filter(Boolean).join('\n\n');
      }
    }

    // TARA especialista solar (Alina, 2026-09-15) — mismo criterio null-safe
    // que ADR-012: si no está configurado, si falla, o si ningún producto
    // real coincide con el mensaje (caso normal de la mayoría de turnos), el
    // flujo sigue exactamente igual que hoy. Cierra el hueco de la
    // auditoría: la conversación libre no tenía ningún acceso a la ficha
    // técnica real de productos — solo el motor de ingeniería (que corre al
    // completar un workflow) la usaba.
    if (this._obtenerCatalogoTecnico) {
      const catalogoResult = await this._paso('catalogo_tecnico', timings, () =>
        this._obtenerCatalogoTecnico(company_id, message.content)
      );
      if (catalogoResult.ok && catalogoResult.value) {
        empresaConf.knowledge_base = [empresaConf.knowledge_base, catalogoResult.value].filter(Boolean).join('\n\n');
      }
    }

    // TARA experta en preguntas/dudas/objeciones (Alina, 2026-09-15) —
    // mismo criterio null-safe. Objetivo: ENTENDER LA DUDA → EXPLICARLA
    // FÁCIL → GENERAR CONFIANZA → DETECTAR NECESIDAD → SIGUIENTE PASO, con
    // preguntas frecuentes reales editables en `solar_faq` en vez de
    // escritas fijas en el prompt.
    if (this._obtenerFaqRelevante) {
      const faqResult = await this._paso('faq_solar', timings, () =>
        this._obtenerFaqRelevante(company_id, message.content)
      );
      if (faqResult.ok && faqResult.value) {
        empresaConf.knowledge_base = [empresaConf.knowledge_base, faqResult.value].filter(Boolean).join('\n\n');
      }
    }

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
    // ADR-012: capacidades por-empresa (personalities.capacidades) si la
    // empresa las definió, si no, el default histórico — cero cambio de
    // comportamiento para cualquier empresa que no lo configure. Se guarda
    // en una variable propia (antes se recalculaba inline) porque el paso 9
    // (auditoría 2026-09-15, Nort Energy) ahora también la necesita para
    // validar acciones_propuestas antes de ejecutarlas — una sola fuente de
    // verdad para "qué puede hacer el modelo libremente en esta empresa".
    const capacidadesResueltas = empresaConf.capacidades.length > 0 ? empresaConf.capacidades : CAPACIDADES_FASE2;

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
        capacidades:           capacidadesResueltas,
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
    // `respuestaYaResuelta` (Alina, 2026-10-16 — corrección del incidente
    // "Carlos González"/Nort Energy, Bug A): si el workflow ya decidió qué
    // responder este turno (una pregunta de nodo, una transición, o el
    // cierre de _finalizarWorkflow), ese texto es la verdad de lo que TARA
    // le mostró al cliente — el paso 9 (abajo) NUNCA debe pisarlo con la
    // pregunta de identificación, porque eso es lo que descuadraba
    // workflow.current_node (lo que el Core cree que preguntó) contra lo
    // que el cliente de verdad vio y contestó. Bloquear la ACCIÓN comercial
    // (accionesAutorizadas, abajo) sigue siendo incondicional — lo único
    // que cambia es si además se reemplaza el TEXTO.
    let respuestaYaResuelta = false;
    if (this._workflow && clienteRaw?.id) {
      const wfResult = await this._paso('workflow', timings, () =>
        this._manejarWorkflow(message.content, clienteRaw, aiOutput, company_id, ctx, sessionId)
      );
      if (wfResult.ok && wfResult.value !== null) {
        aiOutput = { ...aiOutput, respuesta_texto: wfResult.value };
        respuestaYaResuelta = true;
      }
    }

    // ── 9. Acciones propuestas (fuera de un workflow) ──────────────────────
    // Excepción puntual documentada a ADR-005 (Alina, 2026-09-15 — auditoría
    // del workflow real de ventas de Nort Energy: el modelo confirmó una
    // visita técnica por WhatsApp real sin que NINGUNA acción se hubiera
    // ejecutado — ni loggeada — cero fila en `citas`). Dos correcciones:
    //
    // 1. El prompt (bloque_capacidades, prompt-builder.js) ya le SUGERÍA al
    //    modelo qué acciones puede proponer, pero nada lo hacía cumplir del
    //    lado del servidor — ActionRunner despacha por `tipo` contra un
    //    registro GLOBAL compartido por todas las empresas. Se filtra aquí,
    //    antes de ejecutar: una acción libre fuera de `capacidadesResueltas`
    //    nunca corre. (nodo.acciones de un workflow completado, en
    //    _finalizarWorkflow, NO pasa por este filtro — esas ya las configuró
    //    explícitamente quien armó el flujo, no son una decisión libre del
    //    modelo turno a turno.)
    // 2. Si una acción de agenda sí corrió, el texto de confirmación debe
    //    salir de su resultado REAL — mismo criterio que ya usa
    //    _finalizarWorkflow/_confirmacionDeCita para el camino de workflow,
    //    ahora factorizado en _textoDesdeResultadoDeAgenda() y reusado aquí
    //    para el camino de conversación libre.
    // 3. Si la acción bloqueada era justo una de agenda (agendar/reagendar/
    //    cancelar), el texto que el modelo ya había escrito podía sonar a
    //    confirmación aunque nada haya corrido — se reemplaza por un
    //    mensaje honesto que no inventa fecha/hora, nunca se deja pasar tal
    //    cual (esto es lo que le pasó a la clienta real del caso Nort
    //    Energy: "tu visita quedó agendada" sin ninguna fila en `citas`).
    const propuestas = aiOutput.acciones_propuestas || [];

    // Identificación obligatoria de contacto (Alina, 2026-10-16). Combina lo
    // ya persistido en `clienteRaw` con lo que el modelo reportó EN ESTE
    // turno (aiOutput.datos_contacto, validado — nunca se confía ciego en
    // el modelo). Filtra solo las 4 acciones que de verdad la requieren —
    // la respuesta conversacional (aiOutput.respuesta_texto) nunca se
    // bloquea por esto.
    const identificacion = _resolverIdentificacion(clienteRaw, aiOutput.datos_contacto);
    // PRIORIDAD 3: una sola función decide, nunca un chequeo repetido aquí.
    const autorizarAccion = (tipo) => puedeEjecutarseAccionComercial({
      tipoAccion: tipo, companyId: company_id, clienteId: clienteRaw?.id,
      nombre: identificacion.nombre, motivoConsulta: identificacion.motivo,
    }).autorizada;

    const accionesAutorizadas = propuestas.filter(a =>
      a?.tipo && capacidadesResueltas.includes(a.tipo) && autorizarAccion(a.tipo)
    );
    const huboAgendaBloqueada = propuestas.some(a =>
      a?.tipo && !capacidadesResueltas.includes(a.tipo) && ACCIONES_SENSIBLES_DE_AGENDA.includes(a.tipo)
    );
    const huboComercialBloqueadaPorIdentificacion = propuestas.some(a =>
      a?.tipo && capacidadesResueltas.includes(a.tipo) && !autorizarAccion(a.tipo)
    );

    const accionesResult = await this._paso('acciones', timings, () =>
      this._ejecutarAcciones(accionesAutorizadas, ctx, clienteRaw, aiOutput, sessionId)
    );
    if (accionesResult.ok) {
      const textoReal = this._textoDesdeResultadoDeAgenda(accionesResult.value, huboAgendaBloqueada);
      if (textoReal) {
        aiOutput = { ...aiOutput, respuesta_texto: textoReal };
        respuestaYaResuelta = true;
      }
    }
    // Prioridad sobre el texto de arriba: si la acción comercial propuesta
    // ni siquiera se intentó por falta de identificación, la pregunta
    // natural por el dato faltante es lo único honesto que se puede enviar
    // (nunca el texto que el modelo ya había escrito, que podía sonar a
    // cotización/confirmación sin que nada haya corrido) — PERO (corrección
    // Bug A, 2026-10-16) solo cuando todavía no hay una respuesta real ya
    // resuelta este turno (workflow o resultado de acción): "bloquear una
    // acción", "pedir el dato que falta" y "responder al cliente" son 3
    // operaciones independientes que no deben pisarse entre sí — bloquear
    // la acción YA ocurrió arriba (accionesAutorizadas la excluyó), eso no
    // cambia; lo único condicionado aquí es si ADEMÁS hace falta pedir el
    // dato, y solo aplica cuando nadie más ya le respondió al cliente.
    if (huboComercialBloqueadaPorIdentificacion && !respuestaYaResuelta) {
      const campoFaltante = identificacion.nombre ? 'motivo' : 'nombre';
      aiOutput = { ...aiOutput, respuesta_texto: this._preguntaPorDatoFaltante([campoFaltante]) };
    }

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

    // ── 11. Clasificación persistida (punto 8, 2026-10-14) ────────────────
    // Incondicional — corre en todo turno con cliente, tenga o no acciones.
    if (this._actualizarClasificacion && clienteRaw?.id) {
      try {
        await this._actualizarClasificacion(clienteRaw.id, message.company_id, aiOutput.clasificacion_contexto);
      } catch (err) {
        this._log.logError(ctx, 'crm.actualizarClasificacion', err, { session_id: sessionId });
      }
    }

    // ── 11.5 Identificación de contacto persistida (2026-10-16) ───────────
    // Incondicional, mismo criterio que el paso 11 — corre en todo turno
    // con cliente. `identificacion` ya combinó lo persistido con lo nuevo
    // de este turno (ver paso 9); solo lo nuevo-y-validado llega aquí, el
    // módulo decide si de verdad hay que escribir (nunca sobreescribe con
    // menor confianza, ver modules/identificacion-contacto.js).
    if (this._actualizarIdentificacion && clienteRaw?.id) {
      try {
        await this._actualizarIdentificacion(clienteRaw.id, message.company_id, {
          nombre: identificacion.nombre, motivo: identificacion.motivo,
        });
      } catch (err) {
        this._log.logError(ctx, 'crm.actualizarIdentificacion', err, { session_id: sessionId });
      }
    }

    // ── 12. Consumo de IA (Fase 1 TARA AI Engine, 2026-10-16) ─────────────
    if (this._registrarConsumoIA) {
      try {
        await this._registrarConsumoIA({
          companyId: message.company_id,
          proveedor: aiOutput.proveedor_utilizado,
          modelo: aiOutput.modelo_utilizado,
          operacion: 'conversacion',
          tokensEntrada: aiOutput.tokens_entrada,
          tokensSalida: aiOutput.tokens_salida,
          resultado: aiOutput.proveedor_utilizado === 'none' ? 'fallback' : 'exito',
          latenciaMs: aiOutput.latencia_ms,
        });
      } catch (err) {
        this._log.logError(ctx, 'ia-consumo.registrarConsumoIA', err, { session_id: sessionId });
      }
    }

    // ── 13. Auditoría ─────────────────────────────────────────────────────
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
      // ADR-012: completa el TODO ya anotado en CAPACIDADES_FASE2 — vacío/
      // null para el 100% de las empresas existentes (sin cambio de
      // comportamiento), solo TARA-OS lo usa por ahora.
      capacidades:           Array.isArray(personality?.capacidades) ? personality.capacidades : [],
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
      ...instruccionesDePersonalidad(personality),
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

      // Alina, 2026-09-15 (auditoría Nort Energy): "¿Te funciona jueves o
      // viernes?" → "Ok" se capturaba tal cual como respuesta del nodo, sin
      // saber a cuál de las dos opciones se refería. Si la IA no extrajo un
      // valor limpio para este campo (ni hay uno pre-guardado) y la
      // pregunta del nodo ofrece más de una opción explícita ("X o Y"), un
      // acuse genérico ("ok", "sí", "va"...) no cuenta como respuesta —se
      // vuelve a preguntar en vez de capturar el acuse como si fuera la
      // elección.
      const yaHayValorConfiable = nodo.campo && (
        ((aiOutput.datos_extraidos || {})[nodo.campo] != null && String((aiOutput.datos_extraidos || {})[nodo.campo]).trim() !== '')
        || (sesion.captured_fields?.[nodo.campo] != null && String(sesion.captured_fields[nodo.campo]).trim() !== '')
      );
      if (!yaHayValorConfiable && nodo.campo && !nodo.es_opcional && _esAcuseAmbiguo(mensajeCliente, nodo.pregunta)) {
        return nodo.pregunta;
      }

      // Punto 2: usar el valor extraído por la IA cuando el campo fue capturado explícitamente;
      // si no, el dato pre-guardado en esta misma sesión (ver abajo); si
      // tampoco, fallback al mensaje crudo.
      //
      // Alina, 2026-09-15 (auditoría Nort Energy): cuando el turno actual es
      // un adjunto (ej. foto de un recibo CFE), modules/recibo-cfe.js ya
      // corrió ANTES de este punto (server.js, síncrono, awaited) y guardó
      // los datos reales en sesion.captured_fields vía
      // WorkflowEngine.preSalvarDatosExtraidos() — pero antes SOLO se usaban
      // para saltar nodos FUTUROS (_avanzarSaltandoRespondidos, abajo); el
      // nodo ACTUAL dependía de que la IA re-extrajera el mismo dato de su
      // propio resumen sintético ("Datos leídos automáticamente del
      // recibo:...") en una segunda pasada no determinística — si esa
      // relectura no marcaba el campo con suficiente claridad, TARA volvía a
      // preguntarlo. `sesion` se acaba de leer fresca de la DB (arriba,
      // obtenerSesionActiva) en ESTE mismo turno, así que ya refleja
      // cualquier preSalvarDatosExtraidos que acabe de correr.
      const valorExtraido    = nodo.campo ? (aiOutput.datos_extraidos || {})[nodo.campo] : undefined;
      const valorPreGuardado = nodo.campo ? sesion.captured_fields?.[nodo.campo] : undefined;
      const valorParaNodo = (valorExtraido != null && String(valorExtraido).trim() !== '')
        ? String(valorExtraido).trim()
        : (valorPreGuardado != null && String(valorPreGuardado).trim() !== '')
          ? String(valorPreGuardado).trim()
          : mensajeCliente.trim();

      const resultado = await this._workflow.avanzar(sesion, nodo, valorParaNodo);

      if (resultado.completado) {
        console.log(`✅ [workflow] sesión ${sesion.id.slice(0, 8)} completada`);
        return this._finalizarWorkflow(nodo, resultado.sesion, sesion.workflow_id, ctx, clienteRaw, aiOutput, company_id, sessionId);
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

      const { completado: autoCompletadoA, siguiente_nodo: nextNode, nodo_completado: nodoCompletadoA, sesion: sesionCompletadaA } =
        await this._avanzarSaltandoRespondidos(resultado.sesion, resultado.siguiente_nodo, datosMergeados);

      if (autoCompletadoA) {
        console.log(`✅ [workflow] sesión ${sesion.id.slice(0, 8)} completada (auto-advance)`);
        return this._finalizarWorkflow(nodoCompletadoA, sesionCompletadaA, sesion.workflow_id, ctx, clienteRaw, aiOutput, company_id, sessionId);
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
      return this._finalizarWorkflow(nodoCompletadoB, sesionFinalB, workflow.id, ctx, clienteRaw, aiOutput, company_id, sessionId);
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
   * Ejecuta las acciones de un nodo que acaba de completar un workflow, y
   * decide qué responder. Comportamiento por defecto (sin acciones, o todas
   * exitosas): responde aiOutput.respuesta_texto — idéntico a antes de TA.9 v2.
   * Si alguna acción devuelve {tipo: 'sin_disponibilidad', alternativas},
   * reabre una sesión nueva en el nodo inicial del mismo workflow (para que
   * el cliente pueda reintentar) y responde con las alternativas en su lugar.
   *
   * @returns {Promise<string>}
   */
  async _finalizarWorkflow(nodo, sesionCompletada, workflowId, ctx, clienteRaw, aiOutput, company_id, sessionId) {
    if (!nodo?.acciones?.length) return aiOutput.respuesta_texto;

    // Identificación obligatoria de contacto (Alina, 2026-10-16 — hallazgo
    // real de la prueba de validación: las acciones de un nodo de workflow
    // completado NUNCA pasaban por el gate del paso 9, porque este camino
    // (_finalizarWorkflow) llama a _ejecutarAcciones por su cuenta, antes de
    // que exista ningún "accionesAutorizadas" filtrado). Si el nodo incluye
    // alguna de las 4 acciones que requieren identificación y todavía no la
    // hay, se sintetiza el MISMO resultado 'faltan_datos' que ya usa
    // agendar_cita_con_horario_solicitado — reusa el mecanismo de reabrir
    // sesión y la pregunta natural de abajo, sin duplicar esa lógica.
    // Fuente única de identificación (Alina, 2026-10-16 — corrección del
    // incidente "Carlos González"): incluye lo que el propio workflow ya
    // capturó en su nodo "preguntar_nombre" (sesionCompletada.captured_fields),
    // no solo lo que el modelo reportó en el último turno — ver
    // _resolverIdentificacion arriba.
    const identificacion = _resolverIdentificacion(clienteRaw, aiOutput.datos_contacto, sesionCompletada?.captured_fields);

    // Persiste de inmediato lo que ESTA resolución encontró (puede incluir
    // un nombre que solo vivía en captured_fields y que el paso 11.5 de
    // procesarMensaje — que no ve captured_fields — nunca habría visto).
    // actualizarIdentificacionAutomatica es idempotente y nunca sobreescribe
    // con menor confianza, así que la llamada posterior del paso 11.5 (con
    // la identificación resuelta SIN captured_fields) es segura y redundante,
    // no duplica estado: ambas escriben a través de la MISMA función, nunca
    // hay dos fuentes de verdad de identificación.
    if (this._actualizarIdentificacion && clienteRaw?.id) {
      try {
        await this._actualizarIdentificacion(clienteRaw.id, company_id, {
          nombre: identificacion.nombre, motivo: identificacion.motivo,
        });
      } catch (err) {
        console.warn(`⚠️  no se pudo persistir identificación capturada por workflow: ${err.message}`);
      }
    }

    // PRIORIDAD 3: misma función centralizada que el paso 9, nunca un
    // criterio reimplementado aquí.
    const bloqueadoPorIdentificacion = nodo.acciones.some(a =>
      !puedeEjecutarseAccionComercial({
        tipoAccion: a?.tipo, companyId: company_id, clienteId: clienteRaw?.id,
        nombre: identificacion.nombre, motivoConsulta: identificacion.motivo,
      }).autorizada
    );

    const resultados = bloqueadoPorIdentificacion
      ? [{ tipo: 'faltan_datos', campos: [identificacion.nombre ? 'motivo' : 'nombre'], motivo: 'identificacion' }]
      : await this._ejecutarAcciones(
          nodo.acciones, ctx, clienteRaw, aiOutput, sessionId, sesionCompletada?.captured_fields
        );

    // Mismo criterio que ya existía para 'sin_disponibilidad' (TA.9 v2):
    // reabre una sesión para que el cliente pueda retomar la conversación
    // en vez de quedar sin workflow activo. Alina, 2026-09-15 (auditoría
    // Nort Energy): 'faltan_datos' se agrega al mismo mecanismo — si no se
    // reabriera, la respuesta del cliente con el dato que faltaba caería en
    // conversación libre, donde agendar_cita_con_horario_solicitado puede
    // no estar autorizado (ver capacidadesResueltas) y nunca se completaría
    // el agendamiento. Limitación conocida y ya aceptada en 'sin_disponibilidad':
    // reabrir reinicia el workflow desde su nodo de inicio, no desde donde
    // quedó — mismo trade-off, no uno nuevo.
    //
    // EXCEPCIÓN (Alina, 2026-10-16, requisito #5 — "no reiniciar workflows"):
    // 'faltan_datos' con motivo 'identificacion' o 'tecnico' (ver
    // ejecutar_motor_ingenieria más abajo) NUNCA reabre — el cliente ya
    // completó el workflow entero, sesionCompletada.captured_fields ya tiene
    // todo su progreso técnico real y reabrir lo descartaría (current_node
    // volvería al nodo inicial). Se deja la sesión tal cual (status
    // 'completado', datos intactos) y solo se le pide el dato que falta; NO
    // existe hoy un mecanismo para retomar automáticamente la acción
    // bloqueada una vez resuelto el dato faltante sin tocar WorkflowEngine —
    // limitación conocida, documentada en la entrega, no resuelta aquí.
    const necesitaReabrir = resultados.some(r =>
      r?.tipo === 'sin_disponibilidad' ||
      (r?.tipo === 'faltan_datos' && r.motivo !== 'identificacion' && r.motivo !== 'tecnico')
    );
    if (necesitaReabrir) {
      try {
        await this._workflow.iniciarSesion(company_id, clienteRaw.id, null, workflowId);
      } catch (err) {
        console.warn(`⚠️  no se pudo reabrir sesión tras sin_disponibilidad/faltan_datos: ${err.message}`);
      }
    }

    return this._textoDesdeResultadoDeAgenda(resultados) || aiOutput.respuesta_texto;
  }

  /**
   * Traduce el resultado REAL de una acción de agenda a texto — mismo
   * criterio en los dos caminos que pueden disparar
   * agendar_cita_con_horario_solicitado (nodo de workflow recién completado,
   * vía _finalizarWorkflow, o acción libre que el modelo propuso en
   * conversación normal, vía el paso 9 de procesarMensaje): la confirmación
   * SIEMPRE sale de lo que de verdad pasó en SchedulingEngine, nunca del
   * texto que el modelo escribió antes de saber si la acción funcionó.
   *
   * Excepción puntual documentada a ADR-005 (Alina, 2026-08-11 para el caso
   * 'agendada'/'sin_disponibilidad'; 2026-09-15, auditoría Nort Energy, para
   * 'faltan_datos' y para reusarlo también en conversación libre — antes el
   * modelo podía confirmar una visita real sin que la acción se hubiera ni
   * intentado).
   *
   * @returns {string|null} null si ningún resultado amerita reemplazar
   *   aiOutput.respuesta_texto (ej. ejecutar_motor_ingenieria,
   *   crear_oportunidad, crear_ticket_soporte — sin cambio).
   */
  _textoDesdeResultadoDeAgenda(resultados, huboAgendaBloqueada = false) {
    const faltanDatos = resultados.find(r => r?.tipo === 'faltan_datos');
    if (faltanDatos) return this._preguntaPorDatoFaltante(faltanDatos.campos);

    const sinDisponibilidad = resultados.find(r => r?.tipo === 'sin_disponibilidad');
    if (sinDisponibilidad) {
      const opciones = (sinDisponibilidad.alternativas || [])
        .map(a => a.inicio.toLocaleString('es-MX', { timeZone: 'America/Monterrey', hour: '2-digit', minute: '2-digit' }))
        .join(', ');
      return opciones
        ? `Esa hora ya no está disponible. Opciones libres: ${opciones}. ¿Cuál prefieres?`
        : 'Esa hora ya no está disponible y no encontramos otro horario libre pronto. ¿Quieres intentar con otro día?';
    }

    const agendada = resultados.find(r => r?.tipo === 'agendada' && r?.cita?.inicio);
    if (agendada) return this._confirmacionDeCita(agendada);

    // Alina, 2026-09-15: la acción de agenda que el modelo propuso estaba
    // fuera de las capacidades de la empresa y nunca se ejecutó — el texto
    // que el modelo ya había escrito no se envía tal cual (podía sonar a
    // confirmación). Mensaje honesto, sin fecha/hora inventada.
    if (huboAgendaBloqueada) {
      return 'Voy a coordinar tu visita técnica con nuestro equipo y te confirmo la fecha y hora en breve.';
    }

    return null;
  }

  /**
   * Pregunta natural por el primer dato faltante que bloqueó
   * agendar_cita_con_horario_solicitado — nunca confirma nada, solo pide lo
   * que falta (Alina, 2026-09-15: "TARA NO puede marcar una visita como
   * confirmada si no existe dirección/fecha/hora/nombre").
   */
  _preguntaPorDatoFaltante(campos) {
    const PREGUNTAS = {
      direccion: '¿me compartes la dirección completa — calle, número y colonia — donde sería la visita?',
      fecha:     '¿qué día te gustaría que fuera el técnico?',
      hora:      '¿en qué horario te queda bien?',
      nombre:    '¿con quién tengo el gusto?',
      motivo:    '¿en qué te puedo ayudar?',
      // Requisito #3 adicional (Alina, 2026-10-16, auditado el mismo día):
      // identificación completa no equivale a tener los datos técnicos para
      // cotizar — estas preguntas reusan el texto real de los nodos del
      // workflow de ingeniería solar (workflow_nodes, "Cotización directa —
      // ingeniería solar"), nunca texto inventado aquí. importe_promedio_recibo
      // NO está aquí a propósito — el motor real nunca lo exige para el
      // cálculo base (ver CAMPOS_TECNICOS_REQUERIDOS_COTIZACION arriba).
      ubicacion:                '¿en qué ciudad o municipio está la instalación?',
      consumo_mensual_kwh:      '¿cuántos kWh consumes en promedio al mes? Si no lo sabes exacto, dime el monto de tu recibo y lo puedo aproximar.',
      pct_cobertura_deseado:    '¿qué porcentaje de tu consumo te gustaría cubrir con paneles solares? Si no estás seguro, puedo proponerte 90%.',
    };
    const primero = (campos || [])[0];
    return PREGUNTAS[primero] || 'me falta un dato para poder agendar tu visita técnica — ¿me lo compartes?';
  }

  /**
   * Confirmación de cita agendada, generada desde el resultado REAL de
   * SchedulingEngine.agendarCita() — nunca desde texto libre del modelo.
   * Agnóstica de giro: usa el nombre del servicio si el handler lo resolvió
   * (ver _resolverServicioDesdeTexto), si no, un texto genérico.
   */
  _confirmacionDeCita({ cita, servicio }) {
    const fecha = new Date(cita.inicio).toLocaleString('es-MX', {
      timeZone: 'America/Monterrey', weekday: 'long', day: 'numeric', month: 'long',
    });
    const hora = new Date(cita.inicio).toLocaleString('es-MX', {
      timeZone: 'America/Monterrey', hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const nombreServicio = servicio?.nombre ? ` para ${servicio.nombre}` : '';
    return `¡Listo! Tu cita${nombreServicio} quedó agendada para el ${fecha} a las ${hora}.`;
  }

  /**
   * Ejecuta las acciones propuestas por el AI Engine (o por un nodo de
   * workflow completado), despachando cada una por su `tipo` a través del
   * ActionRunner (M8). Devuelve los resultados en el mismo orden — permite
   * que el llamador (ej. _manejarWorkflow) reaccione al resultado de una
   * acción (ANEXO A, TA.9 v2: ofrecer horarios alternativos).
   *
   * @param {Object} [capturedFields] — sesion.captured_fields, disponible
   *   para el handler vía ctx.capturedFields (ej. la hora que pidió el cliente).
   * @returns {Promise<Array>} resultados de cada acción, en orden
   */
  async _ejecutarAcciones(acciones, ctx, clienteRaw, aiOutput, sessionId, capturedFields) {
    if (!Array.isArray(acciones) || acciones.length === 0) return [];
    if (!clienteRaw?.id) return [];

    const handlerCtx = { ...ctx, clienteRaw, aiOutput, capturedFields: capturedFields || {} };
    const resultados = [];

    for (const accion of acciones) {
      try {
        const resultado = await this._actionRunner.ejecutar(accion, handlerCtx);
        resultados.push(resultado);
        if (resultado?.error) {
          this._log.logAccion(ctx, accion.tipo, accion.parametros, { error: resultado.error }, { session_id: sessionId });
        } else {
          this._log.logAccion(ctx, accion.tipo, accion.parametros, { exito: true }, { session_id: sessionId });
        }
      } catch (err) {
        resultados.push({ error: err.message });
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

    return resultados;
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

// Acuses genéricos que NO cuentan como respuesta a una pregunta con varias
// opciones explícitas (Alina, 2026-09-15, auditoría Nort Energy).
const _REGEX_ACUSE_GENERICO = /^(ok(ay)?|va|dale|sale|claro|de acuerdo|est[aá] bien|correcto|perfecto|efectivamente|s[ií])[.,!¡¿? ]*$/i;
// "X o Y" en la pregunta del nodo — heurística deliberadamente simple (no
// distingue tipo de pregunta), la misma idea que ya usa _extraerTransicion
// para no sobre-construir un parser de lenguaje natural completo.
const _REGEX_PREGUNTA_CON_OPCIONES = /\b\S+\s+o\s+\S+\b/i;

/**
 * Un acuse genérico ("ok", "sí", "va"...) solo cuenta como respuesta válida
 * cuando la pregunta del nodo tiene una única lectura binaria clara — si la
 * pregunta nombra explícitamente dos o más opciones ("¿jueves o viernes?"),
 * un acuse no dice a cuál se refiere y se trata como respuesta ambigua.
 */
function _esAcuseAmbiguo(mensajeCliente, pregunta) {
  const texto = (mensajeCliente || '').trim();
  if (!texto || !_REGEX_ACUSE_GENERICO.test(texto)) return false;
  return _REGEX_PREGUNTA_CON_OPCIONES.test(pregunta || '');
}

/**
 * ANEXO A (TA.9 v2) — parseo simple de "hora_preferida" (ej. "10:00", "16:30")
 * para agendar_cita_con_horario_solicitado. No es un parser de lenguaje
 * natural completo — entiende HH:MM (24h) y HH[:MM]am/pm; si no matchea
 * nada reconocible, usa una hora por defecto (10:00) para no romper el
 * flujo. `fecha`/`duracionMinutos` en `parametros` son opcionales.
 *
 * Reutiliza horaLocalAUTC (SchedulingEngine, TA.9 fix de zona horaria) para
 * no reintroducir el mismo bug: "10:00" es hora de pared en America/Monterrey,
 * no UTC.
 */
function _parsearHoraPreferida(texto, parametros = {}) {
  const { horaLocalAUTC } = require('./scheduling-engine');
  const match = String(texto || '').toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);

  let hora = 10;
  let minuto = 0;
  if (match) {
    hora = Number(match[1]);
    minuto = match[2] ? Number(match[2]) : 0;
    const meridiano = match[3];
    if (meridiano === 'pm' && hora < 12) hora += 12;
    if (meridiano === 'am' && hora === 12) hora = 0;
  }
  const horaHHMM = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00`;
  const duracion = parametros.duracionMinutos || 30;
  const zona = parametros.zonaHoraria || 'America/Monterrey';

  const base = parametros.fecha ? new Date(parametros.fecha) : new Date();
  if (!parametros.fecha) base.setUTCDate(base.getUTCDate() + 1); // mañana, por defecto

  const inicio = horaLocalAUTC(base, horaHHMM, zona);
  const fin    = new Date(inicio.getTime() + duracion * 60000);
  return { inicio, fin };
}

/**
 * Resuelve el texto libre que el cliente dio para "servicio_elegido" contra
 * el catálogo real de `servicios` de la empresa — por conteo simple de
 * palabras en común (mismo criterio que detectarIndustria() en
 * plantillas-industria.js), sin IA ni dependencias nuevas.
 *
 * Bug real (Alina, 2026-08-11, diagnóstico LUMÉ Hair Studio):
 * agendar_cita_con_horario_solicitado nunca leía esto — toda cita agendada
 * por WhatsApp quedaba con 30 minutos fijos sin importar el servicio (un
 * balayage de 180 min se agendaba igual que un corte de 60), y
 * servicio_id/precio_cobrado nunca se llenaban desde este camino. Sin match
 * (servicio no reconocible, o la empresa no tiene servicios configurados),
 * devuelve null — nunca inventa una duración o un precio.
 *
 * @returns {Promise<{id, nombre, duracion_minutos, precio}|null>}
 */
async function _resolverServicioDesdeTexto(supabase, companyId, textoServicio) {
  if (!textoServicio) return null;

  const { data: servicios } = await supabase
    .from('servicios').select('id, nombre, duracion_minutos, precio')
    .eq('company_id', companyId).eq('activo', true);
  if (!servicios || servicios.length === 0) return null;

  const normalizar = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const textoNorm = normalizar(textoServicio);

  let mejor = null;
  let mejorScore = 0;
  for (const servicio of servicios) {
    const palabrasServicio = normalizar(servicio.nombre).split(/\s+/).filter(p => p.length > 2);
    const score = palabrasServicio.filter(p => textoNorm.includes(p)).length;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = servicio;
    }
  }
  return mejor;
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
  const { construirResumenCuentaParaKnowledge, crearTicket, resolverCuentaPorTelefono } = require('./cuenta-plataforma');
  const { obtenerCatalogoTecnicoRelevante } = require('./catalogo-tecnico');
  const { obtenerFaqRelevante } = require('./faq-solar');

  // RLS: crearOrchestrator() se usa desde el webhook de Twilio (sin usuario
  // final) — usa supabaseServicio (bypassa RLS por diseño de Supabase).
  const { supabaseServicio: supabase, openai: openaiClient } = require('./clients');

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
  const { actualizarClasificacionAutomatica } = require('./clasificacion-cliente');
  const { actualizarIdentificacionAutomatica } = require('./identificacion-contacto');
  const { registrarConsumoIA } = require('./ia-consumo');

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
        ctx.aiOutput.intenciones || [],
        ctx.capturedFields,
        ctx.aiOutput.clasificacion_contexto || null
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

    // Validado primero en TA.9 (Anexo A) con una cita real en Google Calendar,
    // y de nuevo en Anexo B (segundo giro) — cualquier empresa puede usarlo.
    // Parsea la hora que el cliente escribió (HH:MM 24h o HH[:MM]am/pm — no
    // es un parser de lenguaje natural completo, ver comentario de
    // _parsearHoraPreferida) e intenta agendar; si no hay disponibilidad,
    // ofrece hasta 3 alternativas en vez de fallar en silencio. Si el cliente
    // expresó preferencia de asesor (captured_fields.asesora_preferida), se
    // intenta honrar por nombre; sin match, se asigna automático como siempre.
    runner.registrar('agendar_cita_con_horario_solicitado', async (parametros, ctx) => {
      // Precondiciones (Alina, 2026-09-15, auditoría Nort Energy: una
      // clienta real recibió "tu visita quedó agendada para el jueves" sin
      // que nunca se le pidiera dirección — cero fila en `citas`). DATA, no
      // "if industria": qué campos son obligatorios antes de poder agendar
      // lo decide el `parametros.camposRequeridos` que cada nodo de
      // workflow configura (ver workflow_nodes.acciones) — una empresa cuyo
      // servicio ocurre en su propio local (ej. un salón de belleza) no
      // declara 'direccion' como requerido y sigue exactamente igual que
      // antes; Nort Energy sí, porque el técnico visita el domicilio del
      // cliente. Mismo criterio de "nunca confirmar sin datos" que ya pedía
      // el flujo — ahora enforced aquí, antes de tocar SchedulingEngine.
      const camposFaltantes = (parametros.camposRequeridos || [])
        .filter(campo => !String(ctx.capturedFields?.[campo] || '').trim());
      if (camposFaltantes.length > 0) {
        return { tipo: 'faltan_datos', campos: camposFaltantes };
      }

      const scheduling = await schedulingEngineParaEmpresa(ctx.company_id);

      // Servicio real (Alina, 2026-08-11 — LUMÉ Hair Studio): resuelve el
      // texto libre contra el catálogo antes de calcular inicio/fin, para
      // que la duración de la cita sea la del servicio, no un default fijo.
      const servicio = await _resolverServicioDesdeTexto(supabase, ctx.company_id, ctx.capturedFields?.servicio_elegido);
      const parametrosConServicio = (servicio && !parametros.duracionMinutos)
        ? { ...parametros, duracionMinutos: servicio.duracion_minutos }
        : parametros;

      const { inicio, fin } = _parsearHoraPreferida(ctx.capturedFields?.hora_preferida, parametrosConServicio);
      const asesorId = parametros.asesorId
        || await scheduling.buscarAsesorPorNombre(ctx.company_id, ctx.capturedFields?.asesora_preferida)
        || undefined;

      try {
        const cita = await scheduling.agendarCita(ctx.company_id, {
          clienteId: ctx.clienteRaw.id, asesorId, inicio, fin,
        });

        // SchedulingEngine (Core congelado) no conoce servicio_id/precio_cobrado
        // — mismo patrón ya documentado en modules/agenda.js::crearCita: UPDATE
        // directo después del insert del Core, nunca modificando SchedulingEngine.
        if (servicio) {
          const { error: errServicio } = await supabase
            .from('citas')
            .update({ servicio_id: servicio.id, precio_cobrado: servicio.precio })
            .eq('id', cita.id);
          if (!errServicio) {
            cita.servicio_id = servicio.id;
            cita.precio_cobrado = servicio.precio;
          }
        }

        return { tipo: 'agendada', cita, servicio: servicio || null };
      } catch (err) {
        const alternativas = await scheduling.consultarDisponibilidad(ctx.company_id, {
          fecha: inicio, duracionMinutos: parametrosConServicio.duracionMinutos || 30,
        });
        return { tipo: 'sin_disponibilidad', alternativas: alternativas.slice(0, 3), motivo: err.message };
      }
    });

    // ADR-012 — Asistente Oficial de TARA-OS: solo se propone si la empresa
    // habilitó 'crear_ticket_soporte' en personalities.capacidades (hoy,
    // únicamente TARA-OS) — ver _mapearEmpresaConfig/capacidades dinámicas.
    // Resuelve la cuenta de plataforma por el teléfono de quien escribe
    // (ctx.cliente.identificador) — nunca inventa organizationId/usuarioId.
    runner.registrar('crear_ticket_soporte', async (parametros, ctx) => {
      const { data: company } = await supabase
        .from('companies').select('organization_id').eq('id', ctx.company_id).maybeSingle();
      if (!company?.organization_id) {
        return { error: 'No se pudo identificar la organización para crear el ticket.' };
      }

      const cuenta = await resolverCuentaPorTelefono(supabase, ctx.cliente?.identificador);

      return crearTicket(supabase, {
        organizationId: company.organization_id,
        usuarioId:      cuenta?.usuario?.id || null,
        asunto:         parametros.asunto,
        descripcion:    parametros.descripcion,
        prioridad:      parametros.prioridad,
        canal:          ctx.canal || 'whatsapp',
      });
    });

    // Fase 2 — Ingeniería y Cotización (Alina, 2026-08-04): EXCEPCIÓN
    // PUNTUAL DOCUMENTADA a ADR-005 — se agrega una entrada al registro de
    // ActionRunner en esta misma zona de wiring (ya usada para esto, ver
    // crear_ticket_soporte arriba), sin tocar la clase Orchestrator,
    // _finalizarWorkflow, _ejecutarAcciones ni procesarMensaje. El handler
    // vive en modules/cotizaciones.js (no Core) — aquí solo se registra.
    // Se dispara desde el nodo final del workflow "Cotización directa —
    // ingeniería solar" (migración 090). Deliberadamente NO se ramifica el
    // resultado dentro del workflow (eso sí requeriría tocar Orchestrator,
    // ver ADR-005 condición de reapertura) — el handler manda su propio
    // mensaje de seguimiento proactivo, fuera de _finalizarWorkflow.
    runner.registrar('ejecutar_motor_ingenieria', async (parametros, ctx) => {
      // Requisitos técnicos — identificación válida y datos técnicos
      // suficientes son 2 condiciones INDEPENDIENTES (Alina, 2026-10-16).
      // PRIORIDAD 2 (2026-10-17, tras el hallazgo real de la cotización
      // 85/cálculo 192a6cfe): "¿están presentes los campos?" no bastaba —
      // una ubicación presente pero irresoluble ("en mty") igual producía
      // un cálculo real y bloqueado. validarRequisitosTecnicos()
      // (modules/cotizaciones.js) reutiliza los normalizadores/catálogos
      // reales del motor (resolverHSP, mapearCapturedFieldsAInfoTecnica) —
      // nunca una copia de sus reglas — para comprobar presencia, validez Y
      // resolución antes de correr nada. Mismo formato de resultado que
      // agendar_cita_con_horario_solicitado usa para su propio
      // camposRequeridos (reutiliza _textoDesdeResultadoDeAgenda/
      // _preguntaPorDatoFaltante) — `motivo: 'tecnico'` es lo único que
      // distingue este caso del de identificación para que
      // _finalizarWorkflow sepa que tampoco debe reabrir el workflow.
      const { correrCotizacionDesdeWorkflow, validarRequisitosTecnicos } = require('./cotizaciones');
      const requisitos = await validarRequisitosTecnicos(supabase, ctx.capturedFields);
      if (!requisitos.suficientePreliminar) {
        return { tipo: 'faltan_datos', campos: requisitos.camposFaltantes, motivo: 'tecnico' };
      }

      return correrCotizacionDesdeWorkflow(supabase, {
        companyId: ctx.company_id,
        clienteId: ctx.clienteRaw.id,
        capturedFields: ctx.capturedFields || {},
        destinatario: ctx.cliente?.identificador || null,
      });
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
    obtenerEnriquecimientoCuenta: overrides.obtenerEnriquecimientoCuenta
      || ((companyId, telefono) => construirResumenCuentaParaKnowledge(supabase, companyId, telefono)),
    obtenerCatalogoTecnico: overrides.obtenerCatalogoTecnico
      || ((companyId, mensaje) => obtenerCatalogoTecnicoRelevante(supabase, companyId, mensaje)),
    obtenerFaqRelevante: overrides.obtenerFaqRelevante
      || ((companyId, mensaje) => obtenerFaqRelevante(supabase, companyId, mensaje)),
    actionRunner,
    actualizarScore:      overrides.actualizarScore      || actualizarScoreInteres,
    actualizarClasificacion: overrides.actualizarClasificacion
      || ((clienteId, companyId, clasificacion) => actualizarClasificacionAutomatica(supabase, clienteId, companyId, clasificacion)),
    actualizarIdentificacion: overrides.actualizarIdentificacion
      || ((clienteId, companyId, datos) => actualizarIdentificacionAutomatica(supabase, clienteId, companyId, datos)),
    registrarConsumoIA: overrides.registrarConsumoIA
      || ((datos) => registrarConsumoIA(supabase, datos)),
  });
}

module.exports = {
  Orchestrator, crearOrchestrator, RESPUESTA_EMERGENCIA,
  parsearHoraPreferida: _parsearHoraPreferida,
  resolverServicioDesdeTexto: _resolverServicioDesdeTexto,
  esAcuseAmbiguo: _esAcuseAmbiguo,
  resolverIdentificacion: _resolverIdentificacion,
  validarDatoContacto: _validarDatoContacto,
  camposTecnicosFaltantes: _camposTecnicosFaltantes,
  CAMPOS_TECNICOS_REQUERIDOS_COTIZACION,
  ACCIONES_REQUIEREN_IDENTIFICACION,
};
