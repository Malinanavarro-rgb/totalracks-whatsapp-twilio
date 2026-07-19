/**
 * TARA Matrix™ — plataforma-billing.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo de Billing — único punto de escritura de `suscripciones`. Ningún
 * frontend escribe esa tabla directamente — solo redirige a Checkout/
 * Billing Portal hosted del proveedor conectado, o invoca acciones
 * auditadas de Super Admin que reusan estas mismas funciones.
 *
 * `suscripciones.estado` es SIEMPRE el vocabulario canónico de negocio
 * (trial|active|past_due|suspended|cancelled|expired, ver
 * modules/billing-engine/estados.js) — nunca el vocabulario propio de un
 * proveedor. `manejarWebhookStripe` es el único lugar que traduce.
 *
 * Sin cuenta de Stripe conectada todavía (confirmado explícitamente con la
 * dueña) — `crearCheckoutSession`/`crearPortalSession`/`manejarWebhookStripe`
 * lanzan un error claro si se invocan antes de que exista STRIPE_SECRET_KEY.
 * `crearSuscripcionManual`/`sincronizarEstadoOperativo` NO dependen de
 * ningún proveedor — permiten operar las empresas reales desde hoy.
 *
 * @module modules/plataforma-billing
 */

'use strict';

const { ESTADOS_OPERATIVOS, mapearEstadoProveedor } = require('./billing-engine/estados');

function requerirStripe(stripe) {
  if (!stripe) {
    const err = new Error('Stripe no está configurado todavía — falta STRIPE_SECRET_KEY');
    err.status = 501;
    throw err;
  }
}

/**
 * La suscripción vigente de una organización es la más reciente — cancelar
 * y volver a suscribirse después (con un proveedor_suscripcion_id nuevo)
 * crea una fila nueva legítima, nunca se sobreescribe la anterior.
 */
