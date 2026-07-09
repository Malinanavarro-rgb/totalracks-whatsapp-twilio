/**
 * TARA Matrix™ — dashboard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 2: Centro de Operaciones. Agnóstico de giro — no
 * asume ventas/oportunidades, solo conceptos universales (conversaciones,
 * clientes, citas). Todo filtrado por company_id — nunca datos mezclados
 * entre empresas.
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

const VENTANA_ACTIVA_MS = 30 * 60 * 1000; // 30 minutos

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<Object>} las 8 métricas del Centro de Operaciones
 */
async function obtenerMetricas(supabase, company_id) {
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
  };
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

module.exports = { obtenerMetricas };
