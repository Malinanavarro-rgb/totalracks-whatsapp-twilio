/**
 * TARA Matrix™ — PromptBuilder
 * ─────────────────────────────────────────────────────────────────────────────
 * Único responsable de construir el system prompt para el AI Engine.
 *
 * Ningún otro módulo debe construir prompts.
 * Toda la lógica de ensamblaje vive aquí.
 *
 * Principios de diseño:
 *   1. Bloques independientes — cada sección puede activarse o desactivarse
 *   2. Solo incluye contenido no vacío — bloques sin datos se omiten
 *   3. Agnóstico — no contiene lógica de ningún giro comercial
 *   4. Determinístico — mismo contexto produce siempre el mismo prompt
 *   5. Compatible con cualquier proveedor soportado por el AI Engine
 *
 * Flujo:
 *   ConversationContext (de ContextBuilder)
 *     → PromptBuilder.construir(ctx)
 *       → system_prompt (string)
 *         → ContextBuilder.prepararParaIA(ctx, system_prompt)
 *           → AIInput → AIEngine.procesar()
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloques disponibles (en orden de prioridad descendente para el modelo):
 *
 *   identidad         → quién es el asistente y cómo se comunica
 *   objetivo          → meta comercial de la conversación
 *   etapa_cliente     → dónde está el cliente y adónde queremos llevarlo
 *   knowledge_base    → conocimiento relevante para responder
 *   skills            → capacidades del asistente
 *   resumen_cliente   → historial comprimido del cliente
 *   campos_pendientes → información que aún falta capturar
 *   reglas            → restricciones y guías de la conversación
 *   capacidades       → acciones disponibles en acciones_propuestas
 *   schema_json       → formato JSON esperado en la respuesta
 *
 * @module modules/prompt-builder
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// BLOQUES — funciones puras (ctx → string | null)
// Retornar null significa "no incluir este bloque".
// Exportadas para permitir testing individual y extensión en el futuro.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Identidad del asistente: nombre, rol, empresa, tono y restricciones.
 * El Orchestrator construye este string desde la tabla personalities.
 */
function bloque_identidad(ctx) {
  const personalidad = ctx.empresa?.personalidad;
  if (!personalidad) return null;
  return `## IDENTIDAD\n${personalidad}`;
}

/**
 * Objetivo de la conversación.
 * Usa el objetivo activo del workflow si existe;
 * si no, el objetivo principal de la empresa.
 */
function bloque_objetivo(ctx) {
  const objetivo = ctx.conversacion?.objetivo_actual
    || ctx.empresa?.objetivo_principal;
  if (!objetivo) return null;
  return `## OBJETIVO\n${objetivo}`;
}

/**
 * Etapa comercial actual del cliente y adónde debe avanzar.
 * Solo incluye campos que tengan valor.
 */
function bloque_etapa_cliente(ctx) {
  const partes = [];
  const cliente = ctx.cliente;

  // 'Sin nombre' es el placeholder que crm.js usa al crear un cliente nuevo
  // (nunca null) — tratarlo como nombre real le diría al modelo "ya conozco
  // el nombre" cuando en realidad no lo tiene, rompiendo "pregúntalo una
  // sola vez si no lo sabes".
  if (cliente?.nombre && cliente.nombre !== 'Sin nombre') partes.push(`Cliente: ${cliente.nombre}`);
  if (cliente?.etapa_actual)        partes.push(`Etapa actual: ${cliente.etapa_actual}`);
  if (cliente?.categoria_principal) partes.push(`Producto de interés: ${cliente.categoria_principal}`);

  const etapaObj = ctx.conversacion?.etapa_objetivo;
  if (etapaObj) partes.push(`Etapa objetivo: ${etapaObj}`);

  if (partes.length === 0) return null;
  return `## ETAPA COMERCIAL\n${partes.join('\n')}`;
}

/**
 * Secciones del knowledge base relevantes al mensaje actual.
 * El ContextBuilder ya filtró las más relevantes.
 */
function bloque_knowledge_base(ctx) {
  const kb = ctx.knowledge?.secciones_relevantes;
  if (!kb || !kb.trim()) return null;
  return `## CONOCIMIENTO\n${kb.trim()}`;
}

