'use strict';

const {
  ROLES_GERENCIALES, MODULOS_PERMISOS, ACCIONES_PERMISOS, ALCANCES_PERMISOS,
  esGerencial, tienePermiso, resolverAlcance, requirePermiso,
} = require('../modules/permisos');

function crearBuilder(resultado) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resultado)),
  };
  return builder;
}

/** Simula una empresa con 0 o más filas reales de roles_permisos. */
function crearMockDb(filas = []) {
  return {
    from: jest.fn(() => {
      // La primera llamada real (select roles_permisos por rol+modulo) vs.
      // la de "empresaTieneMatrizConfigurada" (select roles_permisos limit 1)
      // usan la MISMA tabla — se distinguen por los filtros aplicados.
      const filtros = {};
      const builder = {
        select: jest.fn(() => builder),
        eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
        limit: jest.fn(() => builder),
        maybeSingle: jest.fn(() => {
          if (filtros.rol !== undefined && filtros.modulo !== undefined) {
            const fila = filas.find((f) => f.company_id === filtros.company_id && f.rol === filtros.rol && f.modulo === filtros.modulo);
            return Promise.resolve({ data: fila || null, error: null });
          }
          // _empresaTieneMatrizConfigurada: solo filtra por company_id + limit(1)
          const cualquiera = filas.find((f) => f.company_id === filtros.company_id);
          return Promise.resolve({ data: cualquiera || null, error: null });
        }),
      };
      return builder;
    }),
  };
}

const COMPANY_A = 'company-aaaa';

describe('constantes', () => {
  test('ROLES_GERENCIALES sin cambios (compatibilidad con todo lo que ya lo usaba)', () => {
    expect(ROLES_GERENCIALES).toEqual(['owner', 'administrador', 'supervisor']);
  });
  test('MODULOS_PERMISOS incluye los 12 módulos de la auditoría', () => {
    expect(MODULOS_PERMISOS).toEqual([
      'crm', 'cotizaciones', 'proyectos', 'cobranza', 'instalaciones', 'inventario',
      'compras', 'tramites_cfe', 'garantias', 'mantenimiento', 'tickets', 'configuracion',
    ]);
  });
  test('ACCIONES_PERMISOS incluye las 6 acciones de la auditoría', () => {
    expect(ACCIONES_PERMISOS).toEqual(['ver', 'crear', 'editar', 'eliminar', 'aprobar', 'exportar']);
  });
  test('ALCANCES_PERMISOS incluye los 4 alcances de la auditoría', () => {
    expect(ALCANCES_PERMISOS).toEqual(['todos', 'sucursal', 'propios', 'asignados']);
  });
});

describe('esGerencial()', () => {
  test('owner/administrador/supervisor → true', () => {
    expect(esGerencial('owner')).toBe(true);
    expect(esGerencial('administrador')).toBe(true);
    expect(esGerencial('supervisor')).toBe(true);
  });
  test('cualquier otro rol → false', () => {
    expect(esGerencial('ventas')).toBe(false);
    expect(esGerencial('asesor')).toBe(false);
    expect(esGerencial(undefined)).toBe(false);
  });
});

