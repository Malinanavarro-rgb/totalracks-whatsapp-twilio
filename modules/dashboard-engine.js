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

  return resultado;
}

module.exports = { obtenerMetricasGenerico, KPI_TIPOS, REGLA_TIPOS, _formatearMs };
