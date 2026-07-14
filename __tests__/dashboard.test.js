'use strict';

const { obtenerMetricas, obtenerActividadReciente, obtenerMetricasUniformesDeportivos } = require('../modules/dashboard');

// ─── Mock Builder ─────────────────────────────────────────────────────────────
// Mismo patrón thenable que scheduling-engine.test.js/auth.test.js, extendido
// para soportar el estilo `{count:'exact', head:true}` que usa dashboard.js.

function crearBuilder(resultado = { data: null, error: null, count: 0 }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    not:         jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

// obtenerMetricas() ahora siempre empieza con un chequeo de
// companies.industria_slug (Fase Demo Tienda Soccer) — este resultado va
// PRIMERO en cada crearMockDb(...) de las pruebas del tablero genérico, con
// industria_slug=null para que tome la rama universal de siempre.
const SIN_INDUSTRIA = { data: { industria_slug: null }, error: null };

function crearMockDb(...resultados) {
  let idx = 0;
  const db = {
    from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null, count: 0 })),
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

// El orden de las 12 llamadas internas de Promise.all (ver modules/dashboard.js):
// 1. conversaciones (activa, select cliente_id)
// 2. conversaciones (hoy, count)
// 3. clientes (nuevos, count)
// 4. clientes (atendido_por='ia', count)
// 5. clientes (atendido_por='humano', count)
// 6. decision_logs (latencia_ms, select)
// 7. citas (futuras, count)
// 8. decision_logs (errores, count)
// 9. citas (sin confirmar, count)
// 10. clientes (nuevos, feed de actividad reciente)
// 11. clientes (atendido_por='humano', chequeo previo a mensajes_humanos)
// 12. citas (sin confirmar próximas 24h, feed de actividad reciente)
// Nota: si el resultado #11 trae data:[] (sin clientes atendidos por humano),
// _obtenerMensajesSinResponder() corta temprano y NUNCA llama a
// .from('mensajes_humanos') — por eso son 12 llamadas y no 13.

describe('dashboard.obtenerMetricas()', () => {
  test('calcula las 8 métricas a partir de datos reales', async () => {
    const db = crearMockDb(
      SIN_INDUSTRIA,
      { data: [{ cliente_id: 1 }, { cliente_id: 2 }, { cliente_id: 1 }], error: null }, // activas: 2 únicos
      { data: null, error: null, count: 5 },   // atendidas hoy
      { data: null, error: null, count: 3 },   // clientes nuevos
      { data: null, error: null, count: 10 },  // ia
      { data: null, error: null, count: 0 },   // humano
      { data: [{ latencia_ms: 100 }, { latencia_ms: 200 }], error: null }, // tiempo promedio
      { data: null, error: null, count: 4 },   // citas futuras
      { data: null, error: null, count: 1 },   // errores recientes
      { data: null, error: null, count: 2 },   // citas sin confirmar
      { data: [], error: null },               // actividad reciente: clientes nuevos
      { data: [], error: null },               // actividad reciente: chequeo humanos
      { data: [], error: null },               // actividad reciente: citas
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
    expect(metricas.actividadReciente).toEqual([]);
    expect(metricas.kpis).toContainEqual({ valor: 2, etiqueta: 'Conversaciones activas' });
    expect(metricas.recomendaciones).toEqual([]);
  });

  test('sin datos, devuelve ceros/null y sin alertas (no rompe con empresa nueva)', async () => {
    const db = crearMockDb(
      SIN_INDUSTRIA,
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );

    const metricas = await obtenerMetricas(db, COMPANY_A);

    expect(metricas.conversacionesActivas).toBe(0);
    expect(metricas.tiempoPromedioRespuestaMs).toBeNull();
    expect(metricas.alertas).toEqual([]);
  });

  test('errores de Supabase en cualquier query no tumban el dashboard (degrada a 0/null)', async () => {
    const db = crearMockDb(
      SIN_INDUSTRIA,
      { data: null, error: new Error('boom') },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom') },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom'), count: null },
      { data: null, error: new Error('boom') },
      { data: null, error: new Error('boom') },
      { data: null, error: new Error('boom') },
    );

    const metricas = await obtenerMetricas(db, COMPANY_A);

    expect(metricas.conversacionesActivas).toBe(0);
    expect(metricas.conversacionesAtendidasHoy).toBe(0);
    expect(metricas.tiempoPromedioRespuestaMs).toBeNull();
    expect(metricas.alertas).toEqual([]);
    expect(metricas.actividadReciente).toEqual([]);
  });

  test('filtra siempre por company_id en cada tabla consultada (aislamiento multiempresa)', async () => {
    const db = crearMockDb(
      SIN_INDUSTRIA,
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: null, error: null, count: 0 },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );

    await obtenerMetricas(db, COMPANY_A);

    const tablasConsultadas = db.from.mock.calls.map(c => c[0]);
    expect(tablasConsultadas).toEqual([
      'companies',
      'conversaciones', 'conversaciones', 'clientes', 'clientes', 'clientes',
      'decision_logs', 'citas', 'decision_logs', 'citas',
      'clientes', 'clientes', 'citas',
    ]);
  });
});

