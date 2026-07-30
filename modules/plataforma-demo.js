/**
 * TARA Matrix™ — plataforma-demo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Modo Demo en Tiempo Real (Alina, 2026-07-30): el número oficial de TARA-OS
 * sigue atendiendo todo el tráfico normal — solo durante una ventana de
 * tiempo programada, y solo para un teléfono autorizado, ese mismo número
 * responde como si fuera una empresa demo pre-armada por giro (ej. "Empresa
 * Demo Paneles Solares", migración 082).
 *
 * Mismo molde que modules/plataforma-impersonacion.js ("entrar como admin a
 * cualquier empresa para soporte"): una ventana de tiempo
 * (iniciado_en/expira_en/finalizado_en) resuelta por la capa de plataforma
 * ANTES de invocar al Orchestrator — cero cambios al Core congelado
 * (ADR-005). resolverSesionDemoActiva() es la única función que el webhook
 * de server.js necesita llamar; todo lo demás (cliente, workflow, acciones)
 * ya funciona igual para cualquier company_id, incluida una empresa demo.
 *
 * @module modules/plataforma-demo
 */

'use strict';

const { registrarEvento } = require('./plataforma-audit');

// Caché en memoria de sesiones activas por teléfono — mismo patrón/TTL
// corto que ChannelRouter (modules/channel-router.js), para no pegarle a la
// DB en cada mensaje entrante. Una sesión recién finalizada puede tardar
// hasta este TTL en dejar de aplicar — trade-off aceptado, documentado.
const CACHE_TTL_MS = 30 * 1000;
const _cache = new Map();

/**
 * Normaliza un teléfono mexicano al formato exacto en el que llega
 * message.from de un WhatsApp real ("+521" + 10 dígitos — confirmado
 * revisando clientes ya existentes en la base, ej. "+5218125418218").
 *
 * Bug real encontrado en producción (2026-07-30): un admin activó una demo
 * escribiendo el teléfono tal cual lo dicta ("8142850036", 10 dígitos) —
 * resolverSesionDemoActiva() compara por igualdad exacta, así que nunca
 * hizo match contra el "+521..." real del webhook, y el número siguió
 * respondiendo como TARA-OS sin ningún error visible. Se normaliza aquí,
 * en el único punto de entrada manual (crearSesionDemo) — nunca en
 * resolverSesionDemoActiva, que siempre recibe message.from ya normalizado
 * por el adapter real.
 */
function normalizarTelefonoMX(telefono) {
  const soloDigitos = String(telefono || '').replace(/[^\d]/g, '');
  if (soloDigitos.length === 13 && soloDigitos.startsWith('521')) return `+${soloDigitos}`;
  if (soloDigitos.length === 12 && soloDigitos.startsWith('52')) return `+521${soloDigitos.slice(2)}`;
  if (soloDigitos.length === 10) return `+521${soloDigitos}`;
  return telefono.startsWith('+') ? telefono : `+${soloDigitos}`;
}

async function crearSesionDemo(supabase, { adminId, companyId, authorizedPhone, duracionMinutos }) {
  if (!adminId || !companyId || !authorizedPhone) {
    throw new Error('plataforma-demo.crearSesionDemo: adminId, companyId y authorizedPhone son obligatorios.');
  }

  const authorizedPhoneNormalizado = normalizarTelefonoMX(authorizedPhone);

  const { data: activaExistente } = await supabase
    .from('sesiones_demo')
    .select('id')
    .eq('authorized_phone', authorizedPhoneNormalizado)
    .is('finalizado_en', null)
    .gt('expira_en', new Date().toISOString())
    .maybeSingle();

  if (activaExistente) {
    const err = new Error(`Ya existe una sesión demo activa para ${authorizedPhoneNormalizado}. Finalízala antes de activar una nueva.`);
    err.status = 409;
    throw err;
  }

  const expiraEn = new Date(Date.now() + (duracionMinutos || 60) * 60 * 1000);

  const { data, error } = await supabase
    .from('sesiones_demo')
    .insert([{ company_id: companyId, admin_id: adminId, authorized_phone: authorizedPhoneNormalizado, expira_en: expiraEn.toISOString() }])
    .select()
    .single();

  if (error) throw new Error(`plataforma-demo.crearSesionDemo: ${error.message}`);

  _cache.delete(authorizedPhoneNormalizado);

  const { data: company } = await supabase.from('companies').select('organization_id').eq('id', companyId).maybeSingle();
  await registrarEvento(supabase, {
    adminId, accion: 'demo_activar', companyId, organizationId: company?.organization_id,
    detalle: { authorized_phone: authorizedPhoneNormalizado, expira_en: expiraEn.toISOString() },
  });

  return data;
}

/**
 * Resuelve si un teléfono tiene una sesión demo vigente en este momento.
 * Devuelve null si no hay ninguna (caso normal — el llamador sigue el flujo
 * de TARA-OS sin cambios). Cacheado ~30s por teléfono.
 */
async function resolverSesionDemoActiva(supabase, telefono) {
  if (!telefono) return null;

  const cacheado = _cache.get(telefono);
  if (cacheado && (Date.now() - cacheado.cachedAt) < CACHE_TTL_MS) {
    return cacheado.sesion;
  }

  const { data, error } = await supabase
    .from('sesiones_demo')
    .select('*')
    .eq('authorized_phone', telefono)
    .is('finalizado_en', null)
    .gt('expira_en', new Date().toISOString())
    .maybeSingle();

  const sesion = (error || !data) ? null : data;
  _cache.set(telefono, { sesion, cachedAt: Date.now() });
  return sesion;
}

