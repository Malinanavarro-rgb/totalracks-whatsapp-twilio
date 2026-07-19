'use strict';

// plataforma_admins es una tabla nueva con RLS activado sin políticas
// (confirmado en producción: un cliente anon+JWT la ve vacía aunque la fila
// exista) — admin-auth.js consulta esa tabla con supabaseServicio a
// propósito, nunca con el cliente de sesión del usuario. Se mockea el
// service_role aparte del `supabase` que se le pasa a la función (ese
// sigue usándose solo para las llamadas de Auth: signInWithPassword/getUser).
const mockServicioFrom = jest.fn();
jest.mock('../modules/clients', () => ({
  supabaseServicio: { from: (...args) => mockServicioFrom(...args) },
}));

const { iniciarSesionAdmin, resolverSesionAdmin, ErrorAdminAuth } = require('../modules/admin-auth');

function crearBuilderServicio(resultado = { data: null, error: null }) {
  return {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
  };
}

function crearMockSupabaseAuth({ signInResult, getUserResult } = {}) {
  return {
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue(signInResult ?? { data: null, error: { message: 'Invalid login credentials' } }),
      getUser: jest.fn().mockResolvedValue(getUserResult ?? { data: null, error: { message: 'invalid token' } }),
    },
  };
}

const ADMIN_ID = 'admin-0001-0000-0000-0000-000000000001';

describe('admin-auth', () => {
  beforeEach(() => { mockServicioFrom.mockReset(); });

  describe('iniciarSesionAdmin()', () => {
    test('lanza ErrorAdminAuth 401 si las credenciales son inválidas', async () => {
      const supabase = crearMockSupabaseAuth({ signInResult: { data: null, error: { message: 'Invalid login credentials' } } });

      await expect(iniciarSesionAdmin(supabase, 'a@b.com', 'mal')).rejects.toMatchObject({
        message: 'Credenciales inválidas', status: 401,
      });
      await expect(iniciarSesionAdmin(supabase, 'a@b.com', 'mal')).rejects.toBeInstanceOf(ErrorAdminAuth);
    });

    test('lanza ErrorAdminAuth 403 si la cuenta no está en plataforma_admins', async () => {
      const supabase = crearMockSupabaseAuth({ signInResult: { data: { user: { id: ADMIN_ID }, session: { access_token: 'tok-123' } }, error: null } });
      mockServicioFrom.mockReturnValue(crearBuilderServicio({ data: null, error: null }));

      await expect(iniciarSesionAdmin(supabase, 'a@b.com', 'ok')).rejects.toMatchObject({
        message: 'Tu cuenta no tiene acceso al Panel Maestro', status: 403,
      });
    });

    test('éxito: devuelve token y admin con rol (consulta plataforma_admins vía supabaseServicio)', async () => {
      const supabase = crearMockSupabaseAuth({ signInResult: { data: { user: { id: ADMIN_ID }, session: { access_token: 'tok-123' } }, error: null } });
      mockServicioFrom.mockReturnValue(crearBuilderServicio({
        data: { rol: 'super_admin', usuarios: { id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx' } },
        error: null,
      }));

      const resultado = await iniciarSesionAdmin(supabase, 'admin@uprise.com.mx', 'ok');

      expect(mockServicioFrom).toHaveBeenCalledWith('plataforma_admins');
      expect(resultado.token).toBe('tok-123');
      expect(resultado.admin).toEqual({ id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx', rol: 'super_admin' });
    });
  });

  describe('resolverSesionAdmin()', () => {
    test('devuelve null sin llamar a supabase si falta token', async () => {
      const supabase = crearMockSupabaseAuth();
      expect(await resolverSesionAdmin(supabase, null)).toBeNull();
      expect(supabase.auth.getUser).not.toHaveBeenCalled();
    });

    test('devuelve null si el token es inválido', async () => {
      const supabase = crearMockSupabaseAuth({ getUserResult: { data: null, error: { message: 'jwt expired' } } });
      expect(await resolverSesionAdmin(supabase, 'tok-viejo')).toBeNull();
    });

    test('devuelve null si el usuario no es un Super Admin', async () => {
      const supabase = crearMockSupabaseAuth({ getUserResult: { data: { user: { id: ADMIN_ID, email: 'a@b.com' } }, error: null } });
      mockServicioFrom.mockReturnValue(crearBuilderServicio({ data: null, error: null }));

      expect(await resolverSesionAdmin(supabase, 'tok')).toBeNull();
    });

    test('éxito: devuelve id, nombre, email y rol (consulta plataforma_admins vía supabaseServicio)', async () => {
      const supabase = crearMockSupabaseAuth({ getUserResult: { data: { user: { id: ADMIN_ID, email: 'admin@uprise.com.mx' } }, error: null } });
      mockServicioFrom.mockReturnValue(crearBuilderServicio({
        data: { rol: 'super_admin', usuarios: { id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx' } },
        error: null,
      }));

      const admin = await resolverSesionAdmin(supabase, 'tok');

      expect(mockServicioFrom).toHaveBeenCalledWith('plataforma_admins');
      expect(admin).toEqual({ id: ADMIN_ID, nombre: 'Gabriel', email: 'admin@uprise.com.mx', rol: 'super_admin' });
    });
  });
});