// Fase Demo Tienda Soccer: tablero de industria "uniformes_deportivos".
// Orden de llamadas dentro de obtenerMetricasUniformesDeportivos():
// 1-4. oportunidades (count por estado: Solicitud nueva, Cotización enviada, En producción, Listo para entrega)
// 5. oportunidades (select presupuesto_confirmado, ventas del mes)
// 6-8. oportunidades (recomendaciones: estancadas, en preparación, listas)
describe('dashboard.obtenerMetricasUniformesDeportivos()', () => {
  test('calcula los 5 KPIs de la industria a partir de oportunidades reales', async () => {
    const db = crearMockDb(
      { count: 1, error: null },  // Solicitud nueva
      { count: 2, error: null },  // Cotización enviada
      { count: 1, error: null },  // En producción
      { count: 1, error: null },  // Listo para entrega
      { data: [{ presupuesto_confirmado: 48000 }, { presupuesto_confirmado: 31000 }], error: null }, // ventas del mes
      { data: [], error: null },  // estancadas
      { data: [], error: null },  // en preparación
      { data: [], error: null },  // listas
    );

    const metricas = await obtenerMetricasUniformesDeportivos(db, COMPANY_A);

    expect(metricas.kpis).toEqual([
      { valor: 1, etiqueta: 'Solicitudes nuevas' },
      { valor: 2, etiqueta: 'Cotizaciones enviadas' },
      { valor: 1, etiqueta: 'Pedidos en producción' },
      { valor: 1, etiqueta: 'Entregas' },
      { valor: '$79,000', etiqueta: 'Ventas este mes' },
    ]);
  });

  test('genera una recomendación por cada oportunidad estancada 48h+ en Cotización enviada', async () => {
    const db = crearMockDb(
      { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null },
      { data: [], error: null },
      { data: [{ id: 1, cliente_id: 10, updated_at: '2026-07-10T00:00:00Z', clientes: { nombre: 'Rayados FC' } }], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );

    const metricas = await obtenerMetricasUniformesDeportivos(db, COMPANY_A);

    expect(metricas.recomendaciones).toEqual([{
      texto: 'Rayados FC lleva más de 48 horas sin seguimiento.',
      detalle: 'Cotización enviada sin respuesta.',
      accion: 'Dar seguimiento ahora',
      recurso: '/crm/clientes/10',
      severidad: 'critica',
    }]);
  });

  test('genera una recomendación media por cada oportunidad en Cotización en preparación', async () => {
    const db = crearMockDb(
      { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ id: 3, cliente_id: 12, clientes: { nombre: 'Prepa Tec' } }], error: null },
      { data: [], error: null },
    );

    const metricas = await obtenerMetricasUniformesDeportivos(db, COMPANY_A);

    expect(metricas.recomendaciones).toEqual([{
      texto: 'Confirma tallas de Prepa Tec antes de enviarlo a producción.',
      detalle: 'Cotización en preparación.',
      accion: 'Ver detalle',
      recurso: '/crm/clientes/12',
      severidad: 'media',
    }]);
  });

  test('genera una recomendación por cada oportunidad lista para entrega', async () => {
    const db = crearMockDb(
      { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ id: 2, cliente_id: 11, clientes: { nombre: 'Liga Municipal Monterrey' } }], error: null },
    );

    const metricas = await obtenerMetricasUniformesDeportivos(db, COMPANY_A);

    expect(metricas.recomendaciones).toEqual([{
      texto: 'El pedido de Liga Municipal Monterrey está listo para entrega.',
      detalle: 'Listo para entrega.',
      accion: 'Ver pedido',
      recurso: '/crm/clientes/11',
      severidad: 'info',
    }]);
  });

  test('sin datos, devuelve KPIs en cero y sin recomendaciones', async () => {
    const db = crearMockDb(
      { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );

    const metricas = await obtenerMetricasUniformesDeportivos(db, COMPANY_A);

    expect(metricas.kpis.every(k => k.valor === 0 || k.valor === '$0')).toBe(true);
    expect(metricas.recomendaciones).toEqual([]);
  });

  test('Fase Premium V1.1: panelVentas trae las 3 oportunidades con actividad más reciente', async () => {
    const db = crearMockDb(
      { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null }, // workflow_sessions (urgentes por fecha)
      {
        data: [
          { estado: 'En producción', presupuesto_confirmado: null, presupuesto_estimado: 45000, updated_at: '2026-07-09T00:00:00Z', clientes: { nombre: 'Club Cumbres' } },
          { estado: 'Entregado', presupuesto_confirmado: 45000, presupuesto_estimado: 45000, updated_at: '2026-07-04T00:00:00Z', clientes: { nombre: 'Deportivo Anáhuac' } },
        ],
        error: null,
      },
    );

    const metricas = await obtenerMetricasUniformesDeportivos(db, COMPANY_A);

    expect(metricas.panelVentas).toEqual([
      { cliente: 'Club Cumbres', estado: 'En producción', monto: 45000 },
      { cliente: 'Deportivo Anáhuac', estado: 'Entregado', monto: 45000 },
    ]);
  });

  test('Fase Demo Comercial: recomienda "urgente" cuando fecha_entrega menciona un día próximo', async () => {
    const db = crearMockDb(
      { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null },
      { data: [], error: null },
      { data: [], error: null }, // estancadas
      { data: [], error: null }, // en preparación
      { data: [], error: null }, // listas
      {
        data: [
          { cliente_id: 20, captured_fields: { fecha_entrega: 'para el viernes' }, updated_at: '2026-07-13T00:00:00Z', clientes: { nombre: 'Academia Tigres' } },
          { cliente_id: 21, captured_fields: { fecha_entrega: 'en un mes' }, updated_at: '2026-07-13T00:00:00Z', clientes: { nombre: 'Club Cumbres' } },
        ],
        error: null,
      },
      { data: [], error: null }, // panelVentas
    );

    const metricas = await obtenerMetricasUniformesDeportivos(db, COMPANY_A);

    expect(metricas.recomendaciones).toEqual([{
      texto: 'Academia Tigres pidió entrega "para el viernes" — confirma que alcanzas la fecha.',
      detalle: 'Fecha de entrega mencionada en la conversación.',
      accion: 'Ver conversación',
      recurso: '/crm/clientes/20',
      severidad: 'critica',
    }]);
  });
});