/**
 * Skills activos del asistente para esta empresa.
 * Orienta al modelo sobre qué tareas puede realizar.
 */
function bloque_skills(ctx) {
  const skills = ctx.knowledge?.skills_activos;
  if (!Array.isArray(skills) || skills.length === 0) return null;
  return `## HABILIDADES\nPuedes realizar las siguientes tareas: ${skills.join(', ')}.`;
}

/**
 * Historial comprimido del cliente (generado por el Summary Engine).
 * Solo se incluye si existe. Reemplaza datos detallados cuando hay compresión agresiva.
 */
function bloque_resumen_cliente(ctx) {
  const resumen = ctx.cliente?.resumen || ctx.memoria?.resumen_largo;
  if (!resumen || !resumen.trim()) return null;
  return `## HISTORIAL DEL CLIENTE\n${resumen.trim()}`;
}

/**
 * Campos obligatorios que aún faltan capturar del cliente.
 * Instruye al modelo a obtenerlos de forma natural, sin ser mecánico.
 */
function bloque_campos_pendientes(ctx) {
  const campos = ctx.cliente?.campos_faltantes;
  if (!Array.isArray(campos) || campos.length === 0) return null;

  const lista = campos.join(', ');
  return `## INFORMACIÓN PENDIENTE\nNecesitas obtener de forma natural durante la conversación: ${lista}.\nNo los solicites todos a la vez. Máximo uno por respuesta si el flujo lo permite.`;
}

/**
 * Reglas de negocio aplicables a la etapa actual del cliente.
 * El ContextBuilder ya filtró solo las relevantes a la etapa.
 */
function bloque_reglas(ctx) {
  const reglas = ctx.conversacion?.reglas_aplicables;
  if (!Array.isArray(reglas) || reglas.length === 0) return null;

  const lista = reglas.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `## REGLAS\n${lista}`;
}

/**
 * Acciones que el AI puede proponer en acciones_propuestas.
 * Solo se incluye si hay capacidades disponibles.
 */
function bloque_capacidades(ctx) {
  const caps = ctx.knowledge?.capacidades;
  if (!Array.isArray(caps) || caps.length === 0) return null;

  return `## ACCIONES DISPONIBLES\nPuedes proponer estas acciones en el campo "acciones_propuestas": ${caps.join(', ')}.`;
}

/**
 * Formato JSON esperado en la respuesta del modelo.
 * Es el bloque más crítico — siempre debe ser el último.
 * Adapta los tipos de acciones_propuestas a las capacidades disponibles.
 *
 * Nota de compatibilidad: usa "respuesta_texto" (nombre canónico FASE 2).
 * El OpenAIProvider también acepta "respuesta_tara" por compatibilidad con FASE 1.
 */
function bloque_schema_json(ctx) {
  const caps   = ctx.knowledge?.capacidades        || [];
  const idioma = ctx.empresa?.idioma               || 'es';
  const campos = ctx.cliente?.campos_faltantes     || [];

  const tiposAccion = caps.length > 0
    ? caps.map(c => `"${c}"`).join(' | ')
    : '"nombre_accion"';

  // Incluir claves exactas para que el AI no invente nombres propios
  const datosSchema = campos.length > 0
    ? `{${campos.map(c => `"${c}": null`).join(', ')}}`
    : '{}';

  return `## FORMATO DE RESPUESTA
Responde ÚNICAMENTE con JSON válido. Sin texto antes ni después. Sin markdown. Sin backticks.
{
  "respuesta_texto":     "tu respuesta al cliente (máximo 130 palabras, idioma: ${idioma})",
  "categoria_principal": "categoría universal del producto o servicio detectado, o 'Sin clasificar'",
  "datos_extraidos":     ${datosSchema},
  "intenciones":         ["interes_compra" | "solicitud_cotizacion" | "soporte" | "seguimiento" | "cancelar_flujo" | "consulta_general"],
  "sentimiento":         "Positivo | Neutral | Negativo | Muy interesado",
  "etapa_sugerida":      "Nuevo | Calificacion | Negociacion | Cierre | Postventa",
  "acciones_propuestas": [{"tipo": ${tiposAccion}, "parametros": {}}]
}
IMPORTANTE: el campo "intenciones" debe contener ÚNICAMENTE valores del catálogo anterior. Uno o más valores del arreglo, separados por coma. Ningún valor fuera de ese catálogo.
IMPORTANTE: en "datos_extraidos" usa EXACTAMENTE las claves del schema. SOLO incluye el valor si el cliente lo mencionó EXPLÍCITAMENTE en su mensaje. Si no lo dijo con palabras claras, el valor DEBE ser null. No inferir, no asumir, no adivinar.`;
}

