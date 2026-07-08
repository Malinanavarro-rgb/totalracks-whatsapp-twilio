'use strict';

const { SchedulingEngine } = require('../modules/scheduling-engine');

// ─── Mock Builder ─────────────────────────────────────────────────────────────
// Simula el cliente de Supabase con API fluida (chainable). A diferencia del
// mock usado en workflow-engine.test.js, este también resuelve cuando se hace
// `await` directo sobre la cadena sin `.single()`/`.maybeSingle()` (thenable),
// igual que el cliente real de supabase-js.

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    lt:          jest.fn().mockReturnThis(),
    gt:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    single:      jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const builders = [];
  const db = {
    from: jest.fn(() => {
      const b = crearBuilder(resultados[idx++] ?? { data: null, error: null });
      builders.push(b);
      return b;
    }),
    _builders: builders,
  };
  return db;
}

function crearMockCalendar() {
  return {
    crearEvento:       jest.fn().mockResolvedValue({ id: 'evt-mock' }),
    actualizarEvento:  jest.fn().mockResolvedValue({ id: 'evt-mock' }),
    cancelarEvento:    jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ASESOR_1   = 'ases0001-0000-0000-0000-000000000001';
const ASESOR_2   = 'ases0002-0000-0000-0000-000000000002';
const CLIENTE_ID = 42;

const FECHA = new Date('2026-07-06T00:00:00Z');

const horario = {
  id:            'hor-1',
  company_id:    COMPANY_A,
  asesor_id:     ASESOR_1,
  dia_semana:    FECHA.getUTCDay(),
  hora_inicio:   '09:00:00',
  hora_fin:      '10:00:00',
  zona_horaria:  'America/Monterrey',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SchedulingEngine', () => {

  // ── consultarDisponibilidad() ──────────────────────────────────────────────

  describe('consultarDisponibilidad()', () => {
    test('devuelve slots libres partidos por duracionMinutos cuando no hay citas ocupadas', async () => {
      const db = crearMockDb(
        { data: horario, error: null }, // horario propio
        { data: [], error: null }       // citas ocupadas
      );
      const engine = new SchedulingEngine(db, crearMockCalendar());

      const slots = await engine.consultarDisponibilidad(COMPANY_A, {
        asesorId: ASESOR_1, fecha: FECHA, duracionMinutos: 30,
      });

      expect(slots).toHaveLength(2);
      expect(slots[0].asesorId).toBe(ASESOR_1);
      expect(slots[0].zona_horaria).toBe('America/Monterrey');
    });

    test('excluye slots que chocan con una cita ya ocupada', async () => {
      const db = crearMockDb(
        { data: horario, error: null },
        {
          data: [{ inicio: '2026-07-06T09:00:00.000Z', fin: '2026-07-06T09:30:00.000Z' }],
          error: null,
        }
      );
      const engine = new SchedulingEngine(db, crearMockCalendar());

      const slots = await engine.consultarDisponibilidad(COMPANY_A, {
        asesorId: ASESOR_1, fecha: FECHA, duracionMinutos: 30,
      });

      expect(slots).toHaveLength(1);
      expect(slots[0].inicio.toISOString()).toBe('2026-07-06T09:30:00.000Z');
    });

    test('devuelve arreglo vacío si no hay horario laboral ese día (ni propio ni general)', async () => {
      const db = crearMockDb(
        { data: null, error: null }, // propio
        { data: null, error: null }  // general
      );
      const engine = new SchedulingEngine(db, crearMockCalendar());

      const slots = await engine.consultarDisponibilidad(COMPANY_A, {
        asesorId: ASESOR_1, fecha: FECHA,
      });

      expect(slots).toEqual([]);
      expect(db.from).toHaveBeenCalledWith('horarios_laborales');
      expect(db.from).not.toHaveBeenCalledWith('citas');
    });

    test('sin asesorId específico, evalúa todos los asesores activos y etiqueta cada slot', async () => {
      const db = crearMockDb(
        { data: [{ id: ASESOR_1 }, { id: ASESOR_2 }], error: null }, // asesores activos
        { data: horario, error: null },                             // horario asesor 1
        { data: [], error: null },                                  // citas asesor 1
        { data: horario, error: null },                             // horario asesor 2
        { data: [], error: null }                                   // citas asesor 2
      );
      const engine = new SchedulingEngine(db, crearMockCalendar());

      const slots = await engine.consultarDisponibilidad(COMPANY_A, { fecha: FECHA, duracionMinutos: 30 });

      expect(slots).toHaveLength(4);
      expect(slots.filter(s => s.asesorId === ASESOR_1)).toHaveLength(2);
      expect(slots.filter(s => s.asesorId === ASESOR_2)).toHaveLength(2);
    });
  });

  // ── agendarCita() ───────────────────────────────────────────────────────────

  describe('agendarCita()', () => {
    test('asigna automáticamente el primer asesor sin conflicto cuando no se especifica asesorId', async () => {
      const citaCreada = { id: 'cita-1', company_id: COMPANY_A, asesor_id: ASESOR_2, calendar_event_id: null };
      const db = crearMockDb(
        { data: [{ id: ASESOR_1 }, { id: ASESOR_2 }], error: null }, // asesores activos
        { data: [{ id: 'conflicto' }], error: null },                // ASESOR_1 ocupado
        { data: [], error: null },                                   // ASESOR_2 libre
        { data: citaCreada, error: null },                           // insert cita
        { data: { id: ASESOR_2, calendario_id: null }, error: null } // asesor sin calendario externo
      );
      const calendar = crearMockCalendar();
      const engine = new SchedulingEngine(db, calendar);

      const resultado = await engine.agendarCita(COMPANY_A, {
        clienteId: CLIENTE_ID,
        inicio: new Date('2026-07-06T09:00:00Z'),
        fin:    new Date('2026-07-06T09:30:00Z'),
      });

      expect(resultado.asesor_id).toBe(ASESOR_2);
      expect(calendar.crearEvento).not.toHaveBeenCalled();
    });

    test('lanza error si el asesor especificado ya tiene conflicto, sin llegar a insertar', async () => {
      const db = crearMockDb(
        { data: [{ id: 'conflicto' }], error: null }, // _tieneConflicto → true
      );
      const engine = new SchedulingEngine(db, crearMockCalendar());

      await expect(engine.agendarCita(COMPANY_A, {
        clienteId: CLIENTE_ID,
        asesorId:  ASESOR_1,
        inicio:    new Date('2026-07-06T09:00:00Z'),
        fin:       new Date('2026-07-06T09:30:00Z'),
      })).rejects.toThrow('el asesor ya tiene una cita en ese horario');

      expect(db.from).toHaveBeenCalledTimes(1);
    });

    test('crea la cita y sincroniza con el calendario cuando el asesor tiene calendario_id', async () => {
      const citaCreada     = { id: 'cita-2', asesor_id: ASESOR_1, calendar_event_id: null };
      const citaSincronizada = { ...citaCreada, calendar_event_id: 'evt-123' };
      const db = crearMockDb(
        { data: [], error: null },                                       // sin conflicto
        { data: citaCreada, error: null },                                // insert cita
        { data: { id: ASESOR_1, calendario_id: 'cal-ext-1' }, error: null }, // asesor con calendario
        { data: citaSincronizada, error: null },                          // update calendar_event_id
      );
      const calendar = crearMockCalendar();
      const engine = new SchedulingEngine(db, calendar);

      const resultado = await engine.agendarCita(COMPANY_A, {
        clienteId: CLIENTE_ID,
        asesorId:  ASESOR_1,
        inicio:    new Date('2026-07-06T09:00:00Z'),
        fin:       new Date('2026-07-06T09:30:00Z'),
      });

      expect(calendar.crearEvento).toHaveBeenCalledWith(expect.objectContaining({ calendarioId: 'cal-ext-1' }));
      expect(resultado.calendar_event_id).toBe('evt-123');
    });

    test('no falla la operación si el calendarProvider lanza error (best-effort)', async () => {
      const citaCreada = { id: 'cita-3', asesor_id: ASESOR_1, calendar_event_id: null };
      const db = crearMockDb(
        { data: [], error: null },
        { data: citaCreada, error: null },
        { data: { id: ASESOR_1, calendario_id: 'cal-ext-1' }, error: null },
      );
      const calendar = crearMockCalendar();
      calendar.crearEvento.mockRejectedValue(new Error('Google caído'));
      const engine = new SchedulingEngine(db, calendar);

      const resultado = await engine.agendarCita(COMPANY_A, {
        clienteId: CLIENTE_ID,
        asesorId:  ASESOR_1,
        inicio:    new Date('2026-07-06T09:00:00Z'),
        fin:       new Date('2026-07-06T09:30:00Z'),
      });

      expect(resultado.id).toBe('cita-3');
      expect(resultado.calendar_event_id).toBeNull();
    });

    test('traduce el error de índice único de DB a un mensaje legible (condición de carrera)', async () => {
      const db = crearMockDb(
        { data: [], error: null }, // sin conflicto detectado en la app
        {
          data: null,
          error: { message: 'duplicate key value violates unique constraint "idx_citas_sin_doble_reserva"' },
        },
      );
      const engine = new SchedulingEngine(db, crearMockCalendar());

      await expect(engine.agendarCita(COMPANY_A, {
        clienteId: CLIENTE_ID,
        asesorId:  ASESOR_1,
        inicio:    new Date('2026-07-06T09:00:00Z'),
        fin:       new Date('2026-07-06T09:30:00Z'),
      })).rejects.toThrow('el asesor ya tiene una cita en ese horario');
    });
  });

  // ── reagendarCita() ─────────────────────────────────────────────────────────

  describe('reagendarCita()', () => {
    test('actualiza inicio/fin y estado, y sincroniza el calendario si hay calendar_event_id', async () => {
      const citaOriginal = { id: 'cita-1', asesor_id: ASESOR_1, calendar_event_id: 'evt-1' };
      const citaActualizada = {
        ...citaOriginal, estado: 'reagendada',
        inicio: '2026-07-07T10:00:00.000Z', fin: '2026-07-07T10:30:00.000Z',
      };
      const db = crearMockDb(
        { data: citaActualizada, error: null },                         // update
        { data: { id: ASESOR_1, calendario_id: 'cal-ext-1' }, error: null }, // asesor
      );
      const calendar = crearMockCalendar();
      const engine = new SchedulingEngine(db, calendar);

      const resultado = await engine.reagendarCita(
        citaOriginal,
        new Date('2026-07-07T10:00:00Z'),
        new Date('2026-07-07T10:30:00Z'),
      );

      expect(resultado.estado).toBe('reagendada');
      expect(calendar.actualizarEvento).toHaveBeenCalledWith('evt-1', expect.objectContaining({ calendarioId: 'cal-ext-1' }));
    });

    test('traduce el error de índice único de DB a un mensaje legible', async () => {
      const db = crearMockDb({
        data: null,
        error: { message: 'duplicate key value violates unique constraint "idx_citas_sin_doble_reserva"' },
      });
      const engine = new SchedulingEngine(db, crearMockCalendar());

      await expect(engine.reagendarCita(
        { id: 'cita-1', asesor_id: ASESOR_1 },
        new Date('2026-07-07T10:00:00Z'),
        new Date('2026-07-07T10:30:00Z'),
      )).rejects.toThrow('el asesor ya tiene una cita en ese horario');
    });
  });

  // ── cancelarCita() ──────────────────────────────────────────────────────────

  describe('cancelarCita()', () => {
    test('actualiza estado a cancelada y cancela el evento en el calendario si existe calendar_event_id', async () => {
      const db = crearMockDb(
        { data: { id: 'cita-1', asesor_id: ASESOR_1, estado: 'cancelada', calendar_event_id: 'evt-1' }, error: null }, // update
        { data: { id: ASESOR_1, calendario_id: 'cal-ext-1' }, error: null },                                          // asesor
      );
      const calendar = crearMockCalendar();
      const engine = new SchedulingEngine(db, calendar);

      const resultado = await engine.cancelarCita({ id: 'cita-1' });

      expect(resultado.estado).toBe('cancelada');
      expect(calendar.cancelarEvento).toHaveBeenCalledWith('evt-1', 'cal-ext-1');
    });

    test('no llama al calendario si la cita no tiene calendar_event_id', async () => {
      const db = crearMockDb({
        data: { id: 'cita-2', estado: 'cancelada', calendar_event_id: null },
        error: null,
      });
      const calendar = crearMockCalendar();
      const engine = new SchedulingEngine(db, calendar);

      await engine.cancelarCita({ id: 'cita-2' });

      expect(calendar.cancelarEvento).not.toHaveBeenCalled();
    });
  });
});
