/**
 * TARA Matrix™ — operador-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Modo Operador — el motor de razonamiento libre sobre datos de la empresa/
 * organización/plataforma (según alcance). Responde preguntas tipo "¿qué
 * tareas quedaron abiertas?" o "resume el estado de la empresa".
 *
 * Deliberadamente NO pasa por Orchestrator/ContextBuilder/PromptBuilder/
 * WorkflowEngine (Core congelado por ADR-005) — esos están construidos para
 * una conversación con UN cliente dentro de UNA empresa, con un schema JSON
 * fijo de negocio (categoria_principal, intenciones, etc.) que no aplica
 * aquí. Mismo patrón ya usado y validado por modules/asistente-consultas.js:
 * una llamada de IA separada, de solo lectura, con su propio prompt — nunca
 * escribe en `conversaciones` ni activa un workflow.
 *
 * "Un solo motor de inteligencia" (requisito explícito del diseño) se
 * cumple en la capa que de verdad importa: el mismo cliente OpenAI, el
 * mismo proveedor/cuenta, el mismo mecanismo de registro de costo
 * (decision_logs) — no forzando este flujo por el contrato rígido de
 * AIProvider/AIEngine (adapters/ai/), que fue diseñado específicamente
 * para el schema JSON de negocio del motor conversacional y no encaja
 * con una pregunta libre de formato abierto.
 *
 * Seguridad: el `alcance` SIEMPRE lo determina el caller (server.js, a
 * partir de la sesión ya autenticada) — nunca se construye aquí a partir
 * de nada que venga del usuario final o del modelo.
 *
 * @module modules/operador-engine
 */

'use strict';

const { ejecutarTool, CATALOGO_TOOLS } = require('./operador-tools');
const { obtenerResumenEjecutivo } = require('./business-memory-core');

const MODELO_DEFAULT          = 'gpt-4o-mini';
const MAX_ITERACIONES_TOOLS   = 5;
const MAX_TOKENS_RESPUESTA    = 600;

const SYSTEM_PROMPT = [
  'Eres TARA, la inteligencia que ayuda a operar este negocio — no un chatbot de atención a clientes.',
  'Tu trabajo es ayudar a dirigir la operación: conectar información entre módulos, detectar riesgos,',
  'encontrar oportunidades y ayudar en la toma de decisiones. Piensas sobre la empresa, no solo respondes.',
  'Usa las herramientas disponibles para consultar datos reales antes de responder — nunca inventes',
  'cifras, tareas o clientes que no confirmaste con una herramienta.',
  'Si no tienes suficiente información incluso después de consultar, dilo con claridad en vez de adivinar.',
  'Responde en español, directo y objetivo, en máximo 150 palabras salvo que te pidan un resumen extenso.',
].join(' ');

/**
 * @param {Object} opciones
 * @param {import('@supabase/supabase-js').SupabaseClient} opciones.supabase
 * @param {{chat: {completions: {create: Function}}}} opciones.openaiClient - cliente OpenAI ya instanciado (inyectado, no importado directo — testeable sin mocks de módulo)
 * @param {string} opciones.pregunta
 * @param {{nivel: string, organization_id?: string, company_id?: string}} opciones.alcance - calculado por el caller a partir de la sesión, nunca por el modelo
 * @param {{id: string, rol: string}} [opciones.usuario] - calculado por el caller a partir de la sesión, nunca por el modelo; requerido por las tools de escritura del Business Memory Core (trazabilidad de quién propuso/confirmó/rechazó)
 * @param {{role: string, content: string}[]} [opciones.historialCorto]
 * @param {string} [opciones.modelo]
 * @returns {Promise<{respuesta_texto: string, tokens_total: number, iteraciones: number, tools_usadas: string[]}>}
 */
