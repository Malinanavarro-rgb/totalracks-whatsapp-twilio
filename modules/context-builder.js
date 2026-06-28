/**
 * TARA Matrix™ — ContextBuilder
 * ─────────────────────────────────────────────────────────────────────────────
 * Fuente única de contexto para el AI Engine.
 *
 * Responsabilidades:
 *   - Recibir datos ya obtenidos de todos los módulos externos
 *   - Ensamblarlos en una estructura unificada (ConversationContext)
 *   - Optimizar tokens: solo enviar lo estrictamente necesario al modelo
 *   - Preparar el AIInput que consume el AIEngine
 *
 * Lo que NO hace:
 *   - No llama a Supabase
 *   - No conoce ningún giro comercial
 *   - No construye prompts (responsabilidad del PromptBuilder, M6)
 *   - No tiene efectos secundarios
 *
 * El Orchestrator (M7) es quien llama a este módulo con los datos listos.
 * ContextBuilder es 100% síncrono y puro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tipos de entrada:
 *
 * @typedef {Object} EmpresaConfig
 * @property {string}   company_id
 * @property {string}   nombre_empresa
 * @property {string}   personalidad          - Descripción del asistente y tono
 * @property {string}   objetivo_principal     - Meta comercial de la empresa
 * @property {string}   [idioma='es']
 * @property {string}   [zona_horaria='America/Monterrey']
 * @property {string}   [modelo='gpt-4o-mini']
 * @property {number}   [temperatura=0.6]
 * @property {number}   [max_tokens=700]
 * @property {string}   [knowledge_base='']   - Texto libre o JSON de conocimiento
 * @property {Array}    [skills=[]]            - [{nombre, activo}]
 * @property {string[]} [campos_requeridos=[]] - Campos que debe capturar de este cliente
 * @property {Array}    [reglas=[]]            - [{texto, etapas?: string[]}]
 * @property {number}   [ai_max_turnos_memoria=8]
 * @property {number}   [kb_max_secciones=3]
 *
 * @typedef {Object} ClienteData
 * @property {string|null} nombre
 * @property {string}      etapa_actual        - 'Nuevo', 'Calificacion', 'Negociacion', etc.
 * @property {string|null} categoria_principal - Categoría del producto/servicio de interés
 * @property {Object}      datos               - Campos capturados del cliente
 *
 * @typedef {Object} WorkflowState
 * @property {string}      nombre
 * @property {string}      paso_actual
 * @property {string|null} objetivo
 * @property {string|null} etapa_objetivo
 *
 * @typedef {Object} MessagePair
 * @property {string} mensaje_cliente
 * @property {string} respuesta_tara
 *
 * @typedef {Object} ContextInput
 * @property {string}        company_id
 * @property {string}        canal
 * @property {string}        identificador_cliente
 * @property {string}        mensaje_actual
 * @property {EmpresaConfig} empresa_config
 * @property {ClienteData|null}    datos_cliente
 * @property {MessagePair[]}       historia_conversacion
 * @property {string|null}         resumen_cliente
 * @property {WorkflowState|null}  workflow_state
 * @property {string[]}            capacidades
 *
 * @typedef {Object} ConversationContext — salida principal
 *
 * @module modules/context-builder
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// UTILIDADES — exportadas para facilitar tests y extensiones futuras
// ═════════════════════════════════════════════════════════════════════════════

/** Estimación de tokens: 1 token ≈ 4 chars (válido para español e inglés) */
function estimarTokens(texto) {
  return Math.ceil((texto || '').length / 4);
}

const STOPWORDS_ES = new Set([
  'el','la','los','las','un','una','de','del','en','que','y','a','se','es',
  'no','me','te','le','por','con','para','mi','tu','su','lo','al','si','o',
  'más','como','pero','ya','muy','esto','ese','esa',
]);

/** Extrae palabras clave eliminando stopwords básicas en español */
function extraerKeywords(texto) {
  return (texto || '')
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS_ES.has(w));
}

