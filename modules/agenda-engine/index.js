/**
 * TARA Matrix™ — agenda-engine/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Agenda Universal (Fase 1) — único punto de entrada que usa
 * server.js. Orquesta: carga datos reales (asesores, citas, horarios,
 * servicios, agenda_config), llama a disponibilidad/alertas/métricas/
 * recomendaciones (todas puras) y persiste cada recomendación como evento
 * de auditoría (con deduplicación — ver recomendaciones.js).
 *
 * Cero cambios al Core congelado: toda la lectura es directa sobre
 * `citas`/`asesores`/`horarios_laborales`/`servicios`, mismo patrón ya
 * usado en modules/dashboard.js y modules/crm-ui.js — no se agrega ni se
 * modifica ningún método de SchedulingEngine.
 *
 * @module modules/agenda-engine
 */

'use strict';

const { obtenerAgendaConfig, DEFAULT_AGENDA_CONFIG } = require('../agenda-config');
const { obtenerHuecos, calcularOcupacionRecurso } = require('./disponibilidad');
const {
  detectarRetrasos, detectarSaturacion, detectarTiempoMuerto,
  detectarRiesgoTarde, detectarHuecosInsertables, detectarNoShowCandidatos,
} = require('./alertas');
const { calcularMetricasDia } = require('./metricas');
const { construirRecomendaciones, registrarEvento } = require('./recomendaciones');
const { calcularSegmentos } = require('./valor-cliente');

async function _obtenerAsesoresActivos(supabase, company_id) {
  const { data, error } = await supabase
    .from('asesores')
    .select('id, nombre')
    .eq('company_id', company_id)
    .eq('activo', true);
  return error ? [] : (data || []);
}

async function _obtenerCitasDelDia(supabase, company_id, fecha) {
  const inicioDia = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate())).toISOString();
  const finDia = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), 23, 59, 59)).toISOString();

  const { data, error } = await supabase
    .from('citas')
    .select('*, clientes(nombre, telefono)')
    .eq('company_id', company_id)
    .gte('inicio', inicioDia)
    .lte('inicio', finDia)
    .order('inicio', { ascending: true });

  return error ? [] : (data || []);
}

/**
 * Mismo criterio de resolución que SchedulingEngine._obtenerHorario (fila
 * propia del asesor, si no existe cae al horario general de la empresa) —
 * reimplementado aquí como una consulta de solo lectura porque ese método
 * es privado del Core congelado; no se le agrega ni se le expone nada.
 */
async function _resolverHorarioDelAsesor(supabase, company_id, asesorId, diaSemana) {
  const { data: propio } = await supabase
    .from('horarios_laborales')
    .select('*')
    .eq('company_id', company_id)
    .eq('asesor_id', asesorId)
    .eq('dia_semana', diaSemana)
    .maybeSingle();
  if (propio) return propio;

  const { data: general } = await supabase
    .from('horarios_laborales')
    .select('*')
    .eq('company_id', company_id)
    .is('asesor_id', null)
    .eq('dia_semana', diaSemana)
    .maybeSingle();
  return general || null;
}

async function _obtenerServiciosActivos(supabase, company_id) {
  // TARA Canvas v3: `precio` ya existía en el catálogo desde siempre — solo
  // faltaba pedirlo. Con esto, "qué cabe en este hueco y cuánto podría
  // generar" es dato real hoy, sin esperar a la Fase 2 (que solo hace falta
  // para saber qué se cobró en una cita YA reservada).
  const { data, error } = await supabase
    .from('servicios')
    .select('id, nombre, duracion_minutos, precio, activo')
    .eq('company_id', company_id)
    .eq('activo', true);
  return error ? [] : (data || []);
}

/**
 * Historial COMPLETO (no solo hoy) de las clientas que aparecen en la
 * agenda de hoy — base real para calcular frecuencia/asistencia/rebook,
 * sin inventar ningún dato (ver modules/agenda-engine/valor-cliente.js).
 */
async function _obtenerHistorialClientes(supabase, company_id, clienteIds) {
  if (!clienteIds.length) return [];
  const { data, error } = await supabase
    .from('citas')
    .select('cliente_id, inicio, estado')
    .eq('company_id', company_id)
    .in('cliente_id', clienteIds);
  return error ? [] : (data || []);
}

async function _obtenerFechaAltaClientes(supabase, company_id, clienteIds) {
  if (!clienteIds.length) return [];
  const { data, error } = await supabase
    .from('clientes')
    .select('id, created_at')
    .eq('company_id', company_id)
    .in('id', clienteIds);
  return error ? [] : (data || []);
}

/**
 * @returns {Promise<{ config: Object, recursos: Array, alertas: Array, recomendaciones: Array, metricas: Object }>}
 */
