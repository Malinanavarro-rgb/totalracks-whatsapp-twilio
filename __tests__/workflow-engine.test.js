'use strict';

const { WorkflowEngine } = require('../modules/workflow-engine');

// ─── Mock Builder ─────────────────────────────────────────────────────────────
// Simula el cliente de Supabase con API fluida (chainable).
// crearMockDb(...resultados) consume los resultados en orden de llamada a from().

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    single:      jest.fn().mockResolvedValue(resultado),
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_A   = 'aaaaaaaa-0000-0000-0000-000000000001';
const COMPANY_B   = 'bbbbbbbb-0000-0000-0000-000000000002';
const CLIENTE_ID  = 42;
const WORKFLOW_ID = 'wf000000-0000-0000-0000-000000000001';

const workflowBase = {
  id:            WORKFLOW_ID,
  company_id:    COMPANY_A,
  nombre:        'Descubrimiento Comercial',
  trigger:       'intent',
  trigger_value: 'solicitud_cotizacion',
  prioridad:     1,
  activo:        true,
};

const nodoInicio = {
  id:             'node-1',
  workflow_id:    WORKFLOW_ID,
  nombre:         'nombre_contacto',
  es_inicio:      true,
  es_fin:         false,
  pregunta:       '¿Cuál es tu nombre?',
  campo:          'nombre_contacto',
  tipo_campo:     'text',
  es_opcional:    false,
  siguiente_nodo: 'empresa',
  modo_respuesta: 'prepend_ai',
};

const nodoIntermedio = {
  id:             'node-2',
  workflow_id:    WORKFLOW_ID,
  nombre:         'empresa',
  es_inicio:      false,
  es_fin:         false,
  pregunta:       '¿A qué empresa perteneces?',
  campo:          'empresa',
  tipo_campo:     'text',
  es_opcional:    false,
  siguiente_nodo: 'presupuesto',
  modo_respuesta: 'replace_ai',
};

const nodoFinal = {
  id:             'node-6',
  workflow_id:    WORKFLOW_ID,
  nombre:         'presupuesto',
  es_inicio:      false,
  es_fin:         true,
  pregunta:       '¿Tienes un presupuesto aproximado?',
  campo:          'presupuesto',
  tipo_campo:     'text',
  es_opcional:    true,
  siguiente_nodo: null,
  modo_respuesta: 'replace_ai',
};

