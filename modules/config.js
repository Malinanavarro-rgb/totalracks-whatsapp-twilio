/**
 * TARA Matrix™ — config.js
 * Carga y cachea la configuración de empresa desde Supabase.
 * Fuente única de verdad para company, personality y knowledge_base.
 */

const { supabase, COMPANY_SLUG } = require('./clients');

let _configCache = null;
let _configCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function obtenerConfigEmpresa() {
  if (_configCache && (Date.now() - _configCacheTime) < CACHE_TTL) {
    return _configCache;
  }

  const { data: company, error: errCompany } = await supabase
    .from('companies')
    .select('*')
    .eq('slug', COMPANY_SLUG)
    .eq('estado', 'activo')
    .maybeSingle();

  if (errCompany || !company) {
    throw new Error(`Empresa no encontrada o inactiva: ${COMPANY_SLUG}`);
  }

  const { data: personality } = await supabase
    .from('personalities')
    .select('*')
    .eq('company_id', company.id)
    .maybeSingle();

  const { data: knowledge } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('company_id', company.id)
    .order('categoria');

  _configCache = { company, personality, knowledge: knowledge || [] };
  _configCacheTime = Date.now();

  console.log(`✅ Config cargada: ${company.nombre} | ${personality?.nombre_asistente}`);
  return _configCache;
}

module.exports = { obtenerConfigEmpresa };
