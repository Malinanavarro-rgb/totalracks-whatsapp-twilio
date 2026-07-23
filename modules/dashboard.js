/**
 * TARA Matrix™ — dashboard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 2: Centro de Operaciones. El tablero por default es
 * agnóstico de giro (conversaciones, clientes, citas — universal). Empresas
 * con `companies.industria_slug` reconocido reciben en su lugar un tablero de
 * KPIs/recomendaciones propio de su industria, calculado por el Motor
 * Universal (modules/dashboard-engine.js) a partir de
 * `plantillas_industria.dashboard_kpis_seed` — sin ningún `if` de negocio
 * aquí. Agregar una industria nueva es agregar su fila en `plantillas_industria`,
 * no una función nueva en este archivo. Todo sigue filtrado por company_id —
 * nunca datos mezclados entre empresas.
 *
 * "Conversaciones activas" se calcula desde conversaciones.created_at (ya
 * existente) — no requirió ningún cambio a crm.js/Orchestrator. "Atendido
 * por IA/humano" lee clientes.atendido_por (migración 026, aditiva, default
 * 'ia') — hoy siempre da 100% IA, honestamente, hasta que Fase 3 (toma
 * humana real) exista.
 *
 * @module modules/dashboard
 */

'use strict';

const { obtenerPlantillaDeEmpresa } = require('./plantillas-industria');
const { obtenerMetricasGenerico } = require('./dashboard-engine');

const VENTANA_ACTIVA_MS = 30 * 60 * 1000; // 30 minutos

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<Object>} las 8 métricas del Centro de Operaciones
 */
async function obtenerMetricas(supabase, company_id) {
  // Motor Universal: empresas con una plantilla de industria que define
  // dashboard_kpis_seed reciben un tablero calculado por dashboard-engine.js
  // — el resto conserva el tablero genérico universal de siempre, sin
  // ningún cambio de comportamiento.
  const plantilla = await obtenerPlantillaDeEmpresa(supabase, company_id);
  if (plantilla?.dashboard_kpis_seed?.kpis?.length) {
    return obtenerMetricasGenerico(supabase, company_id, plantilla.dashboard_kpis_seed);
  }

  const ahora     = new Date();
  const hace30min = new Date(ahora.getTime() - VENTANA_ACTIVA_MS).toISOString();
  const inicioHoy = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
  const hace24h   = new Date(ahora.getTime() - 24 * 3600 * 1000).toISOString();
  const en24h     = new Date(ahora.getTime() + 24 * 3600 * 1000).toISOString();
  const ahoraIso  = ahora.toISOString();

  const [
    conversacionesActivas,
    conversacionesAtendidasHoy,
    clientesNuevos,
    atendidoPorIA,
    atendidoPorHumano,
    tiempoPromedioRespuestaMs,
    citasAgendadas,
    erroresRecientes,
    citasSinConfirmar,
    actividadReciente,
  ] = await Promise.all([
    _contarClientesConActividad(supabase, company_id, hace30min),
    _contarDesde(supabase, 'conversaciones', company_id, 'created_at', inicioHoy),
    _contarDesde(supabase, 'clientes', company_id, 'created_at', inicioHoy),
    _contarClientesPorAtencion(supabase, company_id, 'ia'),
    _contarClientesPorAtencion(supabase, company_id, 'humano'),
    _tiempoPromedioRespuesta(supabase, company_id, hace24h),
    _contarCitasFuturas(supabase, company_id, ahoraIso),
    _contarErroresRecientes(supabase, company_id, hace24h),
    _contarCitasSinConfirmar(supabase, company_id, ahoraIso, en24h),
    obtenerActividadReciente(supabase, company_id, hace24h, ahoraIso, en24h),
  ]);

  const alertas = [];
  if (erroresRecientes > 0) {
    alertas.push({ tipo: 'error_tecnico', mensaje: `${erroresRecientes} error(es) técnico(s) en las últimas 24h` });
  }
  if (citasSinConfirmar > 0) {
    alertas.push({ tipo: 'cita_sin_confirmar', mensaje: `${citasSinConfirmar} cita(s) próxima(s) sin confirmar` });
  }

  return {
    conversacionesActivas,
    conversacionesAtendidasHoy,
    clientesNuevos,
    atendidoPorIA,
    atendidoPorHumano,
    tiempoPromedioRespuestaMs,
    citasAgendadas,
    alertas,
    actividadReciente,
    // Fase Demo Tienda Soccer: `kpis`/`recomendaciones` es la forma nueva y
    // genérica que ya entiende el frontend (Operaciones.jsx) — se agrega
    // aquí también para que el tablero universal use el mismo render que el
    // de industria, sin mantener dos vistas de dashboard distintas.
    kpis: [
      { valor: conversacionesActivas,        etiqueta: 'Conversaciones activas' },
      { valor: conversacionesAtendidasHoy,    etiqueta: 'Atendidas hoy' },
      { valor: clientesNuevos,                etiqueta: 'Clientes nuevos' },
      { valor: atendidoPorIA,                 etiqueta: 'Resueltas automáticamente' },
      { valor: atendidoPorHumano,             etiqueta: 'Con atención personal' },
      { valor: _formatearMs(tiempoPromedioRespuestaMs), etiqueta: 'Tiempo promedio de respuesta' },
      { valor: citasAgendadas,                etiqueta: 'Citas agendadas' },
    ],
    recomendaciones: [],
  };
}

