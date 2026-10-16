/**
 * TARA Matrix™ — operador-contexto-empresarial.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA AI — Fase 1 (Alina, 2026-10-16, autorizada tras
 * TARA_AI_CONSULTA_EMPRESARIAL_V1.md): resuelve y valida, exclusivamente en
 * el servidor, a qué empresa se refiere una consulta de Super Admin a Modo
 * Operador — nunca el LLM, nunca el body sin validar.
 *
 * Dos pasos deliberadamente separados (existencia, luego autorización) para
 * que el segundo tenga un punto de extensión claro el día que exista un
 * modelo de ACL granular admin→empresa (hoy no existe: cualquier Super
 * Admin autenticado — ya gateado por requireAdmin — puede consultar
 * cualquier empresa activa; ver riesgo pendiente #3 de
 * TARA_AI_CONSULTA_EMPRESARIAL_V1.md).
 *
 * @module modules/operador-contexto-empresarial
 */

'use strict';

/**
 * Hoy: una empresa está autorizada para consulta si está operativamente
 * activa (`companies.estado === 'activo'`, el mismo flag que
 * sincronizarEstadoOperativo() ya mantiene según el estado de facturación
 * de su organización — ver modules/plataforma-billing.js). Una empresa
 * suspendida queda fuera de este flujo de consulta en Fase 1 — decisión de
 * producto, no una limitación técnica; revisable si se necesita que Super
 * Admin consulte empresas suspendidas para soporte.
 */
function estaAutorizada(company) {
  return company?.estado === 'activo';
}

/**
 * @returns {Promise<{id: string, nombre: string, organization_id: string}>}
 * @throws {Error & {status: number}} 400 sin companyId, 404 si no existe, 403 si existe pero no está autorizada
 */
async function resolverContextoEmpresarial(supabase, companyId) {
  if (!companyId || typeof companyId !== 'string') {
    const e = new Error('Selecciona una empresa antes de consultar a TARA.');
    e.status = 400;
    throw e;
  }

  const { data: company, error } = await supabase
    .from('companies')
    .select('id, nombre, organization_id, estado')
    .eq('id', companyId)
    .maybeSingle();

  if (error || !company) {
    const e = new Error('La empresa seleccionada no existe o ya no está disponible.');
    e.status = 404;
    throw e;
  }

  if (!estaAutorizada(company)) {
    const e = new Error(`"${company.nombre}" no está disponible para consulta (empresa suspendida).`);
    e.status = 403;
    throw e;
  }

  return { id: company.id, nombre: company.nombre, organization_id: company.organization_id };
}

/** Catálogo liviano para el selector del Panel Maestro — nunca expone datos de facturación/suscripción. */
async function listarEmpresasConsultables(supabase) {
  const { data, error } = await supabase
    .from('companies')
    .select('id, nombre, industria_slug, estado')
    .eq('estado', 'activo')
    .order('nombre', { ascending: true });
  return error ? [] : (data || []);
}

module.exports = { resolverContextoEmpresarial, listarEmpresasConsultables, estaAutorizada };
