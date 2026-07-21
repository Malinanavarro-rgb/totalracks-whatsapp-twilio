'use strict';

const mockObtenerHistorial = jest.fn();
const mockObtenerFichaCliente = jest.fn();
const mockResumenParaCliente = jest.fn();

jest.mock('../modules/conversaciones', () => ({
  obtenerHistorial: (...args) => mockObtenerHistorial(...args),
}));
jest.mock('../modules/crm-ui', () => ({
  obtenerFichaCliente: (...args) => mockObtenerFichaCliente(...args),
}));
jest.mock('../modules/business-memory-core', () => ({
  resumenParaCliente: (...args) => mockResumenParaCliente(...args),
}));

const { analizarHilo, programarAnalisis, DEBOUNCE_MS_DEFAULT } = require('../modules/inbox-analisis');

function crearMockSupabase(resultadoUpsert = { error: null }) {
  const upsert = jest.fn().mockResolvedValue(resultadoUpsert);
  return { from: jest.fn(() => ({ upsert })), _upsert: upsert };
}

function respuestaIA(json) {
  return { choices: [{ message: { content: JSON.stringify(json) } }] };
}

const HILO = { id: 'hilo-1', canal: 'whatsapp', estado: 'abierta', prioridad: 'normal' };
const FICHA = {
  cliente: { nombre: 'Karla', empresa: null, estado: 'Nuevo' },
  citas: [], oportunidades: [{ estado: 'Nuevo', presupuesto_confirmado: null }],
};
const HISTORIAL = [{ de: 'cliente', texto: 'Hola, quiero información' }, { de: 'tara', texto: '¿Qué servicio buscas?' }];

