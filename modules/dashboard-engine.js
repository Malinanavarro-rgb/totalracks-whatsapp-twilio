/**
 * TARA Matrix™ — dashboard-engine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor Universal de Empresas de Servicios — Capa 2: el tablero de KPIs y
 * recomendaciones por industria deja de vivir como funciones hardcodeadas
 * (antes `obtenerMetricasUniformesDeportivos`/`obtenerMetricasSalonBelleza`
 * en modules/dashboard.js) y pasa a ser config (`plantillas_industria.
 * dashboard_kpis_seed`) interpretada por un registro de tipos — mismo
 * patrón que ActionRunner (Map de tipos con nombre, nunca un "if industria").
 *
 * Agregar una industria nueva que solo necesita combinaciones ya existentes
 * de tipos (95% de los casos) es puro dato. Un tipo de KPI/recomendación
 * genuinamente nuevo es UNA función nueva registrada aquí — una sola vez,
 * reusable por cualquier industria futura, nunca duplicada por industria.
 *
 * @module modules/dashboard-engine
 */

'use strict';

// ── Utilidades de fecha compartidas ──────────────────────────────────────────

function _rangoDia(fecha, finDelDia = false) {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), finDelDia ? 23 : 0, finDelDia ? 59 : 0, finDelDia ? 59 : 0));
  return d.toISOString();
}

function _inicioMes(fecha) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1)).toISOString();
}

function _haceDias(fecha, dias) {
  return new Date(fecha.getTime() - dias * 24 * 3600 * 1000).toISOString();
}

function _enHoras(fecha, horas) {
  return new Date(fecha.getTime() + horas * 3600 * 1000).toISOString();
}

// ── KPI_TIPOS — cada uno es {valor} listo para el arreglo `kpis` ────────────

