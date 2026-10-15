/**
 * TARA Matrix™ — modulos-empresa.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA Module Engine, Fase 3.3 — vista de empresa ("Mi empresa → Explorar
 * herramientas"), distinta de modules/modulo-engine.js (que es el
 * middleware de ENFORCEMENT, en modo observación, para Super Admin/IA).
 * Este módulo es de lectura/activación tenant-facing:
 *
 *   - listarModulosEmpresa() — catálogo completo + estado real de la
 *     empresa + si está incluido en su plan vigente.
 *   - activarModulo() — valida catálogo, plan vigente y dependencias,
 *     y entonces sí escribe en modulos_empresa. Nunca cobra, nunca
 *     factura — si el módulo no está incluido en el plan, no activa nada
 *     (la empresa debe usar solicitar-ampliacion en su lugar).
 *
 * Mismo criterio de fallback que modulo-engine.js: sin fila en
 * modulos_empresa = tratar como 'activo' (nunca bloquear por ausencia de
 * configuración); sin dato de plan todavía (suscripción/plan no
 * encontrado) = no restringir ningún módulo por falta de ese dato.
 *
 * @module modules/modulos-empresa
 */

'use strict';

const { obtenerSuscripcionVigente } = require('./plataforma-billing');

/** @returns {Promise<string[]|null>} null = sin plan/suscripción resuelta todavía, nunca se interpreta como "ningún módulo incluido". */
async function modulosIncluidosEnPlanVigente(supabase, organizationId) {
  const suscripcion = await obtenerSuscripcionVigente(supabase, organizationId);
  return suscripcion?.planes?.limites?.modulos?.incluidos ?? null;
}

async function listarModulosEmpresa(supabase, { companyId, organizationId }) {
  const [{ data: catalogo }, { data: filasEmpresa }, incluidosEnPlan] = await Promise.all([
    supabase.from('modulos_catalogo').select('*').order('categoria', { ascending: true }).order('codigo', { ascending: true }),
    supabase.from('modulos_empresa').select('modulo_codigo, estado').eq('company_id', companyId),
    modulosIncluidosEnPlanVigente(supabase, organizationId),
  ]);

  const estadosPorCodigo = new Map((filasEmpresa || []).map((f) => [f.modulo_codigo, f.estado]));

  return (catalogo || []).map((modulo) => ({
    ...modulo,
    estado: estadosPorCodigo.get(modulo.codigo) || 'activo', // sin fila = activo, mismo criterio que modulo-engine.js
    incluido_en_plan: incluidosEnPlan === null ? true : incluidosEnPlan.includes(modulo.codigo),
  }));
}

async function activarModulo(supabase, { companyId, organizationId, moduloCodigo, activadoPor }) {
  const { data: modulo, error: errModulo } = await supabase.from('modulos_catalogo').select('*').eq('codigo', moduloCodigo).maybeSingle();
  if (errModulo || !modulo) {
    const e = new Error('Módulo no encontrado en el catálogo');
    e.status = 404;
    throw e;
  }

  const incluidos = await modulosIncluidosEnPlanVigente(supabase, organizationId);
  if (incluidos !== null && !incluidos.includes(moduloCodigo)) {
    const e = new Error(`"${modulo.nombre}" no está incluido en tu plan actual — solicita una ampliación.`);
    e.status = 403;
    throw e;
  }

  if (modulo.dependencias?.length) {
    const { data: filasDependencias } = await supabase
      .from('modulos_empresa').select('modulo_codigo, estado').eq('company_id', companyId).in('modulo_codigo', modulo.dependencias);
    const estadosPorCodigo = new Map((filasDependencias || []).map((f) => [f.modulo_codigo, f.estado]));
    // Sin fila para una dependencia = activa por default (mismo criterio de fallback) — solo bloquea si hay una fila EXPLÍCITA en 'inactivo'.
    const faltantes = modulo.dependencias.filter((dep) => estadosPorCodigo.get(dep) === 'inactivo');
    if (faltantes.length) {
      const e = new Error(`Primero activa: ${faltantes.join(', ')}`);
      e.status = 409;
      throw e;
    }
  }

  const { data, error } = await supabase
    .from('modulos_empresa')
    .upsert(
      { company_id: companyId, modulo_codigo: moduloCodigo, estado: 'activo', activado_en: new Date().toISOString(), activado_por: activadoPor },
      { onConflict: 'company_id,modulo_codigo' },
    )
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo activar el módulo');

  await supabase.from('companies').update({ module_engine_configurado_en: new Date().toISOString() }).eq('id', companyId).is('module_engine_configurado_en', null);

  return data;
}

module.exports = { listarModulosEmpresa, modulosIncluidosEnPlanVigente, activarModulo };
