/**
 * TARA Matrix™ — Tests: Calendar Provider Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - Contrato de la interfaz CalendarProvider
 *   - MockCalendarProvider: consultarDisponibilidad, crearEvento,
 *     actualizarEvento, cancelarEvento
 */

'use strict';

const { CalendarProvider }     = require('../adapters/calendar/calendar-provider');
const { MockCalendarProvider } = require('../adapters/calendar/mock-calendar-provider');

// ═════════════════════════════════════════════════════════════════════════════
// INTERFAZ BASE — CalendarProvider
// ═════════════════════════════════════════════════════════════════════════════

describe('CalendarProvider — contrato de interfaz', () => {
  let base;
  beforeEach(() => { base = new CalendarProvider(); });

  test('nombre lanza error si no está implementado', () => {
    expect(() => base.nombre).toThrow('debe implementar nombre');
  });

  test('consultarDisponibilidad() lanza error si no está implementado', async () => {
    await expect(base.consultarDisponibilidad({})).rejects.toThrow('debe implementar consultarDisponibilidad()');
  });

  test('crearEvento() lanza error si no está implementado', async () => {
    await expect(base.crearEvento({})).rejects.toThrow('debe implementar crearEvento()');
  });

  test('actualizarEvento() lanza error si no está implementado', async () => {
    await expect(base.actualizarEvento('id', {})).rejects.toThrow('debe implementar actualizarEvento()');
  });

  test('cancelarEvento() lanza error si no está implementado', async () => {
    await expect(base.cancelarEvento('id')).rejects.toThrow('debe implementar cancelarEvento()');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MOCK CALENDAR PROVIDER
// ═════════════════════════════════════════════════════════════════════════════

describe('MockCalendarProvider', () => {
  let provider;
  beforeEach(() => { provider = new MockCalendarProvider(); });

  describe('nombre', () => {
    test('devuelve "mock-calendar"', () => {
      expect(provider.nombre).toBe('mock-calendar');
    });
  });

  describe('crearEvento()', () => {
    test('crea un evento y devuelve un id', async () => {
      const evento = await provider.crearEvento({
        calendarioId: 'cal-1',
        titulo:       'Cita de prueba',
        inicio:       new Date('2026-07-10T10:00:00Z'),
        fin:          new Date('2026-07-10T10:30:00Z'),
      });

      expect(evento.id).toBeDefined();
    });

    test('dos eventos creados tienen ids distintos', async () => {
      const params = {
        calendarioId: 'cal-1',
        titulo:       'Cita',
        inicio:       new Date('2026-07-10T10:00:00Z'),
        fin:          new Date('2026-07-10T10:30:00Z'),
      };
      const e1 = await provider.crearEvento(params);
      const e2 = await provider.crearEvento(params);
      expect(e1.id).not.toBe(e2.id);
    });
  });

  describe('consultarDisponibilidad()', () => {
    test('no devuelve nada si no hay eventos', async () => {
      const bloques = await provider.consultarDisponibilidad({
        calendarioId: 'cal-1',
        desde: new Date('2026-07-10T00:00:00Z'),
        hasta: new Date('2026-07-11T00:00:00Z'),
      });
      expect(bloques).toEqual([]);
    });

    test('devuelve los eventos que caen dentro de la ventana solicitada', async () => {
      await provider.crearEvento({
        calendarioId: 'cal-1',
        titulo:       'Cita dentro de ventana',
        inicio:       new Date('2026-07-10T10:00:00Z'),
        fin:          new Date('2026-07-10T10:30:00Z'),
      });
      await provider.crearEvento({
        calendarioId: 'cal-1',
        titulo:       'Cita fuera de ventana',
        inicio:       new Date('2026-08-01T10:00:00Z'),
        fin:          new Date('2026-08-01T10:30:00Z'),
      });

      const bloques = await provider.consultarDisponibilidad({
        calendarioId: 'cal-1',
        desde: new Date('2026-07-10T00:00:00Z'),
        hasta: new Date('2026-07-11T00:00:00Z'),
      });

      expect(bloques).toHaveLength(1);
      expect(bloques[0].inicio).toEqual(new Date('2026-07-10T10:00:00Z'));
    });

    test('filtra por calendarioId — no mezcla calendarios distintos', async () => {
      await provider.crearEvento({
        calendarioId: 'cal-1',
        titulo:       'Cita cal-1',
        inicio:       new Date('2026-07-10T10:00:00Z'),
        fin:          new Date('2026-07-10T10:30:00Z'),
      });
      await provider.crearEvento({
        calendarioId: 'cal-2',
        titulo:       'Cita cal-2',
        inicio:       new Date('2026-07-10T11:00:00Z'),
        fin:          new Date('2026-07-10T11:30:00Z'),
      });

      const bloques = await provider.consultarDisponibilidad({
        calendarioId: 'cal-1',
        desde: new Date('2026-07-10T00:00:00Z'),
        hasta: new Date('2026-07-11T00:00:00Z'),
      });

      expect(bloques).toHaveLength(1);
    });
  });

  describe('actualizarEvento()', () => {
    test('actualiza los campos de un evento existente', async () => {
      const { id } = await provider.crearEvento({
        calendarioId: 'cal-1',
        titulo:       'Original',
        inicio:       new Date('2026-07-10T10:00:00Z'),
        fin:          new Date('2026-07-10T10:30:00Z'),
      });

      await provider.actualizarEvento(id, { titulo: 'Reagendada' });

      const bloques = await provider.consultarDisponibilidad({
        calendarioId: 'cal-1',
        desde: new Date('2026-07-10T00:00:00Z'),
        hasta: new Date('2026-07-11T00:00:00Z'),
      });
      expect(bloques).toHaveLength(1);
    });

    test('lanza error si el evento no existe', async () => {
      await expect(provider.actualizarEvento('no-existe', {}))
        .rejects.toThrow('no existe');
    });
  });

  describe('cancelarEvento()', () => {
    test('elimina el evento de la disponibilidad', async () => {
      const { id } = await provider.crearEvento({
        calendarioId: 'cal-1',
        titulo:       'Cita',
        inicio:       new Date('2026-07-10T10:00:00Z'),
        fin:          new Date('2026-07-10T10:30:00Z'),
      });

      await provider.cancelarEvento(id);

      const bloques = await provider.consultarDisponibilidad({
        calendarioId: 'cal-1',
        desde: new Date('2026-07-10T00:00:00Z'),
        hasta: new Date('2026-07-11T00:00:00Z'),
      });
      expect(bloques).toEqual([]);
    });

    test('lanza error si el evento no existe', async () => {
      await expect(provider.cancelarEvento('no-existe'))
        .rejects.toThrow('no existe');
    });
  });

  describe('shouldFail', () => {
    test('todos los métodos lanzan error cuando shouldFail=true', async () => {
      const failProvider = new MockCalendarProvider({ shouldFail: true });

      await expect(failProvider.crearEvento({})).rejects.toThrow('fallo forzado');
      await expect(failProvider.consultarDisponibilidad({ calendarioId: 'x', desde: new Date(), hasta: new Date() }))
        .rejects.toThrow('fallo forzado');
    });
  });
});