async function finalizarSesionDemo(supabase, { sesionId, adminId }) {
  const { data: fila, error } = await supabase
    .from('sesiones_demo')
    .update({ finalizado_en: new Date().toISOString() })
    .eq('id', sesionId)
    .is('finalizado_en', null)
    .select()
    .maybeSingle();

  if (error || !fila) return null;

  _cache.delete(fila.authorized_phone);

  const resumen = await generarResumenSesion(supabase, fila);
  await supabase.from('sesiones_demo').update({ resumen }).eq('id', sesionId);

  const { data: company } = await supabase.from('companies').select('organization_id').eq('id', fila.company_id).maybeSingle();
  await registrarEvento(supabase, {
    adminId, accion: 'demo_finalizar', companyId: fila.company_id, organizationId: company?.organization_id,
    detalle: { sesion_id: sesionId },
  });

  return { ...fila, resumen };
}

/** Resuelve el cliente (si existe) atado al teléfono autorizado de una sesión demo. */
async function _clienteDeSesion(supabase, sesion) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, nombre, telefono, estado, score_interes, created_at')
    .eq('company_id', sesion.company_id)
    .eq('telefono', sesion.authorized_phone)
    .maybeSingle();
  return cliente || null;
}

/**
 * Agrega, para la ventana de tiempo de una sesión demo, todo lo que TARA
 * ejecutó de verdad (cliente, oportunidad, cita, decisiones) — sin tabla de
 * reporte nueva, se calcula una sola vez al cierre.
 */
async function generarResumenSesion(supabase, sesion) {
  const desde = sesion.iniciado_en;
  const hasta = new Date().toISOString();

  const cliente = await _clienteDeSesion(supabase, sesion);

  const [oportunidades, citas, logs] = await Promise.all([
    cliente
      // 'cotizacion' se agrega a este select cuando exista la columna
      // oportunidades.cotizacion (fase separada, folio de cotización — ver
      // plan del Modo Demo, sección 5, no implementada todavía).
      ? supabase.from('oportunidades').select('estado, descripcion, presupuesto_estimado, presupuesto_confirmado, updated_at').eq('cliente_id', cliente.id)
      : Promise.resolve({ data: [] }),
    cliente
      ? supabase.from('citas').select('inicio, fin, estado').eq('cliente_id', cliente.id)
      : Promise.resolve({ data: [] }),
    supabase.from('decision_logs').select('tipo').eq('company_id', sesion.company_id).gte('created_at', desde).lte('created_at', hasta),
  ]);

  const logsPorTipo = {};
  for (const registro of logs.data || []) {
    logsPorTipo[registro.tipo] = (logsPorTipo[registro.tipo] || 0) + 1;
  }

  return {
    duracion_ms: new Date(hasta).getTime() - new Date(desde).getTime(),
    cliente: cliente || null,
    oportunidades: oportunidades.data || [],
    citas: citas.data || [],
    acciones_por_tipo: logsPorTipo,
    generado_en: hasta,
  };
}

/**
 * Estado EN VIVO de una sesión demo (a diferencia de generarResumenSesion,
 * pensada para el cierre): para que el Panel Maestro distinga, mientras la
 * demo está en curso, al prospecto real de esa sesión de los clientes
 * sembrados de la misma empresa (Alina, 2026-07-30 — "no quiero que los
 * registros sembrados oculten la prueba real"). Se filtra siempre por
 * `authorized_phone`, nunca por company_id solo — así nunca mezcla con el
 * resto de los clientes de la empresa demo.
 */
async function obtenerEstadoSesionDemo(supabase, sesion) {
  const cliente = await _clienteDeSesion(supabase, sesion);

  const [oportunidades, citas, conversaciones, workflowSesion] = await Promise.all([
    cliente
      ? supabase.from('oportunidades').select('estado, descripcion, presupuesto_estimado, presupuesto_confirmado, updated_at').eq('cliente_id', cliente.id)
      : Promise.resolve({ data: [] }),
    cliente
      ? supabase.from('citas').select('inicio, fin, estado').eq('cliente_id', cliente.id)
      : Promise.resolve({ data: [] }),
    cliente
      ? supabase.from('conversaciones').select('mensaje_cliente, respuesta_tara, intenciones, sentimiento, created_at').eq('cliente_id', cliente.id).order('created_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
    cliente
      ? supabase.from('workflow_sessions').select('status, current_node, captured_fields, updated_at').eq('cliente_id', cliente.id).order('updated_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    cliente,
    oportunidades: oportunidades.data || [],
    citas: citas.data || [],
    conversaciones: (conversaciones.data || []).reverse(),
    datos_extraidos: workflowSesion.data?.captured_fields || {},
    nodo_actual: workflowSesion.data?.current_node || null,
  };
}

async function listarSesionesActivas(supabase) {
  const { data, error } = await supabase
    .from('sesiones_demo')
    .select('*, companies(nombre)')
    .is('finalizado_en', null)
    .gt('expira_en', new Date().toISOString())
    .order('iniciado_en', { ascending: false });

  return error ? [] : (data || []);
}

/** Empresas demo pre-armadas (companies.es_demo=true) — para el selector de "Activar demo en tiempo real". */
async function listarEmpresasDemo(supabase) {
  const { data, error } = await supabase
    .from('companies')
    .select('id, nombre, industria_slug')
    .eq('es_demo', true)
    .order('nombre');

  return error ? [] : (data || []);
}

module.exports = {
  crearSesionDemo, resolverSesionDemoActiva, finalizarSesionDemo, generarResumenSesion,
  listarSesionesActivas, listarEmpresasDemo, normalizarTelefonoMX, obtenerEstadoSesionDemo,
};
