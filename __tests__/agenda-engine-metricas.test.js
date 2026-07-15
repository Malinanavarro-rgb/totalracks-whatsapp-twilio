'use strict';

const { calcularMetricasDia } = require('../modules/agenda-engine/metricas');

const HORARIO = {
  hora_inicio: '09:00:00', hora_fin: '19:00:00',
  hora_inicio_descanso: '14:00:00', hora_fin_descanso: '15:00:00',
  zona_horaria: 'America/Monterrey',
};
const FECHA = new Date('2026-07-20T00:00:00Z');
const UMBRALES = {
  citas_seguidas_saturacion: 4, minutos_tiempo_muerto: 90, margen_retraso_minutos: 5,
  minutos_riesgo_anticipacion: 30, hueco_insertable_min: 30, hueco_insertable_max: 60, no_show_minutos: 15,
};

function horaMty(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 6, 20, h + 6, m, 0));
}

describe('agenda-engine/metricas', () => {
  test('dineroGenerado y tiempoPromedioServicio siempre son "no_disponible" en Fase 1 — nunca se inventan', () => {
    const r = calcularMetricasDia([{ citas: [], horario: HORARIO, fecha: FECHA }], horaMty('11:00'), UMBRALES);
    expect(r.dineroGenerado).toBe('no_disponible');
    expect(r.tiempoPromedioServicio).toBe('no_disponible');
  });

  test('sin citas que hayan empezado todavía, puntualidad es 100% (nada que juzgar)', () => {
    const citas = [{ id: 1, inicio: horaMty('15:00').toISOString(), fin: horaMty('15:45').toISOString(), estado: 'agendada' }];
    const r = calcularMetricasDia([{ citas, horario: HORARIO, fecha: FECHA }], horaMty('11:00'), UMBRALES);
    expect(r.puntualidadAproxPct).toBe(100);
  });

  test('una cita retrasada de dos consideradas da 50% de puntualidad', () => {
    const citas = [
      // inicia 11:00, ahora 11:03 → dentro del margen (5 min), no cuenta como retrasada
      { id: 1, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'confirmada' },
      // inicia 10:30, ahora 11:03 → 33 min tarde, sigue agendada → retrasada
      { id: 2, inicio: horaMty('10:30').toISOString(), fin: horaMty('11:00').toISOString(), estado: 'agendada' },
    ];
    const r = calcularMetricasDia([{ citas, horario: HORARIO, fecha: FECHA }], horaMty('11:03'), UMBRALES);
    expect(r.puntualidadAproxPct).toBe(50);
  });

  test('citasRestantes cuenta activas cuyo fin todavía no pasó', () => {
    const citas = [
      { id: 1, inicio: horaMty('09:00').toISOString(), fin: horaMty('09:45').toISOString(), estado: 'completada' },
      { id: 2, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'agendada' },
      { id: 3, inicio: horaMty('15:00').toISOString(), fin: horaMty('15:45').toISOString(), estado: 'confirmada' },
      { id: 4, inicio: horaMty('16:00').toISOString(), fin: horaMty('16:30').toISOString(), estado: 'cancelada' },
    ];
    const r = calcularMetricasDia([{ citas, horario: HORARIO, fecha: FECHA }], horaMty('11:10'), UMBRALES);
    expect(r.citasRestantes).toBe(2); // la 2 (en curso/retrasada) + la 3, no la completada ni la cancelada
  });

  test('ocupacionPct se calcula reusando disponibilidad.calcularOcupacion', () => {
    const citas = [{ id: 1, inicio: horaMty('09:00').toISOString(), fin: horaMty('09:45').toISOString(), estado: 'agendada' }];
    const r = calcularMetricasDia([{ citas, horario: HORARIO, fecha: FECHA }], horaMty('11:00'), UMBRALES);
    expect(r.ocupacionPct).toBe(8); // 45/540 ≈ 8%
  });
});
