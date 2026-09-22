/**
 * TARA Matrix™ — planes-financiamiento.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Financiamiento configurable (auditoría 2026-09-16, Parte B punto 12 —
 * Alina, 2026-09-22): "no existe ningún campo ni lógica" — primera vez que
 * se construye. CRUD de planes por empresa (mismo molde exacto que
 * modules/paquetes-solares.js) + el cálculo de cada plan sobre el monto de
 * una cotización.
 *
 * Deliberadamente sin ningún plan sembrado por default (ver migración 110):
 * una tasa de interés o un número de parcialidades es un término financiero
 * real que el cliente ve impreso — inventar uno rompería el principio de
 * "nunca alucinar" de todo este proyecto. Mientras la empresa no capture
 * planes reales, el cotizador simplemente no ofrece financiamiento —
 * "no existe todavía" es honesto, un número inventado no lo es.
 *
 * Amortización francesa estándar para 'credito' (pago fijo mensual);
 * 'msi' es el caso particular tasa=0 (mensualidad = monto/parcialidades,
 * sin costo financiero); 'contado' no tiene mensualidad.
 *
 * @module modules/planes-financiamiento
 */

'use strict';

const CAMPOS_PLAN = ['nombre', 'tipo', 'numero_parcialidades', 'tasa_interes_anual_pct', 'anticipo_pct_minimo', 'activo'];

async function listarPlanes(supabase, companyId, { soloActivos = false } = {}) {
  let query = supabase.from('planes_financiamiento').select('*').eq('company_id', companyId).order('created_at');
  if (soloActivos) query = query.eq('activo', true);
  const { data, error } = await query;
  return error ? [] : (data || []);
}

async function crearPlan(supabase, companyId, datos) {
  if (!datos.nombre || !datos.tipo) {
    const err = new Error('nombre y tipo son requeridos');
    err.status = 400;
    throw err;
  }
  if (!['contado', 'msi', 'credito'].includes(datos.tipo)) {
    const err = new Error("tipo debe ser 'contado', 'msi' o 'credito'");
    err.status = 400;
    throw err;
  }
  if (datos.tipo !== 'contado' && !datos.numero_parcialidades) {
    const err = new Error('numero_parcialidades es requerido para msi/credito');
    err.status = 400;
    throw err;
  }
  if (datos.tipo === 'credito' && !datos.tasa_interes_anual_pct) {
    const err = new Error('tasa_interes_anual_pct es requerida para un plan de crédito — si no lleva interés, usa el tipo "msi"');
    err.status = 400;
    throw err;
  }

  const payload = { company_id: companyId };
  for (const campo of CAMPOS_PLAN) {
    if (datos[campo] !== undefined) payload[campo] = datos[campo];
  }

  const { data, error } = await supabase.from('planes_financiamiento').insert([payload]).select().single();
  if (error) throw new Error(`planes-financiamiento.crearPlan: ${error.message}`);
  return data;
}

async function actualizarPlan(supabase, companyId, planId, cambios) {
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_PLAN) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const { data, error } = await supabase
    .from('planes_financiamiento').update(payload).eq('id', planId).eq('company_id', companyId).select().maybeSingle();

  if (error || !data) {
    const err = new Error('Plan de financiamiento no encontrado');
    err.status = 404;
    throw err;
  }
  return data;
}

/** Nunca borra un plan que ya haya cotizado a un cliente (rompería la trazabilidad) — desactivar es la operación segura por defecto. */
async function desactivarPlan(supabase, companyId, planId) {
  return actualizarPlan(supabase, companyId, planId, { activo: false });
}

async function eliminarPlan(supabase, companyId, planId) {
  const { error } = await supabase.from('planes_financiamiento').delete().eq('id', planId).eq('company_id', companyId);
  if (error) throw new Error(`planes-financiamiento.eliminarPlan: ${error.message}`);
}

/**
 * Calcula un plan sobre un monto — 100% puro, sin DB.
 *   - 'contado': sin mensualidad, el monto completo.
 *   - 'msi': mensualidad = monto / parcialidades, costo financiero 0.
 *   - 'credito': amortización francesa (pago fijo), i = tasa anual / 12.
 *
 * @param {Object} datos
 * @param {number} datos.monto - monto a financiar (después del anticipo, si aplica)
 * @param {Object} datos.plan - fila de planes_financiamiento
 * @returns {{mensualidad: number|null, total_a_pagar: number, costo_financiero: number, incompleto: boolean, motivo: string|null}}
 */
