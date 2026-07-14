'use strict';

const mockInvalidarCache = jest.fn();
jest.mock('../modules/config', () => ({ invalidarCache: mockInvalidarCache }));

const {
  obtenerPersonalidad, actualizarPersonalidad,
  listarKnowledgeBase, crearKnowledgeBase, actualizarKnowledgeBase, eliminarKnowledgeBase,
  listarHorarios, crearHorario, actualizarHorario, eliminarHorario,
  listarHorarioAtencionBot, guardarHorarioAtencionBot, eliminarHorarioAtencionBot,
  listarServicios, crearServicio, actualizarServicio, eliminarServicio,
  listarPipelineEtapas, crearPipelineEtapa, actualizarPipelineEtapa, eliminarPipelineEtapa,
  listarCanales,
  estaDentroDeHorarioAtencion, esPrimerContacto,
} = require('../modules/configuracion');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const db = { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

beforeEach(() => jest.clearAllMocks());

describe('configuracion', () => {
  describe('personalidad', () => {
    test('obtenerPersonalidad() devuelve solo campos de negocio', async () => {
      const db = crearMockDb({ data: { nombre_asistente: 'TARA', tono: 'cálido' }, error: null });
      const resultado = await obtenerPersonalidad(db, COMPANY_A);
      expect(resultado.nombre_asistente).toBe('TARA');
    });

    test('actualizarPersonalidad() solo aplica campos de negocio e invalida la caché', async () => {
      const db = crearMockDb({ data: { tono: 'cercano' }, error: null });
      await actualizarPersonalidad(db, COMPANY_A, { tono: 'cercano', modelo: 'gpt-5', temperatura: 2 });

      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ tono: 'cercano' });
      expect(mockInvalidarCache).toHaveBeenCalledWith(COMPANY_A);
    });

    test('actualizarPersonalidad() 400 si no hay campos válidos', async () => {
      const db = crearMockDb();
      await expect(actualizarPersonalidad(db, COMPANY_A, { modelo: 'gpt-5' }))
        .rejects.toMatchObject({ status: 400 });
    });

    test('actualizarPersonalidad() acepta skills, mensaje_fuera_horario y mensaje_error_tecnico (pivote a producto, Fase 1)', async () => {
      const db = crearMockDb({ data: { skills: [{ nombre: 'agendar citas', activo: true }] }, error: null });
      const cambios = {
        skills: [{ nombre: 'agendar citas', activo: true }],
        mensaje_fuera_horario: 'Volvemos mañana a las 9am',
        mensaje_error_tecnico: 'Ups, algo salió mal',
      };
      await actualizarPersonalidad(db, COMPANY_A, cambios);

      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith(cambios);
    });
  });

  describe('knowledge base', () => {
    test('listarKnowledgeBase() devuelve arreglo vacío en error', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await listarKnowledgeBase(db, COMPANY_A)).toEqual([]);
    });

    test('crearKnowledgeBase() invalida la caché', async () => {
      const db = crearMockDb({ data: { id: 'kb-1' }, error: null });
      await crearKnowledgeBase(db, COMPANY_A, { categoria: 'SERVICIOS', contenido: 'x' });
      expect(mockInvalidarCache).toHaveBeenCalledWith(COMPANY_A);
    });

    test('actualizarKnowledgeBase() invalida la caché', async () => {
      const db = crearMockDb({ data: { id: 'kb-1' }, error: null });
      await actualizarKnowledgeBase(db, COMPANY_A, 'kb-1', { contenido: 'nuevo' });
      expect(mockInvalidarCache).toHaveBeenCalledWith(COMPANY_A);
    });

    test('eliminarKnowledgeBase() invalida la caché', async () => {
      const db = crearMockDb({ error: null });
      await eliminarKnowledgeBase(db, COMPANY_A, 'kb-1');
      expect(mockInvalidarCache).toHaveBeenCalledWith(COMPANY_A);
    });
  });

  describe('horarios laborales (citas)', () => {
    test('crearHorario() inserta con zona horaria default', async () => {
      const db = crearMockDb({ data: { id: 'h1' }, error: null });
      await crearHorario(db, COMPANY_A, { dia_semana: 1, hora_inicio: '09:00', hora_fin: '18:00' });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({ zona_horaria: 'America/Monterrey' })]);
    });

    test('crearHorario() pasa el horario de comida (descanso) cuando se especifica', async () => {
      const db = crearMockDb({ data: { id: 'h1' }, error: null });
      await crearHorario(db, COMPANY_A, {
        dia_semana: 1, hora_inicio: '09:00', hora_fin: '19:00',
        hora_inicio_descanso: '14:00', hora_fin_descanso: '15:00',
      });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({
        hora_inicio_descanso: '14:00', hora_fin_descanso: '15:00',
      })]);
    });

    test('actualizarHorario() solo aplica campos permitidos', async () => {
      const db = crearMockDb({ data: { id: 'h1' }, error: null });
      await actualizarHorario(db, COMPANY_A, 'h1', { hora_inicio: '10:00', otroCampo: 'x' });

      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ hora_inicio: '10:00' });
    });

    test('eliminarHorario() no lanza si tiene éxito', async () => {
      const db = crearMockDb({ error: null });
      await expect(eliminarHorario(db, COMPANY_A, 'h1')).resolves.toBeUndefined();
    });
  });

  describe('horario de atención del bot', () => {
    test('guardarHorarioAtencionBot() usa upsert con onConflict company_id,dia_semana', async () => {
      const db = crearMockDb({ data: { id: 'hb-1', dia_semana: 1 }, error: null });
      await guardarHorarioAtencionBot(db, COMPANY_A, { dia_semana: 1, hora_inicio: '09:00', hora_fin: '19:00' });

      const builder = db.from.mock.results[0].value;
      expect(builder.upsert).toHaveBeenCalledWith(
        [expect.objectContaining({ company_id: COMPANY_A, dia_semana: 1 })],
        { onConflict: 'company_id,dia_semana' }
      );
    });

    test('listarHorarioAtencionBot() devuelve arreglo vacío en error', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await listarHorarioAtencionBot(db, COMPANY_A)).toEqual([]);
    });
  });

  describe('servicios', () => {
    test('crearServicio() aplica duracion_minutos default 30', async () => {
      const db = crearMockDb({ data: { id: 's1' }, error: null });
      await crearServicio(db, COMPANY_A, { nombre: 'Corte' });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({ duracion_minutos: 30, activo: true })]);
    });

    test('actualizarServicio() puede desactivar un servicio', async () => {
      const db = crearMockDb({ data: { id: 's1', activo: false }, error: null });
      const resultado = await actualizarServicio(db, COMPANY_A, 's1', { activo: false });
      expect(resultado.activo).toBe(false);
    });

    test('eliminarServicio() no lanza si tiene éxito', async () => {
      const db = crearMockDb({ error: null });
      await expect(eliminarServicio(db, COMPANY_A, 's1')).resolves.toBeUndefined();
    });

    test('eliminarServicio() lanza si Supabase devuelve error', async () => {
      const db = crearMockDb({ error: new Error('boom') });
      await expect(eliminarServicio(db, COMPANY_A, 's1')).rejects.toThrow('No se pudo eliminar el servicio');
    });
  });

  describe('pipeline de oportunidades (Pivote a producto, Fase 2.2)', () => {
    test('crearPipelineEtapa() aplica orden default 0 y activo=true', async () => {
      const db = crearMockDb({ data: { id: 'pe1' }, error: null });
      await crearPipelineEtapa(db, COMPANY_A, { nombre: 'Negociación' });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([{ company_id: COMPANY_A, nombre: 'Negociación', orden: 0, activo: true }]);
    });

    test('actualizarPipelineEtapa() solo aplica campos permitidos', async () => {
      const db = crearMockDb({ data: { id: 'pe1', activo: false }, error: null });
      const resultado = await actualizarPipelineEtapa(db, COMPANY_A, 'pe1', { activo: false, company_id: 'otra-empresa' });

      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ activo: false });
      expect(resultado.activo).toBe(false);
    });

    test('eliminarPipelineEtapa() no lanza si tiene éxito', async () => {
      const db = crearMockDb({ error: null });
      await expect(eliminarPipelineEtapa(db, COMPANY_A, 'pe1')).resolves.toBeUndefined();
    });

    test('listarPipelineEtapas() devuelve arreglo vacío en error', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await listarPipelineEtapas(db, COMPANY_A)).toEqual([]);
    });
  });

  describe('listarCanales()', () => {
    test('googleCalendar.conectado=true si hay credenciales activas', async () => {
      const db = crearMockDb(
        { data: [{ endpoint: 'whatsapp:+521...', canal: 'whatsapp', activo: true }], error: null },
        { data: { proveedor: 'google', created_at: '2026-01-01' }, error: null },
      );
      const resultado = await listarCanales(db, COMPANY_A);
      expect(resultado.googleCalendar.conectado).toBe(true);
      expect(resultado.canales).toHaveLength(1);
    });

    test('googleCalendar.conectado=false si no hay credenciales', async () => {
      const db = crearMockDb(
        { data: [], error: null },
        { data: null, error: null },
      );
      const resultado = await listarCanales(db, COMPANY_A);
      expect(resultado.googleCalendar).toEqual({ conectado: false });
    });
  });

  describe('estaDentroDeHorarioAtencion()', () => {
    test('sin fila configurada para el día → true (sin restricción, 24/7 default)', async () => {
      const db = crearMockDb({ data: null, error: null });
      const ahora = new Date('2026-07-08T12:00:00Z');
      expect(await estaDentroDeHorarioAtencion(db, COMPANY_A, ahora)).toBe(true);
    });

    test('dentro del horario configurado (zona UTC) → true', async () => {
      const ahora = new Date('2026-07-08T12:00:00Z');
      const db = crearMockDb({
        data: { dia_semana: ahora.getUTCDay(), hora_inicio: '09:00:00', hora_fin: '18:00:00', zona_horaria: 'UTC' },
        error: null,
      });
      expect(await estaDentroDeHorarioAtencion(db, COMPANY_A, ahora)).toBe(true);
    });

    test('fuera del horario configurado (zona UTC) → false', async () => {
      const ahora = new Date('2026-07-08T22:00:00Z');
      const db = crearMockDb({
        data: { dia_semana: ahora.getUTCDay(), hora_inicio: '09:00:00', hora_fin: '18:00:00', zona_horaria: 'UTC' },
        error: null,
      });
      expect(await estaDentroDeHorarioAtencion(db, COMPANY_A, ahora)).toBe(false);
    });

    test('error en la consulta → true (fail-safe, TARA sigue respondiendo)', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await estaDentroDeHorarioAtencion(db, COMPANY_A, new Date())).toBe(true);
    });
  });

  describe('esPrimerContacto()', () => {
    test('true si no hay conversaciones previas', async () => {
      const db = crearMockDb({ data: null, error: null, count: 0 });
      expect(await esPrimerContacto(db, 5)).toBe(true);
    });

    test('false si ya hay conversaciones previas', async () => {
      const db = crearMockDb({ data: null, error: null, count: 3 });
      expect(await esPrimerContacto(db, 5)).toBe(false);
    });

    test('error en la consulta → false (no repite bienvenida de más ante la duda)', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom'), count: null });
      expect(await esPrimerContacto(db, 5)).toBe(false);
    });
  });
});
