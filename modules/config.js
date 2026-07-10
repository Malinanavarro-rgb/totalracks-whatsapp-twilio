'use strict';

/**
 * TARA Matrix™ — config.js
 * Carga y cachea la configuración de empresa desde Supabase.
 * Fuente única de verdad para company, personality y knowledge_base.
 *
 * FASE 3: cache dinámico por companyId (Map) en lugar de valor único.
 * Soporta N empresas simultáneas sin contaminación de caché.
 */

// RLS: usado por el Orchestrator durante el procesamiento del webhook (sin
// usuario final) — usa supabaseServicio (bypassa RLS por diseño de Supabase).
const { supabaseServicio: supabase } = require('./clients');

const _cache   = new Map(); // Map<companyId, { data, cachedAt }>
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * @param {string} companyId - UUID de la empresa en la tabla companies
 * @returns {Promise<{ company, personality, knowledge }>}
 */
async function obtenerConfigEmpresa(companyId) {
  if (!companyId) throw new Error('obtenerConfigEmpresa: companyId es requerido');

  const cached = _cache.get(companyId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
    return cached.data;
  }

  const { data: company, error: errCompany } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .eq('estado', 'activo')
    .maybeSingle();

  if (errCompany || !company) {
    throw new Error(`Empresa no encontrada o inactiva: ${companyId}`);
  }

  const { data: personality } = await supabase
    .from('personalities')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  const { data: knowledge } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('company_id', companyId)
    .order('categoria');

  const result = { company, personality, knowledge: knowledge || [] };

  _cache.set(companyId, { data: result, cachedAt: Date.now() });
  console.log(`✅ Config cargada: ${company.nombre} | ${personality?.nombre_asistente}`);

  return result;
}

/**
 * Invalida la caché de una empresa. Se llama después de editar
 * personalities/knowledge_base desde Configuración (Fase 6) para que el
 * cambio tenga efecto inmediato, sin esperar el TTL de 5 minutos.
 *
 * @param {string} companyId
 */
function invalidarCache(companyId) {
  _cache.delete(companyId);
}

module.exports = { obtenerConfigEmpresa, invalidarCache };
