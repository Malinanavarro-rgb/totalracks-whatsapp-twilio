'use strict';

const {
  ejecutarKCE, generarReporteTexto, listarAlertasPendientes,
  aplicarRefuerzo, fusionarAprendizajes, resolverAlerta, calcularKnowledgeScore,
} = require('../modules/kce');

function crearBuilder(resultado, llamadas) {
  const builder = {
    select: jest.fn((...a) => { llamadas.push(['select', ...a]); return builder; }),
    insert: jest.fn((...a) => { llamadas.push(['insert', ...a]); return builder; }),
    update: jest.fn((...a) => { llamadas.push(['update', ...a]); return builder; }),
    eq:     jest.fn((...a) => { llamadas.push(['eq', ...a]); return builder; }),
    in:     jest.fn((...a) => { llamadas.push(['in', ...a]); return builder; }),
    order:  jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then:   (resolve) => resolve(resultado),
  };
  return builder;
}

const COMPANY_A = 'company-a-0001';
const USUARIO_ID = 'user-1';

function crearOpenAIMock(comparaciones) {
  return { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ comparaciones }) } }] }) } } };
}

const AHORA = new Date();
function haceNDias(n) {
  return new Date(AHORA.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('kce', () => {
  describe('ejecutarKCE()', () => {
    test('exige company_id y usuario_id — nunca corre sin que un operador lo solicite', async () => {
      await expect(ejecutarKCE({ supabase: {}, openaiClient: {}, company_id: null, usuario_id: 'u1' })).rejects.toThrow('nunca corre sin que un operador');
      await expect(ejecutarKCE({ supabase: {}, openaiClient: {}, company_id: 'c1', usuario_id: null })).rejects.toThrow('nunca corre sin que un operador');
    });

    test('sin aprendizajes: reporte en cero, confianza_global=100, no llama a IA', async () => {
      const insertEjecucion = jest.fn().mockResolvedValue({ data: { id: 'ex1', aprendizajes_analizados: 0, refuerzos_sugeridos: 0, alertas_duplicado: 0, alertas_contradiccion: 0, alertas_obsolescencia: 0, cambios_aplicados: 0, confianza_global: 100 }, error: null });
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: [], error: null }, []);
          if (tabla === 'kce_ejecuciones') return { insert: () => ({ select: () => ({ single: insertEjecucion }) }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const openaiClient = { chat: { completions: { create: jest.fn() } } };

      const resultado = await ejecutarKCE({ supabase: db, openaiClient, company_id: COMPANY_A, usuario_id: USUARIO_ID });

      expect(openaiClient.chat.completions.create).not.toHaveBeenCalled();
      expect(resultado.ejecucion.confianza_global).toBe(100);
      expect(resultado.alertas).toEqual([]);
      expect(resultado.reporteTexto).toContain('Cambios aplicados: 0');
    });

    test('nunca escribe en memoria_empresarial — ni una sola vez, aunque encuentre coincidencias', async () => {
      const grupo = [
        { id: 'a1', company_id: COMPANY_A, categoria: 'patron_compra', cliente_id: null, titulo: 'Vende más los martes', detalle: 'x', evidencia: { resumen: 'y' }, confianza: 80, veces_confirmado: 1, estado: 'confirmado', activo: true, created_at: haceNDias(10), updated_at: haceNDias(5) },
        { id: 'a2', company_id: COMPANY_A, categoria: 'patron_compra', cliente_id: null, titulo: 'Vende mas los martes (variante)', detalle: 'x', evidencia: { resumen: 'y' }, confianza: 82, veces_confirmado: 1, estado: 'propuesto', activo: true, created_at: haceNDias(3), updated_at: haceNDias(3) },
      ];
      const llamadasMemoria = [];
      const insertEjecucion = jest.fn().mockResolvedValue({ data: { id: 'ex1', aprendizajes_analizados: 2, refuerzos_sugeridos: 1, alertas_duplicado: 0, alertas_contradiccion: 0, alertas_obsolescencia: 0, cambios_aplicados: 0, confianza_global: 90 }, error: null });
      const insertAlertas = jest.fn().mockResolvedValue({ data: [{ id: 'alerta-1', tipo: 'refuerzo_sugerido' }], error: null });

      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') {
            const b = crearBuilder({ data: grupo, error: null }, llamadasMemoria);
            return b;
          }
          if (tabla === 'kce_ejecuciones') return { insert: () => ({ select: () => ({ single: insertEjecucion }) }) };
          if (tabla === 'kce_alertas') return { insert: jest.fn((...a) => { insertAlertas(...a); return { select: () => insertAlertas.mock.results[insertAlertas.mock.results.length - 1].value }; }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const openaiClient = crearOpenAIMock([{ id_a: 'a1', id_b: 'a2', relacion: 'mismo', similitud_pct: 95, confianza_propuesta: 92, justificacion: 'mismo patrón, mismo texto en esencia', incremento_sugerido: 5 }]);

      await ejecutarKCE({ supabase: db, openaiClient, company_id: COMPANY_A, usuario_id: USUARIO_ID });

      const llamadasUpdate = llamadasMemoria.filter(l => l[0] === 'update' || l[0] === 'insert');
      expect(llamadasUpdate).toEqual([]); // ni un update ni un insert a memoria_empresarial
      expect(insertAlertas).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'refuerzo_sugerido', aprendizaje_id_a: 'a1', aprendizaje_id_b: 'a2' })]);
    });

    test('clasifica "similar" como posible_duplicado y "contradice" como contradiccion', async () => {
      const grupo = [
        { id: 'b1', company_id: COMPANY_A, categoria: 'temporada', cliente_id: null, titulo: 'A', detalle: 'x', evidencia: {}, confianza: 70, veces_confirmado: 1, estado: 'confirmado', activo: true, created_at: haceNDias(10), updated_at: haceNDias(5) },
        { id: 'b2', company_id: COMPANY_A, categoria: 'temporada', cliente_id: null, titulo: 'B', detalle: 'x', evidencia: {}, confianza: 70, veces_confirmado: 1, estado: 'confirmado', activo: true, created_at: haceNDias(10), updated_at: haceNDias(5) },
      ];
      const insertEjecucion = jest.fn().mockResolvedValue({ data: { id: 'ex1', aprendizajes_analizados: 2, refuerzos_sugeridos: 0, alertas_duplicado: 1, alertas_contradiccion: 0, alertas_obsolescencia: 0, cambios_aplicados: 0, confianza_global: 70 }, error: null });
      const insertAlertas = jest.fn().mockResolvedValue({ data: [], error: null });
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: grupo, error: null }, []);
          if (tabla === 'kce_ejecuciones') return { insert: () => ({ select: () => ({ single: insertEjecucion }) }) };
          if (tabla === 'kce_alertas') return { insert: jest.fn((...a) => { insertAlertas(...a); return { select: () => insertAlertas.mock.results[insertAlertas.mock.results.length - 1].value }; }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const openaiClient = crearOpenAIMock([{ id_a: 'b1', id_b: 'b2', relacion: 'similar', similitud_pct: 65, confianza_propuesta: 60, justificacion: 'parecidos pero no idénticos' }]);

      await ejecutarKCE({ supabase: db, openaiClient, company_id: COMPANY_A, usuario_id: USUARIO_ID });
      expect(insertAlertas).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'posible_duplicado' })]);
    });

    test('ignora comparaciones "ninguna" y filtra ids fuera del grupo o auto-referencias (defensivo ante alucinación de la IA)', async () => {
      const grupo = [
        { id: 'c1', company_id: COMPANY_A, categoria: 'riesgo', cliente_id: null, titulo: 'X', detalle: 'x', evidencia: {}, confianza: 70, veces_confirmado: 1, estado: 'confirmado', activo: true, created_at: haceNDias(1), updated_at: haceNDias(1) },
        { id: 'c2', company_id: COMPANY_A, categoria: 'riesgo', cliente_id: null, titulo: 'Y', detalle: 'x', evidencia: {}, confianza: 70, veces_confirmado: 1, estado: 'confirmado', activo: true, created_at: haceNDias(1), updated_at: haceNDias(1) },
      ];
      const insertEjecucion = jest.fn().mockResolvedValue({ data: { id: 'ex1' }, error: null });
      const insertAlertas = jest.fn().mockResolvedValue({ data: [], error: null });
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: grupo, error: null }, []);
          if (tabla === 'kce_ejecuciones') return { insert: () => ({ select: () => ({ single: insertEjecucion }) }) };
          if (tabla === 'kce_alertas') return { insert: jest.fn((...a) => { insertAlertas(...a); return { select: () => insertAlertas.mock.results[insertAlertas.mock.results.length - 1].value }; }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const openaiClient = crearOpenAIMock([
        { id_a: 'c1', id_b: 'c2', relacion: 'ninguna' },
        { id_a: 'c1', id_b: 'id-inventado-que-no-existe', relacion: 'mismo', confianza_propuesta: 99, incremento_sugerido: 10 },
        { id_a: 'c1', id_b: 'c1', relacion: 'mismo', confianza_propuesta: 99, incremento_sugerido: 10 },
      ]);

      await ejecutarKCE({ supabase: db, openaiClient, company_id: COMPANY_A, usuario_id: USUARIO_ID });
      expect(insertAlertas).not.toHaveBeenCalled(); // las 3 comparaciones se descartan (ninguna / id inválido / auto-referencia)
    });

    test('detecta obsolescencia determinística: confirmado sin refuerzo hace >=90 días', async () => {
      const lista = [
        { id: 'd1', company_id: COMPANY_A, categoria: 'temporada', cliente_id: null, titulo: 'Viejo', detalle: 'x', evidencia: {}, confianza: 80, veces_confirmado: 1, estado: 'confirmado', activo: true, created_at: haceNDias(200), updated_at: haceNDias(95) },
      ];
      const insertEjecucion = jest.fn().mockResolvedValue({ data: { id: 'ex1', alertas_obsolescencia: 1 }, error: null });
      const insertAlertas = jest.fn().mockResolvedValue({ data: [], error: null });
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: lista, error: null }, []);
          if (tabla === 'kce_ejecuciones') return { insert: () => ({ select: () => ({ single: insertEjecucion }) }) };
          if (tabla === 'kce_alertas') return { insert: jest.fn((...a) => { insertAlertas(...a); return { select: () => insertAlertas.mock.results[insertAlertas.mock.results.length - 1].value }; }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const openaiClient = { chat: { completions: { create: jest.fn() } } }; // ni se llama, es un solo elemento (sin grupo de 2+)

      await ejecutarKCE({ supabase: db, openaiClient, company_id: COMPANY_A, usuario_id: USUARIO_ID });
      expect(insertAlertas).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'posible_obsoleto', aprendizaje_id_a: 'd1' })]);
    });

    test('no marca obsolescencia si se reforzó hace menos de 90 días', async () => {
      const lista = [
        { id: 'e1', company_id: COMPANY_A, categoria: 'temporada', cliente_id: null, titulo: 'Reciente', detalle: 'x', evidencia: {}, confianza: 80, veces_confirmado: 1, estado: 'confirmado', activo: true, created_at: haceNDias(200), updated_at: haceNDias(10) },
      ];
      const insertEjecucion = jest.fn().mockResolvedValue({ data: { id: 'ex1' }, error: null });
      const insertAlertas = jest.fn().mockResolvedValue({ data: [], error: null });
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: lista, error: null }, []);
          if (tabla === 'kce_ejecuciones') return { insert: () => ({ select: () => ({ single: insertEjecucion }) }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      await ejecutarKCE({ supabase: db, openaiClient: { chat: { completions: { create: jest.fn() } } }, company_id: COMPANY_A, usuario_id: USUARIO_ID });
      expect(insertAlertas).not.toHaveBeenCalled();
    });
  });

  describe('generarReporteTexto()', () => {
    test('formatea exactamente el "Knowledge Consolidation Report" pedido', () => {
      const ejecucion = { aprendizajes_analizados: 186, refuerzos_sugeridos: 12, alertas_duplicado: 2, alertas_contradiccion: 1, alertas_obsolescencia: 3, cambios_aplicados: 0, confianza_global: 94 };
      const texto = generarReporteTexto(ejecucion, 'Salud y Belleza');
      expect(texto).toContain('Knowledge Consolidation Report');
      expect(texto).toContain('Empresa: Salud y Belleza');
      expect(texto).toContain('Analizados: 186 aprendizajes');
      expect(texto).toContain('Refuerzos sugeridos: 12');
      expect(texto).toContain('Posibles duplicados: 2');
      expect(texto).toContain('Posibles contradicciones: 1');
      expect(texto).toContain('Posibles obsoletos: 3');
      expect(texto).toContain('Cambios aplicados: 0');
      expect(texto).toContain('Acciones pendientes: 18'); // 12+2+1+3
      expect(texto).toContain('Nivel de confianza global: 94%');
    });

    test('sin nombreEmpresa: omite esa línea sin romper', () => {
      const texto = generarReporteTexto({ aprendizajes_analizados: 0, refuerzos_sugeridos: 0, alertas_duplicado: 0, alertas_contradiccion: 0, alertas_obsolescencia: 0, cambios_aplicados: 0, confianza_global: 100 });
      expect(texto).not.toContain('Empresa:');
    });
  });

  describe('listarAlertasPendientes()', () => {
    test('filtra por company_id y estado=pendiente', async () => {
      const llamadas = [];
      const db = { from: jest.fn(() => crearBuilder({ data: [{ id: 'al1' }], error: null }, llamadas)) };
      const resultado = await listarAlertasPendientes(db, COMPANY_A);
      expect(resultado).toEqual([{ id: 'al1' }]);
      expect(llamadas).toContainEqual(['eq', 'estado', 'pendiente']);
    });
  });

  describe('aplicarRefuerzo()', () => {
    test('sube la confianza (tope 100), incrementa veces_confirmado, y marca la alerta aplicada', async () => {
      let llamadaMemoria = 0;
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'kce_alertas') {
            return crearBuilder({ data: { id: 'alerta-1', aprendizaje_id_a: 'a1', incremento_sugerido: 15, tipo: 'refuerzo_sugerido', estado: 'pendiente' }, error: null }, []);
          }
          if (tabla === 'memoria_empresarial') {
            llamadaMemoria++;
            if (llamadaMemoria === 1) return crearBuilder({ data: { id: 'a1', confianza: 85, veces_confirmado: 2, estado: 'confirmado' }, error: null }, []);
            return crearBuilder({ data: { id: 'a1', confianza: 95, veces_confirmado: 3 }, error: null }, []);
          }
          return crearBuilder({ data: null, error: null }, []);
        }),
      };

      const resultado = await aplicarRefuerzo(db, COMPANY_A, 'alerta-1', USUARIO_ID);
      expect(resultado.confianza).toBe(95);
    });

    test('tope de confianza en 100 aunque el incremento la pasara', async () => {
      let llamadaMemoria = 0;
      const llamadasSegundoUpdate = [];
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'kce_alertas') {
            return crearBuilder({ data: { id: 'alerta-1', aprendizaje_id_a: 'a1', incremento_sugerido: 15, tipo: 'refuerzo_sugerido', estado: 'pendiente' }, error: null }, []);
          }
          if (tabla === 'memoria_empresarial') {
            llamadaMemoria++;
            if (llamadaMemoria === 1) return crearBuilder({ data: { id: 'a1', confianza: 95, veces_confirmado: 2, estado: 'confirmado' }, error: null }, []);
            return crearBuilder({ data: { id: 'a1', confianza: 100 }, error: null }, llamadasSegundoUpdate);
          }
          return crearBuilder({ data: null, error: null }, []);
        }),
      };

      await aplicarRefuerzo(db, COMPANY_A, 'alerta-1', USUARIO_ID);
      const llamadaUpdate = llamadasSegundoUpdate.find(l => l[0] === 'update');
      expect(llamadaUpdate[1].confianza).toBe(100);
    });

    test('lanza si la alerta no existe o ya fue revisada', async () => {
      const db = { from: jest.fn(() => crearBuilder({ data: null, error: null }, [])) };
      await expect(aplicarRefuerzo(db, COMPANY_A, 'alerta-x', USUARIO_ID)).rejects.toThrow('no existe');
    });

    test('lanza si el aprendizaje ya no está en estado reforzable (cambió desde que el KCE corrió)', async () => {
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'kce_alertas') return crearBuilder({ data: { id: 'alerta-1', aprendizaje_id_a: 'a1', incremento_sugerido: 5, tipo: 'refuerzo_sugerido', estado: 'pendiente' }, error: null }, []);
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: { id: 'a1', confianza: 85, veces_confirmado: 2, estado: 'rechazado' }, error: null }, []);
          return crearBuilder({ data: null, error: null }, []);
        }),
      };
      await expect(aplicarRefuerzo(db, COMPANY_A, 'alerta-1', USUARIO_ID)).rejects.toThrow('ya no está en un estado reforzable');
    });
  });

  describe('fusionarAprendizajes()', () => {
    test('requiere razon', async () => {
      await expect(fusionarAprendizajes({}, COMPANY_A, 'a1', 'a2', USUARIO_ID, '')).rejects.toThrow('razon es requerida');
    });

    test('no permite conservar y descartar el mismo id', async () => {
      await expect(fusionarAprendizajes({}, COMPANY_A, 'a1', 'a1', USUARIO_ID, 'x')).rejects.toThrow('no pueden ser el mismo');
    });

    test('descarta (rechaza) el id_descartar, sin importar si era propuesto o confirmado', async () => {
      const llamadas = [];
      const db = { from: jest.fn(() => crearBuilder({ data: { id: 'a2', estado: 'rechazado' }, error: null }, llamadas)) };
      const resultado = await fusionarAprendizajes(db, COMPANY_A, 'a1', 'a2', USUARIO_ID, 'son el mismo patrón');
      expect(resultado.estado).toBe('rechazado');
      const llamadaUpdate = llamadas.find(l => l[0] === 'update');
      expect(llamadaUpdate[1].razon_rechazo).toContain('a1');
    });

    test('lanza si el id_descartar no existe/no pertenece a la empresa/ya no es válido', async () => {
      const db = { from: jest.fn(() => crearBuilder({ data: null, error: { message: 'no rows' } }, [])) };
      await expect(fusionarAprendizajes(db, COMPANY_A, 'a1', 'a2', USUARIO_ID, 'x')).rejects.toThrow('no se pudo descartar');
    });
  });

  describe('resolverAlerta()', () => {
    test('requiere accion_tomada', async () => {
      await expect(resolverAlerta({}, COMPANY_A, 'al1', USUARIO_ID, '')).rejects.toThrow('accion_tomada es requerida');
    });

    test('marca la alerta aplicada con la acción y razón', async () => {
      const llamadas = [];
      const db = { from: jest.fn(() => crearBuilder({ data: { id: 'al1', estado: 'aplicada' }, error: null }, llamadas)) };
      const resultado = await resolverAlerta(db, COMPANY_A, 'al1', USUARIO_ID, 'confirmado_obsoleto', 'ya no aplica');
      expect(resultado.estado).toBe('aplicada');
      const llamadaUpdate = llamadas.find(l => l[0] === 'update');
      expect(llamadaUpdate[1].accion_tomada).toBe('confirmado_obsoleto: ya no aplica');
    });

    test('lanza si la alerta no existe o ya no está pendiente', async () => {
      const db = { from: jest.fn(() => crearBuilder({ data: null, error: null }, [])) };
      await expect(resolverAlerta(db, COMPANY_A, 'al1', USUARIO_ID, 'ignorada')).rejects.toThrow('no existe');
    });
  });

  describe('calcularKnowledgeScore()', () => {
    test('sin ningún aprendizaje: score 0 en cantidad/calidad/frecuencia, estabilidad y ausenciaContradicciones al máximo', async () => {
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: [], error: null }, []);
          if (tabla === 'kce_alertas') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }) }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const { score, desglose } = await calcularKnowledgeScore(db, COMPANY_A);
      expect(desglose.cantidad).toBe(0);
      expect(desglose.calidadEvidencia).toBe(0);
      expect(desglose.estabilidad).toBe(100);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    test('con confirmados de alta confianza recientes y sin contradicciones: score alto', async () => {
      const confirmados = Array.from({ length: 10 }, (_, i) => ({ estado: 'confirmado', confianza: 90, updated_at: haceNDias(5) }));
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: confirmados, error: null }, []);
          if (tabla === 'kce_alertas') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }) }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const { score, desglose } = await calcularKnowledgeScore(db, COMPANY_A);
      expect(desglose.calidadEvidencia).toBe(90);
      expect(desglose.frecuencia).toBe(100);
      expect(desglose.ausenciaContradicciones).toBe(100);
      expect(score).toBeGreaterThan(70);
    });

    test('cada contradicción pendiente penaliza el componente de ausenciaContradicciones', async () => {
      const db = {
        from: jest.fn((tabla) => {
          if (tabla === 'memoria_empresarial') return crearBuilder({ data: [{ estado: 'confirmado', confianza: 80, updated_at: haceNDias(5) }], error: null }, []);
          if (tabla === 'kce_alertas') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 3, error: null }) }) }) }) };
          return crearBuilder({ data: [], error: null }, []);
        }),
      };
      const { desglose } = await calcularKnowledgeScore(db, COMPANY_A);
      expect(desglose.ausenciaContradicciones).toBe(40); // 100 - 3*20
    });
  });
});
