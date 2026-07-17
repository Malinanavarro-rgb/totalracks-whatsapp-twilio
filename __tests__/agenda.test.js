'use strict';

// Mockeamos SchedulingEngine y google-auth: este módulo no reimplementa la
// lógica de agenda (ya probada en scheduling-engine.test.js) — solo la
// invoca. Aquí probamos exclusivamente la capa de plataforma: resolución
// de asesor por rol, permisos, dedup de cliente manual.

const mockAgendarCita   = jest.fn().mockResolvedValue({ id: 'cita-1' });
const mockReagendarCita = jest.fn().mockResolvedValue({ id: 'cita-1', reagendada: true });
const mockCancelarCita  = jest.fn().mockResolvedValue({ id: 'cita-1', estado: 'cancelada' });
const mockConsultarDisp = jest.fn().mockResolvedValue([{ inicio: new Date(), fin: new Date() }]);

jest.mock('../modules/scheduling-engine', () => ({
  SchedulingEngine: jest.fn().mockImplementation(() => ({
    agendarCita:            mockAgendarCita,
    reagendarCita:          mockReagendarCita,
    cancelarCita:           mockCancelarCita,
    consultarDisponibilidad: mockConsultarDisp,
  })),
}));

jest.mock('../modules/google-auth', () => ({
  obtenerProviderParaEmpresa: jest.fn().mockResolvedValue(null),
}));

const {
  listarAsesores, listarAsesoresConfig, crearAsesor, actualizarAsesor, eliminarAsesor,
  listarCitas, consultarDisponibilidad, obtenerOCrearClienteManual,
  crearCita, reagendarCita, cancelarCita, marcarNoShow, vincularUsuarioAAsesor, resolverAsesorDeUsuario,
} = require('../modules/agenda');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
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
const ASESOR_1  = 'ases0001-0000-0000-0000-000000000001';
const USUARIO_OWNER  = { id: 'u-owner', rol: 'owner' };
const USUARIO_ASESOR = { id: 'u-asesor', rol: 'asesor' };

beforeEach(() => jest.clearAllMocks());

