/**
 * TARA Matrix™ — agenda-engine/alertas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de Agenda Universal (Fase 1) — detección de problemas del día.
 * Todas las funciones son puras (sin I/O, nunca escriben en `citas`/
 * `asesores`) y reciben los umbrales como parámetro — nunca los importan
 * como constante fija (pedido explícito: los umbrales son configurables
 * por empresa vía agenda_config.config.umbrales, ver modules/agenda-config.js).
 *
 * @module modules/agenda-engine/alertas
 */

'use strict';

const { ESTADOS_OCUPAN, limitesJornada } = require('./disponibilidad');

function _activasOrdenadas(citas) {
  return (citas || [])
    .filter(c => ESTADOS_OCUPAN.includes(c.estado))
    .slice()
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}

/**
 * Una cita sigue en agendada/confirmada (nadie la marcó en curso/completada)
 * pasado su horario de inicio + margen — la regla más simple y la que más
 * urgencia comunica: la clienta ya llegó o está por llegar y la técnica
 * sigue con la anterior.
 */
function detectarRetrasos(citas, ahora, umbrales) {
  const margenMs = umbrales.margen_retraso_minutos * 60000;
  return (citas || [])
    .filter(c => ['agendada', 'confirmada'].includes(c.estado))
    .filter(c => ahora.getTime() > new Date(c.inicio).getTime() + margenMs)
    .map(c => ({
      cita: c,
      minutosRetraso: Math.round((ahora.getTime() - new Date(c.inicio).getTime()) / 60000),
    }));
}

/**
 * N o más citas consecutivas sin espacio entre ellas (tolerancia de 5 min
 * para considerarlas "seguidas" — detalle de implementación, no un umbral
 * de negocio como los que sí vive en agenda_config).
 */
const TOLERANCIA_SEGUIDAS_MINUTOS = 5;

function detectarSaturacion(citas, umbrales) {
  const activas = _activasOrdenadas(citas);
  if (activas.length < umbrales.citas_seguidas_saturacion) return [];

  const rachas = [];
  let racha = [activas[0]];
  for (let i = 1; i < activas.length; i++) {
    const gapMin = (new Date(activas[i].inicio) - new Date(activas[i - 1].fin)) / 60000;
    if (gapMin <= TOLERANCIA_SEGUIDAS_MINUTOS) {
      racha.push(activas[i]);
    } else {
      if (racha.length >= umbrales.citas_seguidas_saturacion) rachas.push(racha);
      racha = [activas[i]];
    }
  }
  if (racha.length >= umbrales.citas_seguidas_saturacion) rachas.push(racha);

  return rachas.map(r => ({ citas: r, cantidad: r.length }));
}

/**
 * Huecos (ya calculados por disponibilidad.js::obtenerHuecos) de 90+
 * minutos — tiempo que el recurso pasa sin trabajar, dentro de su propia
 * jornada.
 */
function detectarTiempoMuerto(huecos, umbrales) {
  return (huecos || []).filter(h => h.minutos >= umbrales.minutos_tiempo_muerto);
}

/**
 * Alerta temprana (no cuando ya es tarde): si el retraso ya acumulado hoy
 * empujaría la última cita del recurso más allá de su hora de salida,
 * se marca riesgo — antes de que sea un hecho consumado.
 */
function detectarRiesgoTarde(citas, horario, fecha, ahora, umbrales) {
  const activas = _activasOrdenadas(citas);
  if (activas.length === 0 || !horario) return [];

  const { finJornada } = limitesJornada(horario, fecha);
  const ultima = activas[activas.length - 1];
  const finUltima = new Date(ultima.fin);

  const retrasos = detectarRetrasos(citas, ahora, umbrales);
  const minutosRetrasoTotal = retrasos.reduce((acc, r) => acc + r.minutosRetraso, 0);
  if (minutosRetrasoTotal === 0) return [];

  const finProyectado = new Date(finUltima.getTime() + minutosRetrasoTotal * 60000);
  if (finProyectado <= finJornada) return [];

  return [{
    minutosExceso: Math.round((finProyectado.getTime() - finJornada.getTime()) / 60000),
    minutosRetrasoTotal,
    ultimaCita: ultima,
  }];
}

/**
 * Huecos del tamaño justo para insertar un servicio corto — cruza contra
 * el catálogo real de `servicios` activos (nunca inventa un servicio).
 */
function detectarHuecosInsertables(huecos, servicios, umbrales) {
  const activos = (servicios || []).filter(s => s.activo && s.duracion_minutos);
  if (activos.length === 0) return [];

  return (huecos || [])
    .filter(h => h.minutos >= umbrales.hueco_insertable_min && h.minutos <= umbrales.hueco_insertable_max)
    .map(h => ({
      hueco: h,
      serviciosQueCaben: activos.filter(s => s.duracion_minutos <= h.minutos),
    }))
    .filter(r => r.serviciosQueCaben.length > 0);
}

/**
 * Candidatas a inasistencia — nunca se marca sola (pedido explícito: cero
 * ejecución automática), solo se detecta para que TARA pregunte.
 */
function detectarNoShowCandidatos(citas, ahora, umbrales) {
  const margenMs = umbrales.no_show_minutos * 60000;
  return (citas || [])
    .filter(c => ['agendada', 'confirmada'].includes(c.estado))
    .filter(c => ahora.getTime() > new Date(c.inicio).getTime() + margenMs)
    .map(c => ({
      cita: c,
      minutosSinLlegar: Math.round((ahora.getTime() - new Date(c.inicio).getTime()) / 60000),
    }));
}

module.exports = {
  TOLERANCIA_SEGUIDAS_MINUTOS,
  detectarRetrasos,
  detectarSaturacion,
  detectarTiempoMuerto,
  detectarRiesgoTarde,
  detectarHuecosInsertables,
  detectarNoShowCandidatos,
};