describe('inbox-analisis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockObtenerHistorial.mockResolvedValue(HISTORIAL);
    mockObtenerFichaCliente.mockResolvedValue(FICHA);
    mockResumenParaCliente.mockResolvedValue('');
  });

  describe('analizarHilo()', () => {
    test('arma el contexto, llama a OpenAI con response_format json y guarda (upsert) el análisis', async () => {
      const supabase = crearMockSupabase();
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaIA({
        resumen: 'Cliente nueva pidiendo información de servicios.',
        intencion: 'Consulta general',
        sentimiento: 'Positivo',
        probabilidad_compra: 40,
        urgencia: 'media',
        riesgos: [],
        recomendaciones: ['Preguntar qué servicio busca'],
        proxima_accion: 'Preguntar el servicio deseado',
        tareas_sugeridas: [],
      })) } } };

      const resultado = await analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO });

      expect(openaiClient.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
        response_format: { type: 'json_object' },
      }));
      const mensajeUsuario = openaiClient.chat.completions.create.mock.calls[0][0].messages[1].content;
      expect(mensajeUsuario).toContain('Karla');
      expect(mensajeUsuario).toContain('Hola, quiero información');

      expect(supabase._upsert).toHaveBeenCalledWith(
        expect.objectContaining({ hilo_id: 'hilo-1', resumen: 'Cliente nueva pidiendo información de servicios.', probabilidad_compra: 40 }),
        { onConflict: 'hilo_id' }
      );
      expect(resultado.probabilidad_compra).toBe(40);
    });

    test('normaliza campos fuera de rango/tipo incorrecto en vez de guardarlos tal cual', async () => {
      const supabase = crearMockSupabase();
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaIA({
        probabilidad_compra: 150, urgencia: 'catastrófica', sentimiento: 'Enojadísimo', riesgos: 'no es un arreglo',
      })) } } };

      const resultado = await analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO });

      expect(resultado.probabilidad_compra).toBe(100); // clamp
      expect(resultado.urgencia).toBe('baja');          // default si no es válido
      expect(resultado.sentimiento).toBe('Neutral');     // default si no es válido
      expect(resultado.riesgos).toEqual([]);             // default si no es arreglo
    });

    test('respuesta de IA no es JSON válido: no lanza, usa defaults seguros', async () => {
      const supabase = crearMockSupabase();
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'esto no es json' } }] }) } } };

      const resultado = await analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO });

      expect(resultado.urgencia).toBe('baja');
      expect(resultado.riesgos).toEqual([]);
    });

    test('lanza si falla el upsert en analisis_hilo', async () => {
      const supabase = crearMockSupabase({ error: { message: 'fallo db' } });
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaIA({})) } } };

      await expect(analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO }))
        .rejects.toThrow('fallo db');
    });

    test('sigue funcionando si obtenerFichaCliente falla (ficha null)', async () => {
      mockObtenerFichaCliente.mockRejectedValue(new Error('cliente no encontrado'));
      const supabase = crearMockSupabase();
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaIA({})) } } };

      await expect(analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO }))
        .resolves.toBeDefined();
    });

    test('Business Memory Core: incluye la memoria empresarial confirmada en el contexto enviado a la IA', async () => {
      mockResumenParaCliente.mockResolvedValue('- [preferencia] Prefiere pagar con tarjeta (confianza: 90%) — nunca ha pagado en efectivo.');
      const supabase = crearMockSupabase();
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaIA({})) } } };

      await analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO });

      expect(mockResumenParaCliente).toHaveBeenCalledWith(supabase, 'c1', 60);
      const mensajeUsuario = openaiClient.chat.completions.create.mock.calls[0][0].messages[1].content;
      expect(mensajeUsuario).toContain('Memoria empresarial confirmada');
      expect(mensajeUsuario).toContain('Prefiere pagar con tarjeta');
      expect(mensajeUsuario).toContain('90%');
    });

    test('sigue funcionando si resumenParaCliente (BMC) falla — nunca tumba el análisis del hilo', async () => {
      mockResumenParaCliente.mockRejectedValue(new Error('bmc caído'));
      const supabase = crearMockSupabase();
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaIA({})) } } };

      await expect(analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO }))
        .resolves.toBeDefined();
    });

    test('sin memoria empresarial confirmada todavía: no agrega la sección al contexto', async () => {
      mockResumenParaCliente.mockResolvedValue('');
      const supabase = crearMockSupabase();
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue(respuestaIA({})) } } };

      await analizarHilo({ supabase, openaiClient, company_id: 'c1', hilo_id: 'hilo-1', cliente_id: 60, hilo: HILO });
      const mensajeUsuario = openaiClient.chat.completions.create.mock.calls[0][0].messages[1].content;
      expect(mensajeUsuario).not.toContain('Memoria empresarial confirmada');
    });
  });

  describe('programarAnalisis() — debounce', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('ejecuta después del debounce por defecto', () => {
      const ejecutar = jest.fn().mockResolvedValue(undefined);
      programarAnalisis('hilo-1', ejecutar);

      jest.advanceTimersByTime(DEBOUNCE_MS_DEFAULT - 1);
      expect(ejecutar).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(ejecutar).toHaveBeenCalledTimes(1);
    });

    test('reprograma si se llama de nuevo antes de que dispare (no duplica ejecuciones)', () => {
      const ejecutar = jest.fn().mockResolvedValue(undefined);
      programarAnalisis('hilo-2', ejecutar, 1000);
      jest.advanceTimersByTime(600);
      programarAnalisis('hilo-2', ejecutar, 1000); // llega otro mensaje antes de que dispare

      jest.advanceTimersByTime(600); // 1200ms desde el primer llamado, pero solo 600ms desde el segundo
      expect(ejecutar).not.toHaveBeenCalled();

      jest.advanceTimersByTime(400); // completa 1000ms desde el segundo llamado
      expect(ejecutar).toHaveBeenCalledTimes(1);
    });

    test('hilos distintos no interfieren entre sí', () => {
      const ejecutarA = jest.fn().mockResolvedValue(undefined);
      const ejecutarB = jest.fn().mockResolvedValue(undefined);
      programarAnalisis('hilo-a', ejecutarA, 500);
      programarAnalisis('hilo-b', ejecutarB, 500);

      jest.advanceTimersByTime(500);
      expect(ejecutarA).toHaveBeenCalledTimes(1);
      expect(ejecutarB).toHaveBeenCalledTimes(1);
    });
  });
});
