'use strict';

const { obtenerMetricas } = require('../modules/dashboard');

// ─── Mock Builder ─────────────────────────────────────────────────────────────
// Mismo patrón thenable que scheduling-engine.test.js/auth.test.js, extendido
// para soportar el estilo `{count:'exact', head:true}` que usa dashboard.js.

function crearBuilder(resultado = { data: null, error: null, count: 0 }) {
  const builder = {
    select:  jest.fn().mockReturnThis(),
    eq:      jest.fn().mockReturnThis(),
    in:      jest.fn().mockReturnThis(),
    not:     jest.fn().mockReturnThis(),
    gte:     jest.fn().mockReturnThis(),
    lte:     jest.fn().mockReturnThis(),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const db = {
    from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null, count: 0 })),
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

// El orden de las 9 llamadas internas de Promise.all (ver modules/dashboard.js):
// 1. conversaciones (activa, select cliente_id)
// 2. conversaciones (hoy, count)
// 3. clientes (nuevos, count)
// 4. clientes (atendido_por='ia', count)
// 5. clientes (atendido_por='humano', count)
// 6. decision_logs (latencia_ms, select)
// 7. citas (futuras, count)
// 8. decision_logs (errores, count)
// 9. citas (sin confirmar, count)

describe('dashboard.obtenerMetricas()', () => {
  test('calcula las 8 métricas a partir de datos reales', async () => {
    const db = crearMockDb(
      { data: [{ cliente_id: 1 }, { cliente_id: 2 }, { cliente_id: 1 }], error: null }, // activas: 2 únicos
      { data: null, error: null, count: 5 },   // atendidas hoy
      { data: null, error: null, count: 3 },   // clientes nuevos
      { data: null, error: null, count: 10 },  // ia
      { data: null, error: null, count: 0 },   // humano
      { data: [{ latencia_ms: 100 }, { latencia_ms: 200 }], error: null }, // tiempo promedio
      { data: null, error: null, count: 4 },   // citas futuras
      { data: null, error: null, count: 1 },   // errores recientes
      { data: null, error: null, count: 2 },   // citas sin confirmar
    );

    const metricas = await obtenerMetricas(db, COMPANY_A);

    expect(metricas.conversacionesActivas).toBe(2);
    expect(metricas.conversacionesAtendidasHoy).toBe(5);
    expect(metricas.clientesNuevos).toBe(3);
    expect(metricas.atendidoPorIA).toBe(10);
    expect(metricas.atendidoPorHumano).toBe(0);
    expect(metricas.tiempoPromedioRespuestaMs).toBe(150);
    expect(metricas.citasAgendadas).toBe(4);
    expect(metricas.alertas).toEqual([
      { tipo: 'error_tecnico', mensaje: '1 error(es) técnico(s) en las últimas 24h' },
      { tipo: 'cita_sin_confirmar', mensaje: '2 cita(s) próxima(s) sin confirmar' },
    ]);
  });

  test('sin datos, devuelve ceros/null y sin alertas (no rompe con empresa nueva)', async () => {
    const db = crearMockDb(
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
    );

    const metricas = await obtenerMetricas(db, COMPANY_A);

    expect(metricas.conversacionesActivas).toBe(0);
    expect(metricas.tiempoPromedioRespuestaMs).toBeNull();
    expect(metricas.alertas).toEqual([]);
  });

  test('errores de Supabase en cualquier query no tumban el dashboard (degrada a 0/null)', async () => {
    const db = crearMockDb(
      { data: null, error: new Error('boom') },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom') },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
    );

    const metricas = await obtenerMetricas(db, COMPANY_A);

    expect(metricas.conversacionesActivas).toBe(0);
    expect(metricas.conversacionesAtendidasHoy).toBe(0);
    expect(metricas.tiempoPromedioRespuestaMs).toBeNull();
    expect(metricas.alertas).toEqual([]);
  });

  test('filtra siempre por company_id en cada tabla consultada (aislamiento multiempresa)', async () => {
    const db = crearMockDb(
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
    );

    await obtenerMetricas(db, COMPANY_A);

    const tablasConsultadas = db.from.mock.calls.map(c => c[0]);
    expect(tablasConsultadas).toEqual([
      'conversaciones', 'conversaciones', 'clientes', 'clientes', 'clientes',
      'decision_logs', 'citas', 'decision_logs', 'citas',
    ]);
  });
});