const sesionActiva = {
  id:              'ses-00000001',
  company_id:      COMPANY_A,
  cliente_id:      CLIENTE_ID,
  workflow_id:     WORKFLOW_ID,
  current_node:    'empresa',
  status:          'activo',
  captured_fields: { nombre_contacto: 'Luis' },
  total_turnos:    1,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowEngine', () => {

  // ── evaluar() ───────────────────────────────────────────────────────────────

  describe('evaluar()', () => {
    test('retorna el workflow cuando la intención hace match', async () => {
      const db = crearMockDb({ data: workflowBase, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.evaluar(COMPANY_A, ['solicitud_cotizacion']);

      expect(resultado).toEqual(workflowBase);
      expect(db.from).toHaveBeenCalledWith('workflows');
    });

    test('retorna null cuando ninguna intención hace match', async () => {
      const db = crearMockDb({ data: null, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.evaluar(COMPANY_A, ['consulta_general']);

      expect(resultado).toBeNull();
    });

    test('retorna null sin consultar DB cuando el array de intenciones está vacío', async () => {
      const db = crearMockDb();
      const engine = new WorkflowEngine(db);

      const resultado = await engine.evaluar(COMPANY_A, []);

      expect(resultado).toBeNull();
      expect(db.from).not.toHaveBeenCalled();
    });

    test('workflow inactivo nunca se activa aunque coincida la intención', async () => {
      // DB devuelve null porque la query filtra activo=true
      const db = crearMockDb({ data: null, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.evaluar(COMPANY_A, ['solicitud_cotizacion']);

      expect(resultado).toBeNull();
      expect(db._builders[0].eq).toHaveBeenCalledWith('activo', true);
    });

    test('conflicto de prioridad: selecciona el workflow de menor número (mayor prioridad)', async () => {
      const workflowAlta = { ...workflowBase, id: 'wf-alta', prioridad: 1 };
      // DB devuelve solo uno gracias a ORDER BY prioridad ASC + LIMIT 1
      const db = crearMockDb({ data: workflowAlta, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.evaluar(COMPANY_A, ['solicitud_cotizacion', 'interes_compra']);

      expect(resultado.prioridad).toBe(1);
      expect(db._builders[0].order).toHaveBeenCalledWith('prioridad', { ascending: true });
      expect(db._builders[0].limit).toHaveBeenCalledWith(1);
    });
  });

  // ── obtenerSesionActiva() ───────────────────────────────────────────────────

  describe('obtenerSesionActiva()', () => {
    test('retorna la sesión activa del cliente', async () => {
      const db = crearMockDb({ data: sesionActiva, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.obtenerSesionActiva(COMPANY_A, CLIENTE_ID);

      expect(resultado).toEqual(sesionActiva);
    });

    test('retorna null cuando no hay sesión activa', async () => {
      const db = crearMockDb({ data: null, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.obtenerSesionActiva(COMPANY_A, CLIENTE_ID);

      expect(resultado).toBeNull();
    });

    test('dos empresas con el mismo cliente no comparten sesión — query filtra por company_id', async () => {
      const sesionA = { ...sesionActiva, id: 'ses-A', company_id: COMPANY_A };
      const sesionB = { ...sesionActiva, id: 'ses-B', company_id: COMPANY_B };

      const dbA = crearMockDb({ data: sesionA, error: null });
      const dbB = crearMockDb({ data: sesionB, error: null });
      const engineA = new WorkflowEngine(dbA);
      const engineB = new WorkflowEngine(dbB);

      const resultadoA = await engineA.obtenerSesionActiva(COMPANY_A, CLIENTE_ID);
      const resultadoB = await engineB.obtenerSesionActiva(COMPANY_B, CLIENTE_ID);

      expect(resultadoA.id).toBe('ses-A');
      expect(resultadoB.id).toBe('ses-B');
      expect(resultadoA.company_id).not.toBe(resultadoB.company_id);

      // Verificar que cada engine filtra por su propio company_id
      expect(dbA._builders[0].eq).toHaveBeenCalledWith('company_id', COMPANY_A);
      expect(dbB._builders[0].eq).toHaveBeenCalledWith('company_id', COMPANY_B);
    });
  });

  // ── iniciarSesion() ─────────────────────────────────────────────────────────

  describe('iniciarSesion()', () => {
    test('crea sesión posicionada en el nodo de inicio', async () => {
      const sesionCreada = {
        ...sesionActiva,
        current_node: 'nombre_contacto',
        total_turnos: 0,
        captured_fields: {},
      };
      const db = crearMockDb(
        { data: nodoInicio, error: null },   // query nodo inicio
        { data: sesionCreada, error: null }  // insert sesión
      );
      const engine = new WorkflowEngine(db);

      const resultado = await engine.iniciarSesion(COMPANY_A, CLIENTE_ID, null, WORKFLOW_ID);

      expect(resultado.current_node).toBe('nombre_contacto');
      expect(resultado.status).toBe('activo');
    });

    test('lanza error si el workflow no tiene nodo de inicio', async () => {
      const db = crearMockDb({ data: null, error: null }); // nodo no encontrado
      const engine = new WorkflowEngine(db);

      await expect(
        engine.iniciarSesion(COMPANY_A, CLIENTE_ID, null, WORKFLOW_ID)
      ).rejects.toThrow('no tiene nodo de inicio');
    });

    test('lanza error si ya existe sesión activa para el mismo cliente y empresa', async () => {
      const errorUnico = {
        message: 'duplicate key value violates unique constraint "idx_workflow_sessions_activa"',
      };
      const db = crearMockDb(
        { data: nodoInicio, error: null },  // nodo inicio OK
        { data: null, error: errorUnico }   // insert rechazado por índice único
      );
      const engine = new WorkflowEngine(db);

      await expect(
        engine.iniciarSesion(COMPANY_A, CLIENTE_ID, null, WORKFLOW_ID)
      ).rejects.toThrow('idx_workflow_sessions_activa');
    });
  });

  // ── avanzar() ───────────────────────────────────────────────────────────────

  describe('avanzar()', () => {
    test('avanza al siguiente nodo y captura el campo', async () => {
      const sesionActualizada = {
        ...sesionActiva,
        current_node:    'presupuesto',
        captured_fields: { nombre_contacto: 'Luis', empresa: 'ACME' },
        total_turnos:    2,
      };
      const db = crearMockDb(
        { data: sesionActualizada, error: null }, // update sesión
        { data: nodoFinal, error: null }          // get siguiente nodo
      );
      const engine = new WorkflowEngine(db);

      const resultado = await engine.avanzar(sesionActiva, nodoIntermedio, 'ACME');

      expect(resultado.completado).toBe(false);
      expect(resultado.sesion.captured_fields.empresa).toBe('ACME');
      expect(resultado.siguiente_nodo).toEqual(nodoFinal);
    });

    test('marca la sesión como completada en el nodo final', async () => {
      const sesionFinalDb = {
        ...sesionActiva,
        status:       'completado',
        completed_at: new Date().toISOString(),
      };
      const db = crearMockDb({ data: sesionFinalDb, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.avanzar(sesionActiva, nodoFinal, '50000');

      expect(resultado.completado).toBe(true);
      expect(resultado.sesion.status).toBe('completado');
      expect(resultado.siguiente_nodo).toBeNull();
    });

    test('captura null en campo opcional sin lanzar error', async () => {
      const sesionFinalDb = { ...sesionActiva, status: 'completado' };
      const db = crearMockDb({ data: sesionFinalDb, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.avanzar(sesionActiva, nodoFinal, null);

      expect(resultado.completado).toBe(true);
      expect(db._builders[0].update).toHaveBeenCalledWith(
        expect.objectContaining({
          captured_fields: expect.objectContaining({ presupuesto: null }),
        })
      );
    });
  });

  // ── abandonar() ─────────────────────────────────────────────────────────────

  describe('abandonar()', () => {
    test('actualiza status a abandonado y registra el nodo de abandono', async () => {
      const sesionAbandonada = {
        ...sesionActiva,
        status:        'abandonado',
        nodo_abandono: 'empresa',
      };
      const db = crearMockDb({ data: sesionAbandonada, error: null });
      const engine = new WorkflowEngine(db);

      const resultado = await engine.abandonar('ses-00000001', 'empresa');

      expect(resultado.status).toBe('abandonado');
      expect(resultado.nodo_abandono).toBe('empresa');
    });
  });
});
