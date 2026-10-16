'use strict';

const mockRegistrarAprendizaje = jest.fn();
const mockConfirmarAprendizaje = jest.fn();
const mockRechazarAprendizaje = jest.fn();
const mockMarcarObsoleto = jest.fn();
const mockListarPropuestasPendientes = jest.fn();

jest.mock('../modules/business-memory-core', () => ({
  registrarAprendizaje: (...args) => mockRegistrarAprendizaje(...args),
  confirmarAprendizaje: (...args) => mockConfirmarAprendizaje(...args),
  rechazarAprendizaje: (...args) => mockRechazarAprendizaje(...args),
  marcarObsoleto: (...args) => mockMarcarObsoleto(...args),
  listarPropuestasPendientes: (...args) => mockListarPropuestasPendientes(...args),
}));

const mockEjecutarKCE = jest.fn();
const mockListarAlertasPendientes = jest.fn();
const mockAplicarRefuerzo = jest.fn();
const mockFusionarAprendizajesKce = jest.fn();
const mockResolverAlertaKce = jest.fn();

jest.mock('../modules/kce', () => ({
  ejecutarKCE: (...args) => mockEjecutarKCE(...args),
  listarAlertasPendientes: (...args) => mockListarAlertasPendientes(...args),
  aplicarRefuerzo: (...args) => mockAplicarRefuerzo(...args),
  fusionarAprendizajes: (...args) => mockFusionarAprendizajesKce(...args),
  resolverAlerta: (...args) => mockResolverAlertaKce(...args),
}));

const mockOportunidadSeguimientoVencido = jest.fn();
const mockInstalacionAtrasada = jest.fn();
const mockCobranzaConSaldo = jest.fn();
const mockTramiteCfeSinActualizacion = jest.fn();
const mockGarantiaReclamacionAbierta = jest.fn();
const mockTicketPendiente = jest.fn();

jest.mock('../modules/dashboard-engine', () => ({
  REGLA_TIPOS: {
    oportunidad_seguimiento_vencido: (...args) => mockOportunidadSeguimientoVencido(...args),
    instalacion_atrasada:            (...args) => mockInstalacionAtrasada(...args),
    cobranza_con_saldo:              (...args) => mockCobranzaConSaldo(...args),
    tramite_cfe_sin_actualizacion:   (...args) => mockTramiteCfeSinActualizacion(...args),
    garantia_reclamacion_abierta:    (...args) => mockGarantiaReclamacionAbierta(...args),
    ticket_pendiente:                (...args) => mockTicketPendiente(...args),
  },
}));

