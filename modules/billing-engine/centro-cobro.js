/**
 * TARA Matrix™ — billing-engine/centro-cobro.js
 * ─────────────────────────────────────────────────────────────────────────────
 * "Centro de Cobro" (Panel Maestro): por cada organización, cuánto genera
 * (ingreso contratado, normalizado a mensual) contra cuánto cuesta
 * (consumo real de IA, decision_logs.costo_usd) — el margen real por
 * cliente que permite ver desde el día uno quién es rentable y quién no.
 *
 * Nota de honestidad: el ingreso vive en MXN (precio de planes) y el costo
 * de OpenAI se factura en USD — no hay una tasa de cambio en vivo
 * integrada todavía, así que el margen se calcula con un tipo de cambio
 * FIJO y aproximado (TIPO_CAMBIO_USD_MXN). Se documenta así a propósito —
 * es una aproximación útil para priorizar, no una cifra contable exacta.
 *
 * @module modules/billing-engine/centro-cobro
 */

'use strict';

const TIPO_CAMBIO_USD_MXN = 18.5; // aproximado — no hay integración de tipo de cambio en vivo todavía

function precioMensualCentavos(plan) {
  if (!plan || plan.precio_centavos == null) return 0;
  return plan.periodo === 'anual' ? Math.round(plan.precio_centavos / 12) : plan.precio_centavos;
}

/**
 * @param {{desde: string, hasta: string}} rango - ventana para el costo de IA (30 días típico)
 * @returns {Promise<Array>} una fila por organización
 */
async function resumenPorOrganizacion(supabase, { desde, hasta }) {
  const [{ data: orgs }, { data: subs }, { data: logs }] = await Promise.all([
    supabase.from('organizations').select('id, nombre, estado, companies(id, nombre)'),
    supabase.from('suscripciones')
      .select('organization_id, estado, fecha_periodo_actual_fin, cancelar_al_fin_periodo, created_at, planes(clave, nombre, precio_centavos, periodo)')
      .order('created_at', { ascending: false }),
    supabase.from('decision_logs').select('company_id, costo_usd').gte('created_at', desde).lte('created_at', hasta),
  ]);

  const vigentePorOrg = new Map();
  for (const s of subs || []) {
    if (!vigentePorOrg.has(s.organization_id)) vigentePorOrg.set(s.organization_id, s);
  }

  const costoPorCompany = new Map();
  for (const log of logs || []) {
    costoPorCompany.set(log.company_id, (costoPorCompany.get(log.company_id) || 0) + Number(log.costo_usd || 0));
  }

  return (orgs || []).map((org) => {
    const sub = vigentePorOrg.get(org.id) || null;
    const ingresoCentavos = precioMensualCentavos(sub?.planes);
    const costoUsd = (org.companies || []).reduce((acc, c) => acc + (costoPorCompany.get(c.id) || 0), 0);
    const costoCentavosMxn = Math.round(costoUsd * TIPO_CAMBIO_USD_MXN * 100);
    const margenCentavos = ingresoCentavos - costoCentavosMxn;

    return {
      organizationId: org.id,
      nombre: org.nombre,
      estadoOperativo: org.estado,
      plan: sub?.planes?.nombre || null,
      estadoSuscripcion: sub?.estado || null,
      proximoCobro: sub?.fecha_periodo_actual_fin || null,
      cancelarAlFinPeriodo: sub?.cancelar_al_fin_periodo || false,
      ingresoCentavos,
      costoUsd: Math.round(costoUsd * 100) / 100,
      costoCentavosMxn,
      margenCentavos,
    };
  });
}

module.exports = { resumenPorOrganizacion, TIPO_CAMBIO_USD_MXN };
