'use strict';

// Réplica deliberada de auth.test.js — admin-auth.js es una réplica
// deliberada de auth.js (misma identidad de Supabase Auth, autorización
// contra plataforma_admins en vez de usuarios_empresas).
const mockCrearClienteConSesion = jest.fn();
jest.mock('../modules/clients', () => ({
  crearClienteConSesion: (...args) => mockCrearClienteConSesion(...args),
}));

const { iniciarSesionAdmin, resolverSesionAdmin, ErrorAdminAuth } = require('../modules/admin-auth');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockSupabase({ signInResult, getUserResult, fromResults = [] } = {}) {
  let idx = 0;
  return {
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue(signInResult ?? { data: null, error: { message: 'Invalid login credentials' } }),
      getUser: jest.fn().mockResolvedValue(getUserResult ?? { data: null, error: { message: 'invalid token' } }),
    },
    from: jest.fn(() => crearBuilder(fromResults[idx++] ?? { data: null, error: null })),
  };
}

const ADMIN_ID = 'admin-0001-0000-0000-0000-000000000001';

describe('admin-auth', () => {
  describe('iniciarSesionAdmin()', () => {
    test('lanza ErrorAdminAuth 401 si las credenciales son inválidas', async () => {
      const supabase = crearMockSupabase({ signInResult: { data: null, error: { message: 'Invalid login credentials' } } });

      await expect(iniciarSesionAdmin(supabase, 'a@b.com', 'mal')).rejects.toMatchObject({
        message: 'Credenciales inválidas', status: 401,
      });
      await expect(iniciarSesionAdmin(supabase, 'a@b.com', 'mal')).rejects.toBeInstanceOf(ErrorAdminAuth);
    });

    test('lanza ErrorAdminAuth 403 si la cuenta no está en plataforma_admins', async () => {
      const supabase = crearMockSupabase({
        signInResult: { data: { user: { id: ADMIN_ID }, session: { access_token: 'tok-123' } }, error: null },
        fromResults: [{ data: null, error: null }],
      });
      mockCrearClienteConSesion.mockReturnValue(supabase);

      await expect(iniciarSesionAdmin(supabase, 'a@b.com', 'ok')).rejects.toMatchObject({
        message: 'Tu cuenta no tiene acceso al Panel Maestro', status: 403,
      });
    });

    test('lanza ErrorAdminAuth 403 si la cuenta existe pero está inactiva (activo=false no matchea el filtro)', async () => {
      const supabase = crearMockSupabase({
        signInResult: { data: { user: { id: ADMIN_ID }, session: { access_token: 'tok-123' } }, error: null },
        fromResults: [{ data: null, error: null }], // .eq('activo', true) no encuentra fila
      });
      mockCrearClienteConSesion.mockReturnValue(supabase);

      await expect(iniciarSesionAdmin(supabase, 'a@b.com', 'ok')).rejects.toMatchObject({ status: 403 });
    });

    test('éxito: devuelve token y admin con rol', async () => {
      const supabase = crearMockSupabase({
        signInResult: { data: { user: { id: ADMIN_ID }, session: { access_token: 'tok-123' } }, error: null },
        fromResults: [{ data: { rol: 'super_admin', usuarios: { id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx' } }, error: null }],
      });
      mockCrearClienteConSesion.mockReturnValue(supabase);

      const resultado = await iniciarSesionAdmin(supabase, 'admin@uprise.com.mx', 'ok');

      expect(resultado.token).toBe('tok-123');
      expect(resultado.admin).toEqual({ id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx', rol: 'super_admin' });
    });
  });

  describe('resolverSesionAdmin()', () => {
    test('devuelve null sin llamar a supabase si falta token', async () => {
      const supabase = crearMockSupabase();
      expect(await resolverSesionAdmin(supabase, null)).toBeNull();
      expect(supabase.auth.getUser).not.toHaveBeenCalled();
    });

    test('devuelve null si el token es inválido', async () => {
      const supabase = crearMockSupabase({ getUserResult: { data: null, error: { message: 'jwt expired' } } });
      expect(await resolverSesionAdmin(supabase, 'tok-viejo')).toBeNull();
    });

    test('devuelve null si el usuario no es un Super Admin', async () => {
      const supabase = crearMockSupabase({
        getUserResult: { data: { user: { id: ADMIN_ID, email: 'a@b.com' } }, error: null },
        fromResults: [{ data: null, error: null }],
      });
      expect(await resolverSesionAdmin(supabase, 'tok')).toBeNull();
    });

    test('éxito: devuelve id, nombre, email y rol', async () => {
      const supabase = crearMockSupabase({
        getUserResult: { data: { user: { id: ADMIN_ID, email: 'admin@uprise.com.mx' } }, error: null },
        fromResults: [{ data: { rol: 'super_admin', usuarios: { id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx' } }, error: null }],
      });

      const admin = await resolverSesionAdmin(supabase, 'tok');

      expect(admin).toEqual({ id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx', rol: 'super_admin' });
    });
  });
});
