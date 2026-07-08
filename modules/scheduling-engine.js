/**
 * TARA Matrix™ — SchedulingEngine (M10)
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de agenda. Lógica pura de disponibilidad, asignación de asesor y
 * anti-doble-reserva — no conoce Google ni ningún proveedor de calendario
 * específico (Anexo A, sección 2.2: puerto + adaptador, mismo molde que
 * AIProvider/ChannelAdapter).
 *
 * La sincronización con el calendario externo (crearEvento/actualizarEvento/
 * cancelarEvento) es best-effort y nunca bloquea la escritura en `citas`:
 * la fila en `citas` es la fuente de verdad operativa: si el proveedor de
 * calendario falla, la cita queda agendada igual, con calendar_event_id null.
 *
 * Anti-doble-reserva en dos capas (Anexo A, sección 2.4):
 *   1. Aplicación: _tieneConflicto() consulta citas activas antes de insertar.
 *   2. Base de datos: índice único parcial idx_citas_sin_doble_reserva —
 *      la última línea de defensa contra condiciones de carrera entre
 *      dos clientes pidiendo el mismo asesor casi al mismo tiempo.
 *
 * No implementado en esta versión (documentado, no improvisado):
 *   - Conversión de zona horaria: horarios_laborales.zona_horaria se
 *     transporta como metadata en los slots devueltos, sin convertir horas.
 *   - "Menor carga" real (conteo de citas por asesor): la asignación
 *     automática usa "primero disponible" en el orden que devuelve la DB.
 *     Ver Anexo A 2.4.1/8 para el criterio completo de asignación futura.
 *
 * @module modules/scheduling-engine
 */

'use strict';

const CITAS_ACTIVAS = ['agendada', 'confirmada', 'reagendada'];

class SchedulingEngine {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   * @param {import('../adapters/calendar/calendar-provider').CalendarProvider} calendarProvider
   */
  constructor(supabase, calendarProvider) {
    this._db       = supabase;
    this._calendar = calendarProvider;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPONIBILIDAD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calcula los horarios libres de un asesor (o de cualquier asesor activo de
   * la empresa si no se especifica) para un día dado.
   *
   * @param {string} company_id
   * @param {Object} params
   * @param {string} [params.asesorId]        - si se omite, evalúa todos los asesores activos
   * @param {Date}   params.fecha             - día a evaluar (se usa su fecha calendario)
   * @param {number} [params.duracionMinutos=30]
   * @returns {Promise<Array<{asesorId: string, inicio: Date, fin: Date, zona_horaria: string}>>}
   */
  async consultarDisponibilidad(company_id, { asesorId, fecha, duracionMinutos = 30 }) {
    if (!company_id || !fecha) return [];

    const asesores = asesorId
      ? [asesorId]
      : await this._obtenerAsesoresActivos(company_id);

    const slots = [];
    for (const id of asesores) {
      const horario = await this._obtenerHorario(company_id, id, fecha.getUTCDay());
      if (!horario) continue;

      const ocupadas = await this._obtenerCitasOcupadas(id, fecha);
      const libres = this._calcularSlotsLibres(horario, ocupadas, fecha, duracionMinutos);
      slots.push(...libres.map(s => ({ ...s, asesorId: id })));
    }

    return slots;
  }

  async _obtenerAsesoresActivos(company_id) {
    const { data, error } = await this._db
      .from('asesores')
      .select('id')
      .eq('company_id', company_id)
      .eq('activo', true);

    if (error) {
      console.warn('⚠️  SchedulingEngine._obtenerAsesoresActivos error:', error.message);
      return [];
    }
    return (data || []).map(a => a.id);
  }

  async _obtenerHorario(company_id, asesorId, diaSemana) {
    const { data: propio, error: errorPropio } = await this._db
      .from('horarios_laborales')
      .select('*')
      .eq('company_id', company_id)
      .eq('asesor_id', asesorId)
      .eq('dia_semana', diaSemana)
      .maybeSingle();

    if (errorPropio) {
      console.warn('⚠️  SchedulingEngine._obtenerHorario error:', errorPropio.message);
      return null;
    }
    if (propio) return propio;

    // Fallback: horario general de la empresa (asesor_id NULL = aplica a todos)
    const { data: general, error: errorGeneral } = await this._db
      .from('horarios_laborales')
      .select('*')
      .eq('company_id', company_id)
      .is('asesor_id', null)
      .eq('dia_semana', diaSemana)
      .maybeSingle();

    if (errorGeneral) {
      console.warn('⚠️  SchedulingEngine._obtenerHorario (general) error:', errorGeneral.message);
      return null;
    }
    return general || null;
  }

  async _obtenerCitasOcupadas(asesorId, fecha) {
    const { data, error } = await this._db
      .from('citas')
      .select('inicio, fin')
      .eq('asesor_id', asesorId)
      .in('estado', CITAS_ACTIVAS);

    if (error) {
      console.warn('⚠️  SchedulingEngine._obtenerCitasOcupadas error:', error.message);
      return [];
    }
    return (data || []).map(c => ({ inicio: new Date(c.inicio), fin: new Date(c.fin) }));
  }

  /**
   * Función pura: dado un horario laboral y las citas ya ocupadas, devuelve
   * los bloques libres del día partidos en incrementos de duracionMinutos.
   * @returns {Array<{inicio: Date, fin: Date, zona_horaria: string}>}
   */
  _calcularSlotsLibres(horario, ocupadas, fecha, duracionMinutos) {
    const base = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));