async function obtenerSuscripcionVigente(supabase, organizationId) {
  const { data, error } = await supabase
    .from('suscripciones')
    .select('*, planes(*)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}

/**
 * Propaga organizations.estado hacia companies.estado de TODAS sus
 * companies (hoy 1:1, ya correcto para el caso futuro de 2+ companies por
 * organización). Es la ÚNICA función que escribe companies.estado por
 * razones comerciales — nunca se toca desde otro punto del código por ese
 * motivo (companies.estado sigue siendo, además, el flag operativo que
 * gatea tráfico real de WhatsApp — ver modules/config.js).
 */
async function sincronizarEstadoOperativo(supabase, organizationId) {
  const { data: org, error } = await supabase
    .from('organizations')
    .select('estado')
    .eq('id', organizationId)
    .maybeSingle();

  if (error || !org) throw new Error('Organización no encontrada');

  const estadoOperativo = org.estado === 'activa' ? 'activo' : 'suspendido';

  const { error: errUpdate } = await supabase
    .from('companies')
    .update({ estado: estadoOperativo })
    .eq('organization_id', organizationId);

  if (errUpdate) throw new Error(`plataforma-billing.sincronizarEstadoOperativo: ${errUpdate.message}`);
}

/**
 * Alta manual de suscripción, SIN gateway de pago (proveedor='manual') —
 * es como el Panel Maestro asigna un plan real a una organización
 * (incluyendo Enterprise, que nunca pasa por autoservicio). Si el plan
 * tiene días de prueba (Launch), la suscripción nace en estado 'trial' con
 * fecha_prueba_fin calculada; si no, nace 'active' directo.
 */
async function crearSuscripcionManual(supabase, { organizationId, planId, mesesRegalo, notasPromocion }) {
  const { data: plan, error: errPlan } = await supabase.from('planes').select('dias_prueba').eq('id', planId).maybeSingle();
  if (errPlan || !plan) throw new Error('Plan no encontrado');

  const esPrueba = !!plan.dias_prueba;
  const fechaPruebaFin = esPrueba ? new Date(Date.now() + plan.dias_prueba * 24 * 60 * 60 * 1000).toISOString() : null;

  const { data, error } = await supabase
    .from('suscripciones')
    .insert([{
      organization_id: organizationId,
      plan_id: planId,
      estado: esPrueba ? 'trial' : 'active',
      proveedor: 'manual',
      fecha_prueba_fin: fechaPruebaFin,
      meses_regalo: mesesRegalo || 0,
      notas_promocion: notasPromocion || null,
    }])
    .select()
    .single();

  if (error) throw new Error(`plataforma-billing.crearSuscripcionManual: ${error.message}`);

  await supabase.from('organizations').update({ estado: 'activa' }).eq('id', organizationId);
  await sincronizarEstadoOperativo(supabase, organizationId);

  return data;
}

async function suspenderOrganizacion(supabase, organizationId) {
  const { error } = await supabase.from('organizations').update({ estado: 'suspendida' }).eq('id', organizationId);
  if (error) throw new Error(`plataforma-billing.suspenderOrganizacion: ${error.message}`);
  await sincronizarEstadoOperativo(supabase, organizationId);
}

async function reactivarOrganizacion(supabase, organizationId) {
  const { error } = await supabase.from('organizations').update({ estado: 'activa' }).eq('id', organizationId);
  if (error) throw new Error(`plataforma-billing.reactivarOrganizacion: ${error.message}`);
  await sincronizarEstadoOperativo(supabase, organizationId);
}

/** Licencias — acciones auditadas del Super Admin sobre una suscripción existente, sin pasar por ningún gateway. */
async function extenderPrueba(supabase, suscripcionId, dias) {
  const { data: actual, error: errActual } = await supabase.from('suscripciones').select('fecha_prueba_fin').eq('id', suscripcionId).maybeSingle();
  if (errActual || !actual) throw new Error('Suscripción no encontrada');

  const base = actual.fecha_prueba_fin ? new Date(actual.fecha_prueba_fin) : new Date();
  const nuevaFecha = new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('suscripciones')
    .update({ fecha_prueba_fin: nuevaFecha.toISOString(), estado: 'trial', updated_at: new Date().toISOString() })
    .eq('id', suscripcionId)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo extender la prueba');
  return data;
}

async function regalarMeses(supabase, suscripcionId, meses) {
  const { data: actual, error: errActual } = await supabase
    .from('suscripciones').select('meses_regalo, fecha_periodo_actual_fin').eq('id', suscripcionId).maybeSingle();
  if (errActual || !actual) throw new Error('Suscripción no encontrada');

  const base = actual.fecha_periodo_actual_fin ? new Date(actual.fecha_periodo_actual_fin) : new Date();
  base.setMonth(base.getMonth() + meses);

  const { data, error } = await supabase
    .from('suscripciones')
    .update({
      meses_regalo: (actual.meses_regalo || 0) + meses,
      fecha_periodo_actual_fin: base.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', suscripcionId)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudieron regalar los meses');
  return data;
}

/**
 * Cron diario (scripts/expirar-pruebas.js): toda suscripción en 'trial' con
 * fecha_prueba_fin ya vencida pasa a 'expired'. Que el frontend le pida al
 * cliente contratar un plan al ver estado='expired' es responsabilidad de
 * la UI, no de este cron — aquí solo se garantiza que el dato esté
 * correcto y a tiempo.
 */
async function expirarPruebasVencidas(supabase) {
  const ahoraIso = new Date().toISOString();

  const { data: vencidas, error } = await supabase
    .from('suscripciones')
    .select('id, organization_id')
    .eq('estado', 'trial')
    .lte('fecha_prueba_fin', ahoraIso);

  if (error) throw new Error(`plataforma-billing.expirarPruebasVencidas: ${error.message}`);

  for (const sub of vencidas || []) {
    await supabase.from('suscripciones').update({ estado: 'expired', updated_at: ahoraIso }).eq('id', sub.id);
    await supabase.from('organizations').update({ estado: 'suspendida' }).eq('id', sub.organization_id);
    await sincronizarEstadoOperativo(supabase, sub.organization_id);
  }

  return { expiradas: (vencidas || []).length };
}

async function cambiarPlan(supabase, suscripcionId, nuevoPlanId) {
  const { data, error } = await supabase
    .from('suscripciones')
    .update({ plan_id: nuevoPlanId, updated_at: new Date().toISOString() })
    .eq('id', suscripcionId)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo cambiar el plan');
  return data;
}

/**
 * Stripe Checkout hosted — cero UI de tarjeta propia. Solo para planes
 * es_autoservicio=true (Enterprise nunca llega aquí — su alta es siempre
 * manual, vía crearSuscripcionManual, después de la conversación comercial).
 */
async function crearCheckoutSession(stripe, { organizationId, plan, urlExito, urlCancelacion }) {
  requerirStripe(stripe);
  if (!plan.es_autoservicio) {
    const err = new Error(`El plan "${plan.clave}" no es de autoservicio — requiere alta manual`);
    err.status = 400;
    throw err;
  }
  if (!plan.stripe_price_id) {
    const err = new Error(`El plan "${plan.clave}" todavía no tiene un stripe_price_id configurado`);
    err.status = 400;
    throw err;
  }

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: urlExito,
    cancel_url: urlCancelacion,
    client_reference_id: organizationId,
  });
}

/** Stripe Billing Portal hosted — cambio de plan/cancelación/facturas, sin reconstruirlo. Sub-fase 8.4. */
async function crearPortalSession(stripe, { stripeCustomerId, urlRetorno }) {
  requerirStripe(stripe);
  return stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: urlRetorno });
}

