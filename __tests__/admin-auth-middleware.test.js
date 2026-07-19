'use strict';

// admin-auth.js consulta plataforma_admins vía supabaseServicio (RLS activo
// sin políticas en esa tabla nueva — ver admin-auth.js) — se mockea aparte
// del cliente de sesión que requireAdmin usa solo para auth.getUser().
const mockServicioFrom = jest.fn();
jest.mock('../modules/clients', () => ({
  supabaseServicio: { from: (...args) => mockServicioFrom(...args) },
}));

const { crearRequireAdmin } = require('../modules/admin-auth-middleware');

function crearReq(cookies = {}) {
  return { cookies };
}

function crearRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function crearBuilderServicio(resultado) {
  return {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
  };
}

describe('admin-auth-middleware', () => {
  beforeEach(() => { mockServicioFrom.mockReset(); });

  describe('requireAdmin()', () => {
    test('401 si no hay cookie tara_admin_session', async () => {
      const supabase = { auth: { getUser: jest.fn() } };
      const crearClienteConSesion = jest.fn().mockReturnValue(supabase);
      const requireAdmin = crearRequireAdmin(crearClienteConSesion);
      const req = crearReq();
      const res = crearRes();
      const next = jest.fn();

      await requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
      expect(crearClienteConSesion).not.toHaveBeenCalled();
    });

    test('401 si el token no resuelve a un admin válido', async () => {
      const supabase = { auth: { getUser: jest.fn().mockResolvedValue({ data: null, error: { message: 'jwt expired' } }) } };
      const crearClienteConSesion = jest.fn().mockReturnValue(supabase);
      const requireAdmin = crearRequireAdmin(crearClienteConSesion);
      const req = crearReq({ tara_admin_session: 'tok-viejo' });
      const res = crearRes();
      const next = jest.fn();

      await requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('adjunta req.admin, req.supabase y llama next() cuando la sesión es válida', async () => {
      const supabase = {
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'admin-1', email: 'a@b.com' } }, error: null }) },
      };
      mockServicioFrom.mockReturnValue(crearBuilderServicio({
        data: { rol: 'super_admin', usuarios: { id: 'admin-1', nombre: 'Gabriel', email: 'a@b.com' } },
        error: null,
      }));
      const crearClienteConSesion = jest.fn().mockReturnValue(supabase);
      const requireAdmin = crearRequireAdmin(crearClienteConSesion);
      const req = crearReq({ tara_admin_session: 'tok-bueno' });
      const res = crearRes();
      const next = jest.fn();

      await requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(crearClienteConSesion).toHaveBeenCalledWith('tok-bueno');
      expect(req.admin).toEqual({ id: 'admin-1', nombre: 'Gabriel', email: 'a@b.com', rol: 'super_admin' });
      expect(req.supabase).toBe(supabase);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
