/**
 * TARA Matrix™ — operador-tools.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Modo Operador — capa de herramientas de solo lectura que el motor de
 * razonamiento (modules/operador-engine.js) puede invocar vía tool-calling.
 *
 * Regla de seguridad no negociable: el `alcance` SIEMPRE lo calcula el
 * servidor a partir de la sesión ya autenticada (nunca del LLM ni del body
 * de la petición — ver server.js, ruta /api/operador/preguntar). Ninguna
 * función de este módulo acepta company_id/organization_id como argumento
 * de la IA; el alcance se pasa aparte, como segundo parámetro fijo.
 *
 * alcance = { nivel: 'plataforma'|'organizacion'|'empresa', organization_id?, company_id? }
 *
 * No toca el Core congelado por ADR-005 — es lectura pura sobre tablas ya
 * existentes (clientes, oportunidades) y las nuevas de memoria institucional
 * (migración 074: tareas, proyectos, bitacora_decisiones, documentos).
 *
 * @module modules/operador-tools
 */

'use strict';

/**
 * Resuelve el alcance a una lista de company_id a filtrar, o `null` si no
 * hay que filtrar (alcance 'plataforma' — ve todo el ecosistema autorizado).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{nivel: string, organization_id?: string, company_id?: string}} alcance
 * @returns {Promise<string[]|null>}
 */
async function _companyIdsDeAlcance(supabase, alcance) {
  if (!alcance || alcance.nivel === 'empresa') {
    return alcance?.company_id ? [alcance.company_id] : [];
  }

  if (alcance.nivel === 'organizacion') {
    const { data, error } = await supabase
      .from('companies')
      .select('id')
      .eq('organization_id', alcance.organization_id);
    if (error) return [];
    return (data || []).map(c => c.id);
  }

  return null; // 'plataforma' — sin filtro, ve todas las empresas autorizadas
}

function _aplicarFiltroCompany(query, companyIds) {
  if (companyIds === null) return query; // plataforma: sin filtro
  if (companyIds.length === 0) return query.eq('company_id', '00000000-0000-0000-0000-000000000000'); // alcance vacío, nunca debe regresar filas
  return companyIds.length === 1 ? query.eq('company_id', companyIds[0]) : query.in('company_id', companyIds);
}

/** Tareas abiertas o en progreso, ordenadas por fecha límite más próxima. */
async function tareasAbiertas(supabase, alcance, { limite = 20 } = {}) {
  const companyIds = await _companyIdsDeAlcance(supabase, alcance);
  let query = supabase
    .from('tareas')
    .select('id, titulo, estado, fecha_limite, company_id, companies(nombre)')
    .in('estado', ['abierta', 'en_progreso']);
  query = _aplicarFiltroCompany(query, companyIds);
  const { data, error } = await query.order('fecha_limite', { ascending: true, nullsFirst: false }).limit(limite);
  return error ? [] : (data || []);
}

/** Proyectos activos con riesgo medio o alto. */
async function proyectosEnRiesgo(supabase, alcance, { limite = 20 } = {}) {
  const companyIds = await _companyIdsDeAlcance(supabase, alcance);
  let query = supabase
    .from('proyectos')
    .select('id, nombre, estado, riesgo, company_id, companies(nombre)')
    .eq('estado', 'activo')
    .in('riesgo', ['medio', 'alto']);
  query = _aplicarFiltroCompany(query, companyIds);
  const { data, error } = await query.order('riesgo', { ascending: false }).limit(limite);
  return error ? [] : (data || []);
}

/** Bitácora de decisiones de negocio recientes (no confundir con decision_logs, telemetría técnica de IA). */
async function decisionesRecientes(supabase, alcance, { dias = 30, limite = 20 } = {}) {
  const companyIds = await _companyIdsDeAlcance(supabase, alcance);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from('bitacora_decisiones')
    .select('id, texto, contexto, created_at, company_id, companies(nombre)')
    .gte('created_at', desde);
  query = _aplicarFiltroCompany(query, companyIds);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limite);
  return error ? [] : (data || []);
}