const KPI_TIPOS = {
  /** Conteo de citas dentro de un rango relativo ('hoy'), filtrado por estado. */
  async conteo_citas_rango(supabase, company_id, { rango, estados }, ahora) {
    const desde = rango === 'hoy' ? _rangoDia(ahora) : _haceDias(ahora, 7);
    const hasta = rango === 'hoy' ? _rangoDia(ahora, true) : ahora.toISOString();
    const { count, error } = await supabase
      .from('citas').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).in('estado', estados).gte('inicio', desde).lte('inicio', hasta);
    return error ? 0 : (count || 0);
  },

  /** Citas en estado 'agendada' (sin confirmar) dentro de una ventana de horas hacia adelante. */
  async conteo_citas_sin_confirmar(supabase, company_id, { horas_ventana }, ahora) {
    const { count, error } = await supabase
      .from('citas').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).eq('estado', 'agendada')
      .gte('inicio', ahora.toISOString()).lte('inicio', _enHoras(ahora, horas_ventana));
    return error ? 0 : (count || 0);
  },

  /** Clientes nuevos en los últimos N días. */
  async conteo_clientes_nuevos(supabase, company_id, { dias }, ahora) {
    const { count, error } = await supabase
      .from('clientes').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).gte('created_at', _haceDias(ahora, dias));
    return error ? 0 : (count || 0);
  },

  /** Citas en un estado dado, acumuladas desde 'mes' (inicio del mes actual). */
  async conteo_citas_por_estado_desde(supabase, company_id, { estado, desde }, ahora) {
    const desdeIso = desde === 'mes' ? _inicioMes(ahora) : _haceDias(ahora, 30);
    const { count, error } = await supabase
      .from('citas').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).eq('estado', estado).gte('inicio', desdeIso);
    return error ? 0 : (count || 0);
  },

  /** Oportunidades en un estado (texto libre de pipeline) dado. */
  async conteo_oportunidades_por_estado(supabase, company_id, { estado }) {
    const { count, error } = await supabase
      .from('oportunidades').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).eq('estado', estado);
    return error ? 0 : (count || 0);
  },

  /** Suma de un campo numérico de oportunidades en un estado, desde el inicio del mes. */
  async suma_oportunidades_mes(supabase, company_id, { estado, campo, formato }, ahora) {
    const { data, error } = await supabase
      .from('oportunidades').select(campo)
      .eq('company_id', company_id).eq('estado', estado).gte('updated_at', _inicioMes(ahora));
    const total = (error || !data) ? 0 : data.reduce((acc, fila) => acc + (Number(fila[campo]) || 0), 0);
    return formato === 'moneda' ? `$${total.toLocaleString('es-MX')}` : total;
  },

  /**
   * Conteo de cotizaciones (Panel de Cotizaciones, Alina 2026-08-10) — en un
   * `estado` dado, o cualquiera si se omite; `desde: 'mes'` acota al mes en
   * curso, sin `desde` cuenta el histórico completo.
   */
  async conteo_cotizaciones_por_estado(supabase, company_id, { estado, desde }, ahora) {
    let query = supabase.from('cotizaciones').select('*', { count: 'exact', head: true }).eq('company_id', company_id);
    if (estado) query = query.eq('estado', estado);
    if (desde === 'mes') query = query.gte('created_at', _inicioMes(ahora));
    const { count, error } = await query;
    return error ? 0 : (count || 0);
  },

  /** Suma de cotizaciones.total — en un estado dado, o cualquiera; mismo criterio de `desde` que arriba. */
  async suma_cotizaciones_monto(supabase, company_id, { estado, desde, formato }, ahora) {
    let query = supabase.from('cotizaciones').select('total').eq('company_id', company_id);
    if (estado) query = query.eq('estado', estado);
    if (desde === 'mes') query = query.gte('created_at', _inicioMes(ahora));
    const { data, error } = await query;
    const total = (error || !data) ? 0 : data.reduce((acc, fila) => acc + (Number(fila.total) || 0), 0);
    return formato === 'moneda' ? `$${total.toLocaleString('es-MX')}` : total;
  },

  /**
   * Conteo de oportunidades cuyo `estado` NO está en `estados_excluidos`
   * (ej. pipeline abierto: excluir los nombres de etapa que representan
   * cierre — "Cerrado"/"Perdido", tal cual los tenga configurados cada
   * empresa en pipeline_etapas, nunca hardcodeado aquí). Filtra en JS (no
   * `.not(...,'in',...)` de PostgREST) porque los nombres de etapa pueden
   * traer espacios ("Visita agendada") y complicar el escape del filtro.
   */
  async conteo_oportunidades_excluyendo_estado(supabase, company_id, { estados_excluidos }) {
    const { data, error } = await supabase.from('oportunidades').select('estado').eq('company_id', company_id);
    if (error || !data) return 0;
    const excluidos = new Set(estados_excluidos || []);
    return data.filter(o => !excluidos.has(o.estado)).length;
  },

  /** Suma de un campo numérico de oportunidades cuyo estado NO está en `estados_excluidos` — valor del pipeline abierto, sin acotar a un mes. */
  async suma_oportunidades_excluyendo_estado(supabase, company_id, { estados_excluidos, campo, formato }) {
    const { data, error } = await supabase.from('oportunidades').select(`estado, ${campo}`).eq('company_id', company_id);
    if (error || !data) return formato === 'moneda' ? '$0' : 0;
    const excluidos = new Set(estados_excluidos || []);
    const total = data.filter(o => !excluidos.has(o.estado)).reduce((acc, fila) => acc + (Number(fila[campo]) || 0), 0);
    return formato === 'moneda' ? `$${total.toLocaleString('es-MX')}` : total;
  },

  /** Conteo de oportunidades en un estado dado, acumuladas desde 'mes' (por updated_at) — mismo criterio que conteo_citas_por_estado_desde. */
  async conteo_oportunidades_por_estado_desde(supabase, company_id, { estado, desde }, ahora) {
    const desdeIso = desde === 'mes' ? _inicioMes(ahora) : _haceDias(ahora, 30);
    const { count, error } = await supabase
      .from('oportunidades').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).eq('estado', estado).gte('updated_at', desdeIso);
    return error ? 0 : (count || 0);
  },

  /** Citas futuras (desde ahora) en alguno de `estados`, dentro de una ventana de días hacia adelante. */
  async conteo_citas_futuras(supabase, company_id, { estados, dias_ventana }, ahora) {
    const { count, error } = await supabase
      .from('citas').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).in('estado', estados)
      .gte('inicio', ahora.toISOString()).lte('inicio', _enHoras(ahora, dias_ventana * 24));
    return error ? 0 : (count || 0);
  },

  /** Conteo de tareas en alguno de `estados` (ej. abierta/en_progreso — "pendientes"). */
  async conteo_tareas_por_estado(supabase, company_id, { estados }) {
    const { count, error } = await supabase
      .from('tareas').select('*', { count: 'exact', head: true })
      .eq('company_id', company_id).in('estado', estados);
    return error ? 0 : (count || 0);
  },

  /**
   * Oportunidades con `fecha_seguimiento` ya vencida (<= ahora) que no están
   * en un estado de cierre — "seguimientos pendientes/atrasados". Filtra en
   * JS por el mismo motivo de escape que conteo_oportunidades_excluyendo_estado.
   */
  async conteo_oportunidades_seguimiento_vencido(supabase, company_id, { estados_excluidos }, ahora) {
    const { data, error } = await supabase
      .from('oportunidades').select('estado, fecha_seguimiento').eq('company_id', company_id)
      .not('fecha_seguimiento', 'is', null).lte('fecha_seguimiento', ahora.toISOString());
    if (error || !data) return 0;
    const excluidos = new Set(estados_excluidos || []);
    return data.filter(o => !excluidos.has(o.estado)).length;
  },

  /**
   * Tasa de conversión = oportunidades en `estado_ganado` / oportunidades en
   * alguno de `estados_cierre` (Nort Energy Operations, Alina 2026-09-09).
   * Reusable por cualquier industria con pipeline (no hardcodea nombres de
   * etapa — los recibe por config). Sin oportunidades cerradas todavía
   * (ganadas o perdidas) devuelve '—' en vez de fingir 0% — no hay tasa que
   * calcular aún, no es lo mismo que "0% de conversión".
   */
  async tasa_conversion_oportunidades(supabase, company_id, { estado_ganado, estados_cierre }) {
    const { data, error } = await supabase.from('oportunidades').select('estado').eq('company_id', company_id);
    if (error || !data) return '—';
    const cierre = new Set(estados_cierre || []);
    const totalCerradas = data.filter(o => cierre.has(o.estado)).length;
    if (totalCerradas === 0) return '—';
    const ganadas = data.filter(o => o.estado === estado_ganado).length;
    return `${Math.round((ganadas / totalCerradas) * 100)}%`;
  },
};

