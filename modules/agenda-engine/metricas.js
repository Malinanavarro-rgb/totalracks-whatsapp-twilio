/**
 * TARA Matrix™ — agenda-engine/metricas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Agenda Universal (Fase 1) — KPIs de cierre del día.
 *
 * Pedido explícito: nunca inventar un dato para completar la interfaz.
 * `dineroGenerado` ya es real (Fase 2: `citas.precio_cobrado`) — pero solo
 * cuenta citas donde ese campo fue capturado explícitamente al agendar; si
 * ninguna cita del día lo tiene, se devuelve 'no_disponible' (no 0), porque
 * "sin dato" y "cero ingresos" no son lo mismo. `tiempoPromedioServicio`
 * sigue en 'no_disponible': necesita hora_checkin/hora_checkout reales
 * (Etapa C, aún no construida) — no existe ningún dato hoy del que derivarlo.
 *
 * `puntualidadAproxPct` SÍ es un dato real de Fase 1, pero aproximado: mide
 * cuántas citas que ya deberían haber iniciado no cruzaron el umbral de
 * retraso — no es la puntualidad exacta con check-in que pide la Etapa C.
 *
 * @module modules/agenda-engine/metricas
 */

'use strict';

const { calcularOcupacion } = require('./disponibilidad');
const { detectarRetrasos } = require('./alertas');

const ESTADOS_SIN_COBRO = ['cancelada', 'no_show'];

function calcularDineroGenerado(citas) {
  const conPrecio = citas.filter(c => c.precio_cobrado != null && !ESTADOS_SIN_COBRO.includes(c.estado));
  if (conPrecio.length === 0) return 'no_disponible';
  return conPrecio.reduce((suma, c) => suma + Number(c.precio_cobrado), 0);
}

function calcularMetricasDia(recursos, ahora, umbrales) {
  const todasCitas = (recursos || []).flatMap(r => r.citas || []);

  const ocupacionPct = calcularOcupacion(recursos);

  const citasRestantes = todasCitas.filter(c =>
    ['agendada', 'confirmada'].includes(c.estado) && new Date(c.fin).getTime() > ahora.getTime()
  ).length;

  const consideradasParaPuntualidad = todasCitas.filter(c =>
    ['agendada', 'confirmada'].includes(c.estado) && new Date(c.inicio).getTime() <= ahora.getTime()
  );
  const retrasadas = detectarRetrasos(todasCitas, ahora, umbrales);
  const puntualidadAproxPct = consideradasParaPuntualidad.length === 0
    ? 100 // nada que juzgar todavía hoy — no es lo mismo que "0 problemas", se documenta así
    : Math.round(((consideradasParaPuntualidad.length - retrasadas.length) / consideradasParaPuntualidad.length) * 100);

  return {
    ocupacionPct,
    citasRestantes,
    puntualidadAproxPct,
    dineroGenerado: calcularDineroGenerado(todasCitas),
    tiempoPromedioServicio: 'no_disponible',
  };
}

module.exports = { calcularMetricasDia };
