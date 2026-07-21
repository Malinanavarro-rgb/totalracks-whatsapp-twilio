'use strict';

const {
  registrarAprendizaje, resolverPropuesta, listarPropuestasPendientes,
  resumenParaCliente, generarResumenEjecutivo, obtenerResumenEjecutivo,
} = require('../modules/business-memory-core');

function crearBuilder(resultado, llamadas) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn((...a) => { llamadas.push(['insert', ...a]); return builder; }),
    update: jest.fn((...a) => { llamadas.push(['update', ...a]); return builder; }),
    upsert: jest.fn((...a) => { llamadas.push(['upsert', ...a]); return builder; }),
    eq:     jest.fn((...a) => { llamadas.push(['eq', ...a]); return builder; }),
    is:     jest.fn((...a) => { llamadas.push(['is', ...a]); return builder; }),
    or:     jest.fn((...a) => { llamadas.push(['or', ...a]); return builder; }),
    order:  jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then:   (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resolvers) {
  const llamadas = {};
  const db = {
    from: jest.fn((tabla) => {
      llamadas[tabla] = llamadas[tabla] || [];
      const resultado = resolvers[tabla] ? resolvers[tabla]() : { data: null, error: null };
      return crearBuilder(resultado, llamadas[tabla]);
    }),
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'company-a-0001';

const BASE = {
  company_id: COMPANY_A, categoria: 'patron_compra', titulo: 'Compra más los viernes',
  detalle: 'El 70% de sus pedidos llegan los viernes por la tarde.', origen: 'inbox_analisis',
};

describe('business-memory-core', () => {
  describe('registrarAprendizaje()', () => {
    test('sin aprendizaje existente: crea uno nuevo con estado=propuesta, sin importar el origen', async () => {
      let llamada = 0;
      const db = crearMockDb({
        memoria_empresarial: () => (llamada++ === 0
          ? { data: null, error: null }
          : { data: { id: 'm1', ...BASE, estado: 'propuesta', veces_confirmado: 1 }, error: null }),
      });

      const resultado = await registrarAprendizaje(db, BASE);
      expect(resultado.estado).toBe('propuesta');
    });

    test('origen=manual también nace como propuesta — sin excepciones (regla explícita de Alina)', async () => {
      let llamada = 0;
      const db = crearMockDb({
        memoria_empresarial: () => (llamada++ === 0
          ? { data: null, error: null }
          : { data: { id: 'm2', ...BASE, origen: 'manual', estado: 'propuesta' }, error: null }),
      });

      const resultado = await registrarAprendizaje(db, { ...BASE, origen: 'manual', propuesto_por: 'user-1' });
      expect(resultado.estado).toBe('propuesta');
    });

    test('ya existe un aprendizaje activo igual (misma empresa+categoria+titulo, sin cliente): refuerza en vez de duplicar', async () => {
      let llamada = 0;
      const existente = { id: 'm-existente', veces_confirmado: 2 };
      const db = crearMockDb({
        memoria_empresarial: () => (llamada++ === 0
          ? { data: existente, error: null }
          : { data: { id: 'm-existente', veces_confirmado: 3 }, error: null }),
      });

      const resultado = await registrarAprendizaje(db, BASE);

      expect(resultado.veces_confirmado).toBe(3);
      const llamadasUpdate = db._llamadas.memoria_empresarial.filter(l => l[0] === 'update');
      expect(llamadasUpdate).toHaveLength(1);
      expect(llamadasUpdate[0][1].veces_confirmado).toBe(3);
    });

    test('filtra por cliente_id IS NULL cuando el aprendizaje no es de un cliente específico', async () => {
      let llamada = 0;
      const db = crearMockDb({
        memoria_empresarial: () => (llamada++ === 0 ? { data: null, error: null } : { data: { id: 'm3' }, error: null }),
      });

      await registrarAprendizaje(db, BASE);
      const llamadasIs = db._llamadas.memoria_empresarial.filter(l => l[0] === 'is');
      expect(llamadasIs).toEqual([['is', 'cliente_id', null]]);
    });

    test('filtra por cliente_id exacto cuando sí aplica a un cliente', async () => {
      let llamada = 0;
      const db = crearMockDb({
        memoria_empresarial: () => (llamada++ === 0 ? { data: null, error: null } : { data: { id: 'm4' }, error: null }),
      });

      await registrarAprendizaje(db, { ...BASE, categoria: 'cliente_importante', cliente_id: 42 });
      const llamadasEq = db._llamadas.memoria_empresarial.filter(l => l[0] === 'eq' && l[1] === 'cliente_id');
      expect(llamadasEq).toEqual([['eq', 'cliente_id', 42]]);
    });

    test('lanza si falta un campo requerido', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, titulo: undefined })).rejects.toThrow('requeridos');
    });

    test('lanza si la categoria no es válida', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, categoria: 'inventada' })).rejects.toThrow('categoria inválida');
    });

    test('lanza si el origen no es válido', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, origen: 'inventado' })).rejects.toThrow('origen inválido');
    });
  });

  describe('resolverPropuesta()', () => {
    test('confirma una propuesta y registra quién y cuándo', async () => {
      const db = crearMockDb({
        memoria_empresarial: () => ({ data: { id: 'm1', estado: 'confirmado', confirmado_por: 'user-1' }, error: null }),
      });

      const resultado = await resolverPropuesta(db, COMPANY_A, 'm1', 'confirmado', 'user-1');
      expect(resultado.estado).toBe('confirmado');

      const llamadasUpdate = db._llamadas.memoria_empresarial.filter(l => l[0] === 'update');
      expect(llamadasUpdate[0][1]).toEqual(expect.objectContaining({ estado: 'confirmado', confirmado_por: 'user-1' }));
    });

    test('rechaza una propuesta', async () => {
      const db = crearMockDb({
        memoria_empresarial: () => ({ data: { id: 'm1', estado: 'rechazada' }, error: null }),
      });
      const resultado = await resolverPropuesta(db, COMPANY_A, 'm1', 'rechazada', 'user-1');
      expect(resultado.estado).toBe('rechazada');
    });

    test('lanza si la decisión no es confirmado/rechazada', async () => {
      const db = crearMockDb({});
      await expect(resolverPropuesta(db, COMPANY_A, 'm1', 'lo que sea', 'user-1')).rejects.toThrow('decision inválida');
    });

    test('el update solo aplica sobre filas con estado=propuesta (no puede re-confirmar algo ya resuelto)', async () => {
      const db = crearMockDb({ memoria_empresarial: () => ({ data: { id: 'm1' }, error: null }) });
      await resolverPropuesta(db, COMPANY_A, 'm1', 'confirmado', 'user-1');
      const llamadasEq = db._llamadas.memoria_empresarial.filter(l => l[0] === 'eq');
      expect(llamadasEq).toContainEqual(['eq', 'estado', 'propuesta']);
    });
  });

  describe('listarPropuestasPendientes()', () => {
    test('devuelve solo las propuestas activas de esa empresa', async () => {
      const db = crearMockDb({
        memoria_empresarial: () => ({ data: [{ id: 'm1', estado: 'propuesta' }], error: null }),
      });
      const resultado = await listarPropuestasPendientes(db, COMPANY_A);
      expect(resultado).toEqual([{ id: 'm1', estado: 'propuesta' }]);
    });

    test('arreglo vacío si no hay ninguna', async () => {
      const db = crearMockDb({ memoria_empresarial: () => ({ data: [], error: null }) });
      expect(await listarPropuestasPendientes(db, COMPANY_A)).toEqual([]);
    });
  });

  describe('resumenParaCliente() — lectura pura, sin IA', () => {
    test('formatea solo aprendizajes confirmados con su % de confianza', async () => {
      const db = crearMockDb({
        memoria_empresarial: () => ({
          data: [{ titulo: 'Prefiere pagos con tarjeta', detalle: 'Nunca ha pagado en efectivo.', confianza: 90, categoria: 'preferencia' }],
          error: null,
        }),
      });

      const resultado = await resumenParaCliente(db, COMPANY_A, 7);
      expect(resultado).toContain('90%');
      expect(resultado).toContain('Prefiere pagos con tarjeta');

      const llamadasEq = db._llamadas.memoria_empresarial.filter(l => l[0] === 'eq');
      expect(llamadasEq).toContainEqual(['eq', 'estado', 'confirmado']);
      expect(llamadasEq).toContainEqual(['eq', 'activo', true]);
    });

    test('string vacío si no hay nada confirmado todavía', async () => {
      const db = crearMockDb({ memoria_empresarial: () => ({ data: [], error: null }) });
      expect(await resumenParaCliente(db, COMPANY_A, 7)).toBe('');
    });

    test('no llama a ningún cliente de OpenAI (no hay parámetro para eso)', async () => {
      expect(resumenParaCliente.length).toBe(3); // supabase, company_id, cliente_id — sin openaiClient
    });
  });

  describe('generarResumenEjecutivo()', () => {
    function crearOpenAIMock(json) {
      return { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(json) } }] }) } } };
    }

    test('sintetiza solo a partir de aprendizajes confirmados y hace upsert', async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null });
      const db = crearMockDb({
        memoria_empresarial: () => ({ data: [{ titulo: 'Vende más los martes', detalle: '28% más que el resto de la semana.', confianza: 85, categoria: 'patron_compra' }], error: null }),
      });
      db.from = jest.fn((tabla) => {
        if (tabla === 'resumen_ejecutivo_negocio') return { upsert };
        return crearMockDb({ memoria_empresarial: () => ({ data: [{ titulo: 'Vende más los martes', detalle: '...', confianza: 85, categoria: 'patron_compra' }], error: null }) }).from(tabla);
      });

      const openaiClient = crearOpenAIMock({ resumen: 'El negocio vende más los martes.', highlights: ['Vende más los martes'] });
      const resultado = await generarResumenEjecutivo({ supabase: db, openaiClient, company_id: COMPANY_A });

      expect(resultado.resumen).toBe('El negocio vende más los martes.');
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ company_id: COMPANY_A, resumen: 'El negocio vende más los martes.' }),
        { onConflict: 'company_id' }
      );
    });

    test('sin aprendizajes confirmados: no llama a OpenAI, guarda un resumen vacío explícito', async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null });
      const db = { from: jest.fn((tabla) => (tabla === 'resumen_ejecutivo_negocio' ? { upsert } : crearBuilder({ data: [], error: null }, []))) };
      const openaiClient = { chat: { completions: { create: jest.fn() } } };

      const resultado = await generarResumenEjecutivo({ supabase: db, openaiClient, company_id: COMPANY_A });

      expect(openaiClient.chat.completions.create).not.toHaveBeenCalled();
      expect(resultado.highlights).toEqual([]);
      expect(upsert).toHaveBeenCalled();
    });

    test('respuesta de IA no es JSON válido: no lanza, guarda defaults seguros', async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null });
      const db = {
        from: jest.fn((tabla) => (tabla === 'resumen_ejecutivo_negocio'
          ? { upsert }
          : crearBuilder({ data: [{ titulo: 'x', detalle: 'y', confianza: 50, categoria: 'aprendizaje_general' }], error: null }, []))),
      };
      const openaiClient = { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'no es json' } }] }) } } };

      const resultado = await generarResumenEjecutivo({ supabase: db, openaiClient, company_id: COMPANY_A });
      expect(resultado.resumen).toBe('Sin resumen disponible.');
      expect(resultado.highlights).toEqual([]);
    });
  });

  describe('obtenerResumenEjecutivo() — lectura pura, sin IA', () => {
    test('devuelve la fila ya sintetizada', async () => {
      const db = crearMockDb({ resumen_ejecutivo_negocio: () => ({ data: { company_id: COMPANY_A, resumen: 'x' }, error: null }) });
      expect(await obtenerResumenEjecutivo(db, COMPANY_A)).toEqual({ company_id: COMPANY_A, resumen: 'x' });
    });

    test('null si todavía no se ha generado ninguno', async () => {
      const db = crearMockDb({ resumen_ejecutivo_negocio: () => ({ data: null, error: null }) });
      expect(await obtenerResumenEjecutivo(db, COMPANY_A)).toBeNull();
    });
  });
});