describe('tienePermiso() — bypass gerencial', () => {
  test('gerencial SIEMPRE true, sin siquiera consultar la base', async () => {
    const db = crearMockDb();
    expect(await tienePermiso(db, { companyId: COMPANY_A, rol: 'owner', modulo: 'compras', accion: 'eliminar' })).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('tienePermiso() — empresa SIN matriz configurada (fallback nivel 1: comportamiento previo, acceso total)', () => {
  test('rol no-gerencial, empresa sin ninguna fila → true en cualquier acción (cero regresión)', async () => {
    const db = crearMockDb([]); // ninguna empresa tiene filas
    expect(await tienePermiso(db, { companyId: COMPANY_A, rol: 'ventas', modulo: 'compras', accion: 'eliminar' })).toBe(true);
    expect(await tienePermiso(db, { companyId: COMPANY_A, rol: 'instalaciones', modulo: 'configuracion', accion: 'editar' })).toBe(true);
  });
});

describe('tienePermiso() — empresa CON matriz configurada (fallback nivel 2: hueco = denegar)', () => {
  test('fila existe para (rol, modulo) → respeta el booleano exacto de la acción', async () => {
    const db = crearMockDb([
      { company_id: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones', ver: true, crear: true, editar: true, eliminar: false, aprobar: false, exportar: false },
    ]);
    expect(await tienePermiso(db, { companyId: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones', accion: 'crear' })).toBe(true);
    expect(await tienePermiso(db, { companyId: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones', accion: 'eliminar' })).toBe(false);
  });

  test('la empresa tiene OTRA fila configurada (para otro rol/módulo), pero NO para esta combinación exacta → deniega (nunca "todo permitido" por default)', async () => {
    const db = crearMockDb([
      { company_id: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones', ver: true, crear: true, editar: true, eliminar: false, aprobar: false, exportar: false },
    ]);
    // El mismo rol pidiendo un módulo SIN fila configurada.
    expect(await tienePermiso(db, { companyId: COMPANY_A, rol: 'ventas', modulo: 'compras', accion: 'ver' })).toBe(false);
    // Otro rol sin ninguna fila en absoluto.
    expect(await tienePermiso(db, { companyId: COMPANY_A, rol: 'almacen', modulo: 'compras', accion: 'ver' })).toBe(false);
  });

  test('acción no reconocida → lanza (nunca un booleano silencioso que podría malinterpretarse)', async () => {
    const db = crearMockDb([]);
    await expect(tienePermiso(db, { companyId: COMPANY_A, rol: 'ventas', modulo: 'crm', accion: 'volar' })).rejects.toThrow(/no reconocida/);
  });
});

describe('resolverAlcance()', () => {
  test('gerencial → siempre "todos"', async () => {
    const db = crearMockDb();
    expect(await resolverAlcance(db, { companyId: COMPANY_A, rol: 'owner', modulo: 'cotizaciones' })).toBe('todos');
  });

  test('sin matriz configurada en la empresa → "todos" (comportamiento previo, sin restricción)', async () => {
    const db = crearMockDb([]);
    expect(await resolverAlcance(db, { companyId: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones' })).toBe('todos');
  });

  test('con matriz configurada y fila real → el alcance exacto de la fila', async () => {
    const db = crearMockDb([{ company_id: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones', alcance: 'propios' }]);
    expect(await resolverAlcance(db, { companyId: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones' })).toBe('propios');
  });

  test('con matriz configurada pero SIN fila para esta combinación → "propios" (default seguro, nunca "todos" implícito)', async () => {
    const db = crearMockDb([{ company_id: COMPANY_A, rol: 'ventas', modulo: 'cotizaciones', alcance: 'propios' }]);
    expect(await resolverAlcance(db, { companyId: COMPANY_A, rol: 'almacen', modulo: 'inventario' })).toBe('propios');
  });
});

describe('requirePermiso() — middleware Express', () => {
  function crearReqRes(rol) {
    const req = { supabase: crearMockDb([{ company_id: COMPANY_A, rol: 'ventas', modulo: 'compras', ver: false, crear: false, editar: false, eliminar: false, aprobar: false, exportar: false }]), usuario: { company_id: COMPANY_A, rol } };
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    return { req, res };
  }

  test('permiso concedido → llama next(), nunca responde', async () => {
    const { req, res } = crearReqRes('owner'); // gerencial, bypass
    const next = jest.fn();
    await requirePermiso('compras', 'ver')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('permiso denegado → 403 con mensaje claro, nunca llama next()', async () => {
    const { req, res } = crearReqRes('ventas'); // fila existe pero ver:false
    const next = jest.fn();
    await requirePermiso('compras', 'ver')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('permiso') });
  });

  test('error inesperado (ej. DB caída) → 500, nunca dejar pasar por accidente', async () => {
    const req = { supabase: { from: jest.fn(() => { throw new Error('DB caída'); }) }, usuario: { company_id: COMPANY_A, rol: 'ventas' } };
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();
    await requirePermiso('compras', 'ver')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
