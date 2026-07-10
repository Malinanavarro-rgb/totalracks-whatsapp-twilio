'use strict';

// auth-middleware.js → auth.js → clients.js (createClient real al cargar el
// módulo) — se mockea para no depender de variables de entorno reales en
// este test (el factory real de crearClienteConSesion no se usa aquí, cada
// test inyecta el suyo directamente a crearRequireAuth()).
jest.mock('../modules/clients', () => ({ crearClienteConSesion: jest.fn() }));

const { crearRequireAuth } = require('../modules/auth-middleware');

function crearReq(cookies = {}) {
  return { cookies };
}

function crearRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth-middleware', () => {
  describe('requireAuth()', () => {
    test('401 si no hay cookie de sesión ni de empresa', async () => {
      const supabase = { auth: { getUser: jest.fn() } };
      const crearClienteConSesion = jest.fn().mockReturnValue(supabase);
      const requireAuth = crearRequireAuth(crearClienteConSesion);
      const req = crearReq();
      const res = crearRes();
      const next = jest.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
      expect(supabase.auth.getUser).not.toHaveBeenCalled();
      expect(crearClienteConSesion).not.toHaveBeenCalled();
    });

    test('401 si la sesión no resuelve a un usuario válido', async () => {
      const supabase = {
        auth: { getUser: jest.fn().mockResolvedValue({ data: null, error: { message: 'jwt expired' } }) },
      };
      const crearClienteConSesion = jest.fn().mockReturnValue(supabase);
      const requireAuth = crearRequireAuth(crearClienteConSesion);
      const req = crearReq({ tara_session: 'tok-viejo', tara_company: 'company-a' });
      const res = crearRes();
      const next = jest.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('adjunta req.usuario, req.supabase y llama next() cuando la sesión es válida', async () => {
      const supabase = {
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u-1', email: 'a@b.com' } }, error: null }) },
        from: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { rol: 'owner', usuarios: { id: 'u-1', nombre: 'Alina', email: 'a@b.com' } },
            error: null,
          }),
        })),
      };
      const crearClienteConSesion = jest.fn().mockReturnValue(supabase);
      const requireAuth = crearRequireAuth(crearClienteConSesion);
      const req = crearReq({ tara_session: 'tok-bueno', tara_company: 'company-a' });
      const res = crearRes();
      const next = jest.fn();

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(crearClienteConSesion).toHaveBeenCalledWith('tok-bueno');
      expect(req.usuario).toEqual({
        id: 'u-1', nombre: 'Alina', email: 'a@b.com', company_id: 'company-a', rol: 'owner',
      });
      expect(req.supabase).toBe(supabase);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
