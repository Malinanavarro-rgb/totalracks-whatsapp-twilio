'use strict';

const mockCreate = jest.fn();
jest.mock('../modules/clients', () => ({
  openai: { chat: { completions: { create: (...args) => mockCreate(...args) } } },
}));

const mockListarCitas = jest.fn();
const mockReagendarCita = jest.fn();
const mockCancelarCita = jest.fn();
const mockMarcarNoShow = jest.fn();
jest.mock('../modules/agenda', () => ({
  listarCitas: (...args) => mockListarCitas(...args),
  reagendarCita: (...args) => mockReagendarCita(...args),
  cancelarCita: (...args) => mockCancelarCita(...args),
  marcarNoShow: (...args) => mockMarcarNoShow(...args),
}));

const mockResolverEvento = jest.fn();
jest.mock('../modules/agenda-engine/recomendaciones', () => ({
  resolverEvento: (...args) => mockResolverEvento(...args),
}));

const { interpretarComando, confirmarComando, cancelarComando } = require('../modules/agenda-comandos');

// ─── Mock Builder — dispatcha por tabla ──────────────────────────────────────

function crearMockDb(resolvers) {
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => {
      const filtros = {};
      let payloadInsert = null;
      let payloadUpdate = null;
      const builder = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn((p) => { payloadInsert = p; return builder; }),
        update: jest.fn((p) => { payloadUpdate = p; return builder; }),
        eq: jest.fn((k, v) => { filtros[k] = v; return builder; }),
      };
      const resolver = () => {
        const ctx = { filtros, insert: payloadInsert, update: payloadUpdate };
        llamadas.push({ tabla, ...ctx });
        const fn = resolvers[tabla];
        return fn ? fn(ctx) : { data: null, error: null };
      };
      builder.maybeSingle = jest.fn(() => Promise.resolve(resolver()));
      builder.single = jest.fn(() => Promise.resolve(resolver()));
      return builder;
    }),
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USUARIO = { id: 'u-owner', rol: 'owner' };

const CITA_VALERIA = {
  id: 'c1', asesor_id: 'a1', estado: 'agendada',
  inicio: '2026-07-20T17:00:00.000Z', fin: '2026-07-20T17:30:00.000Z',
  clientes: { nombre: 'Valeria Cruz' }, asesores: { nombre: 'Ana Martínez' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListarCitas.mockResolvedValue([CITA_VALERIA]);
});

function mockRespuestaIA(obj) {
  mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(obj) } }] });
}