function calcularPlan({ monto, plan }) {
  if (!(Number.isFinite(monto) && monto > 0)) {
    return { mensualidad: null, total_a_pagar: null, costo_financiero: null, incompleto: true, motivo: 'Sin un monto válido que financiar.' };
  }

  const redondear = (n) => Math.round(n * 100) / 100;

  if (plan.tipo === 'contado') {
    return { mensualidad: null, total_a_pagar: redondear(monto), costo_financiero: 0, incompleto: false, motivo: null };
  }

  if (!plan.numero_parcialidades || plan.numero_parcialidades <= 0) {
    return { mensualidad: null, total_a_pagar: null, costo_financiero: null, incompleto: true, motivo: 'El plan no tiene número de parcialidades configurado.' };
  }

  if (plan.tipo === 'msi') {
    const mensualidad = monto / plan.numero_parcialidades;
    return { mensualidad: redondear(mensualidad), total_a_pagar: redondear(monto), costo_financiero: 0, incompleto: false, motivo: null };
  }

  // 'credito' — amortización francesa. Tasa 0 configurada por error en un plan
  // de crédito se trata igual que MSI (evita división por cero), nunca lanza.
  const tasaAnual = Number(plan.tasa_interes_anual_pct) || 0;
  if (tasaAnual <= 0) {
    const mensualidad = monto / plan.numero_parcialidades;
    return { mensualidad: redondear(mensualidad), total_a_pagar: redondear(monto), costo_financiero: 0, incompleto: false, motivo: null };
  }

  const iMensual = tasaAnual / 100 / 12;
  const n = plan.numero_parcialidades;
  const mensualidad = (monto * iMensual) / (1 - (1 + iMensual) ** -n);
  const totalAPagar = mensualidad * n;

  return {
    mensualidad: redondear(mensualidad),
    total_a_pagar: redondear(totalAPagar),
    costo_financiero: redondear(totalAPagar - monto),
    incompleto: false,
    motivo: null,
  };
}

/**
 * Monto a financiar: precio final ya autorizado si existe (nunca el
 * recomendado sin autorizar — mismo criterio que autorizarPrecioFinal),
 * menos el anticipo si el plan trae uno mínimo configurado. Nunca inventa
 * un anticipo si el plan no lo pide.
 */
function _montoAFinanciar(total, plan) {
  if (!(Number.isFinite(total) && total > 0)) return null;
  const anticipoPct = Number(plan.anticipo_pct_minimo) || 0;
  return total * (1 - anticipoPct / 100);
}

/**
 * Todos los planes activos de la empresa, calculados sobre el precio final
 * (autorizado si existe, si no el total) de la cotización.
 */
async function simularFinanciamientoCotizacion(supabase, { companyId, cotizacionId }) {
  const { data: cotizacion } = await supabase
    .from('cotizaciones').select('id, total, precio_final_autorizado').eq('id', cotizacionId).eq('company_id', companyId).maybeSingle();
  if (!cotizacion) return null;

  const monto = cotizacion.precio_final_autorizado ?? cotizacion.total;
  if (!(Number.isFinite(monto) && monto > 0)) {
    return { planes: [], motivo: 'Esta cotización todavía no tiene un total o precio final para financiar.' };
  }

  const planesActivos = await listarPlanes(supabase, companyId, { soloActivos: true });
  if (planesActivos.length === 0) {
    return { planes: [], motivo: 'Esta empresa todavía no tiene planes de financiamiento configurados.' };
  }

  const planes = planesActivos.map((plan) => {
    const montoAFinanciar = _montoAFinanciar(monto, plan);
    return { plan, monto_a_financiar: montoAFinanciar != null ? Math.round(montoAFinanciar * 100) / 100 : null, ...calcularPlan({ monto: montoAFinanciar, plan }) };
  });

  return { planes, motivo: null, monto_base: monto };
}

module.exports = {
  listarPlanes, crearPlan, actualizarPlan, desactivarPlan, eliminarPlan,
  calcularPlan, simularFinanciamientoCotizacion,
};