function _formatearMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Pivote a producto, Fase 4.5: feed de eventos accionables recientes, con
 * link directo al recurso — antes el Centro de Operaciones solo tenía
 * contadores agregados (arriba) sin nada clickeable por evento individual.
 * Aproximación deliberadamente simple (no rastrea "no leído" de forma
 * exacta): cliente nuevo, mensaje entrante mientras un humano ya tomó la
 * conversación, y cita próxima sin confirmar — cada uno con su recurso.
 *
 * @returns {Promise<Array<{tipo: string, mensaje: string, recurso: string, created_at: string}>>}
 */
async function obtenerActividadReciente(supabase, company_id, hace24h, ahoraIso, en24h, limite = 8) {
  const [clientesNuevosRes, mensajesRes, citasRes] = await Promise.all([
    supabase
      .from('clientes')
      .select('id, nombre, telefono, created_at')
      .eq('company_id', company_id)
      .gte('created_at', hace24h)
      .order('created_at', { ascending: false })
      .limit(limite),
    _obtenerMensajesSinResponder(supabase, company_id, hace24h, limite),
    supabase
      .from('citas')
      .select('id, cliente_id, inicio, clientes(nombre, telefono)')
      .eq('company_id', company_id)
      .eq('estado', 'agendada')
      .gte('inicio', ahoraIso)
      .lte('inicio', en24h)
      .order('inicio', { ascending: true })
      .limit(limite),
  ]);

  const eventos = [];

  for (const c of clientesNuevosRes.data || []) {
    eventos.push({
      tipo:       'cliente_nuevo',
      mensaje:    `Cliente nuevo: ${c.nombre || c.telefono}`,
      recurso:    `/crm/clientes/${c.id}`,
      created_at: c.created_at,
    });
  }

  for (const m of mensajesRes) {
    eventos.push({
      tipo:       'mensaje_sin_responder',
      mensaje:    `Mensaje sin responder: ${m.clientes?.nombre || m.clientes?.telefono || 'cliente'}`,
      recurso:    `/conversaciones/${m.cliente_id}`,
      created_at: m.created_at,
    });
  }

  for (const cita of citasRes.data || []) {
    eventos.push({
      tipo:       'cita_sin_confirmar',
      mensaje:    `Cita sin confirmar: ${cita.clientes?.nombre || cita.clientes?.telefono || 'cliente'} — ${new Date(cita.inicio).toLocaleString('es-MX')}`,
      recurso:    `/crm/clientes/${cita.cliente_id}`,
      created_at: cita.inicio,
    });
  }

  return eventos
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limite);
}

/**
 * Clientes actualmente tomados por un humano cuyo último mensaje registrado
 * fue del cliente (entrante) — aproximación a "mensaje sin responder" sin
 * rastrear estado de lectura exacto.
 */
async function _obtenerMensajesSinResponder(supabase, company_id, desde, limite) {
  const { data: humanos, error: errHumanos } = await supabase
    .from('clientes')
    .select('id')
    .eq('company_id', company_id)
    .eq('atendido_por', 'humano');

  if (errHumanos || !humanos || humanos.length === 0) return [];

  const { data, error } = await supabase
    .from('mensajes_humanos')
    .select('cliente_id, created_at, clientes(nombre, telefono)')
    .eq('company_id', company_id)
    .eq('direccion', 'entrante')
    .in('cliente_id', humanos.map(c => c.id))
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(limite);

  return error ? [] : (data || []);
}

async function _contarClientesConActividad(supabase, company_id, desde) {
  const { data, error } = await supabase
    .from('conversaciones')
    .select('cliente_id')
    .eq('company_id', company_id)
    .gte('created_at', desde);

  if (error || !data) return 0;
  return new Set(data.map(c => c.cliente_id)).size;
}

async function _contarDesde(supabase, tabla, company_id, columnaFecha, desde) {
  const { count, error } = await supabase
    .from(tabla)
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .gte(columnaFecha, desde);

  return error ? 0 : (count || 0);
}

async function _contarClientesPorAtencion(supabase, company_id, atendidoPor) {
  const { count, error } = await supabase
    .from('clientes')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('atendido_por', atendidoPor);

  return error ? 0 : (count || 0);
}

async function _tiempoPromedioRespuesta(supabase, company_id, desde) {
  const { data, error } = await supabase
    .from('decision_logs')
    .select('latencia_ms')
    .eq('company_id', company_id)
    .eq('tipo', 'ai_call')
    .gte('created_at', desde)
    .not('latencia_ms', 'is', null);

  if (error || !data || data.length === 0) return null;
  const suma = data.reduce((acc, r) => acc + (r.latencia_ms || 0), 0);
  return Math.round(suma / data.length);
}

async function _contarCitasFuturas(supabase, company_id, ahoraIso) {
  const { count, error } = await supabase
    .from('citas')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .in('estado', ['agendada', 'confirmada'])
    .gte('inicio', ahoraIso);

  return error ? 0 : (count || 0);
}

async function _contarErroresRecientes(supabase, company_id, desde) {
  const { count, error } = await supabase
    .from('decision_logs')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .not('error', 'is', null)
    .gte('created_at', desde);

  return error ? 0 : (count || 0);
}

async function _contarCitasSinConfirmar(supabase, company_id, ahoraIso, hasta) {
  const { count, error } = await supabase
    .from('citas')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('estado', 'agendada')
    .gte('inicio', ahoraIso)
    .lte('inicio', hasta);

  return error ? 0 : (count || 0);
}

module.exports = { obtenerMetricas, obtenerActividadReciente };
