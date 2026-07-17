'use strict';

const { calcularSegmentos } = require('../modules/agenda-engine/valor-cliente');

const AHORA = new Date('2026-07-20T18:00:00Z');

function hace(dias) {
  return new Date(AHORA.getTime() - dias * 24 * 3600 * 1000).toISOString();
}

describe('agenda-engine/valor-cliente', () => {
  test('clienta leal: 3+ visitas completadas cada ~18 días', () => {
    const historial = [
      { inicio: hace(54), estado: 'completada' },
      { inicio: hace(36), estado: 'completada' },
      { inicio: hace(18), estado: 'completada' },
    ];
    const { segmentos, factores } = calcularSegmentos(historial, hace(200), AHORA);
    expect(segmentos).toContain('leal');
    expect(factores.diasEntreVisitas).toBe(18);
    expect(factores.visitasCompletadas).toBe(3);
  });

  test('requiere atención: 3+ de sus últimas citas fueron canceladas o no-show', () => {
    const historial = [
      { inicio: hace(40), estado: 'completada' },
      { inicio: hace(30), estado: 'cancelada' },
      { inicio: hace(20), estado: 'no_show' },
      { inicio: hace(10), estado: 'no_show' },
    ];
    const { segmentos, factores } = calcularSegmentos(historial, hace(200), AHORA);
    expect(segmentos).toContain('requiere_atencion');
    expect(factores.pctAsistencia).toBe(25); // 1 de 4 consideradas
  });

  test('oportunidad: clienta nueva con 0 o 1 visita completada', () => {
    const historial = [{ inicio: hace(5), estado: 'completada' }];
    const { segmentos } = calcularSegmentos(historial, hace(6), AHORA);
    expect(segmentos).toContain('oportunidad');
  });

  test('ocasional: visitas esporádicas sin patrón negativo ni frecuencia alta', () => {
    const historial = [
      { inicio: hace(200), estado: 'completada' },
      { inicio: hace(90), estado: 'completada' },
    ];
    const { segmentos } = calcularSegmentos(historial, hace(400), AHORA);
    expect(segmentos).toEqual(['ocasional']);
  });

  test('sin historial: cuenta como "oportunidad" (clienta nueva), nunca revienta ni inventa otros segmentos', () => {
    const { segmentos, factores } = calcularSegmentos([], null, AHORA);
    expect(segmentos).toEqual(['oportunidad']);
    expect(factores.diasEntreVisitas).toBeNull();
    expect(factores.pctAsistencia).toBeNull();
    expect(factores.antiguedadDias).toBeNull();
  });

  test('nunca calcula Premium ni Promotora — no existen en el catálogo de segmentos', () => {
    const historial = Array.from({ length: 10 }, (_, i) => ({ inicio: hace(10 * (10 - i)), estado: 'completada' }));
    const { segmentos } = calcularSegmentos(historial, hace(400), AHORA);
    expect(segmentos).not.toContain('premium');
    expect(segmentos).not.toContain('promotora');
  });

  test('tieneProximaReservada: true si ya tiene una cita futura después de su última completada', () => {
    const historial = [
      { inicio: hace(20), estado: 'completada' },
      { inicio: '2026-08-01T10:00:00.000Z', estado: 'confirmada' },
    ];
    const { factores } = calcularSegmentos(historial, hace(100), AHORA);
    expect(factores.tieneProximaReservada).toBe(true);
  });

  test('puede pertenecer a más de un segmento a la vez', () => {
    // leal (visitas frecuentes) + requiere_atencion (varias incidencias) no se
    // excluyen mutuamente por diseño — cada regla evalúa su propia condición.
    const historial = [
      { inicio: hace(60), estado: 'completada' },
      { inicio: hace(42), estado: 'completada' },
      { inicio: hace(24), estado: 'completada' },
      { inicio: hace(18), estado: 'cancelada' },
      { inicio: hace(12), estado: 'no_show' },
      { inicio: hace(6), estado: 'no_show' },
    ];
    const { segmentos } = calcularSegmentos(historial, hace(200), AHORA);
    expect(segmentos).toContain('leal');
    expect(segmentos).toContain('requiere_atencion');
  });
});
