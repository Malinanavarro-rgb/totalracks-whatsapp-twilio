'use strict';

const mockFreebusyQuery  = jest.fn();
const mockEventsInsert   = jest.fn();
const mockEventsPatch    = jest.fn();
const mockEventsDelete   = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    calendar: jest.fn(() => ({
      freebusy: { query: mockFreebusyQuery },
      events:   { insert: mockEventsInsert, patch: mockEventsPatch, delete: mockEventsDelete },
    })),
  },
}));

const { google } = require('googleapis');
const { GoogleCalendarProvider } = require('../adapters/calendar/google-calendar-provider');

describe('GoogleCalendarProvider', () => {
  let provider;
  const oauth2ClientFake = { credentials: {} };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GoogleCalendarProvider(oauth2ClientFake);
  });

  test('nombre devuelve "google"', () => {
    expect(provider.nombre).toBe('google');
  });

  test('construye el cliente de calendar v3 con el oauth2Client recibido', () => {
    expect(google.calendar).toHaveBeenCalledWith({ version: 'v3', auth: oauth2ClientFake });
  });

  describe('consultarDisponibilidad()', () => {
    test('llama a freebusy.query con la ventana correcta y traduce la respuesta', async () => {
      mockFreebusyQuery.mockResolvedValue({
        data: {
          calendars: {
            'cal-1': {
              busy: [{ start: '2026-07-10T10:00:00.000Z', end: '2026-07-10T10:30:00.000Z' }],
            },
          },
        },
      });

      const bloques = await provider.consultarDisponibilidad({
        calendarioId: 'cal-1',
        desde: new Date('2026-07-10T00:00:00Z'),
        hasta: new Date('2026-07-11T00:00:00Z'),
      });

      expect(mockFreebusyQuery).toHaveBeenCalledWith({
        requestBody: {
          timeMin: '2026-07-10T00:00:00.000Z',
          timeMax: '2026-07-11T00:00:00.000Z',
          items:   [{ id: 'cal-1' }],
        },
      });
      expect(bloques).toEqual([
        { inicio: new Date('2026-07-10T10:00:00.000Z'), fin: new Date('2026-07-10T10:30:00.000Z') },
      ]);
    });

    test('devuelve arreglo vacío si el calendario no tiene bloques ocupados', async () => {
      mockFreebusyQuery.mockResolvedValue({ data: { calendars: { 'cal-1': { busy: [] } } } });

      const bloques = await provider.consultarDisponibilidad({
        calendarioId: 'cal-1',
        desde: new Date('2026-07-10T00:00:00Z'),
        hasta: new Date('2026-07-11T00:00:00Z'),
      });

      expect(bloques).toEqual([]);
    });
  });

  describe('crearEvento()', () => {
    test('llama a events.insert con el body correcto y devuelve el id', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'evt-123' } });

      const resultado = await provider.crearEvento({
        calendarioId: 'cal-1',
        titulo:       'Cita con TARA',
        inicio:       new Date('2026-07-10T10:00:00Z'),
        fin:          new Date('2026-07-10T10:30:00Z'),
        descripcion:  'Nota de la cita',
      });

      expect(mockEventsInsert).toHaveBeenCalledWith({
        calendarId: 'cal-1',
        requestBody: {
          summary:     'Cita con TARA',
          description: 'Nota de la cita',
          start:       { dateTime: '2026-07-10T10:00:00.000Z' },
          end:         { dateTime: '2026-07-10T10:30:00.000Z' },
        },
      });
      expect(resultado).toEqual({ id: 'evt-123' });
    });
  });

  describe('actualizarEvento()', () => {
    test('llama a events.patch con calendarId + eventId correctos', async () => {
      mockEventsPatch.mockResolvedValue({ data: { id: 'evt-123' } });

      const resultado = await provider.actualizarEvento('evt-123', {
        calendarioId: 'cal-1',
        inicio: new Date('2026-07-11T10:00:00Z'),
        fin:    new Date('2026-07-11T10:30:00Z'),
      });

      expect(mockEventsPatch).toHaveBeenCalledWith({
        calendarId: 'cal-1',
        eventId:    'evt-123',
        requestBody: {
          start: { dateTime: '2026-07-11T10:00:00.000Z' },
          end:   { dateTime: '2026-07-11T10:30:00.000Z' },
        },
      });
      expect(resultado).toEqual({ id: 'evt-123' });
    });

    test('solo incluye en requestBody los campos provistos', async () => {
      mockEventsPatch.mockResolvedValue({ data: { id: 'evt-123' } });

      await provider.actualizarEvento('evt-123', { calendarioId: 'cal-1', titulo: 'Nuevo título' });

      expect(mockEventsPatch).toHaveBeenCalledWith({
        calendarId: 'cal-1',
        eventId:    'evt-123',
        requestBody: { summary: 'Nuevo título' },
      });
    });
  });

  describe('cancelarEvento()', () => {
    test('llama a events.delete con calendarId + eventId', async () => {
      mockEventsDelete.mockResolvedValue({});

      await provider.cancelarEvento('evt-123', 'cal-1');

      expect(mockEventsDelete).toHaveBeenCalledWith({ calendarId: 'cal-1', eventId: 'evt-123' });
    });
  });
});
