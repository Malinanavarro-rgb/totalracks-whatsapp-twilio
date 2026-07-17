'use strict';

const { calcularEstadoDelDia } = require('../modules/agenda-engine/index');

// ─── Mock Builder — dispatcha por nombre de tabla, no por posición ───────────
// (los mocks posicionales son frágiles para un orquestador con un número
// variable de llamadas según cuántos asesores/reglas apliquen — ver nota de
// esta sesión sobre "Jest mock-builder positional ordering").

function crearMockDb(resolvers) {
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => {
      const filtros = {};
      let payloadInsert = null;
      const builder = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn((p) => { payloadInsert = p; return builder; }),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn((k, v) => { filtros[k] = v; return builder; }),
        is: jest.fn((k, v) => { filtros[k] = v; return builder; }),
        in: jest.fn((k, v) => { filtros[k] = v; return builder; }),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
      };
      const resolver = () => {
        const ctx = { filtros, insert: payloadInsert };
        llamadas.push({ tabla, ...ctx });
        const fn = resolvers[tabla];
        return fn ? fn(ctx) : { data: null, error: null };
      };
      builder.maybeSingle = jest.fn(() => Promise.resolve(resolver()));
      builder.single = jest.fn(() => Promise.resolve(resolver()));
      builder.then = (resolve) => resolve(resolver());
      return builder;
    }),
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const COMPANY_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const FECHA = new Date('2026-07-20T00:00:00Z'); // lunes

function horaMty(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 6, 20, h + 6, m, 0));
}

const HORARIO = {
  hora_inicio: '09:00:00', hora_fin: '19:00:00',
  hora_inicio_descanso: '14:00:00', hora_fin_descanso: '15:00:00',
  zona_horaria: 'America/Monterrey',
};

const CONFIG_SALON = {
  terminologia: {
    recurso: { singular: 'Técnica', plural: 'Técnicas' },
    bloque: { singular: 'Cita', plural: 'Citas' },
    contacto: { singular: 'Clienta', plural: 'Clientas' },
  },
  umbrales: {
    citas_seguidas_saturacion: 4, minutos_tiempo_muerto: 90, margen_retraso_minutos: 5,
    minutos_riesgo_anticipacion: 30, hueco_insertable_min: 30, hueco_insertable_max: 60, no_show_minutos: 15,
  },
  reglas_prioritarias: ['retraso', 'saturacion', 'tiempo_muerto', 'riesgo_tarde', 'hueco_insertable', 'no_show_candidato'],
};

let contadorEventos;
beforeEach(() => { contadorEventos = 0; });

function resolversBase({ asesoresPorCompany, citasPorCompany, configPorCompany, historialPorCliente = {}, altaPorCliente = {}, serviciosPorCompany = {} }) {
  return {
    agenda_config: (ctx) => {
      const config = configPorCompany[ctx.filtros.company_id];
      return { data: config ? { company_id: ctx.filtros.company_id, schema_version: 1, config } : null, error: null };
    },
    asesores: (ctx) => ({ data: asesoresPorCompany[ctx.filtros.company_id] || [], error: null }),
    citas: (ctx) => {
      // .in('cliente_id', [...]) → consulta de historial completo. Sin ese
      // filtro → consulta de "citas de hoy" (la de siempre).
      if (ctx.filtros.cliente_id) {
        const idsPedidos = ctx.filtros.cliente_id;
        const todas = Object.values(historialPorCliente).flat();
        return { data: todas.filter(c => idsPedidos.includes(c.cliente_id)), error: null };
      }
      return { data: citasPorCompany[ctx.filtros.company_id] || [], error: null };
    },
    clientes: (ctx) => {
      const idsPedidos = ctx.filtros.id || [];
      return { data: idsPedidos.map(id => ({ id, created_at: altaPorCliente[id] || null })), error: null };
    },
    servicios: (ctx) => ({ data: serviciosPorCompany[ctx.filtros.company_id] || [], error: null }),
    horarios_laborales: (ctx) => {
      if ('asesor_id' in ctx.filtros && ctx.filtros.asesor_id !== null) return { data: null, error: null }; // sin horario propio
      return { data: HORARIO, error: null }; // fallback general
    },
    agenda_eventos: (ctx) => {
      if (ctx.insert) return { data: { id: `evt-${++contadorEventos}`, ...ctx.insert }, error: null };
      return { data: null, error: null }; // dedup: nunca hay uno pendiente ya en estos tests
    },
  };
}