async function calcularEstadoDelDia(supabase, company_id, fecha) {
  const ahora = new Date();
  const diaSemana = fecha.getUTCDay();

  const [configFila, asesores, citasDelDia, servicios] = await Promise.all([
    obtenerAgendaConfig(supabase, company_id),
    _obtenerAsesoresActivos(supabase, company_id),
    _obtenerCitasDelDia(supabase, company_id, fecha),
    _obtenerServiciosActivos(supabase, company_id),
  ]);

  const config = configFila?.config || DEFAULT_AGENDA_CONFIG;
  const umbrales = config.umbrales;

  // TARA Canvas v3: segmentación de clientas por comportamiento real,
  // basada en su historial COMPLETO (no solo hoy) — ver valor-cliente.js.
  const clienteIdsHoy = [...new Set(citasDelDia.map(c => c.cliente_id).filter(Boolean))];
  const [historialClientes, altaClientes] = await Promise.all([
    _obtenerHistorialClientes(supabase, company_id, clienteIdsHoy),
    _obtenerFechaAltaClientes(supabase, company_id, clienteIdsHoy),
  ]);
  const historialPorCliente = new Map();
  for (const c of historialClientes) {
    if (!historialPorCliente.has(c.cliente_id)) historialPorCliente.set(c.cliente_id, []);
    historialPorCliente.get(c.cliente_id).push(c);
  }
  const altaPorCliente = new Map(altaClientes.map(c => [c.id, c.created_at]));

  for (const cita of citasDelDia) {
    if (!cita.cliente_id || !cita.clientes) continue;
    const { segmentos, factores } = calcularSegmentos(
      historialPorCliente.get(cita.cliente_id) || [],
      altaPorCliente.get(cita.cliente_id) || null,
      ahora
    );
    cita.clientes.segmentos = segmentos;
    cita.clientes.factoresValor = factores;
  }

  const recursos = [];
  const detecciones = [];

  for (const asesor of asesores) {
    const horario = await _resolverHorarioDelAsesor(supabase, company_id, asesor.id, diaSemana);
    const citasDelAsesor = citasDelDia.filter(c => c.asesor_id === asesor.id);
    const huecos = obtenerHuecos(citasDelAsesor, horario, fecha);
    const ocupacionPct = calcularOcupacionRecurso(citasDelAsesor, horario, fecha).ocupacionPct;
    const siguienteEspacio = huecos.find(h => new Date(h.inicio).getTime() > ahora.getTime()) || null;

    recursos.push({
      asesorId: asesor.id, asesorNombre: asesor.nombre, citas: citasDelAsesor, horario, fecha, huecos,
      ocupacionPct, siguienteEspacio,
    });

    const etiquetar = (tipo, lista) => lista.map(d => ({ tipo, asesorId: asesor.id, asesorNombre: asesor.nombre, ...d }));

    if (config.reglas_prioritarias.includes('retraso')) {
      detecciones.push(...etiquetar('retraso', detectarRetrasos(citasDelAsesor, ahora, umbrales)));
    }
    if (config.reglas_prioritarias.includes('no_show_candidato')) {
      detecciones.push(...etiquetar('no_show_candidato', detectarNoShowCandidatos(citasDelAsesor, ahora, umbrales)));
    }
    if (config.reglas_prioritarias.includes('riesgo_tarde')) {
      detecciones.push(...etiquetar('riesgo_tarde', detectarRiesgoTarde(citasDelAsesor, horario, fecha, ahora, umbrales)));
    }
    if (config.reglas_prioritarias.includes('saturacion')) {
      detecciones.push(...etiquetar('saturacion', detectarSaturacion(citasDelAsesor, umbrales)));
    }
    if (config.reglas_prioritarias.includes('tiempo_muerto')) {
      detecciones.push(...etiquetar('tiempo_muerto', detectarTiempoMuerto(huecos, umbrales)));
    }
    if (config.reglas_prioritarias.includes('hueco_insertable')) {
      detecciones.push(...etiquetar('hueco_insertable', detectarHuecosInsertables(huecos, servicios, umbrales)));
    }
  }

  const metricas = calcularMetricasDia(recursos, ahora, umbrales);
  const recomendaciones = construirRecomendaciones(detecciones, config);

  // Persistir cada recomendación como evento de auditoría (deduplicado) y
  // devolver el id real para que el frontend pueda resolverlo al actuar.
  for (const r of recomendaciones) {
    const evento = await registrarEvento(supabase, company_id, {
      tipo_regla: r.tipo_regla,
      cita_id: r.cita_id,
      asesor_id: r.asesor_id,
      detectado: { severidad: r.severidad, detalle: r.detalle },
      texto: r.texto,
    });
    r.evento_id = evento.id;
  }

  return {
    config,
    recursos: recursos.map(r => ({
      asesorId: r.asesorId, asesorNombre: r.asesorNombre, citas: r.citas, huecos: r.huecos, horario: r.horario,
      ocupacionPct: r.ocupacionPct, siguienteEspacio: r.siguienteEspacio,
    })),
    servicios,
    recomendaciones,
    metricas,
  };
}

module.exports = { calcularEstadoDelDia };