/**
 * Filtra la knowledge base para incluir solo las secciones más relevantes
 * al mensaje actual. Divide por párrafos dobles o encabezados ##.
 *
 * @param {string} kb           - Knowledge base completa
 * @param {string} mensaje      - Mensaje actual del cliente
 * @param {number} maxSecciones - Máximo de secciones a devolver
 * @returns {string}
 */
function filtrarKnowledgeBase(kb, mensaje, maxSecciones) {
  if (!kb) return '';

  const secciones = kb
    .split(/\n{2,}|\n##\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  if (secciones.length <= maxSecciones) return kb;

  const keywords = extraerKeywords(mensaje);
  if (keywords.length === 0) {
    return secciones.slice(0, maxSecciones).join('\n\n');
  }

  return secciones
    .map(s => ({
      texto: s,
      score: keywords.reduce((n, kw) => n + (s.toLowerCase().includes(kw) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSecciones)
    .map(s => s.texto)
    .join('\n\n');
}

/**
 * Recorta la historia al número máximo de turnos más recientes.
 * @param {MessagePair[]} historia
 * @param {number}        maxTurnos
 * @returns {MessagePair[]}
 */
function recortarMemoria(historia, maxTurnos) {
  if (!Array.isArray(historia) || historia.length === 0) return [];
  if (maxTurnos <= 0) return [];
  return historia.slice(-maxTurnos);
}

/**
 * Devuelve qué campos requeridos faltan en los datos del cliente.
 * @param {Object}   datos
 * @param {string[]} camposRequeridos
 * @returns {string[]}
 */
function calcularCamposFaltantes(datos, camposRequeridos) {
  if (!Array.isArray(camposRequeridos) || camposRequeridos.length === 0) return [];
  const d = datos || {};
  return camposRequeridos.filter(campo => {
    const v = d[campo];
    return v === null || v === undefined || v === '';
  });
}

/**
 * Determina nivel de compresión necesario según el presupuesto de tokens.
 * @param {number} estimado
 * @param {number} presupuesto
 * @returns {'ninguna'|'leve'|'agresiva'}
 */
function nivelCompresion(estimado, presupuesto) {
  const ratio = estimado / presupuesto;
  if (ratio <= 0.60) return 'ninguna';
  if (ratio <= 0.85) return 'leve';
  return 'agresiva';
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER
// ═════════════════════════════════════════════════════════════════════════════

class ContextBuilder {
  /**
   * @param {Object} [config]
   * @param {number} [config.max_tokens_contexto=3000]
   * @param {number} [config.max_turnos_memoria=8]
   * @param {number} [config.max_secciones_kb=3]
   */
  constructor(config = {}) {
    this._maxTokensContexto = config.max_tokens_contexto ?? 3000;
    this._maxTurnosMemoria  = config.max_turnos_memoria  ?? 8;
    this._maxSeccionesKB    = config.max_secciones_kb    ?? 3;
  }

  /**
   * Ensambla todos los datos en un ConversationContext unificado.
   * Aplica optimización de tokens automáticamente.
   *
   * @param {ContextInput} input
   * @returns {Object} ConversationContext
   */
  construir(input) {
    this._validarInput(input);

    const {
      company_id,
      canal,
      identificador_cliente,
      mensaje_actual,
      empresa_config:       ec,
      datos_cliente:        dc,
      historia_conversacion: hist,
      resumen_cliente,
      workflow_state:       wf,
      capacidades,
    } = input;

    // ── 1. Memoria corta ──────────────────────────────────────────────────
    const maxTurnos    = ec.ai_max_turnos_memoria ?? this._maxTurnosMemoria;
    const memoriaCorta = recortarMemoria(hist, maxTurnos);

    // ── 2. Campos faltantes ───────────────────────────────────────────────
    // Fusionar campos raíz de ClienteData con el objeto datos capturados,
    // para que campos como "nombre" (almacenado en dc.nombre) sean visibles.
    const datosParaVerificar = {
      ...(dc?.datos || {}),
      ...(dc?.nombre              != null ? { nombre:              dc.nombre              } : {}),
      ...(dc?.categoria_principal != null ? { categoria_principal: dc.categoria_principal } : {}),
    };
    const camposFaltantes = calcularCamposFaltantes(datosParaVerificar, ec.campos_requeridos);

    // ── 3. Knowledge base filtrada ────────────────────────────────────────
    const maxSecciones        = ec.kb_max_secciones ?? this._maxSeccionesKB;
    const seccionesRelevantes = filtrarKnowledgeBase(
      ec.knowledge_base,
      mensaje_actual,
      maxSecciones
    );

    // ── 4. Skills activos ─────────────────────────────────────────────────
    const skillsActivos = (ec.skills || [])
      .filter(s => s?.activo !== false)
      .map(s => (typeof s === 'string' ? s : s.nombre))
      .filter(Boolean);

    // ── 5. Capacidades disponibles ────────────────────────────────────────
    const capsDisponibles = Array.isArray(capacidades) ? capacidades : [];

    // ── 6. Etapa actual ───────────────────────────────────────────────────
    const etapaActual = dc?.etapa_actual || 'Nuevo';

    // ── 7. Reglas aplicables a la etapa actual ────────────────────────────
    const reglasAplicables = (ec.reglas || [])
      .filter(r => {
        if (!r?.texto) return false;
        if (!r.etapas || r.etapas.length === 0) return true;
        return r.etapas.includes(etapaActual);
      })
      .map(r => r.texto);

    // ── 8. Workflow ───────────────────────────────────────────────────────
    const objetivoActual      = wf?.objetivo      || ec.objetivo_principal || null;
    const etapaObjetivo       = wf?.etapa_objetivo || null;
    const workflowActual      = wf?.nombre         || null;
    const workflowPasoActual  = wf?.paso_actual    || null;

    // ── 9. Ensamblar ──────────────────────────────────────────────────────
    let ctx = {
      // Identidad
      company_id,
      canal,
      timestamp:      new Date(),
      mensaje_actual,

      // Cliente
      cliente: {
        identificador:       identificador_cliente,
        nombre:              dc?.nombre              || null,
        etapa_actual:        etapaActual,
        categoria_principal: dc?.categoria_principal || null,
        datos:               dc?.datos               || {},
        resumen:             resumen_cliente          || null,
        campos_faltantes:    camposFaltantes,
      },

      // Empresa (solo campos que el modelo necesita conocer)
      empresa: {
        nombre:             ec.nombre_empresa      || '',
        personalidad:       ec.personalidad        || '',
        objetivo_principal: ec.objetivo_principal  || '',
        idioma:             ec.idioma              || 'es',
        zona_horaria:       ec.zona_horaria        || 'America/Monterrey',
      },

      // Parámetros de IA (vienen de la config de empresa)
      ia: {
        modelo:      ec.modelo      || 'gpt-4o-mini',
        temperatura: ec.temperatura ?? 0.6,
        max_tokens:  ec.max_tokens  ?? 700,
      },

      // Estado de la conversación
      conversacion: {
        objetivo_actual:      objetivoActual,
        etapa_objetivo:       etapaObjetivo,
        workflow_actual:      workflowActual,
        workflow_paso_actual: workflowPasoActual,
        reglas_aplicables:    reglasAplicables,
      },

      // Conocimiento
      knowledge: {
        base_completa:        ec.knowledge_base      || '',
        secciones_relevantes: seccionesRelevantes,
        skills_activos:       skillsActivos,
        capacidades:          capsDisponibles,
      },

      // Memoria
      memoria: {
        corta:         memoriaCorta,
        resumen_largo: resumen_cliente || null,
      },
    };

    // ── 10. Optimización de tokens ────────────────────────────────────────
    const tokensEstimados = this._estimarTokens(ctx);
    const nivel           = nivelCompresion(tokensEstimados, this._maxTokensContexto);

    ctx.optimizacion = {
      tokens_estimados: tokensEstimados,
      nivel_compresion: nivel,
      campos_omitidos:  [],
    };

    if (nivel === 'leve') {
      ctx = this._comprimirLeve(ctx);
    } else if (nivel === 'agresiva') {
      ctx = this._comprimirAgresivo(ctx);
    }

    return ctx;
  }

  /**
   * Prepara el AIInput para el AIEngine.
   * El system_prompt proviene del PromptBuilder (M6) y se inyecta aquí.
   *
   * @param {Object} ctx           - ConversationContext
   * @param {string} system_prompt - Generado por PromptBuilder
   * @returns {import('../adapters/ai/ai-provider').AIInput}
   */
  prepararParaIA(ctx, system_prompt) {
    return {
      system_prompt,
      memoria_corta:  ctx.memoria.corta,
      mensaje_actual: ctx.mensaje_actual,
      temperatura:    ctx.ia.temperatura,
      max_tokens:     ctx.ia.max_tokens,
      modelo:         ctx.ia.modelo,
    };
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  _validarInput(input) {
    const requeridos = [
      'company_id',
      'canal',
      'identificador_cliente',
      'mensaje_actual',
      'empresa_config',
    ];
    for (const campo of requeridos) {
      if (input[campo] === null || input[campo] === undefined || input[campo] === '') {
        throw new Error(`ContextBuilder: campo requerido faltante — "${campo}"`);
      }
    }
    if (typeof input.empresa_config !== 'object' || Array.isArray(input.empresa_config)) {
      throw new Error('ContextBuilder: empresa_config debe ser un objeto');
    }
  }

  _estimarTokens(ctx) {
    let total = 0;
    total += estimarTokens(ctx.empresa.personalidad);
    total += estimarTokens(ctx.empresa.objetivo_principal);
    total += estimarTokens(ctx.knowledge.secciones_relevantes);
    total += estimarTokens(ctx.cliente.resumen);
    total += estimarTokens(JSON.stringify(ctx.cliente.datos));
    total += estimarTokens(ctx.conversacion.reglas_aplicables.join(' '));
    for (const par of ctx.memoria.corta) {
      total += estimarTokens(par.mensaje_cliente);
      total += estimarTokens(par.respuesta_tara);
    }
    return total;
  }

  // Compresión leve: reduce secciones de KB a la mitad
  _comprimirLeve(ctx) {
    const kbReducida = filtrarKnowledgeBase(
      ctx.knowledge.base_completa,
      ctx.mensaje_actual,
      Math.max(1, Math.ceil(this._maxSeccionesKB / 2))
    );

    return {
      ...ctx,
      knowledge: {
        ...ctx.knowledge,
        secciones_relevantes: kbReducida,
      },
      optimizacion: {
        tokens_estimados: this._estimarTokens({
          ...ctx,
          knowledge: { ...ctx.knowledge, secciones_relevantes: kbReducida },
        }),
        nivel_compresion: 'leve',
        campos_omitidos:  [],
      },
    };
  }

  // Compresión agresiva: recorta memoria a la mitad + omite datos si hay resumen
  _comprimirAgresivo(ctx) {
    const mitad = Math.max(1, Math.ceil(ctx.memoria.corta.length / 2));
    const memoriaRecortada = ctx.memoria.corta.slice(-mitad);

    const camposOmitidos = [];
    let clienteComprimido = ctx.cliente;

    // Si hay resumen, los datos detallados son redundantes
    if (ctx.cliente.resumen) {
      clienteComprimido = { ...ctx.cliente, datos: {} };
      camposOmitidos.push('cliente.datos');
    }

    const kbReducida = filtrarKnowledgeBase(
      ctx.knowledge.base_completa,
      ctx.mensaje_actual,
      Math.max(1, Math.ceil(this._maxSeccionesKB / 2))
    );

    const ctxComprimido = {
      ...ctx,
      cliente: clienteComprimido,
      knowledge: {
        ...ctx.knowledge,
        secciones_relevantes: kbReducida,
      },
      memoria: {
        ...ctx.memoria,
        corta: memoriaRecortada,
      },
    };

    return {
      ...ctxComprimido,
      optimizacion: {
        tokens_estimados: this._estimarTokens(ctxComprimido),
        nivel_compresion: 'agresiva',
        campos_omitidos:  camposOmitidos,
      },
    };
  }
}

module.exports = {
  ContextBuilder,
  // Utilidades exportadas para testing y uso externo
  estimarTokens,
  extraerKeywords,
  filtrarKnowledgeBase,
  recortarMemoria,
  calcularCamposFaltantes,
  nivelCompresion,
};