    const [hIni, mIni] = horario.hora_inicio.split(':').map(Number);
    const [hFin, mFin] = horario.hora_fin.split(':').map(Number);

    const inicioJornada = new Date(base); inicioJornada.setUTCHours(hIni, mIni, 0, 0);
    const finJornada    = new Date(base); finJornada.setUTCHours(hFin, mFin, 0, 0);

    const slots = [];
    const pasoMs = duracionMinutos * 60 * 1000;

    for (let t = inicioJornada.getTime(); t + pasoMs <= finJornada.getTime(); t += pasoMs) {
      const inicioSlot = new Date(t);
      const finSlot     = new Date(t + pasoMs);

      const chocaConOcupada = ocupadas.some(o => inicioSlot < o.fin && finSlot > o.inicio);
      if (!chocaConOcupada) {
        slots.push({ inicio: inicioSlot, fin: finSlot, zona_horaria: horario.zona_horaria });
      }
    }

    return slots;
  }

  async _tieneConflicto(asesorId, inicio, fin) {
    const { data, error } = await this._db
      .from('citas')
      .select('id')
      .eq('asesor_id', asesorId)
      .in('estado', CITAS_ACTIVAS)
      .lt('inicio', fin.toISOString())
      .gt('fin', inicio.toISOString());

    if (error) {
      console.warn('⚠️  SchedulingEngine._tieneConflicto error:', error.message);
      return true; // fail-safe: ante duda de DB, no agendar sobre un posible conflicto
    }
    return (data || []).length > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASIGNACIÓN DE ASESOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resuelve qué asesor asignar cuando el cliente no pidió uno específico.
   * MVP: primero disponible en el orden que devuelve la DB (ver nota de
   * "menor carga" en el encabezado del módulo).
   * @returns {Promise<string|null>} asesorId o null si ninguno está libre
   */
  async _elegirAsesorAutomatico(company_id, inicio, fin) {
    const candidatos = await this._obtenerAsesoresActivos(company_id);

    for (const asesorId of candidatos) {
      const ocupado = await this._tieneConflicto(asesorId, inicio, fin);
      if (!ocupado) return asesorId;
    }
    return null;
  }

  async _obtenerAsesor(asesorId) {
    const { data, error } = await this._db
      .from('asesores')
      .select('*')
      .eq('id', asesorId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD DE CITAS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Agenda una cita. Si no se especifica asesorId, se asigna automáticamente.
   * El cliente nunca ve un estado "sin asignar" — la fila solo se crea una
   * vez resuelta la asignación (Anexo A, 2.5).
   *
   * @param {string} company_id
   * @param {Object} params
   * @param {number} params.clienteId
   * @param {string} [params.asesorId]
   * @param {Date}   params.inicio
   * @param {Date}   params.fin
   * @param {string} [params.origenWorkflowId]
   * @returns {Promise<Object>} la fila de `citas` creada
   */
  async agendarCita(company_id, { clienteId, asesorId, inicio, fin, origenWorkflowId }) {
    let asesorResuelto = asesorId;

    if (!asesorResuelto) {
      asesorResuelto = await this._elegirAsesorAutomatico(company_id, inicio, fin);
      if (!asesorResuelto) {
        throw new Error('SchedulingEngine.agendarCita: no hay asesores disponibles para ese horario');
      }
    } else if (await this._tieneConflicto(asesorResuelto, inicio, fin)) {
      throw new Error('SchedulingEngine.agendarCita: el asesor ya tiene una cita en ese horario');
    }

    const { data: cita, error } = await this._db
      .from('citas')
      .insert({
        company_id,
        cliente_id:         clienteId,
        asesor_id:          asesorResuelto,
        inicio:             inicio.toISOString(),
        fin:                fin.toISOString(),
        estado:             'agendada',
        origen_workflow_id: origenWorkflowId || null,
      })
      .select()
      .single();

    if (error) {
      if (/idx_citas_sin_doble_reserva/.test(error.message)) {
        throw new Error('SchedulingEngine.agendarCita: el asesor ya tiene una cita en ese horario');
      }
      throw new Error(`SchedulingEngine.agendarCita: ${error.message}`);
    }

    return this._sincronizarCalendarioBestEffort(cita, 'crear');
  }

  /**
   * Reagenda una cita existente a un nuevo horario.
   * @param {Object} cita   - fila actual de `citas`
   * @param {Date}   nuevoInicio
   * @param {Date}   nuevoFin
   * @returns {Promise<Object>} la cita actualizada
   */
  async reagendarCita(cita, nuevoInicio, nuevoFin) {
    const { data: actualizada, error } = await this._db
      .from('citas')
      .update({
        inicio:     nuevoInicio.toISOString(),
        fin:        nuevoFin.toISOString(),
        estado:     'reagendada',
        updated_at: new Date().toISOString(),
      })
      .eq('id', cita.id)
      .select()
      .single();

    if (error) {
      if (/idx_citas_sin_doble_reserva/.test(error.message)) {
        throw new Error('SchedulingEngine.reagendarCita: el asesor ya tiene una cita en ese horario');
      }
      throw new Error(`SchedulingEngine.reagendarCita: ${error.message}`);
    }

    return this._sincronizarCalendarioBestEffort(actualizada, 'actualizar');
  }

  /**
   * Cancela una cita existente.
   * @param {Object} cita - fila actual de `citas`
   * @returns {Promise<Object>} la cita actualizada
   */
  async cancelarCita(cita) {
    const { data: cancelada, error } = await this._db
      .from('citas')
      .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
      .eq('id', cita.id)
      .select()
      .single();

    if (error) {
      throw new Error(`SchedulingEngine.cancelarCita: ${error.message}`);
    }

    if (cancelada.calendar_event_id) {
      try {
        const asesor = await this._obtenerAsesor(cancelada.asesor_id);
        if (asesor?.calendario_id) {
          await this._calendar.cancelarEvento(cancelada.calendar_event_id, asesor.calendario_id);
        }
      } catch (err) {
        console.warn('⚠️  SchedulingEngine.cancelarCita — fallo sincronizando calendario:', err.message);
      }
    }

    return cancelada;
  }

  /**
   * Sincroniza la cita con el calendario externo sin bloquear ni fallar la
   * operación de agenda si el proveedor falla (best-effort, ver encabezado).
   */
  async _sincronizarCalendarioBestEffort(cita, modo) {
    const asesor = await this._obtenerAsesor(cita.asesor_id);
    if (!asesor?.calendario_id) return cita;

    try {
      if (modo === 'crear') {
        const evento = await this._calendar.crearEvento({
          calendarioId: asesor.calendario_id,
          titulo:       'Cita agendada — TARA',
          inicio:       new Date(cita.inicio),
          fin:          new Date(cita.fin),
        });
        return await this._actualizarCalendarEventId(cita, evento.id);
      }

      if (modo === 'actualizar' && cita.calendar_event_id) {
        await this._calendar.actualizarEvento(cita.calendar_event_id, {
          calendarioId: asesor.calendario_id,
          inicio:       new Date(cita.inicio),
          fin:          new Date(cita.fin),
        });
      }
    } catch (err) {
      console.warn(`⚠️  SchedulingEngine — fallo sincronizando calendario (${modo}):`, err.message);
    }

    return cita;
  }

  async _actualizarCalendarEventId(cita, calendarEventId) {
    const { data, error } = await this._db
      .from('citas')
      .update({ calendar_event_id: calendarEventId })
      .eq('id', cita.id)
      .select()
      .single();

    if (error) {
      console.warn('⚠️  SchedulingEngine — no se pudo guardar calendar_event_id:', error.message);
      return cita;
    }
    return data;
  }
}

module.exports = { SchedulingEngine };
