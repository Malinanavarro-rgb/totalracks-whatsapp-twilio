'use strict';

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
      const requireAuth = crearRequireAuth(supabase);
      const req = crearReq();
      const res = crearRes();
      const next = jest.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
      expect(supabase.auth.getUser).not.toHaveBeenCalled();
    });

    test('401 si la sesión no resuelve a un usuario válido', async () => {
      const supabase = {
        auth: { getUser: jest.fn().mockResolvedValue({ data: null, error: { message: 'jwt expired' } }) },
      };
      const requireAuth = crearRequireAuth(supabase);
      const req = crearReq({ tara_session: 'tok-viejo', tara_company: 'company-a' });
      const res = crearRes();
      const next = jest.fn();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('adjunta req.usuario y llama next() cuando la sesión es válida', async () => {
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
      const requireAuth = crearRequireAuth(supabase);
      const req = crearReq({ tara_session: 'tok-bueno', tara_company: 'company-a' });
      const res = crearRes();
      const next = jest.fn();

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.usuario).toEqual({
        id: 'u-1', nombre: 'Alina', email: 'a@b.com', company_id: 'company-a', rol: 'owner',
      });
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