describe('agenda-comandos', () => {
  describe('interpretarComando()', () => {
    test('intención mutante válida: inserta pendiente_confirmacion y devuelve comando_id + resumen', async () => {
      mockRespuestaIA({
        intencion: 'reagendar_cita',
        entidades: { cita_id: 'c1', nuevo_inicio: '2026-07-20T22:00:00.000Z' },
        resumen: 'Mover la cita de Valeria Cruz de las 11:00 a las 4:00 pm',
      });
      const db = crearMockDb({
        agenda_comandos: (ctx) => ({ data: { id: 'cmd-1', ...ctx.insert }, error: null }),
      });

      const resultado = await interpretarComando(db, COMPANY_A, USUARIO, 'mueve la cita de valeria a las 4');

      expect(resultado).toEqual({ requiere_confirmacion: true, comando_id: 'cmd-1', resumen: 'Mover la cita de Valeria Cruz de las 11:00 a las 4:00 pm' });
      const insertado = db._llamadas[0].insert;
      expect(insertado.company_id).toBe(COMPANY_A);
      expect(insertado.intencion).toBe('reagendar_cita');
      expect(insertado.entidades.nuevo_fin).toBe('2026-07-20T22:30:00.000Z'); // conserva duración original (30 min)
    });

    test('intención "consulta": responde directo, no inserta ninguna fila', async () => {
      mockRespuestaIA({ intencion: 'consulta', entidades: {}, resumen: '', respuesta: 'Tienes 1 cita hoy.' });
      const db = crearMockDb({});

      const resultado = await interpretarComando(db, COMPANY_A, USUARIO, '¿cuántas citas tengo hoy?');

      expect(resultado).toEqual({ requiere_confirmacion: false, respuesta: 'Tienes 1 cita hoy.' });
      expect(db.from).not.toHaveBeenCalled();
    });

    test('cita_id que no existe en las citas de hoy: no se confía en el modelo, no inserta', async () => {
      mockRespuestaIA({
        intencion: 'cancelar_cita',
        entidades: { cita_id: 'c-inventada' },
        resumen: 'Cancelar una cita',
      });
      const db = crearMockDb({});

      const resultado = await interpretarComando(db, COMPANY_A, USUARIO, 'cancela la cita de alguien');

      expect(resultado.requiere_confirmacion).toBe(false);
      expect(db.from).not.toHaveBeenCalled();
    });

    test('no_reconocido: responde con la pregunta de aclaración, no inserta', async () => {
      mockRespuestaIA({ intencion: 'no_reconocido', entidades: {}, resumen: '', respuesta: '¿Podrías darme más detalles?' });
      const db = crearMockDb({});

      const resultado = await interpretarComando(db, COMPANY_A, USUARIO, 'blah blah');

      expect(resultado).toEqual({ requiere_confirmacion: false, respuesta: '¿Podrías darme más detalles?' });
    });

    test('si OpenAI falla, responde honestamente en vez de lanzar', async () => {
      mockCreate.mockRejectedValue(new Error('timeout'));
      const db = crearMockDb({});

      const resultado = await interpretarComando(db, COMPANY_A, USUARIO, 'mueve algo');

      expect(resultado.requiere_confirmacion).toBe(false);
      expect(resultado.respuesta).toMatch(/no pude/i);
    });
  });

  describe('confirmarComando()', () => {
    function dbConComandoPendiente(comando, resolvers = {}) {
      return crearMockDb({
        agenda_comandos: (ctx) => {
          if (ctx.insert) return { data: { id: 'cmd-1', ...ctx.insert }, error: null };
          if (ctx.update) return { data: { id: 'cmd-1', ...comando, ...ctx.update }, error: null };
          return { data: comando, error: null };
        },
        agenda_eventos: (ctx) => resolvers.agenda_eventos ? resolvers.agenda_eventos(ctx) : { data: null, error: null },
      });
    }

    test('reagendar_cita: despacha a modules/agenda.js::reagendarCita con los datos ya persistidos', async () => {
      const comando = {
        id: 'cmd-1', company_id: COMPANY_A, intencion: 'reagendar_cita', estado: 'pendiente_confirmacion',
        entidades: { cita_id: 'c1', nuevo_inicio: '2026-07-20T22:00:00.000Z', nuevo_fin: '2026-07-20T22:30:00.000Z' },
        resumen: 'Mover la cita',
      };
      mockReagendarCita.mockResolvedValue({ id: 'c1', reagendada: true });
      const db = dbConComandoPendiente(comando);

      const resultado = await confirmarComando(db, COMPANY_A, USUARIO, 'cmd-1');

      expect(mockReagendarCita).toHaveBeenCalledWith(db, COMPANY_A, USUARIO, 'c1', new Date('2026-07-20T22:00:00.000Z'), new Date('2026-07-20T22:30:00.000Z'));
      expect(resultado.estado).toBe('ejecutado');
    });

    test('cancelar_cita: despacha a cancelarCita', async () => {
      const comando = { id: 'cmd-1', company_id: COMPANY_A, intencion: 'cancelar_cita', estado: 'pendiente_confirmacion', entidades: { cita_id: 'c1' } };
      mockCancelarCita.mockResolvedValue({ id: 'c1', estado: 'cancelada' });
      const db = dbConComandoPendiente(comando);

      await confirmarComando(db, COMPANY_A, USUARIO, 'cmd-1');

      expect(mockCancelarCita).toHaveBeenCalledWith(db, COMPANY_A, USUARIO, 'c1');
      expect(mockReagendarCita).not.toHaveBeenCalled();
    });

    test('marcar_no_show: despacha a marcarNoShow y resuelve el evento pendiente si existe', async () => {
      const comando = { id: 'cmd-1', company_id: COMPANY_A, intencion: 'marcar_no_show', estado: 'pendiente_confirmacion', entidades: { cita_id: 'c1' } };
      mockMarcarNoShow.mockResolvedValue({ id: 'c1', estado: 'no_show' });
      mockResolverEvento.mockResolvedValue({ id: 'ev1', estado: 'aceptada' });
      const db = dbConComandoPendiente(comando, { agenda_eventos: () => ({ data: { id: 'ev1' }, error: null }) });

      await confirmarComando(db, COMPANY_A, USUARIO, 'cmd-1');

      expect(mockMarcarNoShow).toHaveBeenCalledWith(db, COMPANY_A, USUARIO, 'c1');
      expect(mockResolverEvento).toHaveBeenCalledWith(db, COMPANY_A, 'ev1', expect.objectContaining({ estado: 'aceptada' }));
    });

    test('confirmar_llegada: solo resuelve el evento, sin tocar cancelarCita/reagendarCita', async () => {
      const comando = { id: 'cmd-1', company_id: COMPANY_A, intencion: 'confirmar_llegada', estado: 'pendiente_confirmacion', entidades: { cita_id: 'c1' } };
      mockResolverEvento.mockResolvedValue({ id: 'ev1', estado: 'aceptada' });
      const db = dbConComandoPendiente(comando, { agenda_eventos: () => ({ data: { id: 'ev1' }, error: null }) });

      await confirmarComando(db, COMPANY_A, USUARIO, 'cmd-1');

      expect(mockResolverEvento).toHaveBeenCalled();
      expect(mockCancelarCita).not.toHaveBeenCalled();
      expect(mockReagendarCita).not.toHaveBeenCalled();
      expect(mockMarcarNoShow).not.toHaveBeenCalled();
    });

    test('comando inexistente: 404', async () => {
      const db = crearMockDb({ agenda_comandos: () => ({ data: null, error: null }) });
      await expect(confirmarComando(db, COMPANY_A, USUARIO, 'no-existe')).rejects.toMatchObject({ status: 404 });
    });

    test('comando ya resuelto: 409, no ejecuta nada', async () => {
      const db = crearMockDb({ agenda_comandos: () => ({ data: { id: 'cmd-1', company_id: COMPANY_A, estado: 'ejecutado' }, error: null }) });
      await expect(confirmarComando(db, COMPANY_A, USUARIO, 'cmd-1')).rejects.toMatchObject({ status: 409 });
      expect(mockReagendarCita).not.toHaveBeenCalled();
    });
  });

  describe('cancelarComando()', () => {
    test('marca estado=cancelado, nunca llama una función de mutación', async () => {
      const db = crearMockDb({
        agenda_comandos: (ctx) => ({ data: { id: 'cmd-1', estado: 'cancelado', ...ctx.update }, error: null }),
      });

      const resultado = await cancelarComando(db, COMPANY_A, 'cmd-1');

      expect(resultado.estado).toBe('cancelado');
      expect(mockReagendarCita).not.toHaveBeenCalled();
      expect(mockCancelarCita).not.toHaveBeenCalled();
      expect(mockMarcarNoShow).not.toHaveBeenCalled();
    });

    test('comando inexistente o ya resuelto: 404', async () => {
      const db = crearMockDb({ agenda_comandos: () => ({ data: null, error: null }) });
      await expect(cancelarComando(db, COMPANY_A, 'no-existe')).rejects.toMatchObject({ status: 404 });
    });
  });
});
