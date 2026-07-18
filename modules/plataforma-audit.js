/**
 * TARA Matrix™ — plataforma-audit.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 8.1 — Plataforma Comercial. Aplicación del Artículo 8/Principio P8 de
 * la Constitución ("Todo lo que pasa, se registra") a acciones de Super
 * Admin — mismo principio que `decision_logs` ya aplica a decisiones del
 * AI, ahora para un actor nuevo. Único punto de escritura de
 * `plataforma_audit_log`, para que ningún módulo de admin construya su
 * propio INSERT ad-hoc.
 *
 * @module modules/plataforma-audit
 */

'use strict';

async function registrarEvento(supabase, { adminId, accion, organizationId, companyId, usuarioAfectadoId, detalle }) {
  const { error } = await supabase.from('plataforma_audit_log').insert([{
    admin_id: adminId,
    accion,
    organization_id: organizationId || null,
    company_id: companyId || null,
    usuario_afectado_id: usuarioAfectadoId || null,
    detalle: detalle || null,
  }]);

  if (error) console.error('⚠️  plataforma-audit.registrarEvento:', error.message);
}

/**
 * Devuelve las filas crudas (admin_id sin resolver a nombre) — el llamador
 * ya conoce a sus propios plataforma_admins si necesita mostrar el nombre;
 * no se arriesga un embed de PostgREST a una constraint cuyo nombre exacto
 * no se puede confirmar sin la base ya migrada.
 */
async function listarEventos(supabase, { organizationId, limite } = {}) {
  let query = supabase
    .from('plataforma_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite || 100);

  if (organizationId) query = query.eq('organization_id', organizationId);

  const { data, error } = await query;
  return error ? [] : (data || []);
}

module.exports = { registrarEvento, listarEventos };
