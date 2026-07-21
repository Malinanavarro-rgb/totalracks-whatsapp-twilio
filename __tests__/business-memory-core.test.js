'use strict';

const {
  CONFIANZA_MINIMA, nivelConfianza,
  registrarAprendizaje, confirmarAprendizaje, rechazarAprendizaje, marcarObsoleto,
  listarPropuestasPendientes, resumenParaCliente, generarResumenEjecutivo, obtenerResumenEjecutivo,
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
  evidencia: { resumen: 'Basado en 43 oportunidades de las últimas 8 semanas.' }, confianza: 85,
};

describe('business-memory-core', () => {
  describe('nivelConfianza()', () => {
    test('60-79 es baja, 80-94 sólida, 95-100 alta', () => {
      expect(nivelConfianza(60)).toBe('baja');
      expect(nivelConfianza(79)).toBe('baja');
      expect(nivelConfianza(80)).toBe('solida');
      expect(nivelConfianza(94)).toBe('solida');
      expect(nivelConfianza(95)).toBe('alta');
      expect(nivelConfianza(100)).toBe('alta');
    });

    test('fuera de rango (incluyendo <60): null', () => {
      expect(nivelConfianza(59)).toBeNull();
      expect(nivelConfianza(0)).toBeNull();
      expect(nivelConfianza(101)).toBeNull();
      expect(nivelConfianza(NaN)).toBeNull();
    });
  });

  describe('registrarAprendizaje()', () => {
    test('sin aprendizaje existente: crea uno nuevo con estado=propuesto, sin importar el origen', async () => {
      // Dos pasadas distintas de .from('memoria_empresarial'): la 1ra (búsqueda) ve [], la 2da (insert) ve la fila nueva.
      let llamada = 0;
      const db = { from: jest.fn((tabla) => {
        if (tabla === 'decision_logs') return crearBuilder({ data: null, error: null }, []);
        llamada++;
        const resultado = llamada === 1 ? { data: [], error: null } : { data: { id: 'm1', ...BASE, estado: 'propuesto', veces_confirmado: 1 }, error: null };
        return crearBuilder(resultado, []);
      }) };

      const resultado = await registrarAprendizaje(db, BASE);
      expect(resultado.estado).toBe('propuesto');
      expect(resultado.advertencia).toBeNull();
    });

    test('origen=modo_operador también nace como propuesto — sin excepciones', async () => {
      let llamada = 0;
      const db = { from: jest.fn((tabla) => {
        if (tabla === 'decision_logs') return crearBuilder({ data: null, error: null }, []);
        llamada++;
        return crearBuilder(llamada === 1 ? { data: [], error: null } : { data: { id: 'm2', ...BASE, origen: 'modo_operador', estado: 'propuesto' }, error: null }, []);
      }) };

      const resultado = await registrarAprendizaje(db, { ...BASE, origen: 'modo_operador', propuesto_por: 'user-1' });
      expect(resultado.estado).toBe('propuesto');
    });

    test('ya existe un aprendizaje "propuesto" activo igual: refuerza en vez de duplicar', async () => {
      const existente = { id: 'm-existente', estado: 'propuesto', veces_confirmado: 2 };
      let llamada = 0;
      const db = { from: jest.fn((tabla) => {
        if (tabla === 'decision_logs') return crearBuilder({ data: null, error: null }, []);
        llamada++;
        return crearBuilder(llamada === 1 ? { data: [existente], error: null } : { data: { id: 'm-existente', veces_confirmado: 3 }, error: null }, []);
      }) };

      const resultado = await registrarAprendizaje(db, BASE);
      expect(resultado.veces_confirmado).toBe(3);
      expect(resultado.advertencia).toBeNull();
    });

    test('ya existe un aprendizaje "confirmado" activo igual: también refuerza', async () => {
      const existente = { id: 'm-conf', estado: 'confirmado', veces_confirmado: 5 };
      let llamada = 0;
      const db = { from: jest.fn((tabla) => {
        if (tabla === 'decision_logs') return crearBuilder({ data: null, error: null }, []);
        llamada++;
        return crearBuilder(llamada === 1 ? { data: [existente], error: null } : { data: { id: 'm-conf', veces_confirmado: 6 }, error: null }, []);
      }) };

      const resultado = await registrarAprendizaje(db, BASE);
      expect(resultado.veces_confirmado).toBe(6);
    });

    test('coincidencia "obsoleto": NO se reactiva silenciosamente — crea una propuesta nueva con advertencia', async () => {
      const obsoleto = { id: 'm-obsoleto', estado: 'obsoleto', razon_rechazo: 'Ya no compra los viernes desde marzo.' };
      let llamada = 0;
      const db = { from: jest.fn((tabla) => {
        if (tabla === 'decision_logs') return crearBuilder({ data: null, error: null }, []);
        llamada++;
        return crearBuilder(llamada === 1 ? { data: [obsoleto], error: null } : { data: { id: 'm-nuevo', ...BASE, estado: 'propuesto' }, error: null }, []);
      }) };

      const resultado = await registrarAprendizaje(db, BASE);
      expect(resultado.id).toBe('m-nuevo');
      expect(resultado.estado).toBe('propuesto');
      expect(resultado.advertencia).toContain('obsoleto');
      expect(resultado.advertencia).toContain('m-obsoleto');
    });

    test('coincidencia "rechazado": no bloquea ni refuerza — crea una propuesta nueva sin advertencia', async () => {
      const rechazado = { id: 'm-rechazado', estado: 'rechazado' };
      let llamada = 0;
      const db = { from: jest.fn((tabla) => {
        if (tabla === 'decision_logs') return crearBuilder({ data: null, error: null }, []);
        llamada++;
        return crearBuilder(llamada === 1 ? { data: [rechazado], error: null } : { data: { id: 'm-nuevo2', ...BASE, estado: 'propuesto' }, error: null }, []);
      }) };

      const resultado = await registrarAprendizaje(db, BASE);
      expect(resultado.id).toBe('m-nuevo2');
      expect(resultado.advertencia).toBeNull();
    });

    test('rechaza si evidencia.resumen está vacío — nunca toca la base de datos para crear', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, evidencia: { resumen: '' } }))
        .rejects.toThrow('evidencia.resumen es obligatorio');
    });

    test('rechaza si falta evidencia por completo', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, evidencia: undefined }))
        .rejects.toThrow('evidencia.resumen es obligatorio');
    });

    test(`rechaza confianza menor a ${CONFIANZA_MINIMA}`, async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, confianza: 59 }))
        .rejects.toThrow(`confianza debe ser ${CONFIANZA_MINIMA}-100`);
    });

    test('rechaza confianza mayor a 100', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, confianza: 101 }))
        .rejects.toThrow(`confianza debe ser ${CONFIANZA_MINIMA}-100`);
    });

    test('audita el intento fallido por confianza insuficiente', async () => {
      const insertAuditoria = jest.fn().mockResolvedValue({ error: null });
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? { insert: insertAuditoria } : crearBuilder({ data: [], error: null }, []))) };

      await expect(registrarAprendizaje(db, { ...BASE, confianza: 10 })).rejects.toThrow();
      expect(insertAuditoria).toHaveBeenCalledWith([expect.objectContaining({
        company_id: COMPANY_A,
        payload: expect.objectContaining({ tipo_accion: 'bmc_registrar_aprendizaje', exito: false }),
      })]);
    });

    test('lanza si falta un campo requerido', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, titulo: undefined })).rejects.toThrow('requeridos');
    });

    test('lanza si la categoria no es válida', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, categoria: 'inventada' })).rejects.toThrow('categoria inválida');
    });

    test('lanza si el origen no es válido (incluyendo el "manual" viejo de Fase 1, ya renombrado)', async () => {
      const db = crearMockDb({});
      await expect(registrarAprendizaje(db, { ...BASE, origen: 'manual' })).rejects.toThrow('origen inválido');
    });

    test('filtra por cliente_id IS NULL cuando el aprendizaje no es de un cliente específico', async () => {
      let llamada = 0;
      const db = { from: jest.fn((tabla) => {
        if (tabla === 'decision_logs') return crearBuilder({ data: null, error: null }, []);
        llamada++;
        const b = crearBuilder(llamada === 1 ? { data: [], error: null } : { data: { id: 'm3' }, error: null }, db._llamadas || (db._llamadas = []));
        return b;
      }), _llamadas: [] };

      await registrarAprendizaje(db, BASE);
      const llamadasIs = db._llamadas.filter(l => l[0] === 'is');
      expect(llamadasIs).toEqual([['is', 'cliente_id', null]]);
    });
  });

  describe('confirmarAprendizaje() / rechazarAprendizaje() / marcarObsoleto() — transiciones atómicas', () => {
    test('confirmarAprendizaje: UPDATE filtra por id+company_id+estado=propuesto, registra resuelto_por/resuelto_at', async () => {
      const llamadas = [];
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? crearBuilder({ error: null }, []) : crearBuilder({ data: { id: 'm1', estado: 'confirmado' }, error: null }, llamadas))) };

      const resultado = await confirmarAprendizaje(db, COMPANY_A, 'm1', 'user-1');

      expect(resultado.estado).toBe('confirmado');
      const llamadaUpdate = llamadas.find(l => l[0] === 'update');
      expect(llamadaUpdate[1]).toEqual(expect.objectContaining({ estado: 'confirmado', resuelto_por: 'user-1' }));
      expect(llamadas).toContainEqual(['eq', 'id', 'm1']);
      expect(llamadas).toContainEqual(['eq', 'company_id', COMPANY_A]);
      expect(llamadas).toContainEqual(['eq', 'estado', 'propuesto']);
    });

    test('confirmarAprendizaje: si el UPDATE no afecta ninguna fila (ya resuelto/otra empresa/id inexistente), lanza error explícito', async () => {
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? crearBuilder({ error: null }, []) : crearBuilder({ data: null, error: { message: 'no rows' } }, []))) };
      await expect(confirmarAprendizaje(db, COMPANY_A, 'm1', 'user-1'))
        .rejects.toThrow('no se pudo aplicar la transición');
    });

    test('confirmarAprendizaje: audita el intento fallido (sin datos sensibles)', async () => {
      const insertAuditoria = jest.fn().mockResolvedValue({ error: null });
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? { insert: insertAuditoria } : crearBuilder({ data: null, error: { message: 'no rows' } }, []))) };

      await expect(confirmarAprendizaje(db, COMPANY_A, 'm1', 'user-1')).rejects.toThrow();
      expect(insertAuditoria).toHaveBeenCalledWith([expect.objectContaining({
        payload: expect.objectContaining({ tipo_accion: 'bmc_confirmar_aprendizaje', exito: false }),
      })]);
    });

    test('confirmarAprendizaje: audita el intento exitoso', async () => {
      const insertAuditoria = jest.fn().mockResolvedValue({ error: null });
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? { insert: insertAuditoria } : crearBuilder({ data: { id: 'm1', estado: 'confirmado' }, error: null }, []))) };

      await confirmarAprendizaje(db, COMPANY_A, 'm1', 'user-1');
      expect(insertAuditoria).toHaveBeenCalledWith([expect.objectContaining({
        payload: expect.objectContaining({ tipo_accion: 'bmc_confirmar_aprendizaje', exito: true }),
      })]);
    });

    test('rechazarAprendizaje: requiere razón — nunca llega a tocar la base de datos sin ella', async () => {
      const db = crearMockDb({});
      await expect(rechazarAprendizaje(db, COMPANY_A, 'm1', 'user-1', '')).rejects.toThrow('razon es requerida');
      await expect(rechazarAprendizaje(db, COMPANY_A, 'm1', 'user-1', undefined)).rejects.toThrow('razon es requerida');
    });

    test('rechazarAprendizaje: transición propuesto→rechazado, guarda razon_rechazo', async () => {
      const llamadas = [];
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? crearBuilder({ error: null }, []) : crearBuilder({ data: { id: 'm1', estado: 'rechazado' }, error: null }, llamadas))) };

      await rechazarAprendizaje(db, COMPANY_A, 'm1', 'user-1', 'no aplica a este negocio');
      const llamadaUpdate = llamadas.find(l => l[0] === 'update');
      expect(llamadaUpdate[1]).toEqual(expect.objectContaining({ estado: 'rechazado', razon_rechazo: 'no aplica a este negocio' }));
      expect(llamadas).toContainEqual(['eq', 'estado', 'propuesto']);
    });

    test('marcarObsoleto: transición confirmado→obsoleto (no desde propuesto)', async () => {
      const llamadas = [];
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? crearBuilder({ error: null }, []) : crearBuilder({ data: { id: 'm1', estado: 'obsoleto' }, error: null }, llamadas))) };

      await marcarObsoleto(db, COMPANY_A, 'm1', 'user-1', 'temporada terminó');
      expect(llamadas).toContainEqual(['eq', 'estado', 'confirmado']);
      const llamadaUpdate = llamadas.find(l => l[0] === 'update');
      expect(llamadaUpdate[1]).toEqual(expect.objectContaining({ estado: 'obsoleto', razon_rechazo: 'temporada terminó' }));
    });

    test('marcarObsoleto: razón es opcional', async () => {
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? crearBuilder({ error: null }, []) : crearBuilder({ data: { id: 'm1', estado: 'obsoleto' }, error: null }, []))) };
      await expect(marcarObsoleto(db, COMPANY_A, 'm1', 'user-1')).resolves.toBeDefined();
    });

    test('aislamiento: nunca resuelve un aprendizaje de otra empresa (WHERE incluye company_id)', async () => {
      const llamadas = [];
      const db = { from: jest.fn((tabla) => (tabla === 'decision_logs' ? crearBuilder({ error: null }, []) : crearBuilder({ data: { id: 'm1' }, error: null }, llamadas))) };

      await confirmarAprendizaje(db, 'empresa-correcta', 'm1', 'user-1');
      expect(llamadas).toContainEqual(['eq', 'company_id', 'empresa-correcta']);
    });
  });

  describe('listarPropuestasPendientes()', () => {
    test('devuelve solo las propuestas (estado=propuesto) activas de esa empresa', async () => {
      const db = crearMockDb({
        memoria_empresarial: () => ({ data: [{ id: 'm1', estado: 'propuesto' }], error: null }),
      });
      const resultado = await listarPropuestasPendientes(db, COMPANY_A);
      expect(resultado).toEqual([{ id: 'm1', estado: 'propuesto' }]);
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
      const db = {
        from: jest.fn((tabla) => (tabla === 'resumen_ejecutivo_negocio'
          ? { upsert }
          : crearBuilder({ data: [{ titulo: 'Vende más los martes', detalle: '28% más que el resto de la semana.', confianza: 85, categoria: 'patron_compra' }], error: null }, []))),
      };

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
