/**
 * TARA Matrix™ — plataforma-impersonacion.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 8.1 — Plataforma Comercial. "Entrar como administrador a cualquier
 * empresa para soporte." No reusa `usuarios_empresas` — forzar una fila de
 * membresía ahí ensuciaría la lista real de usuarios de esa empresa y no
 * sería auditable como acto distinto de una membresía real. En su lugar, un
 * token de vida corta que `resolverSesionImpersonada()` valida ANTES del
 * flujo normal de `requireAuth` (modules/auth-middleware.js) — cambio
 * aditivo, mismo patrón ya usado para el handoff humano de conversaciones:
 * extender por capa adicional, sin tocar el camino congelado.
 *
 * @module modules/plataforma-impersonacion
 */

'use strict';

const crypto = require('crypto');
const { registrarEvento } = require('./plataforma-audit');

async function iniciarImpersonacion(supabase, { adminId, companyId, motivo }) {
  const token = crypto.randomBytes(32).toString('hex');

  const { data, error } = await supabase
    .from('plataforma_impersonaciones')
    .insert([{ admin_id: adminId, company_id: companyId, token, motivo: motivo || null }])
    .select()
    .single();

  if (error) throw new Error(`plataforma-impersonacion.iniciarImpersonacion: ${error.message}`);

  const { data: company } = await supabase.from('companies').select('organization_id').eq('id', companyId).maybeSingle();

  await registrarEvento(supabase, {
    adminId, accion: 'impersonar_inicio', companyId,
    organizationId: company?.organization_id, detalle: { motivo: motivo || null },
  });

  return data;
}

/**
 * Se consulta antes que el flujo normal de requireAuth. Devuelve un
 * `req.usuario` sintético (rol 'owner', para que el admin vea/opere la
 * empresa como su dueña vería el panel) sin escribir nada en
 * usuarios_empresas. null si el token no existe, ya expiró, o ya se cerró.
 */
async function resolverSesionImpersonada(supabase, token) {
  if (!token) return null;

  const { data: fila, error } = await supabase
    .from('plataforma_impersonaciones')
    .select('*, usuarios(nombre)')
    .eq('token', token)
    .is('finalizado_en', null)
    .gt('expira_en', new Date().toISOString())
    .maybeSingle();

  if (error || !fila) return null;

  return {
    id: fila.admin_id,
    nombre: `${fila.usuarios?.nombre || 'Soporte'} (soporte)`,
    email: null,
    company_id: fila.company_id,
    rol: 'owner',
    es_impersonacion: true,
    impersonacion_id: fila.id,
  };
}

async function finalizarImpersonacion(supabase, { token, adminId }) {
  const { data: fila, error } = await supabase
    .from('plataforma_impersonaciones')
    .update({ finalizado_en: new Date().toISOString() })
    .eq('token', token)
    .is('finalizado_en', null)
    .select()
    .maybeSingle();

  if (error || !fila) return;

  const { data: company } = await supabase.from('companies').select('organization_id').eq('id', fila.company_id).maybeSingle();

  await registrarEvento(supabase, {
    adminId, accion: 'impersonar_fin', companyId: fila.company_id,
    organizationId: company?.organization_id,
  });
}

module.exports = { iniciarImpersonacion, resolverSesionImpersonada, finalizarImpersonacion };
