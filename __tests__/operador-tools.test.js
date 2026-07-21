'use strict';

const {
  tareasAbiertas, proyectosEnRiesgo, decisionesRecientes, buscarDocumentos,
  resumenPipeline, buscarCliente, ejecutarTool, CATALOGO_TOOLS,
} = require('../modules/operador-tools');

// ─── Mock builder: registra cada llamada (.eq/.in/.or) para poder afirmar
// exactamente qué filtro de alcance se aplicó — el punto más crítico del
// módulo (nunca debe cruzar company_id) ─────────────────────────────────────

function crearBuilder(resultado, llamadas) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn((...args) => { llamadas.push(['eq', ...args]); return builder; }),
    in:     jest.fn((...args) => { llamadas.push(['in', ...args]); return builder; }),
    or:     jest.fn((...args) => { llamadas.push(['or', ...args]); return builder; }),
    gte:    jest.fn((...args) => { llamadas.push(['gte', ...args]); return builder; }),
    ilike:  jest.fn((...args) => { llamadas.push(['ilike', ...args]); return builder; }),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockResolvedValue(resultado),
    then:   (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(resolvers) {
  const llamadas = {};
  const db = {
    from: jest.fn((tabla) => {
      llamadas[tabla] = llamadas[tabla] || [];
      const resultado = resolvers[tabla] ? resolvers[tabla]() : { data: [], error: null };
      return crearBuilder(resultado, llamadas[tabla]);
    }),
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const COMPANY_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const ORG_1      = 'org-1111';

describe('operador-tools', () => {
  describe('alcance "empresa" — aísla a una sola compañía', () => {
    test('tareasAbiertas() filtra con .eq company_id, nunca .in', async () => {
      const db = crearMockDb({ tareas: () => ({ data: [{ id: 't1' }], error: null }) });
      const alcance = { nivel: 'empresa', company_id: COMPANY_A };

      await tareasAbiertas(db, alcance);

      const llamadaEq = db._llamadas.tareas.find(l => l[0] === 'eq' && l[1] === 'company_id');
      expect(llamadaEq).toEqual(['eq', 'company_id', COMPANY_A]);
      expect(db._llamadas.tareas.some(l => l[0] === 'in' && l[1] === 'company_id')).toBe(false);
    });

    test('buscarCliente() nunca ve otra compañía aunque el nombre coincida en ambas', async () => {
      const db = crearMockDb({ clientes: () => ({ data: [{ id: 1, nombre: 'Ana', company_id: COMPANY_A }], error: null }) });
      const alcance = { nivel: 'empresa', company_id: COMPANY_A };

      const resultado = await buscarCliente(db, alcance, { nombre: 'Ana' });

      expect(db._llamadas.clientes).toContainEqual(['eq', 'company_id', COMPANY_A]);
      expect(resultado).toEqual([{ id: 1, nombre: 'Ana', company_id: COMPANY_A }]);
    });

    test('alcance "empresa" sin company_id (defensivo) nunca regresa filas de nadie', async () => {
      const db = crearMockDb({ tareas: () => ({ data: [{ id: 'no-deberia-verse' }], error: null }) });
      const alcance = { nivel: 'empresa' }; // sin company_id — caso anómalo

      await tareasAbiertas(db, alcance);

      // Debe filtrar por un UUID imposible, nunca dejar la query sin filtro
      expect(db._llamadas.tareas.some(l => l[0] === 'eq' && l[1] === 'company_id' && l[2] === '00000000-0000-0000-0000-000000000000')).toBe(true);
    });
  });

  describe('alcance "organizacion" — resuelve companies de esa organización primero', () => {
    test('proyectosEnRiesgo() usa .in con los company_id de la organización', async () => {
      const db = crearMockDb({
        companies: () => ({ data: [{ id: COMPANY_A }, { id: COMPANY_B }], error: null }),
        proyectos: () => ({ data: [], error: null }),
      });
      const alcance = { nivel: 'organizacion', organization_id: ORG_1 };

      await proyectosEnRiesgo(db, alcance);

      expect(db._llamadas.companies).toContainEqual(['eq', 'organization_id', ORG_1]);
      expect(db._llamadas.proyectos).toContainEqual(['in', 'company_id', [COMPANY_A, COMPANY_B]]);
    });

    test('organización con una sola empresa usa .eq, no .in', async () => {
      const db = crearMockDb({
        companies: () => ({ data: [{ id: COMPANY_A }], error: null }),
        proyectos: () => ({ data: [], error: null }),
      });
      const alcance = { nivel: 'organizacion', organization_id: ORG_1 };

      await proyectosEnRiesgo(db, alcance);

      expect(db._llamadas.proyectos).toContainEqual(['eq', 'company_id', COMPANY_A]);
    });
  });

  describe('alcance "plataforma" — sin filtro, ve todo el ecosistema autorizado', () => {
    test('decisionesRecientes() no aplica ningún filtro de company_id', async () => {
      const db = crearMockDb({ bitacora_decisiones: () => ({ data: [], error: null }) });
      const alcance = { nivel: 'plataforma' };

      await decisionesRecientes(db, alcance);

      expect(db._llamadas.bitacora_decisiones.some(l => l[0] === 'eq' && l[1] === 'company_id')).toBe(false);
      expect(db._llamadas.bitacora_decisiones.some(l => l[0] === 'in' && l[1] === 'company_id')).toBe(false);
      expect(db._llamadas.bitacora_decisiones.some(l => l[0] === 'gte')).toBe(true);
    });

    test('resumenPipeline() agrupa por estado sin filtrar company', async () => {
      const db = crearMockDb({
        oportunidades: () => ({ data: [{ estado: 'Nuevo' }, { estado: 'Nuevo' }, { estado: 'Ganado' }], error: null }),
      });
      const resultado = await resumenPipeline(db, { nivel: 'plataforma' });
      expect(resultado).toEqual({ Nuevo: 2, Ganado: 1 });
    });
  });

  describe('buscarDocumentos()', () => {
    test('aplica .or sobre titulo/contenido cuando se da texto', async () => {
      const db = crearMockDb({ documentos: () => ({ data: [], error: null }) });
      await buscarDocumentos(db, { nivel: 'empresa', company_id: COMPANY_A }, { texto: 'contrato' });
      expect(db._llamadas.documentos.some(l => l[0] === 'or' && l[1].includes('contrato'))).toBe(true);
    });
  });

  describe('errores de Supabase: nunca lanzan, regresan vacío', () => {
    test('tareasAbiertas() con error → arreglo vacío', async () => {
      const db = crearMockDb({ tareas: () => ({ data: null, error: { message: 'fallo' } }) });
      expect(await tareasAbiertas(db, { nivel: 'empresa', company_id: COMPANY_A })).toEqual([]);
    });
  });

  describe('ejecutarTool() — dispatcher', () => {
    test('despacha por nombre y aplica el alcance', async () => {
      const db = crearMockDb({ tareas: () => ({ data: [{ id: 't1' }], error: null }) });
      const resultado = await ejecutarTool('tareas_abiertas', { limite: 5 }, db, { nivel: 'empresa', company_id: COMPANY_A });
      expect(resultado).toEqual([{ id: 't1' }]);
      expect(db._llamadas.tareas).toContainEqual(['eq', 'company_id', COMPANY_A]);
    });

    test('tool desconocida lanza error explícito', async () => {
      const db = crearMockDb({});
      await expect(ejecutarTool('tool_inventada', {}, db, { nivel: 'empresa', company_id: COMPANY_A }))
        .rejects.toThrow(/tool desconocida/);
    });

    test('argumentos undefined no lanza (dispatcher los normaliza a {})', async () => {
      const db = crearMockDb({ oportunidades: () => ({ data: [], error: null }) });
      await expect(ejecutarTool('resumen_pipeline', undefined, db, { nivel: 'plataforma' })).resolves.toEqual({});
    });
  });

  describe('CATALOGO_TOOLS', () => {
    test('ninguna tool expone company_id/organization_id como parámetro al modelo', () => {
      for (const tool of CATALOGO_TOOLS) {
        const props = Object.keys(tool.function.parameters.properties || {});
        expect(props).not.toContain('company_id');
        expect(props).not.toContain('organization_id');
      }
    });

    test('cada tool del catálogo tiene una implementación registrada', async () => {
      const db = crearMockDb({});
      for (const tool of CATALOGO_TOOLS) {
        // No debe lanzar "tool desconocida" — confirma que IMPLEMENTACIONES cubre el catálogo completo.
        await expect(ejecutarTool(tool.function.name, {}, db, { nivel: 'plataforma' })).resolves.toBeDefined();
      }
    });
  });
});