/**
 * Único punto de escritura a partir de eventos reales de Stripe. Todos los
 * upserts son idempotentes por proveedor_suscripcion_id/proveedor_invoice_id
 * — Stripe puede reenviar el mismo evento más de una vez. El estado bruto
 * de Stripe SIEMPRE pasa por mapearEstadoProveedor() antes de escribirse —
 * suscripciones.estado nunca ve vocabulario de Stripe directo.
 *
 * past_due no dispara suspensión inmediata: se confía en las transiciones
 * de subscription.status que Stripe ya emite (su propio dunning/reintentos),
 * no se reimplementa un temporizador de gracia propio.
 */
async function manejarWebhookStripe(supabase, evento) {
  switch (evento.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = evento.data.object;
      const estadoCanonico = mapearEstadoProveedor('stripe', sub.status);

      await supabase.from('suscripciones').upsert({
        organization_id: sub.metadata?.organization_id,
        plan_id: sub.metadata?.plan_id,
        estado: estadoCanonico,
        proveedor: 'stripe',
        proveedor_customer_id: sub.customer,
        proveedor_suscripcion_id: sub.id,
        fecha_periodo_actual_inicio: new Date(sub.current_period_start * 1000).toISOString(),
        fecha_periodo_actual_fin: new Date(sub.current_period_end * 1000).toISOString(),
        cancelar_al_fin_periodo: sub.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'proveedor_suscripcion_id' });

      if (sub.metadata?.organization_id) {
        const estadoOrg = ESTADOS_OPERATIVOS.includes(estadoCanonico) ? 'activa' : 'suspendida';
        await supabase.from('organizations').update({ estado: estadoOrg }).eq('id', sub.metadata.organization_id);
        await sincronizarEstadoOperativo(supabase, sub.metadata.organization_id);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = evento.data.object;
      await supabase.from('suscripciones')
        .update({ estado: 'cancelled', fecha_cancelacion: new Date().toISOString() })
        .eq('proveedor_suscripcion_id', sub.id);

      if (sub.metadata?.organization_id) {
        await supabase.from('organizations').update({ estado: 'suspendida' }).eq('id', sub.metadata.organization_id);
        await sincronizarEstadoOperativo(supabase, sub.metadata.organization_id);
      }
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = evento.data.object;
      await supabase.from('pagos').upsert({
        organization_id: inv.metadata?.organization_id || null,
        proveedor: 'stripe',
        proveedor_invoice_id: inv.id,
        subtotal_centavos: inv.subtotal ?? inv.amount_due,
        iva_centavos: inv.tax || 0,
        total_centavos: inv.total ?? inv.amount_due,
        moneda: (inv.currency || 'mxn').toUpperCase(),
        estado: inv.status,
        fecha_emision: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        fecha_pago: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null,
        factura_pdf_url: inv.hosted_invoice_url || inv.invoice_pdf || null,
        raw_evento: evento,
      }, { onConflict: 'proveedor_invoice_id' });
      break;
    }
    default:
      // Eventos no manejados: se ignoran explícitamente, no es un error.
      break;
  }
}

module.exports = {
  obtenerSuscripcionVigente,
  sincronizarEstadoOperativo,
  crearSuscripcionManual,
  suspenderOrganizacion,
  reactivarOrganizacion,
  extenderPrueba,
  regalarMeses,
  expirarPruebasVencidas,
  cambiarPlan,
  crearCheckoutSession,
  crearPortalSession,
  manejarWebhookStripe,
};