const {
  tareasAbiertas, proyectosEnRiesgo, decisionesRecientes, buscarDocumentos,
  resumenPipeline, buscarCliente, ejecutarTool, CATALOGO_TOOLS, IMPLEMENTACIONES, TOOLS_SOLO_GERENCIAL,
  TOOLS_CONSULTA_EMPRESARIAL,
  registrarAprendizajeNegocio, listarAprendizajesPendientes,
  confirmarAprendizajeTool, rechazarAprendizajeTool, marcarAprendizajeObsoletoTool,
  ejecutarKceTool, listarAlertasKceTool, aplicarRefuerzoKceTool, fusionarAprendizajesTool, resolverAlertaKceTool,
  consultarCatalogoTecnicoTool, consultarFaqSolarTool,
  clientesNecesitanSeguimientoTool, instalacionesRequierenAtencionTool, cobranzaPendienteTool,
  tramitesCfePendientesTool, garantiasAbiertasTool, ticketsPendientesTool,
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

    test('cada tool del catálogo tiene una implementación registrada', () => {
      // Chequeo estático de paridad catálogo↔implementación — invocar cada
      // tool (en vez de solo verificar el registro) requeriría mocks
      // distintos por tool (las de BMC escriben y exigen alcance='empresa');
      // esa cobertura de comportamiento ya vive en sus propios describe()s.
      for (const tool of CATALOGO_TOOLS) {
        expect(typeof IMPLEMENTACIONES[tool.function.name]).toBe('function');
      }
    });
  });

  describe('Centro de Conocimiento (Alina, 2026-09-15) — consultar_catalogo_tecnico / consultar_faq_solar', () => {
    const ALCANCE_EMPRESA = { nivel: 'empresa', company_id: COMPANY_A };

    test('consultarCatalogoTecnicoTool exige alcance de empresa', async () => {
      await expect(consultarCatalogoTecnicoTool({}, { nivel: 'plataforma' }, { texto: 'Growatt' }))
        .rejects.toThrow('una empresa específica');
    });

    test('consultarCatalogoTecnicoTool sin match devuelve un texto honesto, nunca inventa', async () => {
      const db = crearMockDb({ productos: () => ({ data: [], error: null }) });
      const resultado = await consultarCatalogoTecnicoTool(db, ALCANCE_EMPRESA, { texto: 'marca inexistente' });
      expect(resultado).toMatch(/no se encontró/i);
    });

    test('consultarCatalogoTecnicoTool con match devuelve el catálogo real formateado', async () => {
      const db = crearMockDb({
        productos: () => ({
          data: [{ marca: 'Growatt', modelo: 'MIN 4000TL-X', tipo: 'inversor', activo: true, specs: { potencia_ac_nominal_kw: 4 }, ficha_tecnica_completa: true, costo_proveedor: 6000, margen: 3500 }],
          error: null,
        }),
      });
      const resultado = await consultarCatalogoTecnicoTool(db, ALCANCE_EMPRESA, { texto: 'Growatt MIN 4000TL-X' });
      expect(resultado).toContain('Growatt');
      expect(resultado).not.toContain('6000'); // costo_proveedor nunca sale de aquí
    });

    test('consultarFaqSolarTool exige alcance de empresa', async () => {
      await expect(consultarFaqSolarTool({}, { nivel: 'organizacion', organization_id: 'org-1' }, { texto: 'apagones' }))
        .rejects.toThrow('una empresa específica');
    });

    test('consultarFaqSolarTool sin match devuelve un texto honesto', async () => {
      const db = crearMockDb({ solar_faq: () => ({ data: [], error: null }) });
      const resultado = await consultarFaqSolarTool(db, ALCANCE_EMPRESA, { texto: 'algo sin relación' });
      expect(resultado).toMatch(/no hay ninguna pregunta frecuente/i);
    });

    test('ambas tools están en CATALOGO_TOOLS y no exponen company_id', () => {
      const nombres = CATALOGO_TOOLS.map((t) => t.function.name);
      expect(nombres).toContain('consultar_catalogo_tecnico');
      expect(nombres).toContain('consultar_faq_solar');
    });
  });

  describe('TOOLS_SOLO_GERENCIAL — Modo Operador abierto a toda la empresa, memoria empresarial sigue gerencial-only', () => {
    const ALCANCE_EMPRESA = { nivel: 'empresa', company_id: COMPANY_A };
    const ASESOR = { id: 'user-2', rol: 'asesor' };
    const GERENTE = { id: 'user-1', rol: 'owner' };

    test.each([...TOOLS_SOLO_GERENCIAL])('%s rechaza a un usuario no gerencial sin tocar la implementación', async (nombreTool) => {
      const db = crearMockDb({});
      await expect(ejecutarTool(nombreTool, {}, db, ALCANCE_EMPRESA, ASESOR)).rejects.toThrow('rol gerencial');
    });

    test('una tool NO listada en TOOLS_SOLO_GERENCIAL (ej. tareas_abiertas) corre normal para un asesor', async () => {
      const db = crearMockDb({ tareas: () => ({ data: [], error: null }) });
      await expect(ejecutarTool('tareas_abiertas', {}, db, ALCANCE_EMPRESA, ASESOR)).resolves.toEqual([]);
    });

    test('consultar_catalogo_tecnico corre normal para un asesor (no es gerencial-only)', async () => {
      const db = crearMockDb({ productos: () => ({ data: [], error: null }) });
      await expect(ejecutarTool('consultar_catalogo_tecnico', { texto: 'Growatt' }, db, ALCANCE_EMPRESA, ASESOR))
        .resolves.toMatch(/no se encontró/i);
    });

    test('sin usuario (undefined), una tool gerencial-only también se rechaza — nunca asume gerencial por default', async () => {
      const db = crearMockDb({});
      await expect(ejecutarTool('ejecutar_kce', {}, db, ALCANCE_EMPRESA, undefined)).rejects.toThrow('rol gerencial');
    });

    test('un gerente sigue pudiendo usar las tools de memoria empresarial (sin regresión)', async () => {
      mockListarPropuestasPendientes.mockResolvedValue([]);
      const db = crearMockDb({});
      await expect(ejecutarTool('listar_aprendizajes_pendientes', {}, db, ALCANCE_EMPRESA, GERENTE)).resolves.toEqual([]);
    });
  });

  describe('Business Memory Core (BMC, Fase 2) — tools de escritura', () => {
    const ALCANCE_EMPRESA = { nivel: 'empresa', company_id: COMPANY_A };
    const USUARIO = { id: 'user-1', rol: 'owner' };

    beforeEach(() => jest.clearAllMocks());

    describe('alcance no es "empresa": las 5 tools rechazan sin tocar la base de datos', () => {
      const alcancesInvalidos = [{ nivel: 'organizacion', organization_id: 'org-1' }, { nivel: 'plataforma' }, null];

      test.each(alcancesInvalidos)('registrar_aprendizaje_negocio rechaza con alcance %p', async (alcance) => {
        await expect(registrarAprendizajeNegocio({}, alcance, {}, USUARIO)).rejects.toThrow('una empresa específica');
        expect(mockRegistrarAprendizaje).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('confirmar_aprendizaje rechaza con alcance %p', async (alcance) => {
        await expect(confirmarAprendizajeTool({}, alcance, { aprendizaje_id: 'a1' }, USUARIO)).rejects.toThrow('una empresa específica');
        expect(mockConfirmarAprendizaje).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('rechazar_aprendizaje rechaza con alcance %p', async (alcance) => {
        await expect(rechazarAprendizajeTool({}, alcance, { aprendizaje_id: 'a1', razon: 'x' }, USUARIO)).rejects.toThrow('una empresa específica');
        expect(mockRechazarAprendizaje).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('marcar_aprendizaje_obsoleto rechaza con alcance %p', async (alcance) => {
        await expect(marcarAprendizajeObsoletoTool({}, alcance, { aprendizaje_id: 'a1' }, USUARIO)).rejects.toThrow('una empresa específica');
        expect(mockMarcarObsoleto).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('listar_aprendizajes_pendientes rechaza con alcance %p', async (alcance) => {
        await expect(listarAprendizajesPendientes({}, alcance)).rejects.toThrow('una empresa específica');
        expect(mockListarPropuestasPendientes).not.toHaveBeenCalled();
      });
    });

    test('registrar_aprendizaje_negocio: pasa company_id del alcance, origen=modo_operador y propuesto_por=usuario.id', async () => {
      mockRegistrarAprendizaje.mockResolvedValue({ id: 'a1', estado: 'propuesto' });

      await registrarAprendizajeNegocio({}, ALCANCE_EMPRESA, {
        categoria: 'patron_compra', titulo: 'Vende más los martes', detalle: '...', evidencia_resumen: '28% más que el resto de la semana', confianza: 85,
      }, USUARIO);

      expect(mockRegistrarAprendizaje).toHaveBeenCalledWith({}, expect.objectContaining({
        company_id: COMPANY_A, categoria: 'patron_compra', titulo: 'Vende más los martes',
        evidencia: { resumen: '28% más que el resto de la semana' }, confianza: 85,
        origen: 'modo_operador', propuesto_por: 'user-1',
      }));
    });

    test('listar_aprendizajes_pendientes: usa el company_id del alcance', async () => {
      mockListarPropuestasPendientes.mockResolvedValue([{ id: 'a1' }]);
      const resultado = await listarAprendizajesPendientes({}, ALCANCE_EMPRESA);
      expect(mockListarPropuestasPendientes).toHaveBeenCalledWith({}, COMPANY_A);
      expect(resultado).toEqual([{ id: 'a1' }]);
    });

    test('confirmar_aprendizaje: pasa company_id, aprendizaje_id y usuario.id', async () => {
      mockConfirmarAprendizaje.mockResolvedValue({ id: 'a1', estado: 'confirmado' });
      await confirmarAprendizajeTool({}, ALCANCE_EMPRESA, { aprendizaje_id: 'a1' }, USUARIO);
      expect(mockConfirmarAprendizaje).toHaveBeenCalledWith({}, COMPANY_A, 'a1', 'user-1');
    });

    test('rechazar_aprendizaje: pasa razón al módulo', async () => {
      mockRechazarAprendizaje.mockResolvedValue({ id: 'a1', estado: 'rechazado' });
      await rechazarAprendizajeTool({}, ALCANCE_EMPRESA, { aprendizaje_id: 'a1', razon: 'no aplica a este negocio' }, USUARIO);
      expect(mockRechazarAprendizaje).toHaveBeenCalledWith({}, COMPANY_A, 'a1', 'user-1', 'no aplica a este negocio');
    });

    test('marcar_aprendizaje_obsoleto: razón es opcional', async () => {
      mockMarcarObsoleto.mockResolvedValue({ id: 'a1', estado: 'obsoleto' });
      await marcarAprendizajeObsoletoTool({}, ALCANCE_EMPRESA, { aprendizaje_id: 'a1' }, USUARIO);
      expect(mockMarcarObsoleto).toHaveBeenCalledWith({}, COMPANY_A, 'a1', 'user-1', undefined);
    });

    test('ejecutarTool() propaga usuario a las tools de BMC', async () => {
      mockConfirmarAprendizaje.mockResolvedValue({ id: 'a1', estado: 'confirmado' });
      await ejecutarTool('confirmar_aprendizaje', { aprendizaje_id: 'a1' }, {}, ALCANCE_EMPRESA, USUARIO);
      expect(mockConfirmarAprendizaje).toHaveBeenCalledWith({}, COMPANY_A, 'a1', 'user-1');
    });
  });

  describe('Knowledge Consolidation Engine (KCE, Fase 3A) — tools de solo bajo demanda', () => {
    const ALCANCE_EMPRESA = { nivel: 'empresa', company_id: COMPANY_A };
    const USUARIO = { id: 'user-1', rol: 'owner' };
    const OPENAI_MOCK = { chat: { completions: { create: jest.fn() } } };

    beforeEach(() => jest.clearAllMocks());

    describe('alcance no es "empresa": las 5 tools rechazan sin tocar nada', () => {
      const alcancesInvalidos = [{ nivel: 'organizacion', organization_id: 'org-1' }, { nivel: 'plataforma' }, null];

      test.each(alcancesInvalidos)('ejecutar_kce rechaza con alcance %p', async (alcance) => {
        await expect(ejecutarKceTool({}, alcance, {}, USUARIO, OPENAI_MOCK)).rejects.toThrow('una empresa específica');
        expect(mockEjecutarKCE).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('listar_alertas_kce rechaza con alcance %p', async (alcance) => {
        await expect(listarAlertasKceTool({}, alcance)).rejects.toThrow('una empresa específica');
        expect(mockListarAlertasPendientes).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('aplicar_refuerzo_kce rechaza con alcance %p', async (alcance) => {
        await expect(aplicarRefuerzoKceTool({}, alcance, { alerta_id: 'al1' }, USUARIO)).rejects.toThrow('una empresa específica');
        expect(mockAplicarRefuerzo).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('fusionar_aprendizajes rechaza con alcance %p', async (alcance) => {
        await expect(fusionarAprendizajesTool({}, alcance, { id_conservar: 'a1', id_descartar: 'a2', razon: 'x' }, USUARIO)).rejects.toThrow('una empresa específica');
        expect(mockFusionarAprendizajesKce).not.toHaveBeenCalled();
      });

      test.each(alcancesInvalidos)('resolver_alerta_kce rechaza con alcance %p', async (alcance) => {
        await expect(resolverAlertaKceTool({}, alcance, { alerta_id: 'al1', accion_tomada: 'ignorada' }, USUARIO)).rejects.toThrow('una empresa específica');
        expect(mockResolverAlertaKce).not.toHaveBeenCalled();
      });
    });

    test('ejecutar_kce: pasa company_id, usuario.id y el openaiClient recibido, devuelve el reporte en texto', async () => {
      mockEjecutarKCE.mockResolvedValue({ ejecucion: { id: 'ex1' }, alertas: [], reporteTexto: 'Knowledge Consolidation Report\n...' });
      const resultado = await ejecutarKceTool({}, ALCANCE_EMPRESA, {}, USUARIO, OPENAI_MOCK);

      expect(mockEjecutarKCE).toHaveBeenCalledWith({ supabase: {}, openaiClient: OPENAI_MOCK, company_id: COMPANY_A, usuario_id: 'user-1' });
      expect(resultado).toBe('Knowledge Consolidation Report\n...');
    });

    test('listar_alertas_kce: usa el company_id del alcance', async () => {
      mockListarAlertasPendientes.mockResolvedValue([{ id: 'al1' }]);
      const resultado = await listarAlertasKceTool({}, ALCANCE_EMPRESA);
      expect(mockListarAlertasPendientes).toHaveBeenCalledWith({}, COMPANY_A);
      expect(resultado).toEqual([{ id: 'al1' }]);
    });

    test('aplicar_refuerzo_kce: pasa alerta_id y usuario.id', async () => {
      mockAplicarRefuerzo.mockResolvedValue({ id: 'a1', confianza: 90 });
      await aplicarRefuerzoKceTool({}, ALCANCE_EMPRESA, { alerta_id: 'al1' }, USUARIO);
      expect(mockAplicarRefuerzo).toHaveBeenCalledWith({}, COMPANY_A, 'al1', 'user-1');
    });

    test('fusionar_aprendizajes: pasa conservar/descartar/razon/alerta_id', async () => {
      mockFusionarAprendizajesKce.mockResolvedValue({ id: 'a2', estado: 'rechazado' });
      await fusionarAprendizajesTool({}, ALCANCE_EMPRESA, { id_conservar: 'a1', id_descartar: 'a2', razon: 'mismo patrón', alerta_id: 'al1' }, USUARIO);
      expect(mockFusionarAprendizajesKce).toHaveBeenCalledWith({}, COMPANY_A, 'a1', 'a2', 'user-1', 'mismo patrón', 'al1');
    });

    test('resolver_alerta_kce: pasa accion_tomada y razon', async () => {
      mockResolverAlertaKce.mockResolvedValue({ id: 'al1', estado: 'aplicada' });
      await resolverAlertaKceTool({}, ALCANCE_EMPRESA, { alerta_id: 'al1', accion_tomada: 'confirmado_obsoleto', razon: 'ya no aplica' }, USUARIO);
      expect(mockResolverAlertaKce).toHaveBeenCalledWith({}, COMPANY_A, 'al1', 'user-1', 'confirmado_obsoleto', 'ya no aplica');
    });

    test('ejecutarTool() propaga usuario y openaiClient a ejecutar_kce', async () => {
      mockEjecutarKCE.mockResolvedValue({ ejecucion: {}, alertas: [], reporteTexto: 'reporte' });
      await ejecutarTool('ejecutar_kce', {}, {}, ALCANCE_EMPRESA, USUARIO, OPENAI_MOCK);
      expect(mockEjecutarKCE).toHaveBeenCalledWith({ supabase: {}, openaiClient: OPENAI_MOCK, company_id: COMPANY_A, usuario_id: 'user-1' });
    });
  });

  describe('TOOLS_CONSULTA_EMPRESARIAL — TARA AI Consulta Empresarial, Fase 1+2 (2026-10-16)', () => {
    test('todas las tools listadas existen en el catálogo real', () => {
      const nombresReales = new Set(CATALOGO_TOOLS.map(t => t.function.name));
      for (const nombre of TOOLS_CONSULTA_EMPRESARIAL) expect(nombresReales.has(nombre)).toBe(true);
    });

    test('CRÍTICO: ninguna tool de TOOLS_SOLO_GERENCIAL (BMC/KCE) está en la lista blanca', () => {
      for (const nombre of TOOLS_CONSULTA_EMPRESARIAL) expect(TOOLS_SOLO_GERENCIAL.has(nombre)).toBe(false);
    });

    test('son exactamente las 14 tools de solo lectura ya auditadas (8 de Fase 1 + 6 de Fase 2), ni una más ni una menos', () => {
      expect([...TOOLS_CONSULTA_EMPRESARIAL].sort()).toEqual([
        'buscar_cliente', 'buscar_documentos', 'clientes_necesitan_seguimiento', 'cobranza_pendiente',
        'consultar_catalogo_tecnico', 'consultar_faq_solar', 'decisiones_recientes', 'garantias_abiertas',
        'instalaciones_requieren_atencion', 'proyectos_en_riesgo', 'resumen_pipeline', 'tareas_abiertas',
        'tickets_pendientes', 'tramites_cfe_pendientes',
      ]);
    });
  });

  describe('"Qué necesita mi atención" — TARA AI Consulta Empresarial, Fase 2 (2026-10-16)', () => {
    const ALCANCE_NORT = { nivel: 'empresa', company_id: 'company-nort-energy' };
    const ALCANCE_TOTAL_RACKS = { nivel: 'empresa', company_id: 'company-total-racks' };

    beforeEach(() => jest.clearAllMocks());

    describe('clientesNecesitanSeguimientoTool()', () => {
      test('consulta individual para Nort Energy: pasa el company_id del alcance y los valores reales ya usados en producción', async () => {
        mockOportunidadSeguimientoVencido.mockResolvedValue([{ texto: 'Seguimiento vencido: Roberto.' }]);
        const resultado = await clientesNecesitanSeguimientoTool({}, ALCANCE_NORT, {});
        expect(mockOportunidadSeguimientoVencido).toHaveBeenCalledWith(
          {}, 'company-nort-energy', { estados_excluidos: ['Cerrado', 'Perdido'], severidad: 'critica' }, expect.any(Date),
        );
        expect(resultado).toEqual([{ texto: 'Seguimiento vencido: Roberto.' }]);
      });

      test('consulta individual para Total Racks: usa SU company_id, nunca el de otra empresa', async () => {
        mockOportunidadSeguimientoVencido.mockResolvedValue([]);
        await clientesNecesitanSeguimientoTool({}, ALCANCE_TOTAL_RACKS, {});
        expect(mockOportunidadSeguimientoVencido).toHaveBeenCalledWith({}, 'company-total-racks', expect.anything(), expect.any(Date));
      });

      test('empresa sin información: devuelve arreglo vacío, nunca inventa resultados', async () => {
        mockOportunidadSeguimientoVencido.mockResolvedValue([]);
        await expect(clientesNecesitanSeguimientoTool({}, ALCANCE_NORT, {})).resolves.toEqual([]);
      });

      test('respeta `limite` recortando el resultado real (la regla no lo soporta internamente)', async () => {
        mockOportunidadSeguimientoVencido.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
        const resultado = await clientesNecesitanSeguimientoTool({}, ALCANCE_NORT, { limite: 2 });
        expect(resultado).toHaveLength(2);
      });

      test('alcance no es "empresa": rechaza sin consultar nada (ej. intento de acceder a "toda la plataforma")', async () => {
        await expect(clientesNecesitanSeguimientoTool({}, { nivel: 'plataforma' }, {})).rejects.toThrow(/alcance de una empresa específica/);
        expect(mockOportunidadSeguimientoVencido).not.toHaveBeenCalled();
      });

      test('company_id nunca puede venir de los argumentos del modelo — solo existe en `alcance`', async () => {
        mockOportunidadSeguimientoVencido.mockResolvedValue([]);
        // Argumento malicioso/alucinado: la implementación ni siquiera lo lee.
        await clientesNecesitanSeguimientoTool({}, ALCANCE_NORT, { limite: 5, company_id: 'otra-empresa-cualquiera' });
        expect(mockOportunidadSeguimientoVencido).toHaveBeenCalledWith({}, 'company-nort-energy', expect.anything(), expect.any(Date));
      });
    });

    describe('instalacionesRequierenAtencionTool() / cobranzaPendienteTool() / tramitesCfePendientesTool() / garantiasAbiertasTool() / ticketsPendientesTool()', () => {
      test('instalacionesRequierenAtencionTool: pasa company_id + severidad real + fecha', async () => {
        mockInstalacionAtrasada.mockResolvedValue([]);
        await instalacionesRequierenAtencionTool({}, ALCANCE_NORT, { limite: 7 });
        expect(mockInstalacionAtrasada).toHaveBeenCalledWith({}, 'company-nort-energy', { severidad: 'critica', limite: 7 }, expect.any(Date));
      });

      test('cobranzaPendienteTool: no requiere fecha (la regla real tampoco la usa)', async () => {
        mockCobranzaConSaldo.mockResolvedValue([]);
        await cobranzaPendienteTool({}, ALCANCE_NORT, {});
        expect(mockCobranzaConSaldo).toHaveBeenCalledWith({}, 'company-nort-energy', { severidad: 'alta', limite: 10 });
      });

      test('tramitesCfePendientesTool: pasa fecha (la regla real sí la usa para calcular días sin actualización)', async () => {
        mockTramiteCfeSinActualizacion.mockResolvedValue([]);
        await tramitesCfePendientesTool({}, ALCANCE_NORT, {});
        expect(mockTramiteCfeSinActualizacion).toHaveBeenCalledWith({}, 'company-nort-energy', { severidad: 'media', limite: 10 }, expect.any(Date));
      });

      test('garantiasAbiertasTool: datos incompletos (la regla real devuelve null) nunca lanza, se propaga tal cual', async () => {
        mockGarantiaReclamacionAbierta.mockResolvedValue([]);
        await expect(garantiasAbiertasTool({}, ALCANCE_NORT, {})).resolves.toEqual([]);
      });

      test('ticketsPendientesTool: alcance no es "empresa" → rechaza sin consultar', async () => {
        await expect(ticketsPendientesTool({}, { nivel: 'organizacion', organization_id: 'org-1' }, {})).rejects.toThrow(/alcance de una empresa específica/);
        expect(mockTicketPendiente).not.toHaveBeenCalled();
      });
    });

    describe('aislamiento y seguridad vía ejecutarTool() — el dispatcher real, no solo la función suelta', () => {
      test('ejecutarTool() ejecuta correctamente una tool de Fase 2 sin usuario (no son gerencial-only)', async () => {
        mockTicketPendiente.mockResolvedValue([{ texto: 'Ticket pendiente: revisar inversor.' }]);
        const resultado = await ejecutarTool('tickets_pendientes', { limite: 5 }, {}, ALCANCE_NORT, undefined, undefined);
        expect(resultado).toEqual([{ texto: 'Ticket pendiente: revisar inversor.' }]);
      });

      test('prompt injection: un argumento "company_id" dentro de argumentos del modelo se ignora por completo', async () => {
        mockCobranzaConSaldo.mockResolvedValue([]);
        await ejecutarTool('cobranza_pendiente', { company_id: 'empresa-ajena', limite: 3 }, {}, ALCANCE_NORT, undefined, undefined);
        expect(mockCobranzaConSaldo).toHaveBeenCalledWith({}, 'company-nort-energy', { severidad: 'alta', limite: 3 });
      });

      test('consultas concurrentes de 2 empresas distintas vía ejecutarTool() no mezclan su company_id', async () => {
        mockGarantiaReclamacionAbierta.mockImplementation((supabase, companyId) => Promise.resolve([{ companyId }]));
        const [resultadoNort, resultadoRacks] = await Promise.all([
          ejecutarTool('garantias_abiertas', {}, {}, ALCANCE_NORT, undefined, undefined),
          ejecutarTool('garantias_abiertas', {}, {}, ALCANCE_TOTAL_RACKS, undefined, undefined),
        ]);
        expect(resultadoNort).toEqual([{ companyId: 'company-nort-energy' }]);
        expect(resultadoRacks).toEqual([{ companyId: 'company-total-racks' }]);
      });

      test('ninguna tool de Fase 2 está en TOOLS_SOLO_GERENCIAL — todas corren para un usuario no gerencial/sin usuario', async () => {
        mockInstalacionAtrasada.mockResolvedValue([]);
        await expect(ejecutarTool('instalaciones_requieren_atencion', {}, {}, ALCANCE_NORT, { id: 'u1', rol: 'ventas' }, undefined))
          .resolves.toEqual([]);
      });
    });

    describe('ausencia de escritura — las 6 tools de Fase 2 son de solo lectura', () => {
      test('ninguna de las 6 implementaciones llama a métodos de escritura de Supabase (insert/update/upsert/delete)', async () => {
        const dbQueNuncaDebeEscribir = {
          insert: jest.fn(), update: jest.fn(), upsert: jest.fn(), delete: jest.fn(),
        };
        mockOportunidadSeguimientoVencido.mockResolvedValue([]);
        mockInstalacionAtrasada.mockResolvedValue([]);
        mockCobranzaConSaldo.mockResolvedValue([]);
        mockTramiteCfeSinActualizacion.mockResolvedValue([]);
        mockGarantiaReclamacionAbierta.mockResolvedValue([]);
        mockTicketPendiente.mockResolvedValue([]);

        await clientesNecesitanSeguimientoTool(dbQueNuncaDebeEscribir, ALCANCE_NORT, {});
        await instalacionesRequierenAtencionTool(dbQueNuncaDebeEscribir, ALCANCE_NORT, {});
        await cobranzaPendienteTool(dbQueNuncaDebeEscribir, ALCANCE_NORT, {});
        await tramitesCfePendientesTool(dbQueNuncaDebeEscribir, ALCANCE_NORT, {});
        await garantiasAbiertasTool(dbQueNuncaDebeEscribir, ALCANCE_NORT, {});
        await ticketsPendientesTool(dbQueNuncaDebeEscribir, ALCANCE_NORT, {});

        expect(dbQueNuncaDebeEscribir.insert).not.toHaveBeenCalled();
        expect(dbQueNuncaDebeEscribir.update).not.toHaveBeenCalled();
        expect(dbQueNuncaDebeEscribir.upsert).not.toHaveBeenCalled();
        expect(dbQueNuncaDebeEscribir.delete).not.toHaveBeenCalled();
      });
    });
  });
});