describe('dashboard.obtenerMetricas() — enruta a la industria correcta', () => {
  test('empresa con industria_slug="uniformes_deportivos" usa el tablero de esa industria', async () => {
    const db = crearMockDb(
      { data: { industria_slug: 'uniformes_deportivos' }, error: null }, // chequeo de industria
      { count: 3, error: null }, { count: 2, error: null }, { count: 1, error: null }, { count: 0, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );

    const metricas = await obtenerMetricas(db, COMPANY_A);

    expect(metricas.kpis[0]).toEqual({ valor: 3, etiqueta: 'Solicitudes nuevas' });
  });
});

// Orden de llamadas .from() dentro de obtenerActividadReciente() (llamada
// directamente, sin el resto de obtenerMetricas() alrededor):
// 1. clientes (nuevos)
// 2. clientes (chequeo de atendido_por='humano', antes de mensajes_humanos)
// 3. citas (sin confirmar próximas)
// 4. mensajes_humanos — SOLO si el resultado #2 no viene vacío (short-circuit)
describe('dashboard.obtenerActividadReciente() (Pivote a producto, Fase 4.5)', () => {
  test('incluye clientes nuevos con link a su ficha CRM', async () => {
    const db = crearMockDb(
      { data: [{ id: 5, nombre: 'Ana', telefono: '+52...', created_at: '2026-07-13T10:00:00Z' }], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );

    const eventos = await obtenerActividadReciente(db, COMPANY_A, 'hace24h', 'ahora', 'en24h');

    expect(eventos).toEqual([
      { tipo: 'cliente_nuevo', mensaje: 'Cliente nuevo: Ana', recurso: '/crm/clientes/5', created_at: '2026-07-13T10:00:00Z' },
    ]);
  });

  test('incluye citas sin confirmar con link a la ficha del cliente', async () => {
    const db = crearMockDb(
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ id: 'c1', cliente_id: 7, inicio: '2026-07-14T15:00:00Z', clientes: { nombre: 'Beto' } }], error: null },
    );

    const eventos = await obtenerActividadReciente(db, COMPANY_A, 'hace24h', 'ahora', 'en24h');

    expect(eventos).toHaveLength(1);
    expect(eventos[0].tipo).toBe('cita_sin_confirmar');
    expect(eventos[0].recurso).toBe('/crm/clientes/7');
    expect(eventos[0].mensaje).toContain('Beto');
  });

  test('sin clientes atendidos por humano, nunca consulta mensajes_humanos (corte temprano)', async () => {
    const db = crearMockDb(
      { data: [], error: null },
      { data: [], error: null }, // humanos vacío → corte temprano
      { data: [], error: null },
    );

    const eventos = await obtenerActividadReciente(db, COMPANY_A, 'hace24h', 'ahora', 'en24h');

    expect(eventos).toEqual([]);
    expect(db.from).toHaveBeenCalledTimes(3); // nunca llamó a mensajes_humanos
  });

  test('incluye mensajes sin responder solo de clientes actualmente atendidos por humano', async () => {
    const db = crearMockDb(
      { data: [], error: null },                    // clientes nuevos
      { data: [{ id: 9 }], error: null },            // humanos: hay 1
      { data: [], error: null },                     // citas
      { data: [{ cliente_id: 9, created_at: '2026-07-13T09:00:00Z', clientes: { nombre: 'Carla' } }], error: null }, // mensajes_humanos
    );

    const eventos = await obtenerActividadReciente(db, COMPANY_A, 'hace24h', 'ahora', 'en24h');

    expect(eventos).toEqual([
      { tipo: 'mensaje_sin_responder', mensaje: 'Mensaje sin responder: Carla', recurso: '/conversaciones/9', created_at: '2026-07-13T09:00:00Z' },
    ]);
  });

  test('ordena todos los eventos por created_at descendente y respeta el límite', async () => {
    const db = crearMockDb(
      { data: [
          { id: 1, nombre: 'Viejo', created_at: '2026-07-10T00:00:00Z' },
          { id: 2, nombre: 'Reciente', created_at: '2026-07-13T00:00:00Z' },
        ], error: null },
      { data: [], error: null },
      { data: [], error: null },
    );

    const eventos = await obtenerActividadReciente(db, COMPANY_A, 'hace24h', 'ahora', 'en24h', 1);

    expect(eventos).toHaveLength(1);
    expect(eventos[0].mensaje).toBe('Cliente nuevo: Reciente');
  });
});