describe('agenda-engine/index — calcularEstadoDelDia()', () => {
  test('caso base: una cita retrasada produce una recomendación con evento_id persistido', async () => {
    // "ahora" real (Date.now()) no se puede fijar dentro del motor sin inyectar
    // reloj — construimos la cita para que SIEMPRE esté retrasada respecto al
    // reloj real usando una fecha pasada reciente relativa a la ejecución del test.
    const haceRato = new Date(Date.now() - 10 * 60000);
    const dentroDePoco = new Date(Date.now() - 1 * 60000);
    const db = crearMockDb(resolversBase({
      asesoresPorCompany: { [COMPANY_A]: [{ id: 'a1', nombre: 'Ana Martínez' }] },
      citasPorCompany: {
        [COMPANY_A]: [{
          id: 'c1', asesor_id: 'a1', estado: 'agendada',
          inicio: haceRato.toISOString(), fin: dentroDePoco.toISOString(),
          clientes: { nombre: 'Valeria Cruz' },
        }],
      },
      configPorCompany: { [COMPANY_A]: CONFIG_SALON },
    }));

    const estado = await calcularEstadoDelDia(db, COMPANY_A, FECHA);

    // Una sola cita corta en medio de un día de 9h también deja huecos
    // reales de tiempo muerto antes/después — correcto, no es un bug del
    // fixture. Se busca específicamente la recomendación de retraso.
    const retraso = estado.recomendaciones.find(r => r.tipo_regla === 'retraso');
    expect(retraso).toBeDefined();
    expect(retraso.texto).toContain('Valeria Cruz');
    expect(retraso.evento_id).toMatch(/^evt-/);
    expect(estado.metricas.dineroGenerado).toBe('no_disponible');
  });

  test('sin agenda_config (empresa sin fila) usa DEFAULT_AGENDA_CONFIG y no lanza', async () => {
    const db = crearMockDb(resolversBase({
      asesoresPorCompany: { [COMPANY_A]: [] },
      citasPorCompany: { [COMPANY_A]: [] },
      configPorCompany: {}, // sin fila para ninguna empresa
    }));

    const estado = await calcularEstadoDelDia(db, COMPANY_A, FECHA);
    expect(estado.config.terminologia.recurso.singular).toBe('Recurso'); // default genérico, no "Técnica"
    expect(estado.recomendaciones).toEqual([]);
  });

  test('aislamiento por company_id: el estado de A nunca incluye asesores/citas de B', async () => {
    const db = crearMockDb(resolversBase({
      asesoresPorCompany: {
        [COMPANY_A]: [{ id: 'a1', nombre: 'Ana Martínez' }],
        [COMPANY_B]: [{ id: 'b1', nombre: 'Beto Salazar' }],
      },
      citasPorCompany: {
        [COMPANY_A]: [{ id: 'c1', asesor_id: 'a1', estado: 'confirmada', inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), clientes: { nombre: 'Clienta de A' } }],
        [COMPANY_B]: [{ id: 'c2', asesor_id: 'b1', estado: 'confirmada', inicio: horaMty('11:00').toISOString(), fin: horaMty('11:30').toISOString(), clientes: { nombre: 'Cliente de B' } }],
      },
      configPorCompany: { [COMPANY_A]: CONFIG_SALON, [COMPANY_B]: CONFIG_SALON },
    }));

    const estadoA = await calcularEstadoDelDia(db, COMPANY_A, FECHA);

    expect(estadoA.recursos).toHaveLength(1);
    expect(estadoA.recursos[0].asesorId).toBe('a1');
    expect(estadoA.recursos.some(r => r.asesorId === 'b1')).toBe(false);
    expect(JSON.stringify(estadoA.recursos)).not.toContain('Cliente de B');

    // Toda llamada de datos (no la de eventos) debe ir filtrada por COMPANY_A.
    const llamadasDeDatos = db._llamadas.filter(l => l.tabla !== 'agenda_eventos');
    for (const l of llamadasDeDatos) {
      expect(l.filtros.company_id).toBe(COMPANY_A);
    }
  });

  describe('TARA Canvas v3 — densidad, servicios con precio y segmentación', () => {
    function haceDias(dias) {
      return new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
    }

    test('ocupacionPct por recurso, servicios con precio real, y segmentos adjuntos a la clienta', async () => {
      const db = crearMockDb(resolversBase({
        asesoresPorCompany: { [COMPANY_A]: [{ id: 'a1', nombre: 'Ana Martínez' }] },
        citasPorCompany: {
          [COMPANY_A]: [{
            id: 'c1', cliente_id: 'cli-1', asesor_id: 'a1', estado: 'confirmada',
            inicio: horaMty('09:00').toISOString(), fin: horaMty('09:45').toISOString(),
            clientes: { nombre: 'Karla Torres' },
          }],
        },
        configPorCompany: { [COMPANY_A]: CONFIG_SALON },
        serviciosPorCompany: {
          [COMPANY_A]: [{ id: 's1', nombre: 'Manicure exprés', duracion_minutos: 30, precio: 300, activo: true }],
        },
        historialPorCliente: {
          'cli-1': [
            { cliente_id: 'cli-1', inicio: haceDias(54), estado: 'completada' },
            { cliente_id: 'cli-1', inicio: haceDias(36), estado: 'completada' },
            { cliente_id: 'cli-1', inicio: haceDias(18), estado: 'completada' },
          ],
        },
        altaPorCliente: { 'cli-1': haceDias(200) },
      }));

      const estado = await calcularEstadoDelDia(db, COMPANY_A, FECHA);

      // 45 min de cita en una jornada de 540 min (9h - 1h comida) ≈ 8%
      expect(estado.recursos[0].ocupacionPct).toBe(8);
      expect('siguienteEspacio' in estado.recursos[0]).toBe(true);

      expect(estado.servicios).toEqual([{ id: 's1', nombre: 'Manicure exprés', duracion_minutos: 30, precio: 300, activo: true }]);

      const cita = estado.recursos[0].citas[0];
      expect(cita.clientes.segmentos).toContain('leal');
      expect(cita.clientes.factoresValor.visitasCompletadas).toBe(3);
    });

    test('sin cliente_id en la cita (ej. dato viejo): no intenta calcular segmentos ni truena', async () => {
      const db = crearMockDb(resolversBase({
        asesoresPorCompany: { [COMPANY_A]: [{ id: 'a1', nombre: 'Ana Martínez' }] },
        citasPorCompany: {
          [COMPANY_A]: [{ id: 'c1', asesor_id: 'a1', estado: 'confirmada', inicio: horaMty('09:00').toISOString(), fin: horaMty('09:45').toISOString(), clientes: { nombre: 'Sin id' } }],
        },
        configPorCompany: { [COMPANY_A]: CONFIG_SALON },
      }));

      const estado = await calcularEstadoDelDia(db, COMPANY_A, FECHA);
      expect(estado.recursos[0].citas[0].clientes.segmentos).toBeUndefined();
    });
  });
});
