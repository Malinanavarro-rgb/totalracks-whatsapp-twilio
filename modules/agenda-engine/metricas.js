/**
 * TARA Matrix™ — agenda-engine/metricas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Agenda Universal (Fase 1) — KPIs de cierre del día.
 *
 * Pedido explícito: nunca inventar un dato para completar la interfaz.
 * `dineroGenerado` y `tiempoPromedioServicio` necesitan `citas.servicio_id`/
 * `precio_cobrado` (Fase 2, ya autorizada pero no construida) — aquí se
 * devuelven explícitamente como 'no_disponible', nunca como 0 ni omitidos
 * en silencio, para que quede claro que no es un olvido.
 *
 * `puntualidadAproxPct` SÍ es un dato real de Fase 1, pero aproximado: mide
 * cuántas citas que ya deberían haber iniciado no cruzaron el umbral de
 * retraso — no es la puntualidad exacta con check-in que pide la Fase 2.
 *
 * @module modules/agenda-engine/metricas
 */

'use strict';

const { calcularOcupacion } = require('./disponibilidad');
const { detectarRetrasos } = require('./alertas');

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
    dineroGenerado: 'no_disponible',
    tiempoPromedioServicio: 'no_disponible',
  };
}

module.exports = { calcularMetricasDia };