// ── REGLA_TIPOS — cada uno devuelve un arreglo de recomendaciones ──────────

function _texto(plantilla, valores) {
  return plantilla.replace(/\{(\w+)\}/g, (_, clave) => valores[clave] ?? '');
}

const REGLA_TIPOS = {
  /** Citas 'agendada' dentro de una ventana de horas — recordatorio de confirmar. */
  async cita_sin_confirmar_ventana(supabase, company_id, { horas, severidad }, ahora) {
    const { data } = await supabase
      .from('citas').select('id, cliente_id, inicio, clientes(nombre)')
      .eq('company_id', company_id).eq('estado', 'agendada')
      .gte('inicio', ahora.toISOString()).lte('inicio', _enHoras(ahora, horas))
      .order('inicio', { ascending: true });

    return (data || []).map(cita => ({
      texto: `Confirma la cita de ${cita.clientes?.nombre || 'una clienta'}.`,
      detalle: `Agendada para ${new Date(cita.inicio).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.`,
      accion: 'Confirmar cita', recurso: `/crm/clientes/${cita.cliente_id}`, severidad,
    }));
  },

  /** Clientes sin cita futura cuya última cita completada fue hace N+ días. */
  async cliente_sin_visita(supabase, company_id, { dias, severidad }, ahora) {
    const [historial, futuras] = await Promise.all([
      supabase.from('citas').select('cliente_id, inicio, clientes(nombre)')
        .eq('company_id', company_id).eq('estado', 'completada').order('inicio', { ascending: false }),
      supabase.from('citas').select('cliente_id')
        .eq('company_id', company_id).in('estado', ['agendada', 'confirmada']).gte('inicio', ahora.toISOString()),
    ]);

    const idsConCitaFutura = new Set((futuras.data || []).map(c => c.cliente_id));
    const limiteAntiguedad = ahora.getTime() - dias * 24 * 3600 * 1000;
    const vistos = new Set();
    const recos = [];

    for (const cita of historial.data || []) {
      if (vistos.has(cita.cliente_id)) continue;
      vistos.add(cita.cliente_id);
      if (idsConCitaFutura.has(cita.cliente_id)) continue;
      if (new Date(cita.inicio).getTime() > limiteAntiguedad) continue;

      recos.push({
        texto: `${cita.clientes?.nombre || 'Una clienta'} no visita hace más de ${dias} días.`,
        detalle: '¿Le enviamos un recordatorio de retoque?',
        accion: 'Enviar recordatorio', recurso: `/crm/clientes/${cita.cliente_id}`, severidad,
      });
    }
    return recos;
  },

  /** Oportunidades en un estado, estancadas más de N horas sin actualizar. */
  async oportunidad_estancada(supabase, company_id, { estado, horas, severidad, mensaje, detalle, accion }, ahora) {
    const { data } = await supabase
      .from('oportunidades').select('id, cliente_id, updated_at, clientes(nombre)')
      .eq('company_id', company_id).eq('estado', estado).lte('updated_at', _enHoras(ahora, -horas))
      .order('updated_at', { ascending: true });

    return (data || []).map(op => ({
      texto: _texto(mensaje, { cliente: op.clientes?.nombre || 'Un cliente' }),
      detalle, accion, recurso: `/crm/clientes/${op.cliente_id}`, severidad,
    }));
  },

  /** Cualquier oportunidad en un estado dado — sin condición de antigüedad. */
  async oportunidad_en_estado(supabase, company_id, { estado, severidad, mensaje, detalle, accion }) {
    const { data } = await supabase
      .from('oportunidades').select('id, cliente_id, clientes(nombre)')
      .eq('company_id', company_id).eq('estado', estado);

    return (data || []).map(op => ({
      texto: _texto(mensaje, { cliente: op.clientes?.nombre || 'un cliente' }),
      detalle, accion, recurso: `/crm/clientes/${op.cliente_id}`, severidad,
    }));
  },

  /**
   * Detecta lenguaje de urgencia en un campo de texto de workflow_sessions
   * capturado en vivo durante el intake (antes de que exista la oportunidad).
   * Match de texto, no parser de fechas reales — honesto ante la ambigüedad.
   */
  async texto_urgente_workflow(supabase, company_id, { campo, severidad }) {
    const REGEX_URGENTE = /\b(hoy|mañana|urgent\w*|lo antes posible|esta semana|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\b/i;
    const { data } = await supabase
      .from('workflow_sessions').select('cliente_id, captured_fields, updated_at, clientes(nombre)')
      .eq('company_id', company_id).order('updated_at', { ascending: false }).limit(20);

    const vistos = new Set();
    const recos = [];
    for (const sesion of data || []) {
      const valor = sesion.captured_fields?.[campo];
      if (!valor || !REGEX_URGENTE.test(valor)) continue;
      if (vistos.has(sesion.cliente_id)) continue;
      vistos.add(sesion.cliente_id);

      recos.push({
        texto: `${sesion.clientes?.nombre || 'Un cliente'} pidió "${valor}" — confirma que alcanzas la fecha.`,
        detalle: 'Fecha mencionada en la conversación.',
        accion: 'Ver conversación', recurso: `/crm/clientes/${sesion.cliente_id}`, severidad,
      });
    }
    return recos;
  },

  /** Tareas (migración 074) en alguno de `estados` — "pendientes" para el nivel operativo del dashboard. */
  async tarea_pendiente(supabase, company_id, { estados, severidad }) {
    const { data } = await supabase
      .from('tareas').select('id, titulo, fecha_limite, cliente_id, clientes(nombre)')
      .eq('company_id', company_id).in('estado', estados)
      .order('fecha_limite', { ascending: true, nullsFirst: false });

    return (data || []).map(t => ({
      texto: t.clientes?.nombre ? `${t.titulo} — ${t.clientes.nombre}` : t.titulo,
      detalle: t.fecha_limite ? `Vence: ${new Date(t.fecha_limite).toLocaleDateString('es-MX')}` : 'Sin fecha límite.',
      accion: 'Ver tarea', recurso: t.cliente_id ? `/crm/clientes/${t.cliente_id}` : '/panel-accion', severidad,
    }));
  },

  /**
   * Versión "lista" de conteo_oportunidades_seguimiento_vencido — mismo
   * criterio (fecha_seguimiento vencida, fuera de estados de cierre), pero
   * devuelve una tarjeta de recomendación por oportunidad en vez de un
   * conteo (Nort Energy Operations, Alina 2026-09-09).
   */
  async oportunidad_seguimiento_vencido(supabase, company_id, { estados_excluidos, severidad }, ahora) {
    const { data } = await supabase
      .from('oportunidades').select('id, cliente_id, estado, fecha_seguimiento, clientes(nombre)')
      .eq('company_id', company_id).not('fecha_seguimiento', 'is', null)
      .lte('fecha_seguimiento', ahora.toISOString()).order('fecha_seguimiento', { ascending: true });

    const excluidos = new Set(estados_excluidos || []);
    return (data || [])
      .filter(o => !excluidos.has(o.estado))
      .map(o => ({
        texto: `Seguimiento vencido: ${o.clientes?.nombre || 'un cliente'}.`,
        detalle: `Fecha de seguimiento: ${new Date(o.fecha_seguimiento).toLocaleDateString('es-MX')}.`,
        accion: 'Ver oportunidad', recurso: `/crm/clientes/${o.cliente_id}`, severidad,
      }));
  },

  /**
   * Clientes tomados por un humano cuyo último mensaje registrado fue
   * entrante (sin responder) en las últimas `horas` — mismo criterio que
   * modules/dashboard._obtenerMensajesSinResponder() para el tablero
   * genérico, expuesto aquí como tipo del Motor Universal para que
   * cualquier industria (empezando por Nort Energy Operations, Alina
   * 2026-09-09) lo use vía config, sin volver a escribir la query.
   */
  async mensaje_sin_responder(supabase, company_id, { horas, severidad }, ahora) {
    const { data: humanos, error: errHumanos } = await supabase
      .from('clientes').select('id').eq('company_id', company_id).eq('atendido_por', 'humano');
    if (errHumanos || !humanos || humanos.length === 0) return [];

    const { data, error } = await supabase
      .from('mensajes_humanos')
      .select('cliente_id, created_at, clientes(nombre)')
      .eq('company_id', company_id).eq('direccion', 'entrante')
      .in('cliente_id', humanos.map(c => c.id))
      .gte('created_at', _enHoras(ahora, -horas))
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return data.map(m => ({
      texto: `Lead sin respuesta: ${m.clientes?.nombre || 'un cliente'}.`,
      detalle: `Último mensaje: ${new Date(m.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.`,
      accion: 'Responder', recurso: `/conversaciones/${m.cliente_id}`, severidad,
    }));
  },
};

/** Últimas 3 oportunidades con actividad, con su monto — feature opcional por industria. */
async function _panelVentas(supabase, company_id) {
  const { data, error } = await supabase
    .from('oportunidades')
    .select('estado, presupuesto_confirmado, presupuesto_estimado, updated_at, clientes(nombre)')
    .eq('company_id', company_id).order('updated_at', { ascending: false }).limit(3);

  if (error || !data) return [];
  return data.map(op => ({
    cliente: op.clientes?.nombre || 'Cliente', estado: op.estado,
    monto: op.presupuesto_confirmado ?? op.presupuesto_estimado ?? null,
  }));
}

function _formatearMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Calcula el tablero de una empresa a partir de la config de su industria
 * (`plantillas_industria.dashboard_kpis_seed`) — sin ningún `if` de negocio,
 * solo despachando por `tipo` contra los registros de arriba.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {{kpis: Array, recomendaciones: Array, panel_ventas?: boolean}} config
 * @returns {Promise<Object>}
 */
async function obtenerMetricasGenerico(supabase, company_id, config) {
  const ahora = new Date();

  const kpis = await Promise.all((config.kpis || []).map(async (k) => {
    const fn = KPI_TIPOS[k.tipo];
    if (!fn) { console.warn(`dashboard-engine: tipo de KPI desconocido "${k.tipo}"`); return { valor: '—', etiqueta: k.etiqueta }; }
    const valor = await fn(supabase, company_id, k.params || {}, ahora);
    return { valor: k.formatear === 'ms' ? _formatearMs(valor) : valor, etiqueta: k.etiqueta };
  }));

  const recomendacionesPorRegla = await Promise.all((config.recomendaciones || []).map(async (r) => {
    const fn = REGLA_TIPOS[r.tipo];
    if (!fn) { console.warn(`dashboard-engine: tipo de recomendación desconocido "${r.tipo}"`); return []; }
    return fn(supabase, company_id, r.params || {}, ahora);
  }));

  const resultado = {
    kpis, alertas: [], actividadReciente: [],
    recomendaciones: recomendacionesPorRegla.flat(),
  };

  if (config.panel_ventas) {
    resultado.panelVentas = await _panelVentas(supabase, company_id);
  }

  // Opt-in (Nort Energy Operations, Alina 2026-09-09): reusa el mismo feed
  // de eventos accionables que ya arma el tablero genérico universal
  // (modules/dashboard.js) — sin duplicar esa lógica. Require perezoso
  // porque dashboard.js ya requiere este módulo arriba (obtenerMetricasGenerico);
  // requerirlo aquí adentro, en tiempo de llamada y no de carga del módulo,
  // evita el problema clásico de dependencia circular en Node.
  if (config.actividad_reciente) {
    const { obtenerActividadReciente } = require('./dashboard');
    const hace24h = _haceDias(ahora, 1);
    const en24h = _enHoras(ahora, 24);
    resultado.actividadReciente = await obtenerActividadReciente(supabase, company_id, hace24h, ahora.toISOString(), en24h);
  }

  return resultado;
}

module.exports = { obtenerMetricasGenerico, KPI_TIPOS, REGLA_TIPOS, _formatearMs };
