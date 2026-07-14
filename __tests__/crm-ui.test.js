'use strict';

const mockObtenerHistorial = jest.fn().mockResolvedValue([{ de: 'cliente', texto: 'hola', created_at: '2026-07-09T10:00:00Z' }]);

jest.mock('../modules/conversaciones', () => ({
  obtenerHistorial: mockObtenerHistorial,
}));

const {
  listarClientes, obtenerFichaCliente, actualizarCliente, eliminarCliente,
  listarSeguimientos, crearSeguimiento, actualizarSeguimiento,
  listarOportunidades, crearOportunidad, actualizarOportunidad, eliminarOportunidad,
} = require('../modules/crm-ui');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    or:          jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
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
const USUARIO_OWNER  = { id: 'u-owner', rol: 'owner' };
const USUARIO_ASESOR = { id: 'u-asesor', rol: 'asesor' };

beforeEach(() => jest.clearAllMocks());

describe('crm-ui', () => {
  describe('listarClientes()', () => {
    test('gerencial ve todos, sin .or()', async () => {
      const db = crearMockDb({ data: [{ id: 1 }, { id: 2 }], error: null });
      const resultado = await listarClientes(db, COMPANY_A, USUARIO_OWNER);
      expect(resultado).toHaveLength(2);
    });

    test('asesor filtra con .or() (asignados + pool sin asignar)', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarClientes(db, COMPANY_A, USUARIO_ASESOR);

      const builder = db.from.mock.results[0].value;
      expect(builder.or).toHaveBeenCalledWith(
        `asesor_id.eq.${USUARIO_ASESOR.id},and(atendido_por.eq.ia,asesor_id.is.null)`
      );
    });

    test('filtro nombre busca por nombre O teléfono (Pivote a producto, Fase 2.4)', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarClientes(db, COMPANY_A, USUARIO_OWNER, { nombre: 'Juan' });

      const builder = db.from.mock.results[0].value;
      expect(builder.or).toHaveBeenCalledWith('nombre.ilike.%Juan%,telefono.ilike.%Juan%');
    });

    test('filtro estado usa .eq()', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarClientes(db, COMPANY_A, USUARIO_OWNER, { estado: 'Ganado' });

      const builder = db.from.mock.results[0].value;
      expect(builder.eq).toHaveBeenCalledWith('estado', 'Ganado');
    });

    test('filtro score_min usa .gte()', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarClientes(db, COMPANY_A, USUARIO_OWNER, { score_min: '50' });

      const builder = db.from.mock.results[0].value;
      expect(builder.gte).toHaveBeenCalledWith('score_interes', 50);
    });

    test('sin filtros no llama a .gte() ni agrega .or() de búsqueda', async () => {
      const db = crearMockDb({ data: [], error: null });
      await listarClientes(db, COMPANY_A, USUARIO_OWNER, {});

      const builder = db.from.mock.results[0].value;
      expect(builder.gte).not.toHaveBeenCalled();
      expect(builder.or).not.toHaveBeenCalled();
    });

    test('Fase Premium V1.1: adjunta la oportunidad más reciente de cada cliente', async () => {
      const db = crearMockDb(
        { data: [{ id: 1, nombre: 'Rayados FC' }, { id: 2, nombre: 'Colegio Oxford' }], error: null },
        {
          data: [
            { cliente_id: 1, estado: 'Cotización enviada', presupuesto_confirmado: null, presupuesto_estimado: 62000, proxima_accion: 'Dar seguimiento', updated_at: '2026-07-11T00:00:00Z' },
            { cliente_id: 1, estado: 'Solicitud nueva', presupuesto_confirmado: null, presupuesto_estimado: 1000, proxima_accion: null, updated_at: '2026-07-01T00:00:00Z' },
          ],
          error: null,
        },
      );

      const resultado = await listarClientes(db, COMPANY_A, USUARIO_OWNER);

      expect(resultado[0].ultima_oportunidad).toEqual({
        estado: 'Cotización enviada', monto: 62000, proxima_accion: 'Dar seguimiento', actualizado: '2026-07-11T00:00:00Z',
      });
      expect(resultado[1].ultima_oportunidad).toBeNull();
    });

    test('lista vacía no dispara la consulta de oportunidades', async () => {
      const db = crearMockDb({ data: [], error: null });
      const resultado = await listarClientes(db, COMPANY_A, USUARIO_OWNER);

      expect(resultado).toEqual([]);
      expect(db.from).toHaveBeenCalledTimes(1);
    });

    test('Fase Premium · Salón de Belleza: adjunta próxima cita y última cita completada', async () => {
      const db = crearMockDb(
        { data: [{ id: 1, nombre: 'Karla Torres' }, { id: 2, nombre: 'Sofía Ramírez' }], error: null },
        { data: [], error: null }, // oportunidades
        { data: [{ cliente_id: 1, inicio: '2026-07-20T15:00:00Z', estado: 'agendada' }], error: null }, // próximas
        { data: [{ cliente_id: 2, inicio: '2026-06-01T15:00:00Z', estado: 'completada' }], error: null }, // pasadas
      );

      const resultado = await listarClientes(db, COMPANY_A, USUARIO_OWNER);

      expect(resultado[0].proxima_cita).toEqual({ inicio: '2026-07-20T15:00:00Z', estado: 'agendada' });
      expect(resultado[0].ultima_cita).toBeNull();
      expect(resultado[1].proxima_cita).toBeNull();
      expect(resultado[1].ultima_cita).toBe('2026-06-01T15:00:00Z');
    });
  });

  describe('obtenerFichaCliente()', () => {
    test('combina cliente + historial (Fase 3) + citas + oportunidades', async () => {
      const db = crearMockDb(
        { data: { id: 5, nombre: 'Juan' }, error: null },
        { data: [{ id: 'c1', estado: 'cancelada' }, { id: 'c2', estado: 'agendada' }], error: null },
        { data: [{ id: 'op1' }], error: null },
      );

      const ficha = await obtenerFichaCliente(db, COMPANY_A, 5);

      expect(ficha.cliente.nombre).toBe('Juan');
      expect(ficha.historial).toHaveLength(1);
      expect(ficha.citas).toHaveLength(2); // incluye canceladas
      expect(ficha.oportunidades).toHaveLength(1);
      expect(mockObtenerHistorial).toHaveBeenCalledWith(db, COMPANY_A, 5);
    });

    test('404 si el cliente no existe en la empresa', async () => {
      const db = crearMockDb({ data: null, error: null }, { data: [], error: null }, { data: [], error: null });
      await expect(obtenerFichaCliente(db, COMPANY_A, 999)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('actualizarCliente()', () => {
    test('solo aplica campos editables (telefono nunca se actualiza)', async () => {
      const db = crearMockDb({ data: { id: 5, nombre: 'Nuevo nombre' }, error: null });
      await actualizarCliente(db, COMPANY_A, 5, { nombre: 'Nuevo nombre', telefono: '+52111', otroDato: 'x' });

      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ nombre: 'Nuevo nombre' });
    });

    test('400 si no hay campos válidos', async () => {
      const db = crearMockDb();
      await expect(actualizarCliente(db, COMPANY_A, 5, { telefono: '+52111' })).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('eliminarCliente() (Pivote a producto, Fase 2.5)', () => {
    test('no lanza si tiene éxito', async () => {
      const db = crearMockDb({ error: null });
      await expect(eliminarCliente(db, COMPANY_A, 5)).resolves.toBeUndefined();
    });

    test('traduce foreign_key_violation (23503) a un 409 legible', async () => {
      const db = crearMockDb({ error: { code: '23503', message: 'violates foreign key constraint' } });
      await expect(eliminarCliente(db, COMPANY_A, 5)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('historial asociado'),
      });
    });

    test('otros errores de Supabase se traducen a un mensaje genérico sin status', async () => {
      const db = crearMockDb({ error: { code: '42501', message: 'permission denied' } });
      await expect(eliminarCliente(db, COMPANY_A, 5)).rejects.toThrow('No se pudo eliminar el cliente');
    });
  });

  describe('seguimientos', () => {
    test('crearSeguimiento() usa prioridad=media por default', async () => {
      const db = crearMockDb({ data: { id: 's1', prioridad: 'media' }, error: null });
      await crearSeguimiento(db, COMPANY_A, 5, USUARIO_ASESOR.id, { texto: 'Llamar mañana' });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({ texto: 'Llamar mañana', prioridad: 'media' })]);
    });

    test('actualizarSeguimiento() puede marcar completado', async () => {
      const db = crearMockDb({ data: { id: 's1', completado: true }, error: null });
      const resultado = await actualizarSeguimiento(db, COMPANY_A, 's1', { completado: true });
      expect(resultado.completado).toBe(true);
    });

    test('listarSeguimientos() devuelve arreglo vacío si falla la consulta', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      const resultado = await listarSeguimientos(db, COMPANY_A, 5);
      expect(resultado).toEqual([]);
    });
  });

  describe('oportunidades (Pivote a producto, Fase 2.1)', () => {
    test('listarOportunidades() devuelve arreglo vacío en error', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await listarOportunidades(db, COMPANY_A)).toEqual([]);
    });

    test('crearOportunidad() asocia cliente_id y company_id', async () => {
      const db = crearMockDb({ data: { id: 'op1' }, error: null });
      await crearOportunidad(db, COMPANY_A, 5, { estado: 'Nuevo', tipo_rack: 'Cotizacion racks', probabilidad: 40 });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({
        cliente_id: 5, company_id: COMPANY_A, estado: 'Nuevo', tipo_rack: 'Cotizacion racks', probabilidad: 40,
      })]);
    });

    test('actualizarOportunidad() solo aplica campos permitidos, filtrando por company_id', async () => {
      const db = crearMockDb({ data: { id: 'op1', estado: 'Ganado' }, error: null });
      const resultado = await actualizarOportunidad(db, COMPANY_A, 'op1', { estado: 'Ganado', cliente_id: 999 });

      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ estado: 'Ganado' });
      expect(builder.eq).toHaveBeenCalledWith('company_id', COMPANY_A);
      expect(resultado.estado).toBe('Ganado');
    });

    test('actualizarOportunidad() 400 si no hay campos válidos', async () => {
      const db = crearMockDb();
      await expect(actualizarOportunidad(db, COMPANY_A, 'op1', { cliente_id: 999 }))
        .rejects.toMatchObject({ status: 400 });
    });

    test('eliminarOportunidad() no lanza si tiene éxito', async () => {
      const db = crearMockDb({ error: null });
      await expect(eliminarOportunidad(db, COMPANY_A, 'op1')).resolves.toBeUndefined();
    });

    test('eliminarOportunidad() lanza si Supabase devuelve error', async () => {
      const db = crearMockDb({ error: new Error('boom') });
      await expect(eliminarOportunidad(db, COMPANY_A, 'op1')).rejects.toThrow('No se pudo eliminar la oportunidad');
    });
  });
});
