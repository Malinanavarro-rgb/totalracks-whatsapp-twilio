'use strict';

const {
  detectarRetrasos,
  detectarSaturacion,
  detectarTiempoMuerto,
  detectarRiesgoTarde,
  detectarHuecosInsertables,
  detectarNoShowCandidatos,
} = require('../modules/agenda-engine/alertas');

const HORARIO = {
  hora_inicio: '09:00:00', hora_fin: '19:00:00',
  hora_inicio_descanso: '14:00:00', hora_fin_descanso: '15:00:00',
  zona_horaria: 'America/Monterrey',
};
const FECHA = new Date('2026-07-20T00:00:00Z');
const UMBRALES = {
  citas_seguidas_saturacion: 4,
  minutos_tiempo_muerto: 90,
  margen_retraso_minutos: 5,
  minutos_riesgo_anticipacion: 30,
  hueco_insertable_min: 30,
  hueco_insertable_max: 60,
  no_show_minutos: 15,
};

function horaMty(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 6, 20, h + 6, m, 0));
}

describe('agenda-engine/alertas', () => {
  describe('detectarRetrasos()', () => {
    test('marca retraso cuando ahora pasa de inicio + margen y sigue agendada', () => {
      const citas = [{ id: 1, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'agendada' }];
      const ahora = horaMty('11:08'); // 8 min tarde, margen es 5
      const r = detectarRetrasos(citas, ahora, UMBRALES);
      expect(r).toHaveLength(1);
      expect(r[0].minutosRetraso).toBe(8);
    });

    test('no marca retraso dentro del margen', () => {
      const citas = [{ id: 1, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'agendada' }];
      const ahora = horaMty('11:03');
      expect(detectarRetrasos(citas, ahora, UMBRALES)).toHaveLength(0);
    });

    test('no marca retraso si ya está completada (alguien la avanzó)', () => {
      const citas = [{ id: 1, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'completada' }];
      const ahora = horaMty('11:20');
      expect(detectarRetrasos(citas, ahora, UMBRALES)).toHaveLength(0);
    });

    test('el umbral (margen_retraso_minutos) viene de config, no está hardcodeado', () => {
      const citas = [{ id: 1, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'agendada' }];
      const ahora = horaMty('11:08');
      expect(detectarRetrasos(citas, ahora, UMBRALES)).toHaveLength(1);
      expect(detectarRetrasos(citas, ahora, { ...UMBRALES, margen_retraso_minutos: 20 })).toHaveLength(0);
    });
  });

  describe('detectarSaturacion()', () => {
    function citasSeguidas(n) {
      const citas = [];
      let t = horaMty('10:30');
      for (let i = 0; i < n; i++) {
        const fin = new Date(t.getTime() + 40 * 60000);
        citas.push({ id: i, inicio: t.toISOString(), fin: fin.toISOString(), estado: 'agendada' });
        t = fin;
      }
      return citas;
    }

    test('detecta una racha de 6 citas seguidas (umbral 4)', () => {
      const r = detectarSaturacion(citasSeguidas(6), UMBRALES);
      expect(r).toHaveLength(1);
      expect(r[0].cantidad).toBe(6);
    });

    test('no marca nada con solo 3 citas seguidas (bajo el umbral)', () => {
      expect(detectarSaturacion(citasSeguidas(3), UMBRALES)).toHaveLength(0);
    });

    test('el umbral (citas_seguidas_saturacion) viene de config: 6 citas no saturan con umbral 8', () => {
      const r = detectarSaturacion(citasSeguidas(6), { ...UMBRALES, citas_seguidas_saturacion: 8 });
      expect(r).toHaveLength(0);
    });

    test('un hueco grande entre citas rompe la racha', () => {
      const citas = [
        ...citasSeguidas(4),
        { id: 99, inicio: horaMty('16:00').toISOString(), fin: horaMty('16:40').toISOString(), estado: 'agendada' },
      ];
      const r = detectarSaturacion(citas, UMBRALES);
      expect(r).toHaveLength(1); // solo la racha de 4, la suelta de las 16:00 no cuenta
      expect(r[0].cantidad).toBe(4);
    });
  });

  describe('detectarTiempoMuerto()', () => {
    test('marca huecos de 90+ minutos', () => {
      const huecos = [{ inicio: horaMty('10:00'), fin: horaMty('12:00'), minutos: 120 }, { inicio: horaMty('16:00'), fin: horaMty('16:20'), minutos: 20 }];
      const r = detectarTiempoMuerto(huecos, UMBRALES);
      expect(r).toHaveLength(1);
      expect(r[0].minutos).toBe(120);
    });

    test('el umbral (minutos_tiempo_muerto) viene de config', () => {
      const huecos = [{ inicio: horaMty('10:00'), fin: horaMty('11:00'), minutos: 60 }];
      expect(detectarTiempoMuerto(huecos, UMBRALES)).toHaveLength(0);
      expect(detectarTiempoMuerto(huecos, { ...UMBRALES, minutos_tiempo_muerto: 45 })).toHaveLength(1);
    });
  });

  describe('detectarRiesgoTarde()', () => {
    test('sin retraso acumulado, no hay riesgo aunque la última cita termine justo a tiempo', () => {
      const citas = [{ id: 1, inicio: horaMty('18:00').toISOString(), fin: horaMty('19:00').toISOString(), estado: 'agendada' }];
      const r = detectarRiesgoTarde(citas, HORARIO, FECHA, horaMty('17:00'), UMBRALES);
      expect(r).toHaveLength(0);
    });

    test('con retraso acumulado que empuja la última cita más allá del cierre, marca riesgo', () => {
      const citas = [
        { id: 1, inicio: horaMty('18:00').toISOString(), fin: horaMty('18:45').toISOString(), estado: 'agendada' },
      ];
      // ahora son las 18:20 y la cita de las 18:00 sigue "agendada" → 20 min de retraso
      // 18:45 (fin programado) + 20 min retraso = 19:05, pasa la hora de cierre (19:00)
      const r = detectarRiesgoTarde(citas, HORARIO, FECHA, horaMty('18:20'), UMBRALES);
      expect(r).toHaveLength(1);
      expect(r[0].minutosExceso).toBe(5);
    });

    test('sin citas activas, no hay riesgo', () => {
      expect(detectarRiesgoTarde([], HORARIO, FECHA, horaMty('18:20'), UMBRALES)).toHaveLength(0);
    });
  });

  describe('detectarHuecosInsertables()', () => {
    const servicios = [
      { id: 's1', nombre: 'Manicure exprés', duracion_minutos: 30, activo: true },
      { id: 's2', nombre: 'Uñas acrílicas', duracion_minutos: 90, activo: true },
      { id: 's3', nombre: 'Servicio descontinuado', duracion_minutos: 20, activo: false },
    ];

    test('un hueco de 45 min sí alcanza para el manicure exprés (30 min)', () => {
      const huecos = [{ inicio: horaMty('16:30'), fin: horaMty('17:15'), minutos: 45 }];
      const r = detectarHuecosInsertables(huecos, servicios, UMBRALES);
      expect(r).toHaveLength(1);
      expect(r[0].serviciosQueCaben.map(s => s.id)).toEqual(['s1']);
    });

    test('un hueco de 120 min está fuera del rango insertable (min 30, max 60) — es tiempo muerto, no hueco rápido', () => {
      const huecos = [{ inicio: horaMty('10:00'), fin: horaMty('12:00'), minutos: 120 }];
      expect(detectarHuecosInsertables(huecos, servicios, UMBRALES)).toHaveLength(0);
    });

    test('ignora servicios inactivos', () => {
      const huecos = [{ inicio: horaMty('16:30'), fin: horaMty('16:50'), minutos: 20 }];
      expect(detectarHuecosInsertables(huecos, servicios, UMBRALES)).toHaveLength(0);
    });
  });

  describe('detectarNoShowCandidatos()', () => {
    test('marca candidata pasado el umbral de no_show_minutos', () => {
      const citas = [{ id: 1, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'agendada' }];
      const r = detectarNoShowCandidatos(citas, horaMty('11:20'), UMBRALES);
      expect(r).toHaveLength(1);
      expect(r[0].minutosSinLlegar).toBe(20);
    });

    test('no marca no-show dentro del margen de simple retraso', () => {
      const citas = [{ id: 1, inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), estado: 'agendada' }];
      expect(detectarNoShowCandidatos(citas, horaMty('11:08'), UMBRALES)).toHaveLength(0);
    });
  });
});
