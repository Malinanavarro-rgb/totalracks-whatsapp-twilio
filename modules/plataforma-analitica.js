/**
 * TARA Matrix™ — plataforma-analitica.js
 * ─────────────────────────────────────────────────────────────────────────────
 * MRR/ARR/churn/uso/cobranza para el dashboard global del Panel Maestro.
 *
 * Agregación en JS, no SQL/RPC — decisión consciente y documentada, no un
 * descuido: a la escala de hoy (pocas organizaciones) es correcta y simple.
 * La Auditoría 2026-07 (hallazgo #3) recomienda agregación SQL para
 * Reportes que SÍ opera a escala de miles de filas por empresa — si el
 * número de organizaciones crece a decenas, esto debe migrar a una vista/
 * RPC de Postgres, mismo criterio.
 *
 * @module modules/plataforma-analitica
 */

'use strict';

const { ESTADOS_OPERATIVOS } = require('./billing-engine/estados');

/** Normaliza el precio de un plan a su equivalente mensual (planes anuales /12). */
function precioMensualCentavos(plan) {
  if (!plan || plan.precio_centavos == null) return 0;
  return plan.periodo === 'anual' ? Math.round(plan.precio_centavos / 12) : plan.precio_centavos;
}

function suscripcionVigentePorOrg(filas) {
  const vigentePorOrg = new Map();
  for (const fila of filas) {
    if (!vigentePorOrg.has(fila.organization_id)) vigentePorOrg.set(fila.organization_id, fila);
  }
  return vigentePorOrg;
}

/**
 * MRR: suma del precio mensual normalizado de la suscripción vigente de
 * cada organización en estado trial/active/past_due. Una organización con
 * más de una fila en `suscripciones` (canceló y volvió a suscribirse) solo
 * cuenta su fila más reciente. Nota: 'trial' (Launch) es $0 real, así que
 * contribuye 0 al MRR aunque cuente como organización con acceso vigente.
 */
async function calcularMRR(supabase) {
  const { data, error } = await supabase
    .from('suscripciones')
    .select('organization_id, estado, created_at, planes(precio_centavos, periodo)')
    .order('created_at', { ascending: false });

  if (error || !data) return { mrrCentavos: 0, arrCentavos: 0, organizacionesActivas: 0 };

  const vigentePorOrg = suscripcionVigentePorOrg(data);

  let mrrCentavos = 0;
  let organizacionesActivas = 0;
  for (const sub of vigentePorOrg.values()) {
    if (!ESTADOS_OPERATIVOS.includes(sub.estado)) continue;
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
    .select('organization_id, estado, fecha_cancelacion, created_at')
    .order('created_at', { ascending: false });

  if (error || !data) return { churnPct: 0, cancelacionesUltimos30Dias: 0 };

  const vigentePorOrg = suscripcionVigentePorOrg(data);

  const total = vigentePorOrg.size;
  const canceladasRecientes = [...vigentePorOrg.values()]
    .filter(s => s.estado === 'cancelled' && s.fecha_cancelacion && s.fecha_cancelacion >= haceUnMes).length;

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

/** Clientes activos/en prueba/pasados de vencimiento/suspendidos/cancelados/expirados — por estado CANÓNICO de suscripción, no el operativo de organizations. */
async function contarPorEstadoSuscripcion(supabase) {
  const { data, error } = await supabase
    .from('suscripciones')
    .select('organization_id, estado, created_at')
    .order('created_at', { ascending: false });

  if (error || !data) return {};

  const vigentePorOrg = suscripcionVigentePorOrg(data);
  const conteo = { trial: 0, active: 0, past_due: 0, suspended: 0, cancelled: 0, expired: 0 };
  for (const sub of vigentePorOrg.values()) {
    if (conteo[sub.estado] != null) conteo[sub.estado] += 1;
  }
  return conteo;
}

/** Ingresos reales cobrados en el mes calendario actual (pagos con estado='paid'). */
async function ingresoDelMes(supabase) {
  const ahora = new Date();
  const inicioMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString();

  const { data, error } = await supabase
    .from('pagos')
    .select('total_centavos, estado, fecha_pago')
    .eq('estado', 'paid')
    .gte('fecha_pago', inicioMes);

  if (error || !data) return { ingresoCentavos: 0 };
  return { ingresoCentavos: data.reduce((acc, p) => acc + (p.total_centavos || 0), 0) };
}

/** Suscripciones vigentes en past_due — a quién se le debe cobrar/dar seguimiento. */
async function pagosPendientes(supabase) {
  const { data, error } = await supabase
    .from('suscripciones')
    .select('organization_id, estado, created_at, organizations(nombre), planes(nombre, precio_centavos)')
    .order('created_at', { ascending: false });

  if (error || !data) return { cantidad: 0, organizaciones: [] };

  const vigentePorOrg = suscripcionVigentePorOrg(data);
  const pendientes = [...vigentePorOrg.values()]
    .filter(s => s.estado === 'past_due')
    .map(s => ({ organizationId: s.organization_id, nombre: s.organizations?.nombre, plan: s.planes?.nombre, montoCentavos: s.planes?.precio_centavos }));

  return { cantidad: pendientes.length, organizaciones: pendientes };
}

/** Renovaciones (o fin de prueba) esperadas en los próximos `dias`. */
async function proximosCobros(supabase, dias = 7) {
  const limite = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
  const ahoraIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('suscripciones')
    .select('organization_id, estado, fecha_periodo_actual_fin, fecha_prueba_fin, created_at, organizations(nombre), planes(nombre)')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  const vigentePorOrg = suscripcionVigentePorOrg(data);
  return [...vigentePorOrg.values()]
    .filter(s => ESTADOS_OPERATIVOS.includes(s.estado))
    .map(s => ({
      organizationId: s.organization_id,
      nombre: s.organizations?.nombre,
      plan: s.planes?.nombre,
      fecha: s.estado === 'trial' ? s.fecha_prueba_fin : s.fecha_periodo_actual_fin,
    }))
    .filter(s => s.fecha && s.fecha >= ahoraIso && s.fecha <= limite)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** @returns {Promise<Object>} snapshot completo para el dashboard global del Panel Maestro. */
async function dashboardGlobal(supabase, { desde, hasta } = {}) {
  const rangoDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rangoHasta = hasta || new Date().toISOString();

  const [mrr, churn, uso, porEstadoOperativo, porEstadoSuscripcion, ingresoMes, pendientes, cobros] = await Promise.all([
    calcularMRR(supabase),
    calcularChurn(supabase),
    resumenUsoPorEmpresa(supabase, { desde: rangoDesde, hasta: rangoHasta }),
    contarOrganizacionesPorEstado(supabase),
    contarPorEstadoSuscripcion(supabase),
    ingresoDelMes(supabase),
    pagosPendientes(supabase),
    proximosCobros(supabase, 7),
  ]);

  const ticketPromedioCentavos = mrr.organizacionesActivas === 0 ? 0 : Math.round(mrr.mrrCentavos / mrr.organizacionesActivas);

  return {
    ...mrr, ...churn, ...ingresoMes,
    ticketPromedioCentavos,
    empresasPorUso: uso,
    organizacionesPorEstado: porEstadoOperativo,
    clientesPorEstadoSuscripcion: porEstadoSuscripcion,
    pagosPendientes: pendientes,
    proximosCobros: cobros,
  };
}

module.exports = {
  calcularMRR, calcularChurn, resumenUsoPorEmpresa, contarOrganizacionesPorEstado,
  contarPorEstadoSuscripcion, ingresoDelMes, pagosPendientes, proximosCobros, dashboardGlobal,
};
