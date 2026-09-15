/**
 * TARA Matrix™ — faq-solar.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA experta en preguntas, dudas y objeciones de clientes de energía
 * solar (Alina, 2026-09-15 — Nort Energy). Base de conocimiento editable
 * (`solar_faq`) en vez de preguntas fijas en el prompt — "esto permitirá
 * agregar nuevas dudas sin modificar código" (petición textual).
 *
 * Mismo patrón que modules/catalogo-tecnico.js (que a su vez sigue
 * ADR-012/cuenta-plataforma.js): resuelve datos reales ANTES del turno de
 * IA y los agrega a knowledge_base como texto — el Core nunca cambia,
 * nunca aprende nada de "FAQ" ni "objeciones". Genérico por diseño:
 * cualquier empresa con filas en `solar_faq` se beneficia; sin filas o sin
 * match, el comportamiento es idéntico a hoy.
 *
 * @module modules/faq-solar
 */

'use strict';

function _normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Palabras demasiado comunes en preguntas cotidianas — se ignoran al armar
// las "palabras clave" de cada entrada, si no, casi cualquier mensaje
// matchearía casi cualquier FAQ por compartir "el", "que", "mi", etc.
const PALABRAS_VACIAS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'que', 'qué', 'y', 'o', 'a', 'en', 'con', 'por', 'para', 'es', 'son',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'me', 'te', 'se', 'lo', 'si', 'sí',
  'como', 'cómo', 'cuando', 'cuándo', 'cuanto', 'cuánto', 'cuánta', 'cuántos',
  'cuántas', 'voy', 'va', 'van', 'puedo', 'puede', 'pueden', 'tengo', 'tiene',
  'hay', 'ya', 'no', 'muy', 'más', 'esto', 'esta', 'este', 'eso', 'ese',
]);

function _palabrasClave(texto) {
  return _normalizar(texto).split(/\W+/).filter((p) => p.length > 2 && !PALABRAS_VACIAS.has(p));
}

/**
 * Busca en `solar_faq` las entradas cuya pregunta o formulaciones
 * alternativas comparten más palabras clave con el mensaje del cliente —
 * mismo criterio de conteo simple ya usado en
 * modules/catalogo-tecnico.js::buscarProductosMencionados() y
 * modules/orchestrator.js::_resolverServicioDesdeTexto().
 *
 * @returns {Promise<Array>} entradas activas, score más alto primero
 */
async function buscarFaqRelevante(supabase, companyId, texto, limite = 2) {
  if (!texto?.trim()) return [];

  const { data: entradas, error } = await supabase
    .from('solar_faq').select('*').eq('company_id', companyId).eq('active', true);
  if (error || !entradas?.length) return [];

  const palabrasMensaje = new Set(_palabrasClave(texto));
  if (palabrasMensaje.size === 0) return [];

  const conScore = entradas
    .map((entrada) => {
      const formulaciones = [entrada.question, ...(entrada.alternative_phrasings || [])];
      const palabrasEntrada = new Set(formulaciones.flatMap((f) => _palabrasClave(f)));
      let score = 0;
      for (const palabra of palabrasEntrada) {
        if (palabrasMensaje.has(palabra)) score++;
      }
      return { entrada, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return conScore.slice(0, limite).map((r) => r.entrada);
}

/**
 * Formatea entradas de FAQ como texto listo para `knowledge_base` — cada
 * una con sus banderas explícitas de vigencia/dependencia de datos del
 * cliente, para que el modelo nunca presente como definitivo lo que no lo es.
 */
function formatearParaKnowledge(entradas) {
  if (!entradas?.length) return '';

  const bloques = entradas.map((e) => {
    const avisos = [];
    if (e.requires_current_data) {
      avisos.push('Esta información puede cambiar (CFE, trámites, tarifas, regulación) — si no estás seguro de que sigue vigente, dilo antes de confirmarla como definitiva.');
    }
    if (e.requires_customer_data) {
      avisos.push('La respuesta real depende de datos específicos de este cliente (consumo, techo, ubicación, etc.) — usa esto como base general, no como su caso ya calculado.');
    }

    const partes = [
      `PREGUNTA: ${e.question}`,
      `RESPUESTA SENCILLA (úsala primero, en lenguaje cotidiano): ${e.simple_answer}`,
    ];
    if (e.technical_answer) partes.push(`RESPUESTA TÉCNICA (solo si el cliente pide profundizar): ${e.technical_answer}`);
    if (e.sales_followup) partes.push(`SIGUIENTE PASO SUGERIDO (una sola pregunta, solo si tiene sentido en este momento): ${e.sales_followup}`);
    if (avisos.length) partes.push(`AVISO: ${avisos.join(' ')}`);

    return partes.join('\n');
  });

  return [
    '## PREGUNTAS FRECUENTES REALES (coinciden con este mensaje)',
    'Usa la respuesta sencilla como base de tu respuesta — en tu propio tono, sin copiarla literal. Profundiza con la respuesta técnica SOLO si el cliente pide más detalle. Como máximo UNA pregunta de seguimiento, solo si ayuda a avanzar la conversación — nunca termines con "¿en qué más puedo ayudarte?".',
    ...bloques,
  ].join('\n\n');
}

/**
 * Punto de entrada — mismo criterio de inyección que
 * catalogo-tecnico.js::obtenerCatalogoTecnicoRelevante(): resuelve y
 * devuelve texto listo para concatenar a empresaConf.knowledge_base ANTES
 * de construir el contexto (ver modules/orchestrator.js, wiring opcional
 * null-safe). String vacío si no hay match.
 */
async function obtenerFaqRelevante(supabase, companyId, mensajeActual) {
  const entradas = await buscarFaqRelevante(supabase, companyId, mensajeActual);
  return formatearParaKnowledge(entradas);
}

module.exports = {
  buscarFaqRelevante,
  formatearParaKnowledge,
  obtenerFaqRelevante,
};
