/**
 * TARA Matrix™ — GoogleCalendarProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Implementación real del puerto CalendarProvider contra la API de Google
 * Calendar v3. No conoce OAuth ni de dónde salen las credenciales — recibe
 * un `oauth2Client` ya autenticado (ver modules/google-auth.js, que es quien
 * arma ese cliente a partir de calendar_credentials por empresa).
 *
 * @module adapters/calendar/google-calendar-provider
 */

'use strict';

const { google } = require('googleapis');
const { CalendarProvider } = require('./calendar-provider');

class GoogleCalendarProvider extends CalendarProvider {
  /**
   * @param {import('google-auth-library').OAuth2Client} oauth2Client - ya autenticado
   */
  constructor(oauth2Client) {
    super();
    this._calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  }

  get nombre() { return 'google'; }

  /**
   * @param {import('./calendar-provider').DisponibilidadParams} params
   * @returns {Promise<import('./calendar-provider').BloqueOcupado[]>}
   */
  async consultarDisponibilidad({ calendarioId, desde, hasta }) {
    const respuesta = await this._calendar.freebusy.query({
      requestBody: {
        timeMin: desde.toISOString(),
        timeMax: hasta.toISOString(),
        items:   [{ id: calendarioId }],
      },
    });

    const ocupados = respuesta.data.calendars?.[calendarioId]?.busy || [];
    return ocupados.map(b => ({ inicio: new Date(b.start), fin: new Date(b.end) }));
  }

  /**
   * @param {import('./calendar-provider').EventoParams} params
   * @returns {Promise<import('./calendar-provider').EventoCreado>}
   */
  async crearEvento({ calendarioId, titulo, inicio, fin, descripcion }) {
    const respuesta = await this._calendar.events.insert({
      calendarId: calendarioId,
      requestBody: {
        summary:     titulo,
        description: descripcion || undefined,
        start:       { dateTime: inicio.toISOString() },
        end:         { dateTime: fin.toISOString() },
      },
    });

    return { id: respuesta.data.id };
  }

  /**
   * @param {string} eventoId
   * @param {Partial<import('./calendar-provider').EventoParams> & {calendarioId: string}} params
   * @returns {Promise<import('./calendar-provider').EventoCreado>}
   */
  async actualizarEvento(eventoId, { calendarioId, titulo, inicio, fin, descripcion }) {
    const requestBody = {};
    if (titulo !== undefined)      requestBody.summary     = titulo;
    if (descripcion !== undefined) requestBody.description = descripcion;
    if (inicio !== undefined)      requestBody.start        = { dateTime: inicio.toISOString() };
    if (fin !== undefined)         requestBody.end          = { dateTime: fin.toISOString() };

    const respuesta = await this._calendar.events.patch({
      calendarId: calendarioId,
      eventId:    eventoId,
      requestBody,
    });

    return { id: respuesta.data.id };
  }

  /**
   * @param {string} eventoId
   * @param {string} calendarioId
   * @returns {Promise<void>}
   */
  async cancelarEvento(eventoId, calendarioId) {
    await this._calendar.events.delete({
      calendarId: calendarioId,
      eventId:    eventoId,
    });
  }
}

module.exports = { GoogleCalendarProvider };
