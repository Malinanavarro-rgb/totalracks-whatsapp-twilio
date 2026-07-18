/**
 * TARA Matrix™ — plataforma-analitica.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 8.1 — Plataforma Comercial. MRR/ARR/churn/uso para el dashboard
 * global del Panel Maestro (Sub-fase 8.2).
 *
 * Agregación en JS, no SQL/RPC — decisión consciente y documentada, no un
 * descuido: a la escala de hoy (8 organizaciones) es correcta y simple. La
 * Auditoría 2026-07 (hallazgo #3) recomienda agregación SQL para Reportes
 * quien SÍ opera a escala de miles de filas por empresa — si el número de
 * organizaciones crece a decenas, esto debe migrar a una vista/RPC de
 * Postgres, mismo criterio.
 *
 * @module modules/plataforma-analitica
 */

'use strict';

const ESTADOS_ACTIVOS = ['trialing', 'active', 'past_due'];

/** Normaliza el precio de un plan a su equivalente mensual (planes anuales /12). */
function precioMensualCentavos(plan) {
  if (!plan) return 0;
  return plan.periodo === 'anual' ? Math.round(plan.precio_centavos / 12) : plan.precio_centavos;
}

/**
 * MRR: suma del precio mensual normalizado de la suscripción vigente de
 * cada organización en estado activo/trialing/past_due. Una organización
 * con más de una fila en `suscripciones` (canceló y volvió a suscribirse)
 * solo cuenta su fila más reciente.
 */
async function calcularMRR(supabase) {
  const { data, error } = await supabase
    .from('suscripciones')
    .select('organization_id, estado, created_at, planes(precio_centavos, periodo)')
    .order('created_at', { ascending: false });

  if (error || !data) return { mrrCentavos: 0, arrCentavos: 0, organizacionesActivas: 0 };

  const vigentePorOrg = new Map();
  for (const fila of data) {
    if (!vigentePorOrg.has(fila.organization_id)) vigentePorOrg.set(fila.organization_id, fila);
  }

  let mrrCentavos = 0;
  let organizacionesActivas = 0;
  for (const sub of vigentePorOrg.values()) {
    if (!ESTADOS_ACTIVOS.includes(sub.estado)) continue;
    organizacionesActivas += 1;
    mrrCentavos += precioMensualCentavos(sub.planes);
  }

  return { mrrCentavos, arrCentavos: mrrCentavos * 12, organizacionesActivas };
}

/** Churn simple: organizaciones cuya suscripción vigente se canceló en los últimos 30 días, sobre el total con al menos una suscripción. */
async function calcularChurn(supabase) {
  const haceUnMes = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('suscripciones')
    .select('organization_id, estado, fecha_cancelacion')
    .order('created_at', { ascending: false });

  if (error || !data) return { churnPct: 0, cancelacionesUltimos30Dias: 0 };

  const vigentePorOrg = new Map();
  for (const fila of data) {
    if (!vigentePorOrg.has(fila.organization_id)) vigentePorOrg.set(fila.organization_id, fila);
  }

  const total = vigentePorOrg.size;
  const canceladasRecientes = [...vigentePorOrg.values()]
    .filter(s => s.estado === 'canceled' && s.fecha_cancelacion && s.fecha_cancelacion >= haceUnMes).length;

  return {
    churnPct: total === 0 ? 0 : Math.round((canceladasRecientes / total) * 1000) / 10,
    cancelacionesUltimos30Dias: canceladasRecientes,
  };
}

/** Conversaciones/tokens/costo real de OpenAI, agrupado por company, en un rango — para el ranking "empresas con mayor uso". */
async function resumenUsoPorEmpresa(supabase, { desde, hasta }) {
  const { data: logs, error } = await supabase
    .from('decision_logs')
    .select('company_id, costo_usd, tokens_total')
    .gte('created_at', desde)
    .lte('created_at', hasta);

  if (error || !logs) return [];

  const porEmpresa = new Map();
  for (const log of logs) {
    if (!porEmpresa.has(log.company_id)) porEmpresa.set(log.company_id, { company_id: log.company_id, costoUsd: 0, tokens: 0, eventos: 0 });
    const acc = porEmpresa.get(log.company_id);
    acc.costoUsd += Number(log.costo_usd || 0);
    acc.tokens += Number(log.tokens_total || 0);
    acc.eventos += 1;
  }

  const { data: companies } = await supabase.from('companies').select('id, nombre');
  const nombrePorId = new Map((companies || []).map(c => [c.id, c.nombre]));

  return [...porEmpresa.values()]
    .map(fila => ({ ...fila, nombre: nombrePorId.get(fila.company_id) || 'Empresa' }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
}

async function contarOrganizacionesPorEstado(supabase) {
  const { data, error } = await supabase.from('organizations').select('estado');
  if (error || !data) return {};

  return data.reduce((acc, fila) => {
    acc[fila.estado] = (acc[fila.estado] || 0) + 1;
    return acc;
  }, {});
}

/** @returns {Promise<Object>} snapshot completo para el dashboard global del Panel Maestro. */
async function dashboardGlobal(supabase, { desde, hasta } = {}) {
  const rangoDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rangoHasta = hasta || new Date().toISOString();

  const [mrr, churn, uso, porEstado] = await Promise.all([
    calcularMRR(supabase),
    calcularChurn(supabase),
    resumenUsoPorEmpresa(supabase, { desde: rangoDesde, hasta: rangoHasta }),
    contarOrganizacionesPorEstado(supabase),
  ]);

  return { ...mrr, ...churn, empresasPorUso: uso, organizacionesPorEstado: porEstado };
}

module.exports = { calcularMRR, calcularChurn, resumenUsoPorEmpresa, contarOrganizacionesPorEstado, dashboardGlobal };
