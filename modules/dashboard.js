/**
 * TARA Matrix™ — dashboard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Plataforma SaaS, Fase 2: Centro de Operaciones. El tablero por default es
 * agnóstico de giro (conversaciones, clientes, citas — universal). Empresas
 * con `companies.industria_slug` reconocido (ver migrations/046) reciben un
 * tablero de KPIs/recomendaciones propio de su industria en su lugar —
 * `obtenerMetricasUniformesDeportivos()` es el primer caso. Todo sigue
 * filtrado por company_id — nunca datos mezclados entre empresas.
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
  // Pivote a producto — Fase Demo Tienda Soccer: el Centro de Operaciones
  // deja de ser 100% agnóstico de giro. Empresas con `industria_slug` en
  // companies (ver migrations/046) reciben un tablero de KPIs y
  // recomendaciones propio de su industria — el resto conserva el tablero
  // genérico universal de siempre, sin ningún cambio de comportamiento.
  const { data: company } = await supabase
    .from('companies')
    .select('industria_slug')
    .eq('id', company_id)
    .maybeSingle();

  if (company?.industria_slug === 'uniformes_deportivos') {
    return obtenerMetricasUniformesDeportivos(supabase, company_id);
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
 * Fase Demo Tienda Soccer: tablero de KPIs y recomendaciones propio de un
 * negocio de venta/manufactura por cotización (uniformes deportivos
 * personalizados) — sin agenda, con `oportunidades` como objeto central en
 * vez de `citas`. Las recomendaciones se calculan de datos reales
 * (oportunidades por etapa/antigüedad), no son texto fijo — cambian solas
 * conforme cambian los datos de la empresa.
 */
async function obtenerMetricasUniformesDeportivos(supabase, company_id) {
  const ahora      = new Date();
  const hace48h    = new Date(ahora.getTime() - 48 * 3600 * 1000).toISOString();
  const inicioMes  = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString();

  const [solicitudes, cotizaciones, produccion, entregas, ventasDelMes, recomendaciones, panelVentas] = await Promise.all([
    _contarOportunidadesPorEstado(supabase, company_id, 'Solicitud nueva'),
    _contarOportunidadesPorEstado(supabase, company_id, 'Cotización enviada'),
    _contarOportunidadesPorEstado(supabase, company_id, 'En producción'),
    _contarOportunidadesPorEstado(supabase, company_id, 'Listo para entrega'),
    _sumarVentasDelMes(supabase, company_id, inicioMes),
    _obtenerRecomendacionesUniformesDeportivos(supabase, company_id, hace48h),
    _panelVentasUniformesDeportivos(supabase, company_id),
  ]);

  return {
    kpis: [
      { valor: solicitudes,   etiqueta: 'Solicitudes nuevas' },
      { valor: cotizaciones,  etiqueta: 'Cotizaciones enviadas' },
      { valor: produccion,    etiqueta: 'Pedidos en producción' },
      { valor: entregas,      etiqueta: 'Entregas' },
      { valor: `$${ventasDelMes.toLocaleString('es-MX')}`, etiqueta: 'Ventas este mes' },
    ],
    alertas: [],
    actividadReciente: [],
    recomendaciones,
    panelVentas,
  };
}

/**
 * Fase Premium V1.1: "Estado de ventas" — snapshot de las 3 oportunidades
 * con actividad más reciente (cualquier etapa), con el monto real de cada
 * una. Complementa a las recomendaciones (que son solo lo urgente) con una
 * vista general de qué se está moviendo en el negocio.
 */
async function _panelVentasUniformesDeportivos(supabase, company_id) {
  const { data, error } = await supabase
    .from('oportunidades')
    .select('estado, presupuesto_confirmado, presupuesto_estimado, updated_at, clientes(nombre)')
    .eq('company_id', company_id)
    .order('updated_at', { ascending: false })
    .limit(3);

  if (error || !data) return [];

  return data.map(op => ({
    cliente: op.clientes?.nombre || 'Cliente',
    estado: op.estado,
    monto: op.presupuesto_confirmado ?? op.presupuesto_estimado ?? null,
  }));
}

async function _contarOportunidadesPorEstado(supabase, company_id, estado) {
  const { count, error } = await supabase
    .from('oportunidades')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('estado', estado);

  return error ? 0 : (count || 0);
}

async function _sumarVentasDelMes(supabase, company_id, desde) {
  const { data, error } = await supabase
    .from('oportunidades')
    .select('presupuesto_confirmado')
    .eq('company_id', company_id)
    .eq('estado', 'Entregado')
    .gte('updated_at', desde);

  if (error || !data) return 0;
  return data.reduce((acc, fila) => acc + (Number(fila.presupuesto_confirmado) || 0), 0);
}

/**
 * Reglas de recomendación por etapa — cada una lee oportunidades reales,
 * no texto fijo. "Cotización enviada" + estancada 48h+ → seguimiento;
 * "Cotización en preparación" → recordatorio de confirmar tallas antes de
 * producción; "Listo para entrega" → aviso de entrega pendiente.
 */
async function _obtenerRecomendacionesUniformesDeportivos(supabase, company_id, hace48h) {
  const [estancadas, enPreparacion, listas] = await Promise.all([
    supabase
      .from('oportunidades')
      .select('id, cliente_id, updated_at, clientes(nombre)')
      .eq('company_id', company_id)
      .eq('estado', 'Cotización enviada')
      .lte('updated_at', hace48h)
      .order('updated_at', { ascending: true }),
    supabase
      .from('oportunidades')
      .select('id, cliente_id, clientes(nombre)')
      .eq('company_id', company_id)
      .eq('estado', 'Cotización en preparación'),
    supabase
      .from('oportunidades')
      .select('id, cliente_id, clientes(nombre)')
      .eq('company_id', company_id)
      .eq('estado', 'Listo para entrega'),
  ]);

  const recos = [];

  for (const op of estancadas.data || []) {
    recos.push({
      texto:     `${op.clientes?.nombre || 'Un cliente'} lleva más de 48 horas sin seguimiento.`,
      detalle:   'Cotización enviada sin respuesta.',
      accion:    'Dar seguimiento ahora',
      recurso:   `/crm/clientes/${op.cliente_id}`,
      severidad: 'critica',
    });
  }

  for (const op of enPreparacion.data || []) {
    recos.push({
      texto:     `Confirma tallas de ${op.clientes?.nombre || 'este pedido'} antes de enviarlo a producción.`,
      detalle:   'Cotización en preparación.',
      accion:    'Ver detalle',
      recurso:   `/crm/clientes/${op.cliente_id}`,
      severidad: 'media',
    });
  }

  for (const op of listas.data || []) {
    recos.push({
      texto:     `El pedido de ${op.clientes?.nombre || 'un cliente'} está listo para entrega.`,
      detalle:   'Listo para entrega.',
      accion:    'Ver pedido',
      recurso:   `/crm/clientes/${op.cliente_id}`,
      severidad: 'info',
    });
  }

  return recos;
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

module.exports = { obtenerMetricas, obtenerActividadReciente, obtenerMetricasUniformesDeportivos };
