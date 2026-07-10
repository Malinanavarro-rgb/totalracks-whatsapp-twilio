'use strict';

// RLS: iniciarSesion() construye un cliente por-sesión (crearClienteConSesion)
// en cuanto tiene el JWT — se mockea para que apunte al mismo mock de
// Supabase usado en cada test, preservando las aserciones existentes.
const mockCrearClienteConSesion = jest.fn();
jest.mock('../modules/clients', () => ({
  crearClienteConSesion: (...args) => mockCrearClienteConSesion(...args),
}));

const { iniciarSesion, obtenerEmpresasDeUsuario, resolverSesion, ErrorAuth } = require('../modules/auth');

// ─── Mock Supabase (thenable, mismo patrón que scheduling-engine.test.js) ─────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockSupabase({ signInResult, getUserResult, fromResults = [] } = {}) {
  let idx = 0;
  const builders = [];
  return {
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue(
        signInResult ?? { data: null, error: { message: 'Invalid login credentials' } }
      ),
      getUser: jest.fn().mockResolvedValue(
        getUserResult ?? { data: null, error: { message: 'invalid token' } }
      ),
    },
    from: jest.fn(() => {
      const b = crearBuilder(fromResults[idx++] ?? { data: null, error: null });
      builders.push(b);
      return b;
    }),
    _builders: builders,
  };
}

const USUARIO_ID = 'user-0001-0000-0000-0000-000000000001';
const COMPANY_A  = 'company-a-0000-0000-0000-000000000001';
const COMPANY_B  = 'company-b-0000-0000-0000-000000000002';

describe('auth', () => {
  describe('iniciarSesion()', () => {
    test('lanza ErrorAuth 401 si las credenciales son inválidas', async () => {
      const supabase = crearMockSupabase({
        signInResult: { data: null, error: { message: 'Invalid login credentials' } },
      });

      await expect(iniciarSesion(supabase, 'a@b.com', 'mal')).rejects.toMatchObject({
        message: 'Credenciales inválidas',
        status: 401,
      });
      await expect(iniciarSesion(supabase, 'a@b.com', 'mal')).rejects.toBeInstanceOf(ErrorAuth);
    });

    test('lanza ErrorAuth 403 si el usuario no pertenece a ninguna empresa', async () => {
      const supabase = crearMockSupabase({
        signInResult: {
          data: { user: { id: USUARIO_ID }, session: { access_token: 'tok-123' } },
          error: null,
        },
        fromResults: [{ data: [], error: null }], // usuarios_empresas vacío
      });
      mockCrearClienteConSesion.mockReturnValue(supabase);

      await expect(iniciarSesion(supabase, 'a@b.com', 'ok')).rejects.toMatchObject({
        message: 'Tu cuenta no está asociada a ninguna empresa',
        status: 403,
      });
    });

    test('éxito con una empresa: devuelve token, usuario y empresaActiva', async () => {
      const supabase = crearMockSupabase({
        signInResult: {
          data: { user: { id: USUARIO_ID }, session: { access_token: 'tok-123' } },
          error: null,
        },
        fromResults: [
          { data: [{ company_id: COMPANY_A, rol: 'owner', created_at: '2026-01-01', companies: { nombre: 'Total Racks' } }], error: null },
          { data: { id: USUARIO_ID, nombre: 'Alina', email: 'a@b.com' }, error: null },
        ],
      });
      mockCrearClienteConSesion.mockReturnValue(supabase);

      const resultado = await iniciarSesion(supabase, 'a@b.com', 'ok');

      expect(resultado.token).toBe('tok-123');
      expect(resultado.usuario).toEqual({ id: USUARIO_ID, nombre: 'Alina', email: 'a@b.com' });
      expect(resultado.empresaActiva).toEqual({ company_id: COMPANY_A, nombre: 'Total Racks', rol: 'owner' });
      expect(resultado.empresas).toHaveLength(1);
    });

    test('éxito con varias empresas: empresaActiva es la primera del listado (orden por created_at)', async () => {
      const supabase = crearMockSupabase({
        signInResult: {
          data: { user: { id: USUARIO_ID }, session: { access_token: 'tok-123' } },
          error: null,
        },
        fromResults: [
          {
            data: [
              { company_id: COMPANY_A, rol: 'owner', created_at: '2026-01-01', companies: { nombre: 'Total Racks' } },
              { company_id: COMPANY_B, rol: 'asesor', created_at: '2026-02-01', companies: { nombre: 'Salón de Uñas' } },
            ],
            error: null,
          },
          { data: { id: USUARIO_ID, nombre: 'Alina', email: 'a@b.com' }, error: null },
        ],
      });
      mockCrearClienteConSesion.mockReturnValue(supabase);

      const resultado = await iniciarSesion(supabase, 'a@b.com', 'ok');

      expect(resultado.empresaActiva.company_id).toBe(COMPANY_A);
      expect(resultado.empresas).toHaveLength(2);
    });
  });

  describe('obtenerEmpresasDeUsuario()', () => {
    test('mapea company_id, nombre y rol de cada fila', async () => {
      const supabase = crearMockSupabase({
        fromResults: [{
          data: [{ company_id: COMPANY_A, rol: 'supervisor', created_at: '2026-01-01', companies: { nombre: 'Total Racks' } }],
          error: null,
        }],
      });

      const empresas = await obtenerEmpresasDeUsuario(supabase, USUARIO_ID);

      expect(empresas).toEqual([{ company_id: COMPANY_A, nombre: 'Total Racks', rol: 'supervisor' }]);
    });

    test('devuelve arreglo vacío si la consulta falla', async () => {
      const supabase = crearMockSupabase({
        fromResults: [{ data: null, error: { message: 'fallo de red' } }],
      });

      const empresas = await obtenerEmpresasDeUsuario(supabase, USUARIO_ID);

      expect(empresas).toEqual([]);
    });
  });

  describe('resolverSesion()', () => {
    test('devuelve null sin llamar a supabase si falta token o companyId', async () => {
      const supabase = crearMockSupabase();

      expect(await resolverSesion(supabase, null, COMPANY_A)).toBeNull();
      expect(await resolverSesion(supabase, 'tok', null)).toBeNull();
      expect(supabase.auth.getUser).not.toHaveBeenCalled();
    });

    test('devuelve null si el token es inválido', async () => {
      const supabase = crearMockSupabase({
        getUserResult: { data: null, error: { message: 'jwt expired' } },
      });

      expect(await resolverSesion(supabase, 'tok-viejo', COMPANY_A)).toBeNull();
    });

    test('devuelve null si el usuario no pertenece a esa empresa', async () => {
      const supabase = crearMockSupabase({
        getUserResult: { data: { user: { id: USUARIO_ID, email: 'a@b.com' } }, error: null },
        fromResults: [{ data: null, error: null }], // usuarios_empresas: sin fila para esa empresa
      });

      expect(await resolverSesion(supabase, 'tok', COMPANY_B)).toBeNull();
    });

    test('éxito: devuelve id, nombre, email, company_id y rol', async () => {
      const supabase = crearMockSupabase({
        getUserResult: { data: { user: { id: USUARIO_ID, email: 'a@b.com' } }, error: null },
        fromResults: [{
          data: { rol: 'administrador', usuarios: { id: USUARIO_ID, nombre: 'Alina', email: 'a@b.com' } },
          error: null,
        }],
      });

      const usuario = await resolverSesion(supabase, 'tok', COMPANY_A);

      expect(usuario).toEqual({
        id: USUARIO_ID, nombre: 'Alina', email: 'a@b.com', company_id: COMPANY_A, rol: 'administrador',
      });
    });
  });
});
