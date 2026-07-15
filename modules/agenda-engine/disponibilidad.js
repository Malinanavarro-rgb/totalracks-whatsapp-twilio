/**
 * TARA Matrix™ — agenda-engine/disponibilidad.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Agenda Universal (Fase 1) — cálculo de ocupación y huecos libres.
 * Funciones puras, sin I/O: reciben citas/horario ya cargados y devuelven
 * números. No conocen "clienta" ni "técnica" — eso vive en la capa de
 * experiencia (agenda-config + recomendaciones.js).
 *
 * Reutiliza `horaLocalAUTC` de modules/scheduling-engine.js (ya exportado,
 * lectura únicamente — cero cambios al Core congelado) para convertir las
 * horas de pared del horario laboral al mismo instante UTC que usan
 * `citas.inicio`/`citas.fin`, evitando reimplementar la conversión de zona
 * horaria que ya se validó en producción (Anexo A).
 *
 * @module modules/agenda-engine/disponibilidad
 */

'use strict';

const { horaLocalAUTC } = require('../scheduling-engine');

// Estados que "ocupan" el horario de un recurso — cancelada/no_show liberan
// el espacio, igual que ya asume SchedulingEngine (CITAS_ACTIVAS).
const ESTADOS_OCUPAN = ['agendada', 'confirmada', 'completada'];

function _citasActivas(citas) {
  return (citas || []).filter(c => ESTADOS_OCUPAN.includes(c.estado));
}

function limitesJornada(horario, fecha) {
  const base = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  return {
    inicioJornada: horaLocalAUTC(base, horario.hora_inicio, horario.zona_horaria),
    finJornada:    horaLocalAUTC(base, horario.hora_fin, horario.zona_horaria),
    descanso: (horario.hora_inicio_descanso && horario.hora_fin_descanso) ? {
      inicio: horaLocalAUTC(base, horario.hora_inicio_descanso, horario.zona_horaria),
      fin:    horaLocalAUTC(base, horario.hora_fin_descanso, horario.zona_horaria),
    } : null,
  };
}

/**
 * Ocupación de un solo recurso (asesor) en un día — minutos de jornada
 * (menos comida) vs. minutos realmente ocupados por citas activas.
 */
function calcularOcupacionRecurso(citas, horario, fecha) {
  if (!horario) return { minutosJornada: 0, minutosOcupados: 0, ocupacionPct: 0 };

  const { inicioJornada, finJornada, descanso } = limitesJornada(horario, fecha);
  let minutosJornada = Math.max(0, (finJornada - inicioJornada) / 60000);
  if (descanso) minutosJornada -= Math.max(0, (descanso.fin - descanso.inicio) / 60000);

  const minutosOcupados = _citasActivas(citas).reduce((acc, c) => {
    return acc + Math.max(0, (new Date(c.fin) - new Date(c.inicio)) / 60000);
  }, 0);

  return {
    minutosJornada,
    minutosOcupados,
    ocupacionPct: minutosJornada > 0 ? Math.round((minutosOcupados / minutosJornada) * 100) : 0,
  };
}

/**
 * Ocupación agregada de varios recursos (el % que se muestra en la barra
 * de mando). `recursos`: [{ citas, horario, fecha }].
 */
function calcularOcupacion(recursos) {
  let totalJornada = 0, totalOcupado = 0;
  for (const r of recursos || []) {
    const { minutosJornada, minutosOcupados } = calcularOcupacionRecurso(r.citas, r.horario, r.fecha);
    totalJornada += minutosJornada;
    totalOcupado += minutosOcupados;
  }
  return totalJornada > 0 ? Math.round((totalOcupado / totalJornada) * 100) : 0;
}

/**
 * Huecos libres reales de un recurso en un día: jornada laboral menos
 * comida menos citas activas — devuelto como intervalos contiguos (no
 * partidos en slots de duración fija, a diferencia de
 * SchedulingEngine.consultarDisponibilidad, que sirve para "encontrar un
 * horario", no para "ver el hueco completo").
 * @returns {Array<{inicio: Date, fin: Date, minutos: number}>}
 */
function obtenerHuecos(citas, horario, fecha) {
  if (!horario) return [];
  const { inicioJornada, finJornada, descanso } = limitesJornada(horario, fecha);

  const bloqueadas = _citasActivas(citas)
    .map(c => ({ inicio: new Date(c.inicio), fin: new Date(c.fin) }))
    .filter(b => b.fin > inicioJornada && b.inicio < finJornada);
  if (descanso) bloqueadas.push(descanso);
  bloqueadas.sort((a, b) => a.inicio - b.inicio);

  const huecos = [];
  let cursor = inicioJornada;
  for (const b of bloqueadas) {
    if (b.fin <= cursor) continue;
    if (b.inicio > cursor) {
      const finGap = b.inicio < finJornada ? b.inicio : finJornada;
      if (finGap > cursor) huecos.push({ inicio: cursor, fin: finGap });
    }
    if (b.fin > cursor) cursor = b.fin;
    if (cursor >= finJornada) break;
  }
  if (cursor < finJornada) huecos.push({ inicio: cursor, fin: finJornada });

  return huecos
    .map(h => ({ ...h, minutos: Math.round((h.fin - h.inicio) / 60000) }))
    .filter(h => h.minutos > 0);
}

module.exports = {
  ESTADOS_OCUPAN,
  limitesJornada,
  calcularOcupacionRecurso,
  calcularOcupacion,
  obtenerHuecos,
};