describe('agenda', () => {
  describe('listarAsesores()', () => {
    test('devuelve los asesores activos de la empresa', async () => {
      const db = crearMockDb({ data: [{ id: ASESOR_1, nombre: 'Ana', usuario_id: null }], error: null });
      const resultado = await listarAsesores(db, COMPANY_A);
      expect(resultado).toHaveLength(1);
    });
  });

  describe('listarAsesoresConfig() / crearAsesor() / actualizarAsesor() / eliminarAsesor() (gestión de equipo)', () => {
    test('listarAsesoresConfig() devuelve activos e inactivos (a diferencia de listarAsesores)', async () => {
      const db = crearMockDb({
        data: [{ id: ASESOR_1, nombre: 'Ana', activo: true }, { id: 'a2', nombre: 'Paty', activo: false }],
        error: null,
      });
      const resultado = await listarAsesoresConfig(db, COMPANY_A);
      expect(resultado).toHaveLength(2);
    });

    test('crearAsesor() inserta con activo=true por default', async () => {
      const db = crearMockDb({ data: { id: 'a3', nombre: 'Vale', activo: true }, error: null });
      const resultado = await crearAsesor(db, COMPANY_A, { nombre: 'Vale' });
      expect(resultado.nombre).toBe('Vale');
      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ company_id: COMPANY_A, nombre: 'Vale', activo: true }));
    });

    test('actualizarAsesor() solo aplica campos permitidos (nombre, email, activo)', async () => {
      const db = crearMockDb({ data: { id: ASESOR_1, activo: false }, error: null });
      await actualizarAsesor(db, COMPANY_A, ASESOR_1, { activo: false, otroCampo: 'x' });
      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ activo: false });
    });

    test('eliminarAsesor() no lanza si tiene éxito', async () => {
      const db = crearMockDb({ error: null });
      await expect(eliminarAsesor(db, COMPANY_A, ASESOR_1)).resolves.toBeUndefined();
    });

    test('eliminarAsesor() traduce foreign_key_violation (23503) a un 409 legible', async () => {
      const db = crearMockDb({ error: { code: '23503', message: 'fk' } });
      await expect(eliminarAsesor(db, COMPANY_A, ASESOR_1)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('resolverAsesorDeUsuario()', () => {
    test('devuelve el id del asesor vinculado', async () => {
      const db = crearMockDb({ data: { id: ASESOR_1 }, error: null });
      const resultado = await resolverAsesorDeUsuario(db, COMPANY_A, USUARIO_ASESOR.id);
      expect(resultado).toBe(ASESOR_1);
    });

    test('devuelve null si no hay vínculo', async () => {
      const db = crearMockDb({ data: null, error: null });
      const resultado = await resolverAsesorDeUsuario(db, COMPANY_A, USUARIO_ASESOR.id);
      expect(resultado).toBeNull();
    });
  });

  describe('listarCitas()', () => {
    test('gerencial ve todas, sin filtrar por asesor', async () => {
      const db = crearMockDb({ data: [{ id: 'c1' }, { id: 'c2' }], error: null });
      const resultado = await listarCitas(db, COMPANY_A, USUARIO_OWNER, { desde: 'a', hasta: 'b' });
      expect(resultado).toHaveLength(2);
    });

    test('asesor sin vínculo recibe lista vacía (no error)', async () => {
      const db = crearMockDb({ data: null, error: null }); // resolverAsesorDeUsuario → null
      const resultado = await listarCitas(db, COMPANY_A, USUARIO_ASESOR, { desde: 'a', hasta: 'b' });
      expect(resultado).toEqual([]);
    });
  });

  describe('crearCita()', () => {
    test('gerencial puede especificar cualquier asesorId', async () => {
      const db = crearMockDb();
      await crearCita(db, COMPANY_A, USUARIO_OWNER, { clienteId: 1, asesorId: ASESOR_1, inicio: new Date(), fin: new Date() });
      expect(mockAgendarCita).toHaveBeenCalledWith(COMPANY_A, expect.objectContaining({ asesorId: ASESOR_1 }));
    });

    test('asesor: se fuerza su propio asesor vinculado', async () => {
      const db = crearMockDb({ data: { id: ASESOR_1 }, error: null }); // resolverAsesorDeUsuario
      await crearCita(db, COMPANY_A, USUARIO_ASESOR, { clienteId: 1, asesorId: 'otro-asesor', inicio: new Date(), fin: new Date() });
      expect(mockAgendarCita).toHaveBeenCalledWith(COMPANY_A, expect.objectContaining({ asesorId: ASESOR_1 }));
    });

    test('asesor sin vínculo: 403', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(
        crearCita(db, COMPANY_A, USUARIO_ASESOR, { clienteId: 1, inicio: new Date(), fin: new Date() })
      ).rejects.toMatchObject({ status: 403 });
    });

    test('con servicioId/precioCobrado: hace un UPDATE aparte (Fase 2) sin tocar SchedulingEngine.agendarCita', async () => {
      const citaActualizada = { id: 'cita-1', servicio_id: 's1', precio_cobrado: 350 };
      const db = crearMockDb({ data: citaActualizada, error: null }); // el UPDATE post-agendarCita
      const resultado = await crearCita(db, COMPANY_A, USUARIO_OWNER, {
        clienteId: 1, asesorId: ASESOR_1, inicio: new Date(), fin: new Date(), servicioId: 's1', precioCobrado: 350,
      });
      expect(mockAgendarCita).toHaveBeenCalledWith(COMPANY_A, expect.objectContaining({ asesorId: ASESOR_1 }));
      const builder = db.from.mock.results[0].value;
      expect(builder.update).toHaveBeenCalledWith({ servicio_id: 's1', precio_cobrado: 350 });
      expect(resultado).toEqual(citaActualizada);
    });

    test('sin servicioId ni precioCobrado: no hace ningún UPDATE extra', async () => {
      const db = crearMockDb();
      await crearCita(db, COMPANY_A, USUARIO_OWNER, { clienteId: 1, asesorId: ASESOR_1, inicio: new Date(), fin: new Date() });
      expect(db.from).not.toHaveBeenCalled(); // el único insert vive dentro del SchedulingEngine mockeado
    });
  });

  describe('reagendarCita() / cancelarCita()', () => {
    test('asesor no puede tocar la cita de otro asesor (403)', async () => {
      const db = crearMockDb(
        { data: { id: 'cita-1', asesor_id: 'otro-asesor' }, error: null }, // _obtenerCitaPropia: cita
        { data: { id: ASESOR_1 }, error: null },                          // resolverAsesorDeUsuario
      );
      await expect(
        reagendarCita(db, COMPANY_A, USUARIO_ASESOR, 'cita-1', new Date(), new Date())
      ).rejects.toMatchObject({ status: 403 });
    });

    test('asesor puede cancelar su propia cita', async () => {
      const db = crearMockDb(
        { data: { id: 'cita-1', asesor_id: ASESOR_1 }, error: null },
        { data: { id: ASESOR_1 }, error: null },
      );
      const resultado = await cancelarCita(db, COMPANY_A, USUARIO_ASESOR, 'cita-1');
      expect(mockCancelarCita).toHaveBeenCalled();
      expect(resultado.estado).toBe('cancelada');
    });

    test('cita inexistente: 404', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(
        cancelarCita(db, COMPANY_A, USUARIO_OWNER, 'no-existe')
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('marcarNoShow() (Motor de Agenda Universal, Fase 1)', () => {
    test('marca la cita como no_show', async () => {
      const db = crearMockDb(
        { data: { id: 'cita-1', asesor_id: ASESOR_1 }, error: null }, // _obtenerCitaPropia
        { data: { id: 'cita-1', estado: 'no_show' }, error: null },   // update
      );
      const resultado = await marcarNoShow(db, COMPANY_A, USUARIO_OWNER, 'cita-1');
      expect(resultado.estado).toBe('no_show');
    });

    test('asesor no puede marcar no-show en la cita de otro asesor (403)', async () => {
      const db = crearMockDb(
        { data: { id: 'cita-1', asesor_id: 'otro-asesor' }, error: null },
        { data: { id: ASESOR_1 }, error: null },
      );
      await expect(
        marcarNoShow(db, COMPANY_A, USUARIO_ASESOR, 'cita-1')
      ).rejects.toMatchObject({ status: 403 });
    });

    test('cita inexistente: 404', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(
        marcarNoShow(db, COMPANY_A, USUARIO_OWNER, 'no-existe')
      ).rejects.toMatchObject({ status: 404 });
    });

    test('lanza si Supabase falla al actualizar', async () => {
      const db = crearMockDb(
        { data: { id: 'cita-1', asesor_id: ASESOR_1 }, error: null },
        { data: null, error: new Error('boom') },
      );
      await expect(
        marcarNoShow(db, COMPANY_A, USUARIO_OWNER, 'cita-1')
      ).rejects.toThrow('boom');
    });
  });

  describe('obtenerOCrearClienteManual()', () => {
    test('no duplica: devuelve el cliente existente si el teléfono ya existe', async () => {
      const db = crearMockDb({ data: { id: 5, telefono: '+521800' }, error: null });
      const resultado = await obtenerOCrearClienteManual(db, COMPANY_A, { telefono: '+521800' });
      expect(resultado.id).toBe(5);
    });

    test('crea uno nuevo con fuente=Manual si no existe', async () => {
      const db = crearMockDb(
        { data: null, error: null },
        { data: { id: 9, telefono: '+521900', nombre: 'Pedro' }, error: null },
      );
      const resultado = await obtenerOCrearClienteManual(db, COMPANY_A, { telefono: '+521900', nombre: 'Pedro' });
      expect(resultado.nombre).toBe('Pedro');

      const builderInsert = db.from.mock.results[1].value;
      expect(builderInsert.insert).toHaveBeenCalledWith([expect.objectContaining({ fuente: 'Manual' })]);
    });
  });

  describe('vincularUsuarioAAsesor()', () => {
    test('rechaza si el usuario no pertenece a la empresa', async () => {
      const db = crearMockDb({ data: null, error: null }); // pertenece → null
      await expect(
        vincularUsuarioAAsesor(db, COMPANY_A, ASESOR_1, 'usuario-externo')
      ).rejects.toMatchObject({ status: 400 });
    });

    test('vincula correctamente si pertenece a la empresa', async () => {
      const db = crearMockDb(
        { data: { usuario_id: 'u1' }, error: null },       // pertenece
        { data: { id: ASESOR_1, usuario_id: 'u1' }, error: null }, // update
      );
      const resultado = await vincularUsuarioAAsesor(db, COMPANY_A, ASESOR_1, 'u1');
      expect(resultado.usuario_id).toBe('u1');
    });
  });

  describe('consultarDisponibilidad()', () => {
    test('delega en SchedulingEngine.consultarDisponibilidad', async () => {
      const db = crearMockDb();
      const resultado = await consultarDisponibilidad(db, COMPANY_A, { fecha: new Date() });
      expect(mockConsultarDisp).toHaveBeenCalled();
      expect(resultado).toHaveLength(1);
    });
  });
});
