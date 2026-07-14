'use strict';

const {
  listarMiembros, listarInvitacionesPendientes, crearInvitacion,
  obtenerInvitacionPorToken, aceptarInvitacion, actualizarMiembro, actualizarNombreMiembro,
} = require('../modules/invitaciones');

// ─── Mock Builder ─────────────────────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
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
  const llamadas = [];
  const db = {
    from: jest.fn((tabla) => {
      llamadas.push(tabla);
      return crearBuilder(resultados[idx++] ?? { data: null, error: null });
    }),
    auth: { signUp: jest.fn() },
    _llamadas: llamadas,
  };
  return db;
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('invitaciones', () => {
  describe('crearInvitacion()', () => {
    test('crea con rol default "asesor" si no se especifica', async () => {
      const db = crearMockDb({ data: { id: 'inv-1', token: 'abc123' }, error: null });
      await crearInvitacion(db, COMPANY_A, { nombre: 'Juan', email: 'juan@x.com' });

      const builder = db.from.mock.results[0].value;
      expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({
        nombre: 'Juan', email: 'juan@x.com', rol: 'asesor', estado: 'pendiente',
      })]);
    });
  });

  describe('obtenerInvitacionPorToken()', () => {
    test('404 si no existe o ya fue usada', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(obtenerInvitacionPorToken(db, 'token-x')).rejects.toMatchObject({ status: 404 });
    });

    test('410 si ya expiró', async () => {
      const db = crearMockDb({
        data: { token: 'abc', expires_at: '2020-01-01T00:00:00Z', email: 'x@x.com' }, error: null,
      });
      await expect(obtenerInvitacionPorToken(db, 'abc')).rejects.toMatchObject({ status: 410 });
    });

    test('éxito: devuelve la invitación vigente', async () => {
      const futura = new Date(Date.now() + 86400000).toISOString();
      const db = crearMockDb({ data: { token: 'abc', expires_at: futura, email: 'x@x.com' }, error: null });
      const resultado = await obtenerInvitacionPorToken(db, 'abc');
      expect(resultado.email).toBe('x@x.com');
    });
  });

  describe('aceptarInvitacion()', () => {
    test('éxito: signUp + crea usuarios + usuarios_empresas + marca aceptada', async () => {
      const futura = new Date(Date.now() + 86400000).toISOString();
      const db = crearMockDb(
        { data: { token: 'abc', email: 'nuevo@x.com', nombre: 'Nuevo', rol: 'asesor', company_id: COMPANY_A, expires_at: futura }, error: null }, // obtenerInvitacionPorToken
        { data: null, error: null }, // insert usuarios
        { data: null, error: null }, // insert usuarios_empresas
        { data: null, error: null }, // update invitaciones
      );
      db.auth.signUp.mockResolvedValue({ data: { user: { id: 'user-uuid-1' } }, error: null });

      const resultado = await aceptarInvitacion(db, 'abc', 'password123');

      expect(db.auth.signUp).toHaveBeenCalledWith({ email: 'nuevo@x.com', password: 'password123' });
      expect(resultado).toEqual({ usuarioId: 'user-uuid-1', email: 'nuevo@x.com' });
      expect(db._llamadas).toEqual(['invitaciones', 'usuarios', 'usuarios_empresas', 'invitaciones']);
    });

    test('propaga el error si signUp falla', async () => {
      const futura = new Date(Date.now() + 86400000).toISOString();
      const db = crearMockDb(
        { data: { token: 'abc', email: 'nuevo@x.com', expires_at: futura }, error: null },
      );
      db.auth.signUp.mockResolvedValue({ data: null, error: { message: 'Email ya registrado' } });

      await expect(aceptarInvitacion(db, 'abc', 'password123')).rejects.toThrow('Email ya registrado');
    });

    test('rechaza si la invitación ya expiró (no llega a llamar signUp)', async () => {
      const db = crearMockDb({ data: { token: 'abc', expires_at: '2020-01-01T00:00:00Z' }, error: null });
      await expect(aceptarInvitacion(db, 'abc', 'password123')).rejects.toMatchObject({ status: 410 });
      expect(db.auth.signUp).not.toHaveBeenCalled();
    });
  });

  describe('actualizarMiembro()', () => {
    test('actualiza rol y/o activo', async () => {
      const db = crearMockDb({ data: { usuario_id: 'u1', rol: 'supervisor', activo: true }, error: null });
      const resultado = await actualizarMiembro(db, COMPANY_A, 'u1', { rol: 'supervisor' });
      expect(resultado.rol).toBe('supervisor');
    });
  });

  describe('actualizarNombreMiembro() (Fase Premium V1.1)', () => {
    test('404 si el usuario no pertenece a la empresa', async () => {
      const db = crearMockDb({ data: null, error: null });
      await expect(actualizarNombreMiembro(db, COMPANY_A, 'u1', 'Luis')).rejects.toMatchObject({ status: 404 });
    });

    test('éxito: actualiza el nombre en `usuarios` tras verificar pertenencia', async () => {
      const db = crearMockDb(
        { data: { usuario_id: 'u1' }, error: null },
        { data: { id: 'u1', nombre: 'Luis' }, error: null },
      );
      const resultado = await actualizarNombreMiembro(db, COMPANY_A, 'u1', 'Luis');
      expect(resultado.nombre).toBe('Luis');
      expect(db._llamadas).toEqual(['usuarios_empresas', 'usuarios']);
    });
  });

  describe('listarMiembros() / listarInvitacionesPendientes()', () => {
    test('listarMiembros() devuelve arreglo vacío en error', async () => {
      const db = crearMockDb({ data: null, error: new Error('boom') });
      expect(await listarMiembros(db, COMPANY_A)).toEqual([]);
    });

    test('listarInvitacionesPendientes() filtra por estado=pendiente', async () => {
      const db = crearMockDb({ data: [{ id: 'inv-1' }], error: null });
      const resultado = await listarInvitacionesPendientes(db, COMPANY_A);
      expect(resultado).toHaveLength(1);

      const builder = db.from.mock.results[0].value;
      expect(builder.eq).toHaveBeenCalledWith('estado', 'pendiente');
    });
  });
});