/** Busca documentos/notas internas por coincidencia de texto en título o contenido. */
async function buscarDocumentos(supabase, alcance, { texto = '', limite = 10 } = {}) {
  const companyIds = await _companyIdsDeAlcance(supabase, alcance);
  let query = supabase
    .from('documentos')
    .select('id, titulo, contenido, categoria, company_id, companies(nombre)');
  if (texto) query = query.or(`titulo.ilike.%${texto}%,contenido.ilike.%${texto}%`);
  query = _aplicarFiltroCompany(query, companyIds);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(limite);
  return error ? [] : (data || []);
}

/** Resumen del pipeline comercial: cuántas oportunidades hay por etapa. */
async function resumenPipeline(supabase, alcance) {
  const companyIds = await _companyIdsDeAlcance(supabase, alcance);
  let query = supabase.from('oportunidades').select('estado, company_id, companies(nombre)');
  query = _aplicarFiltroCompany(query, companyIds);
  const { data, error } = await query;
  if (error || !data) return {};

  const resumen = {};
  for (const fila of data) {
    resumen[fila.estado] = (resumen[fila.estado] || 0) + 1;
  }
  return resumen;
}

/** Busca un cliente por nombre (o coincidencia parcial) dentro del alcance autorizado. */
async function buscarCliente(supabase, alcance, { nombre = '', limite = 10 } = {}) {
  const companyIds = await _companyIdsDeAlcance(supabase, alcance);
  let query = supabase
    .from('clientes')
    .select('id, nombre, telefono, estado, empresa, company_id, companies(nombre)');
  if (nombre) query = query.ilike('nombre', `%${nombre}%`);
  query = _aplicarFiltroCompany(query, companyIds);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limite);
  return error ? [] : (data || []);
}

/**
 * Catálogo de tools en formato OpenAI (tools/tool_choice) — nombre y
 * parámetros visibles al modelo. Los parámetros NUNCA incluyen
 * company_id/organization_id; el alcance se aplica aparte, en el dispatcher.
 */
const CATALOGO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'tareas_abiertas',
      description: 'Lista las tareas abiertas o en progreso, ordenadas por fecha límite más próxima.',
      parameters: { type: 'object', properties: { limite: { type: 'integer', description: 'máximo de resultados' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proyectos_en_riesgo',
      description: 'Lista los proyectos activos con riesgo medio o alto.',
      parameters: { type: 'object', properties: { limite: { type: 'integer' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'decisiones_recientes',
      description: 'Lista decisiones de negocio registradas recientemente en la bitácora.',
      parameters: {
        type: 'object',
        properties: {
          dias:   { type: 'integer', description: 'ventana de días hacia atrás, default 30' },
          limite: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_documentos',
      description: 'Busca documentos o notas internas por coincidencia de texto en título o contenido.',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string', description: 'palabra o frase a buscar' }, limite: { type: 'integer' } },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_pipeline',
      description: 'Resumen del pipeline comercial: cuántas oportunidades hay por etapa/estado.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_cliente',
      description: 'Busca un cliente por nombre (coincidencia parcial).',
      parameters: {
        type: 'object',
        properties: { nombre: { type: 'string' }, limite: { type: 'integer' } },
        required: ['nombre'],
      },
    },
  },
];

const IMPLEMENTACIONES = {
  tareas_abiertas:      tareasAbiertas,
  proyectos_en_riesgo:  proyectosEnRiesgo,
  decisiones_recientes: decisionesRecientes,
  buscar_documentos:    buscarDocumentos,
  resumen_pipeline:     resumenPipeline,
  buscar_cliente:       buscarCliente,
};

/**
 * Ejecuta una tool por nombre, aplicando el alcance calculado por el
 * servidor. Nunca confía en un company_id/organization_id que venga en
 * `argumentos` (el LLM no los conoce — no están en el catálogo expuesto).
 *
 * @param {string} nombre
 * @param {Object} argumentos - lo que decidió el modelo (sin campos de alcance)
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{nivel: string, organization_id?: string, company_id?: string}} alcance
 * @returns {Promise<*>}
 */
async function ejecutarTool(nombre, argumentos, supabase, alcance) {
  const fn = IMPLEMENTACIONES[nombre];
  if (!fn) throw new Error(`operador-tools.ejecutarTool: tool desconocida "${nombre}"`);
  return fn(supabase, alcance, argumentos || {});
}

module.exports = {
  tareasAbiertas,
  proyectosEnRiesgo,
  decisionesRecientes,
  buscarDocumentos,
  resumenPipeline,
  buscarCliente,
  ejecutarTool,
  CATALOGO_TOOLS,
};