// ═════════════════════════════════════════════════════════════════════════════
// REGISTRO Y ORDEN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Mapa de nombre → función constructora de bloque.
 * Extensible: agregar una clave aquí es suficiente para registrar un bloque nuevo.
 */
const MAPA_BLOQUES = {
  identidad:         bloque_identidad,
  objetivo:          bloque_objetivo,
  etapa_cliente:     bloque_etapa_cliente,
  knowledge_base:    bloque_knowledge_base,
  skills:            bloque_skills,
  resumen_cliente:   bloque_resumen_cliente,
  campos_pendientes: bloque_campos_pendientes,
  reglas:            bloque_reglas,
  capacidades:       bloque_capacidades,
  schema_json:       bloque_schema_json,
};

/**
 * Orden canónico de bloques.
 * El modelo procesa el prompt de arriba hacia abajo:
 *   identidad → objetivo → contexto → conocimiento → restricciones → formato
 */
const ORDEN_DEFAULT = [
  'identidad',
  'objetivo',
  'etapa_cliente',
  'knowledge_base',
  'skills',
  'resumen_cliente',
  'campos_pendientes',
  'reglas',
  'capacidades',
  'schema_json',
];

// ═════════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER
// ═════════════════════════════════════════════════════════════════════════════

class PromptBuilder {
  /**
   * @param {Object}   [config]
   * @param {string[]} [config.bloques_activos]  - Lista ordenada de bloques a incluir
   * @param {string}   [config.separador='\n\n'] - Separador entre bloques
   */
  constructor(config = {}) {
    this._bloquesActivos = Array.isArray(config.bloques_activos)
      ? config.bloques_activos
      : [...ORDEN_DEFAULT];

    this._separador = config.separador ?? '\n\n';
  }

  /**
   * Construye el system prompt completo a partir del ConversationContext.
   * Solo incluye bloques con contenido no vacío.
   *
   * @param {Object} ctx - ConversationContext producido por ContextBuilder
   * @returns {string}   - System prompt listo para AIEngine
   */
  construir(ctx) {
    if (!ctx) throw new Error('PromptBuilder.construir(): ctx es requerido');

    const secciones = [];

    for (const nombre of this._bloquesActivos) {
      const fn = MAPA_BLOQUES[nombre];

      if (!fn) {
        console.warn(`⚠️  PromptBuilder: bloque desconocido "${nombre}" — ignorado`);
        continue;
      }

      const contenido = fn(ctx);
      if (contenido && contenido.trim()) {
        secciones.push(contenido.trim());
      }
    }

    if (secciones.length === 0) {
      throw new Error('PromptBuilder.construir(): el contexto produjo un prompt vacío');
    }

    return secciones.join(this._separador);
  }

  /**
   * Construye un bloque individual por nombre.
   * Útil para debugging y para el PromptBuilder del Orchestrator.
   *
   * @param {string} nombre - Nombre del bloque
   * @param {Object} ctx
   * @returns {string|null}
   */
  construirBloque(nombre, ctx) {
    const fn = MAPA_BLOQUES[nombre];
    if (!fn) throw new Error(`PromptBuilder.construirBloque(): bloque desconocido "${nombre}"`);
    return fn(ctx) || null;
  }

  /**
   * Lista todos los bloques registrados en el sistema.
   * @returns {string[]}
   */
  listarBloques() {
    return Object.keys(MAPA_BLOQUES);
  }

  /**
   * Lista los bloques activos en esta instancia (en orden).
   * @returns {string[]}
   */
  listarBloquesActivos() {
    return [...this._bloquesActivos];
  }
}

module.exports = {
  PromptBuilder,
  ORDEN_DEFAULT,
  MAPA_BLOQUES,
  // Funciones de bloque exportadas para testing individual
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
};
