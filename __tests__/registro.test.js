'use strict';

const mockCrearEmpresaConIndustria = jest.fn();
const mockCrearSuscripcionManual   = jest.fn();

jest.mock('../modules/plantillas-industria', () => ({
  crearEmpresaConIndustria: (...args) => mockCrearEmpresaConIndustria(...args),
}));
jest.mock('../modules/plataforma-billing', () => ({
  crearSuscripcionManual: (...args) => mockCrearSuscripcionManual(...args),
}));

const { registrarEmpresa, ErrorRegistro } = require('../modules/registro');

const USUARIO_ID = 'user-0001-0000-0000-0000-000000000001';
const COMPANY_ID = 'company-0000-0000-0000-000000000001';
const ORG_ID     = 'org-0000-0000-0000-000000000001';
const PLAN_LAUNCH_ID = 'plan-launch-0001';

function crearBuilder(resultado) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then:        (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockSupabaseServicio({ signUpResult, updateUserResult, planLaunchResult, fromInsertResults = {} } = {}) {
  const llamadasInsert = [];
  return {
    auth: {
      signUp: jest.fn().mockResolvedValue(signUpResult ?? { data: { user: { id: USUARIO_ID } }, error: null }),
      admin: { updateUserById: jest.fn().mockResolvedValue(updateUserResult ?? { data: {}, error: null }) },
    },
    from: jest.fn((tabla) => {
      if (tabla === 'planes') return crearBuilder(planLaunchResult ?? { data: { id: PLAN_LAUNCH_ID }, error: null });
      const builder = crearBuilder({ data: null, error: null });
      builder.insert = jest.fn((filas) => { llamadasInsert.push([tabla, filas]); return builder; });
      return builder;
    }),
    _llamadasInsert: llamadasInsert,
  };
}

const DATOS_VALIDOS = {
  nombreNegocio: 'Bella Studio',
  descripcionNegocio: 'Salón de uñas y manicure en Monterrey',
  nombreUsuario: 'Ana Pérez',
  email: 'ana@bellastudio.com',
  password: 'ClaveSegura123',
};

describe('registro', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCrearEmpresaConIndustria.mockResolvedValue({
      organization: { id: ORG_ID }, company: { id: COMPANY_ID }, industriaDetectada: 'Salón de belleza', huboCoincidencia: true,
    });
    mockCrearSuscripcionManual.mockResolvedValue({ id: 'sub-1' });
  });

  describe('validaciones', () => {
    test('rechaza sin nombreNegocio', async () => {
      const supabase = crearMockSupabaseServicio();
      await expect(registrarEmpresa(supabase, { ...DATOS_VALIDOS, nombreNegocio: '' }))
        .rejects.toMatchObject({ status: 400 });
      expect(supabase.auth.signUp).not.toHaveBeenCalled();
    });

    test('rechaza sin email', async () => {
      const supabase = crearMockSupabaseServicio();
      await expect(registrarEmpresa(supabase, { ...DATOS_VALIDOS, email: '' })).rejects.toMatchObject({ status: 400 });
    });

    test('rechaza password menor a 8 caracteres', async () => {
      const supabase = crearMockSupabaseServicio();
      await expect(registrarEmpresa(supabase, { ...DATOS_VALIDOS, password: '123' })).rejects.toMatchObject({
        status: 400, message: expect.stringMatching(/8 caracteres/),
      });
      expect(supabase.auth.signUp).not.toHaveBeenCalled();
    });
  });

  describe('email ya registrado', () => {
    test('signUp falla → ErrorRegistro 400, no crea nada más', async () => {
      const supabase = crearMockSupabaseServicio({
        signUpResult: { data: null, error: { message: 'User already registered' } },
      });

      await expect(registrarEmpresa(supabase, DATOS_VALIDOS)).rejects.toMatchObject({
        status: 400, message: 'User already registered',
      });
      expect(mockCrearEmpresaConIndustria).not.toHaveBeenCalled();
    });
  });

  describe('flujo exitoso', () => {
    test('crea cuenta, confirma email, empresa+organización, vincula owner y suscripción trial', async () => {
      const supabase = crearMockSupabaseServicio();

      const resultado = await registrarEmpresa(supabase, DATOS_VALIDOS);

      expect(supabase.auth.signUp).toHaveBeenCalledWith({ email: DATOS_VALIDOS.email, password: DATOS_VALIDOS.password });
      expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith(USUARIO_ID, { email_confirm: true });

      expect(mockCrearEmpresaConIndustria).toHaveBeenCalledWith(supabase, expect.objectContaining({
        nombre: 'Bella Studio', descripcionNegocio: 'Salón de uñas y manicure en Monterrey',
      }));

      const insertUsuarios = supabase._llamadasInsert.find(([tabla]) => tabla === 'usuarios');
      expect(insertUsuarios[1]).toEqual([{ id: USUARIO_ID, email: DATOS_VALIDOS.email, nombre: 'Ana Pérez' }]);

      const insertVinculo = supabase._llamadasInsert.find(([tabla]) => tabla === 'usuarios_empresas');
      expect(insertVinculo[1]).toEqual([{ usuario_id: USUARIO_ID, company_id: COMPANY_ID, rol: 'owner', activo: true }]);

      expect(mockCrearSuscripcionManual).toHaveBeenCalledWith(supabase, { organizationId: ORG_ID, planId: PLAN_LAUNCH_ID });

      expect(resultado).toEqual({ usuarioId: USUARIO_ID, email: DATOS_VALIDOS.email, companyId: COMPANY_ID, organizationId: ORG_ID });
    });

    test('el rol siempre es "owner" — ignora cualquier campo "rol" que venga en los datos', async () => {
      const supabase = crearMockSupabaseServicio();
      await registrarEmpresa(supabase, { ...DATOS_VALIDOS, rol: 'administrador' });

      const insertVinculo = supabase._llamadasInsert.find(([tabla]) => tabla === 'usuarios_empresas');
      expect(insertVinculo[1][0].rol).toBe('owner');
    });

    test('sin plan Launch configurado: no lanza, simplemente no crea suscripción', async () => {
      const supabase = crearMockSupabaseServicio({ planLaunchResult: { data: null, error: null } });
      await expect(registrarEmpresa(supabase, DATOS_VALIDOS)).resolves.toBeDefined();
      expect(mockCrearSuscripcionManual).not.toHaveBeenCalled();
    });

    test('nombreUsuario opcional: usuarios.nombre queda null si no se da', async () => {
      const supabase = crearMockSupabaseServicio();
      await registrarEmpresa(supabase, { ...DATOS_VALIDOS, nombreUsuario: undefined });
      const insertUsuarios = supabase._llamadasInsert.find(([tabla]) => tabla === 'usuarios');
      expect(insertUsuarios[1][0].nombre).toBeNull();
    });
  });
});
