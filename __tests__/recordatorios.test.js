'use strict';

const { enviarRecordatoriosPendientes } = require('../modules/recordatorios');

// ─── Mock Supabase (thenable, mismo patrón que scheduling-engine.test.js) ─────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
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

function crearMockAIEngine(respuesta) {
  return { procesar: jest.fn().mockResolvedValue(respuesta) };
}

function crearMockChannelAdapter() {
  return { sendProactive: jest.fn().mockResolvedValue(undefined) };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AHORA = new Date('2026-07-10T00:00:00Z');

const plantillaSinIA = {
  id: 'msg-1', company_id: 'company-1', tipo: 'recordatorio_cita',
  plantilla: 'Hola {{nombre}}, tu cita con {{asesor}} es el {{fecha}} a las {{hora}}.',
  permite_ia: false, activo: true,
};

const plantillaConIA = { ...plantillaSinIA, id: 'msg-2', permite_ia: true };

function makeCita(overrides = {}) {
  return {
    id: 'cita-1', company_id: 'company-1',
    inicio: '2026-07-10T16:00:00.000Z',
    estado: 'agendada', recordatorio_enviado: false,
    clientes: { nombre: 'Carlos', telefono: '+5218112345678' },
    asesores: { nombre: 'Ana' },
    ...overrides,
  };
}

describe('recordatorios', () => {
  describe('enviarRecordatoriosPendientes()', () => {
    test('envía el recordatorio con la plantilla renderizada cuando permite_ia es false', async () => {
      const cita = makeCita();
      const db = crearMockDb(
        { data: [cita], error: null },        // citas pendientes
        { data: plantillaSinIA, error: null }, // plantilla
        { data: null, error: null },           // update recordatorio_enviado
      );
      const aiEngine = crearMockAIEngine({ respuesta_texto: 'no debería llamarse' });
      const channelAdapter = crearMockChannelAdapter();

      const resultado = await enviarRecordatoriosPendientes({ supabase: db, aiEngine, channelAdapter, ahora: AHORA });

      expect(aiEngine.procesar).not.toHaveBeenCalled();
      expect(channelAdapter.sendProactive).toHaveBeenCalledWith(
        expect.stringContaining('Hola Carlos, tu cita con Ana es el'),
        '+5218112345678'
      );
      expect(resultado).toEqual({ enviados: 1, fallidos: 0 });
    });

    test('con permite_ia true y la IA responde a tiempo, antepone la frase generada', async () => {
      const cita = makeCita();
      const db = crearMockDb(
        { data: [cita], error: null },
        { data: plantillaConIA, error: null },
        { data: null, error: null },
      );
      const aiEngine = crearMockAIEngine({ respuesta_texto: '¡Qué gusto saludarte!' });
      const channelAdapter = crearMockChannelAdapter();

      await enviarRecordatoriosPendientes({ supabase: db, aiEngine, channelAdapter, ahora: AHORA, timeoutIaMs: 200 });

      expect(channelAdapter.sendProactive).toHaveBeenCalledWith(
        expect.stringMatching(/^¡Qué gusto saludarte! Hola Carlos/),
        '+5218112345678'
      );
    });

    test('si la IA tarda más que el timeout, se envía la plantilla base sin esperar', async () => {
      const cita = makeCita();
      const db = crearMockDb(
        { data: [cita], error: null },
        { data: plantillaConIA, error: null },
        { data: null, error: null },
      );
      const aiEngine = {
        procesar: jest.fn(() => new Promise(resolve =>
          setTimeout(() => resolve({ respuesta_texto: 'demasiado tarde' }), 100)
        )),
      };
      const channelAdapter = crearMockChannelAdapter();

      const resultado = await enviarRecordatoriosPendientes({
        supabase: db, aiEngine, channelAdapter, ahora: AHORA, timeoutIaMs: 10,
      });

      expect(channelAdapter.sendProactive).toHaveBeenCalledWith(
        expect.stringMatching(/^Hola Carlos/), // sin la frase de la IA
        '+5218112345678'
      );
      expect(resultado).toEqual({ enviados: 1, fallidos: 0 });
    });

    test('si la IA lanza error, se envía la plantilla base sin fallar', async () => {
      const cita = makeCita();
      const db = crearMockDb(
        { data: [cita], error: null },
        { data: plantillaConIA, error: null },
        { data: null, error: null },
      );
      const aiEngine = { procesar: jest.fn().mockRejectedValue(new Error('OpenAI caído')) };
      const channelAdapter = crearMockChannelAdapter();

      const resultado = await enviarRecordatoriosPendientes({ supabase: db, aiEngine, channelAdapter, ahora: AHORA });

      expect(channelAdapter.sendProactive).toHaveBeenCalledWith(
        expect.stringMatching(/^Hola Carlos/),
        '+5218112345678'
      );
      expect(resultado).toEqual({ enviados: 1, fallidos: 0 });
    });

    test('sin plantilla activa configurada para la empresa → no envía, no lanza', async () => {
      const cita = makeCita();
      const db = crearMockDb(
        { data: [cita], error: null },
        { data: null, error: null }, // sin plantilla
      );
      const aiEngine = crearMockAIEngine({});
      const channelAdapter = crearMockChannelAdapter();

      const resultado = await enviarRecordatoriosPendientes({ supabase: db, aiEngine, channelAdapter, ahora: AHORA });

      expect(channelAdapter.sendProactive).not.toHaveBeenCalled();
      expect(resultado).toEqual({ enviados: 0, fallidos: 0 });
    });

    test('una cita que falla no detiene el procesamiento de las demás', async () => {
      const citaA = makeCita({ id: 'cita-A', clientes: { nombre: 'Carlos', telefono: '+5211111111111' } });
      const citaB = makeCita({ id: 'cita-B', clientes: { nombre: 'María', telefono: '+5222222222222' } });
      const db = crearMockDb(
        { data: [citaA, citaB], error: null },
        { data: plantillaSinIA, error: null }, // plantilla para citaA
        { data: plantillaSinIA, error: null }, // plantilla para citaB
        { data: null, error: null },           // update citaB (citaA no llega a actualizar)
      );
      const aiEngine = crearMockAIEngine({});
      const channelAdapter = {
        sendProactive: jest.fn()
          .mockRejectedValueOnce(new Error('Twilio caído'))
          .mockResolvedValueOnce(undefined),
      };

      const resultado = await enviarRecordatoriosPendientes({ supabase: db, aiEngine, channelAdapter, ahora: AHORA });

      expect(channelAdapter.sendProactive).toHaveBeenCalledTimes(2);
      expect(resultado).toEqual({ enviados: 1, fallidos: 1 });
    });

    test('la consulta de citas filtra por estado, recordatorio_enviado y la ventana de tiempo', async () => {
      const db = crearMockDb({ data: [], error: null });

      await enviarRecordatoriosPendientes({
        supabase: db, aiEngine: crearMockAIEngine({}), channelAdapter: crearMockChannelAdapter(),
        ahora: AHORA, ventanaHoras: 24,
      });

      const builder = db._builders[0];
      expect(builder.in).toHaveBeenCalledWith('estado', ['agendada', 'confirmada']);
      expect(builder.eq).toHaveBeenCalledWith('recordatorio_enviado', false);
      expect(builder.gte).toHaveBeenCalledWith('inicio', AHORA.toISOString());
      expect(builder.lte).toHaveBeenCalledWith('inicio', new Date('2026-07-11T00:00:00.000Z').toISOString());
    });

    test('sin citas pendientes, no consulta plantillas ni intenta enviar nada', async () => {
      const db = crearMockDb({ data: [], error: null });
      const aiEngine = crearMockAIEngine({});
      const channelAdapter = crearMockChannelAdapter();

      const resultado = await enviarRecordatoriosPendientes({ supabase: db, aiEngine, channelAdapter, ahora: AHORA });

      expect(db.from).toHaveBeenCalledTimes(1);
      expect(channelAdapter.sendProactive).not.toHaveBeenCalled();
      expect(resultado).toEqual({ enviados: 0, fallidos: 0 });
    });
  });
});
