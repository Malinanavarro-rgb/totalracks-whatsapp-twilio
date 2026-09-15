/**
 * TARA Matrix™ — catalogo-tecnico.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA especialista solar (Alina, 2026-09-15 — Nort Energy, Ficha Maestra
 * de Proveedor SOLES). Cierra el hueco encontrado en la auditoría: el
 * motor de ingeniería (modules/motores-ingenieria/paneles-solares.js) ya
 * usa `productos` real para calcular una cotización, pero la conversación
 * LIBRE (antes/fuera del workflow estructurado) no tenía ningún acceso
 * programático a la ficha técnica real — si un cliente preguntaba "¿este
 * inversor aguanta 12 paneles?" a media plática, el modelo solo tenía el
 * texto genérico de `knowledge_base` para responder.
 *
 * Mismo patrón que modules/cuenta-plataforma.js (ADR-012, "Asistente
 * Oficial de TARA-OS"): resuelve datos reales ANTES del turno de IA y los
 * agrega a `knowledge_base` como texto — el Core (ContextBuilder/
 * PromptBuilder/WorkflowEngine/Orchestrator) nunca cambia, nunca aprende
 * nada de "productos" ni "SOLES". Genérico por diseño: cualquier empresa
 * con catálogo en `productos` puede usarlo (no es exclusivo de paneles
 * solares ni de Nort Energy), y si una empresa no tiene productos que
 * coincidan con el mensaje, el comportamiento es idéntico a hoy (string
 * vacío, nada se agrega).
 *
 * Regla de oro (Alina, sección 18 de la auditoría): "NO TENGO INFORMACIÓN
 * SUFICIENTE PARA CONFIRMARLO" es mejor que inventar. Por eso
 * formatearParaKnowledge() nunca presenta un producto con
 * ficha_tecnica_completa=false como si sus specs estuvieran confirmadas —
 * se lo dice explícitamente al modelo en el mismo texto.
 *
 * @module modules/catalogo-tecnico
 */

'use strict';

// Nunca deben llegar a un prompt ni a una respuesta de cliente — separación
// estricta interno/cliente (Alina, sección 11: "el cliente JAMÁS debe
// recibir el costo del proveedor o margen interno").
const CAMPOS_INTERNOS = ['costo_proveedor', 'costo_interno_nort_energy', 'costo_instalacion', 'costo_materiales', 'margen'];

function _normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Quita campos internos de costos/margen — se llama SIEMPRE antes de que un producto salga de este módulo. */
function sanearProducto(producto) {
  const limpio = { ...producto };
  for (const campo of CAMPOS_INTERNOS) delete limpio[campo];
  return limpio;
}

/**
 * Busca productos activos de la empresa cuya marca o modelo aparezcan
 * mencionados en el texto — mismo criterio de conteo simple de palabras ya
 * usado en modules/orchestrator.js::_resolverServicioDesdeTexto() y
 * modules/plantillas-industria.js::detectarIndustria() (sin IA, sin
 * dependencias nuevas, mismo patrón ya validado en este proyecto).
 *
 * @returns {Promise<Array>} productos saneados (nunca campos internos), score más alto primero
 */
async function buscarProductosMencionados(supabase, companyId, texto, limite = 5) {
  if (!texto?.trim()) return [];

  const { data: productos, error } = await supabase
    .from('productos').select('*').eq('company_id', companyId).eq('activo', true);
  if (error || !productos?.length) return [];

  const textoNorm = _normalizar(texto);

  const conScore = productos
    .map((producto) => {
      const palabras = [_normalizar(producto.marca), _normalizar(producto.modelo)]
        .filter(Boolean).join(' ').split(/\s+/).filter((p) => p.length > 2);
      const score = palabras.filter((p) => textoNorm.includes(p)).length;
      return { producto, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return conScore.slice(0, limite).map((r) => sanearProducto(r.producto));
}

/**
 * Formatea productos reales como texto listo para `knowledge_base` —
 * jerarquía de fuente explícita en cada línea (Alina, sección 10): un
 * producto sin ficha técnica completa nunca se presenta como dato
 * confirmado.
 */
function formatearParaKnowledge(productos) {
  if (!productos?.length) return '';

  const lineas = productos.map((p) => {
    const specsTexto = p.specs && Object.keys(p.specs).length
      ? Object.entries(p.specs).map(([clave, valor]) => `${clave}: ${valor}`).join(', ')
      : 'sin datos técnicos cargados todavía';
    const estado = p.ficha_tecnica_completa
      ? 'FICHA TÉCNICA CONFIRMADA'
      : 'FICHA TÉCNICA PENDIENTE DE CONFIRMAR — no presentes estos datos como completos ni infieras los campos que faltan, di que vas a confirmar con el proveedor';
    const proveedor = p.proveedor ? ` — proveedor: ${p.proveedor}` : '';
    return `- ${p.marca}${p.modelo ? ' ' + p.modelo : ''} (${p.tipo}${proveedor}). ${estado}. Datos conocidos: ${specsTexto}.`;
  });

  return [
    '## CATÁLOGO TÉCNICO REAL (productos que coinciden con este mensaje)',
    'Usa ÚNICAMENTE estos datos para hablar de las especificaciones de un modelo específico — nunca completes con conocimiento general de internet ni con memoria de otros modelos similares.',
    ...lineas,
  ].join('\n');
}

/**
 * Punto de entrada — mismo criterio de inyección que
 * cuenta-plataforma.js::construirResumenCuentaParaKnowledge(): resuelve y
 * devuelve texto listo para concatenar a empresaConf.knowledge_base ANTES
 * de construir el contexto (ver modules/orchestrator.js, wiring opcional
 * null-safe). String vacío si no hay match — el llamador ya filtra eso.
 */
async function obtenerCatalogoTecnicoRelevante(supabase, companyId, mensajeActual) {
  const productos = await buscarProductosMencionados(supabase, companyId, mensajeActual);
  return formatearParaKnowledge(productos);
}

module.exports = {
  sanearProducto,
  buscarProductosMencionados,
  formatearParaKnowledge,
  obtenerCatalogoTecnicoRelevante,
  CAMPOS_INTERNOS,
};
