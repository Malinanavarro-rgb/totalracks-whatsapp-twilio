/**
 * TARA Matrix™ — agenda-engine/valor-cliente.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA Canvas v3 (Etapa A) — segmentación de clientas por comportamiento
 * real, nunca por juicio de valor. Función pura: recibe el historial
 * completo de citas de una clienta (no solo las de hoy) y calcula a qué
 * segmentos pertenece — puede pertenecer a varios a la vez.
 *
 * Premium y Promotora NO se calculan aquí a propósito: Premium necesita
 * ticket real (citas.servicio_id/precio_cobrado, Fase 2, ya autorizada
 * pero no construida) y Promotora necesita rastrear quién refirió a quién
 * (clientes.referida_por, Etapa C, aún no autorizada) — ninguno de los dos
 * existe hoy en el esquema. Se documentan como pendientes en vez de
 * aproximarse con un proxy inventado.
 *
 * @module modules/agenda-engine/valor-cliente
 */

'use strict';

const SEGMENTO_UMBRALES = {
  leal_dias_entre_visitas_max: 25,
  leal_min_visitas: 3,
  atencion_min_incidencias_pct: 0.34,
  atencion_min_citas_consideradas: 3,
  oportunidad_max_visitas: 1,
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * @param {Array<{inicio: string, estado: string}>} historialCitas - TODAS las
 *   citas históricas de la clienta (no solo las de hoy), en esta empresa.
 * @param {string} clienteCreatedAt - clientes.created_at (ISO).
 * @param {Date} ahora
 * @returns {{ segmentos: string[], factores: Object }}
 */
function calcularSegmentos(historialCitas, clienteCreatedAt, ahora) {
  const historial = historialCitas || [];
  const completadas = historial
    .filter(c => c.estado === 'completada')
    .slice()
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  const incidencias = historial.filter(c => c.estado === 'cancelada' || c.estado === 'no_show');
  const totalConsideradas = completadas.length + incidencias.length;
  const pctIncidencias = totalConsideradas > 0 ? incidencias.length / totalConsideradas : 0;
  const pctAsistencia = totalConsideradas > 0 ? 1 - pctIncidencias : null;

  let diasEntreVisitas = null;
  if (completadas.length >= 2) {
    const diffs = [];
    for (let i = 1; i < completadas.length; i++) {
      diffs.push((new Date(completadas[i].inicio) - new Date(completadas[i - 1].inicio)) / MS_POR_DIA);
    }
    diasEntreVisitas = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  const ultimaCompletada = completadas[completadas.length - 1] || null;
  const tieneProximaReservada = ultimaCompletada
    ? historial.some(c =>
        ['agendada', 'confirmada'].includes(c.estado) &&
        new Date(c.inicio).getTime() > new Date(ultimaCompletada.inicio).getTime()
      )
    : historial.some(c => ['agendada', 'confirmada'].includes(c.estado));

  const antiguedadDias = clienteCreatedAt
    ? Math.round((ahora.getTime() - new Date(clienteCreatedAt).getTime()) / MS_POR_DIA)
    : null;

  const segmentos = [];

  if (totalConsideradas >= SEGMENTO_UMBRALES.atencion_min_citas_consideradas && pctIncidencias >= SEGMENTO_UMBRALES.atencion_min_incidencias_pct) {
    segmentos.push('requiere_atencion');
  }
  if (
    completadas.length >= SEGMENTO_UMBRALES.leal_min_visitas &&
    diasEntreVisitas !== null &&
    diasEntreVisitas <= SEGMENTO_UMBRALES.leal_dias_entre_visitas_max
  ) {
    segmentos.push('leal');
  }
  if (completadas.length <= SEGMENTO_UMBRALES.oportunidad_max_visitas) {
    segmentos.push('oportunidad');
  }
  if (completadas.length > 0 && !segmentos.includes('leal') && !segmentos.includes('requiere_atencion') && !segmentos.includes('oportunidad')) {
    segmentos.push('ocasional');
  }

  return {
    segmentos,
    factores: {
      visitasCompletadas: completadas.length,
      diasEntreVisitas: diasEntreVisitas !== null ? Math.round(diasEntreVisitas) : null,
      pctAsistencia: pctAsistencia !== null ? Math.round(pctAsistencia * 100) : null,
      antiguedadDias,
      tieneProximaReservada,
    },
  };
}

module.exports = { SEGMENTO_UMBRALES, calcularSegmentos };
