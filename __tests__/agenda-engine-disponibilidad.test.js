'use strict';

const {
  calcularOcupacionRecurso,
  calcularOcupacion,
  obtenerHuecos,
} = require('../modules/agenda-engine/disponibilidad');

// Mismo horario real sembrado para Sugar Salon (migraciones 053/054):
// lunes 09:00-19:00 America/Monterrey (UTC-6, sin DST), comida 14:00-15:00.
const HORARIO = {
  hora_inicio: '09:00:00',
  hora_fin:    '19:00:00',
  hora_inicio_descanso: '14:00:00',
  hora_fin_descanso:    '15:00:00',
  zona_horaria: 'America/Monterrey',
};

const FECHA = new Date('2026-07-20T00:00:00Z'); // lunes

// 09:00 Monterrey = 15:00 UTC (offset fijo -6)
function horaMty(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 6, 20, h + 6, m, 0));
}

describe('agenda-engine/disponibilidad', () => {
  describe('calcularOcupacionRecurso()', () => {
    test('jornada de 10h menos 1h de comida = 9h (540 min) disponibles, sin citas', () => {
      const r = calcularOcupacionRecurso([], HORARIO, FECHA);
      expect(r.minutosJornada).toBe(540);
      expect(r.minutosOcupados).toBe(0);
      expect(r.ocupacionPct).toBe(0);
    });

    test('cuenta solo citas activas (ignora canceladas y no_show)', () => {
      const citas = [
        { inicio: horaMty('09:00').toISOString(), fin: horaMty('09:45').toISOString(), estado: 'agendada' },
        { inicio: horaMty('10:00').toISOString(), fin: horaMty('10:45').toISOString(), estado: 'completada' },
        { inicio: horaMty('11:00').toISOString(), fin: horaMty('12:00').toISOString(), estado: 'cancelada' },
        { inicio: horaMty('12:00').toISOString(), fin: horaMty('12:30').toISOString(), estado: 'no_show' },
      ];
      const r = calcularOcupacionRecurso(citas, HORARIO, FECHA);
      expect(r.minutosOcupados).toBe(90); // 45 + 45, las otras dos no cuentan
    });

    test('sin horario (recurso sin horarios_laborales) devuelve todo en cero', () => {
      const r = calcularOcupacionRecurso([], null, FECHA);
      expect(r).toEqual({ minutosJornada: 0, minutosOcupados: 0, ocupacionPct: 0 });
    });
  });

  describe('calcularOcupacion() — agregado de varios recursos', () => {
    test('promedia proporcionalmente entre recursos con distinta carga', () => {
      const citasA = [{ inicio: horaMty('09:00').toISOString(), fin: horaMty('09:45').toISOString(), estado: 'agendada' }];
      const citasB = [];
      const pct = calcularOcupacion([
        { citas: citasA, horario: HORARIO, fecha: FECHA },
        { citas: citasB, horario: HORARIO, fecha: FECHA },
      ]);
      // (45 + 0) / (540 + 540) = 4.16% ≈ 4%
      expect(pct).toBe(4);
    });

    test('arreglo vacío no lanza y da 0%', () => {
      expect(calcularOcupacion([])).toBe(0);
    });
  });

  describe('obtenerHuecos()', () => {
    test('sin citas, el único hueco es toda la jornada menos la comida', () => {
      const huecos = obtenerHuecos([], HORARIO, FECHA);
      expect(huecos).toHaveLength(2);
      expect(huecos[0].minutos).toBe(300); // 09:00-14:00
      expect(huecos[1].minutos).toBe(240); // 15:00-19:00
    });

    test('detecta un hueco de 45 min entre dos citas (caso del wireframe: 16:30-17:15)', () => {
      const citas = [
        { inicio: horaMty('15:15').toISOString(), fin: horaMty('16:00').toISOString(), estado: 'agendada' },
        { inicio: horaMty('17:15').toISOString(), fin: horaMty('18:00').toISOString(), estado: 'agendada' },
      ];
      const huecos = obtenerHuecos(citas, HORARIO, FECHA);
      const huecoDelMedio = huecos.find(h => h.minutos === 75); // 16:00-17:15
      expect(huecoDelMedio).toBeDefined();
    });

    test('una cita cancelada no bloquea el hueco', () => {
      const citas = [
        { inicio: horaMty('15:00').toISOString(), fin: horaMty('15:45').toISOString(), estado: 'cancelada' },
      ];
      const huecos = obtenerHuecos(citas, HORARIO, FECHA);
      const tardeCompleta = huecos.find(h => h.minutos === 240); // 15:00-19:00, sin descontar la cancelada
      expect(tardeCompleta).toBeDefined();
    });

    test('jornada 100% ocupada (sin comida configurada) no devuelve huecos', () => {
      const horarioSinComida = { hora_inicio: '09:00:00', hora_fin: '10:00:00', zona_horaria: 'America/Monterrey' };
      const citas = [{ inicio: horaMty('09:00').toISOString(), fin: horaMty('10:00').toISOString(), estado: 'agendada' }];
      const huecos = obtenerHuecos(citas, horarioSinComida, FECHA);
      expect(huecos).toEqual([]);
    });

    test('sin horario devuelve arreglo vacío', () => {
      expect(obtenerHuecos([], null, FECHA)).toEqual([]);
    });
  });
});
