'use strict';

const {
  INTENCIONES_VALIDAS,
  listarWorkflows, crearWorkflow, actualizarWorkflow, eliminarWorkflow,
  listarNodos, crearNodo, actualizarNodo, eliminarNodo,
} = require('../modules/workflow-admin');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
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
const WORKFLOW_1 = 'wf-1111-0000-0000-000000000001';

describe('workflow-admin', () => {
  describe('workflows', () => {
    test('crearWorkflow() fuerza trigger="intent" y valida trigger_value contra el catálogo', async () => {
      const db = crearMockDb({ data: { id: WORKFLOW_1 }, error: null });
      await crearWorkflow(db, COMPANY_A, { nombre: 'Descubrimiento', trigger_value: 'solicitud_cotizacion' });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({
        company_id: COMPANY_A, nombre: 'Descubrimiento', trigger: 'intent',
        trigger_value: 'solicitud_cotizacion', prioridad: 10, activo: true,
      })]);
    });

    test('crearWorkflow() rechaza un trigger_value fuera del catálogo', async () => {
      const db = crearMockDb();
      await expect(crearWorkflow(db, COMPANY_A, { nombre: 'X', trigger_value: 'lo_que_sea' }))
        .rejects.toMatchObject({ status: 400 });
    });

    test('INTENCIONES_VALIDAS expone el catálogo fijo (mismo que prompt-builder.js)', () => {
      expect(INTENCIONES_VALIDAS).toEqual([
        'interes_compra', 'solicitud_cotizacion', 'soporte', 'seguimiento', 'cancelar_flujo', 'consulta_general',
      ]);
    });

    test('actualizarWorkflow() solo aplica campos permitidos', async () => {
      const db = crearMockDb({ data: { id: WORKFLOW_1, activo: false }, error: null });
      const resultado = await actualizarWorkflow(db, COMPANY_A, WORKFLOW_1, { activo: false, company_id: 'otra' });

      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ activo: false });
      expect(resultado.activo).toBe(false);
    });

    test('actualizarWorkflow() valida trigger_value si se intenta cambiar', async () => {
      const db = crearMockDb();
      await expect(actualizarWorkflow(db, COMPANY_A, WORKFLOW_1, { trigger_value: 'no_valido' }))
        .rejects.toMatchObject({ status: 400 });
    });

    test('eliminarWorkflow() no lanza si tiene éxito', async () => {
      const db = crearMockDb({ error: null });
      await expect(eliminarWorkflow(db, COMPANY_A, WORKFLOW_1)).resolves.toBeUndefined();
    });

    test('listarWorkflows() devuelve arreglo vacío en error', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await listarWorkflows(db, COMPANY_A)).toEqual([]);
    });
  });

  describe('nodos — aislamiento multiempresa', () => {
    test('listarNodos() lanza 404 si el workflow no pertenece a la empresa', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(listarNodos(db, COMPANY_A, WORKFLOW_1)).rejects.toMatchObject({ status: 404 });
    });

    test('listarNodos() devuelve los nodos si el workflow sí pertenece a la empresa', async () => {
      const db = crearMockDb(
        { data: { id: WORKFLOW_1 }, error: null }, // verificación de dueño
        { data: [{ id: 'n1' }, { id: 'n2' }], error: null }, // nodos
      );
      const resultado = await listarNodos(db, COMPANY_A, WORKFLOW_1);
      expect(resultado).toHaveLength(2);
    });

    test('crearNodo() requiere nombre', async () => {
      const db = crearMockDb({ data: { id: WORKFLOW_1 }, error: null });
      await expect(crearNodo(db, COMPANY_A, WORKFLOW_1, {})).rejects.toMatchObject({ status: 400 });
    });

    test('crearNodo() inserta con workflow_id asignado', async () => {
      const db = crearMockDb(
        { data: { id: WORKFLOW_1 }, error: null },
        { data: { id: 'n1' }, error: null },
      );
      await crearNodo(db, COMPANY_A, WORKFLOW_1, { nombre: 'pedir_nombre', pregunta: '¿Cómo te llamas?' });

      const builder = db.from.mock.results[1].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({
        workflow_id: WORKFLOW_1, nombre: 'pedir_nombre', pregunta: '¿Cómo te llamas?',
      })]);
    });

    test('actualizarNodo() verifica dueño del workflow antes de actualizar', async () => {
      const db = crearMockDb(
        { data: { workflow_id: WORKFLOW_1 }, error: null }, // nodo → workflow_id
        { data: { id: WORKFLOW_1 }, error: null },          // verificación de dueño
        { data: { id: 'n1', pregunta: 'nueva' }, error: null }, // update
      );
      const resultado = await actualizarNodo(db, COMPANY_A, 'n1', { pregunta: 'nueva' });
      expect(resultado.pregunta).toBe('nueva');
    });

    test('actualizarNodo() lanza 404 si el workflow del nodo es de otra empresa', async () => {
      const db = crearMockDb(
        { data: { workflow_id: WORKFLOW_1 }, error: null },
        { data: null, error: null }, // _verificarWorkflowDeEmpresa falla
      );
      await expect(actualizarNodo(db, COMPANY_A, 'n1', { pregunta: 'x' })).rejects.toMatchObject({ status: 404 });
    });

    test('eliminarNodo() verifica dueño antes de borrar', async () => {
      const db = crearMockDb(
        { data: { workflow_id: WORKFLOW_1 }, error: null },
        { data: { id: WORKFLOW_1 }, error: null },
        { error: null },
      );
      await expect(eliminarNodo(db, COMPANY_A, 'n1')).resolves.toBeUndefined();
    });
  });
});