async function preguntar({ supabase, openaiClient, pregunta, alcance, usuario, historialCorto = [], modelo = MODELO_DEFAULT }) {
  if (!alcance || !alcance.nivel) {
    throw new Error('operador-engine.preguntar: alcance requerido (lo calcula el caller, nunca el usuario final)');
  }

  // Business Memory Core (BMC): solo a nivel 'empresa' (una sola compañía) —
  // a nivel organización/plataforma habría que agregar el resumen de N
  // empresas distintas, lo cual es trabajo de Business Intelligence (v0.9),
  // no de esta fase. Lectura pura (sin IA, ver business-memory-core.js);
  // si falla, nunca bloquea a Modo Operador — sigue igual que antes de BMC.
  let resumenNegocio = null;
  if (alcance.nivel === 'empresa' && alcance.company_id) {
    try {
      resumenNegocio = await obtenerResumenEjecutivo(supabase, alcance.company_id);
    } catch {
      resumenNegocio = null;
    }
  }

  const systemPrompt = resumenNegocio?.resumen
    ? `${SYSTEM_PROMPT} Memoria empresarial de este negocio (resumen ejecutivo ya validado por un humano): ${resumenNegocio.resumen}`
    : SYSTEM_PROMPT;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...historialCorto,
    { role: 'user', content: pregunta },
  ];

  let tokensTotal = 0;
  const toolsUsadas = [];

  for (let iteracion = 1; iteracion <= MAX_ITERACIONES_TOOLS; iteracion++) {
    let respuesta;
    try {
      respuesta = await openaiClient.chat.completions.create({
        model:       modelo,
        messages,
        tools:       CATALOGO_TOOLS,
        temperature: 0.3,
        max_tokens:  MAX_TOKENS_RESPUESTA,
      });
    } catch (e) {
      return {
        respuesta_texto: 'Tuve un problema técnico consultando la información. Intenta de nuevo en unos segundos.',
        tokens_total: tokensTotal, iteraciones: iteracion, tools_usadas: toolsUsadas, error: e.message,
      };
    }

    const choice = respuesta.choices[0];
    tokensTotal += respuesta.usage?.total_tokens || 0;

    const toolCalls = choice.message.tool_calls;
    if (choice.finish_reason === 'tool_calls' && toolCalls?.length) {
      messages.push(choice.message);
      for (const toolCall of toolCalls) {
        let argumentos = {};
        try { argumentos = JSON.parse(toolCall.function.arguments || '{}'); } catch { /* argumentos inválidos → {} */ }

        let resultado;
        try {
          resultado = await ejecutarTool(toolCall.function.name, argumentos, supabase, alcance, usuario, openaiClient);
          toolsUsadas.push(toolCall.function.name);
        } catch (e) {
          resultado = { error: e.message };
        }

        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(resultado) });
      }
      continue; // deja que el modelo use los resultados en la siguiente vuelta
    }

    return {
      respuesta_texto: choice.message.content || 'No pude generar una respuesta con la información disponible.',
      tokens_total: tokensTotal, iteraciones: iteracion, tools_usadas: toolsUsadas,
    };
  }

  return {
    respuesta_texto: 'Tu pregunta requirió demasiados pasos de consulta — intenta ser más específico.',
    tokens_total: tokensTotal, iteraciones: MAX_ITERACIONES_TOOLS, tools_usadas: toolsUsadas,
  };
}

// ── "Convertir en respuesta para cliente" (Centro de Conocimiento, Fase 3) ──
// Toma una respuesta interna de Modo Operador (pensada para el equipo, puede
// incluir profundidad técnica) y la traduce a un mensaje enviable a un
// cliente — mismo cliente OpenAI, llamada simple sin tools, prompt distinto.
// No requiere infraestructura nueva (auditoría, sección 6.3).

const SYSTEM_PROMPT_RESPUESTA_CLIENTE = [
  'Tu única tarea es traducir una respuesta interna de Modo Operador (pensada para el equipo de la empresa,',
  'puede incluir profundidad técnica) a un mensaje que se le pueda enviar directamente a un CLIENTE:',
  'lenguaje sencillo, tono consultivo y cordial, sin jerga interna.',
  'Elimina SIEMPRE cualquier dato que un cliente nunca debería ver: costos de proveedor, costos internos,',
  'márgenes, comisiones, nombres o datos de otros clientes, notas internas del equipo, o cualquier evaluación',
  'del desempeño de un asesor. No agregues datos, cifras ni promesas que no estén ya en el texto original —',
  'si después de quitar lo interno no queda nada seguro que compartir, dilo con honestidad en vez de inventar.',
  'Responde ÚNICAMENTE con el mensaje final para el cliente, sin explicaciones ni texto adicional.',
].join(' ');

/**
 * @param {Object} opciones
 * @param {{chat: {completions: {create: Function}}}} opciones.openaiClient
 * @param {string} opciones.textoInterno - la respuesta interna de Modo Operador a traducir
 * @param {string} [opciones.modelo]
 * @returns {Promise<string>} el mensaje listo para enviar al cliente
 */
async function convertirParaCliente({ openaiClient, textoInterno, modelo = MODELO_DEFAULT }) {
  if (!textoInterno || !textoInterno.trim()) {
    throw new Error('operador-engine.convertirParaCliente: textoInterno requerido');
  }

  const respuesta = await openaiClient.chat.completions.create({
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_RESPUESTA_CLIENTE },
      { role: 'user', content: textoInterno },
    ],
    temperature: 0.3,
    max_tokens: MAX_TOKENS_RESPUESTA,
  });

  return respuesta.choices[0]?.message?.content?.trim() || 'No pude generar una versión para cliente de este texto.';
}

module.exports = { preguntar, convertirParaCliente, SYSTEM_PROMPT, SYSTEM_PROMPT_RESPUESTA_CLIENTE, MAX_ITERACIONES_TOOLS };
