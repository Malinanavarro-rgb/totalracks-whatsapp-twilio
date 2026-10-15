'use strict';

jest.mock('../modules/permisos', () => ({
  ...jest.requireActual('../modules/permisos'),
  modulosVisibles: jest.fn(),
}));

const { modulosVisibles } = require('../modules/permisos');
const {
  resolverEstadoModulo, moduloPermiteAcceso, requireModuloActivo, resolverModulosAutorizadosParaIA,
} = require('../modules/modulo-engine');

function crearMockDb({ filaModulo, insertados = [] } = {}) {
  return {
    _insertados: insertados,
    from: jest.fn((tabla) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: filaModulo ?? null, error: null }),
      insert: jest.fn((filas) => { insertados.push({ tabla, filas }); return Promise.resolve({ data: filas, error: null }); }),
    })),
  };
}

const COMPANY_A = 'company-aaaa';

describe('resolverEstadoModulo() / moduloPermiteAcceso()', () => {
  test('sin fila (empresa no migrada, o migrada sin opinión sobre este módulo) → "sin_fila_configurada", SIEMPRE permite acceso', async () => {
    const db = crearMockDb({ filaModulo: null });
    const estado = await resolverEstadoModulo(db, COMPANY_A, 'tickets');
    expect(estado).toBe('sin_fila_configurada');
    expect(moduloPermiteAcceso(estado)).toBe(true);
  });

  test('estado "activo" → permite acceso', async () => {
    expect(moduloPermiteAcceso('activo')).toBe(true);
  });

  test('estado "integrado" → permite acceso — nunca se trata como bloqueado', async () => {
    expect(moduloPermiteAcceso('integrado')).toBe(true);
  });

  test('estado "inactivo" → es el ÚNICO que bloquearía en una fase de enforcement real', async () => {
    expect(moduloPermiteAcceso('inactivo')).toBe(false);
  });
});

describe('requireModuloActivo() — MODO OBSERVACIÓN (Fase 2 piloto, 2026-10-17)', () => {
  function crearReqRes(filaModulo) {
    const db = crearMockDb({ filaModulo });
    const req = { supabase: db, usuario: { company_id: COMPANY_A, rol: 'ventas' }, originalUrl: '/api/tickets', method: 'GET' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return { req, res, db };
  }

  test('CRÍTICO: módulo "inactivo" (se habría bloqueado) → de todas formas llama next(), NUNCA responde 403 en esta fase', async () => {
    const { req, res } = crearReqRes({ estado: 'inactivo' });
    const next = jest.fn();
    await requireModuloActivo('tickets')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('registra la observación con hubiera_bloqueado=true cuando el módulo está inactivo', async () => {
    const { req, res, db } = crearReqRes({ estado: 'inactivo' });
    await requireModuloActivo('tickets')(req, res, jest.fn());
    const obs = db._insertados[0].filas[0];
    expect(db._insertados[0].tabla).toBe('modulo_enforcement_observaciones');
    expect(obs).toMatchObject({
      company_id: COMPANY_A, modulo_codigo: 'tickets', ruta: '/api/tickets', metodo: 'GET',
      rol: 'ventas', estado_modulo_encontrado: 'inactivo', hubiera_bloqueado: true,
    });
  });

  test('módulo "activo" → registra hubiera_bloqueado=false, llama next()', async () => {
    const { req, res, db } = crearReqRes({ estado: 'activo' });
    const next = jest.fn();
    await requireModuloActivo('tickets')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(db._insertados[0].filas[0].hubiera_bloqueado).toBe(false);
  });

  test('módulo "integrado" → registra hubiera_bloqueado=false (compatibilidad con funcionalidades integradas, nunca se trata como bloqueo)', async () => {
    const { req, res, db } = crearReqRes({ estado: 'integrado' });
    await requireModuloActivo('tickets')(req, res, jest.fn());
    expect(db._insertados[0].filas[0]).toMatchObject({ estado_modulo_encontrado: 'integrado', hubiera_bloqueado: false });
  });

  test('empresa con module_engine_configurado_en = NULL (sin fila) → hubiera_bloqueado=false SIEMPRE, cero bloqueo por ausencia de configuración', async () => {
    const { req, res, db } = crearReqRes(null);
    const next = jest.fn();
    await requireModuloActivo('tickets')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(db._insertados[0].filas[0]).toMatchObject({ estado_modulo_encontrado: 'sin_fila_configurada', hubiera_bloqueado: false });
  });

  test('si falla la consulta a modulos_empresa, igual llama next() — nunca bloquea el turno/la petición por un error interno', async () => {
    const db = { from: jest.fn(() => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockRejectedValue(new Error('DB caída')) })) };
    const req = { supabase: db, usuario: { company_id: COMPANY_A, rol: 'ventas' }, originalUrl: '/api/tickets', method: 'GET' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await requireModuloActivo('tickets')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('si falla el registro de la observación, igual llama next() — nunca bloquea el turno por un fallo de auditoría', async () => {
    const dbQueBuilder = () => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: { estado: 'activo' }, error: null }) });
    const db = { from: jest.fn((tabla) => tabla === 'modulo_enforcement_observaciones' ? { insert: jest.fn().mockRejectedValue(new Error('insert falló')) } : dbQueBuilder()) };
    const req = { supabase: db, usuario: { company_id: COMPANY_A, rol: 'ventas' }, originalUrl: '/api/tickets', method: 'GET' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await requireModuloActivo('tickets')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('aislamiento multiempresa — requireModuloActivo()', () => {
  test('la observación siempre se filtra/etiqueta con el company_id del usuario autenticado, nunca con uno distinto', async () => {
    const COMPANY_B = 'company-bbbb';
    const db = crearMockDb({ filaModulo: { estado: 'activo' } });
    const req = { supabase: db, usuario: { company_id: COMPANY_B, rol: 'owner' }, originalUrl: '/api/tickets', method: 'GET' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await requireModuloActivo('tickets')(req, res, jest.fn());

    expect(db._insertados[0].filas[0].company_id).toBe(COMPANY_B);
  });
});

describe('resolverModulosAutorizadosParaIA() — preparada, no conectada a producción todavía', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sin ningún módulo "inactivo" (empresa sin migrar o totalmente activa) → devuelve exactamente lo que ya devolvía modulosVisibles(), sin restar nada', async () => {
    modulosVisibles.mockResolvedValue(['crm', 'cotizaciones', 'tickets']);
    const db = {
      from: jest.fn(() => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [], error: null }) })),
    };
    const resultado = await resolverModulosAutorizadosParaIA(db, { companyId: COMPANY_A, rol: 'ventas' });
    expect(resultado).toEqual(['crm', 'cotizaciones', 'tickets']);
  });

  test('un módulo marcado "inactivo" en modulos_empresa se excluye, aunque modulosVisibles() lo incluyera', async () => {
    modulosVisibles.mockResolvedValue(['crm', 'cotizaciones', 'tickets']);
    const db = {
      from: jest.fn(() => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [{ modulo_codigo: 'tickets', estado: 'inactivo' }], error: null }) })),
    };
    const resultado = await resolverModulosAutorizadosParaIA(db, { companyId: COMPANY_A, rol: 'ventas' });
    expect(resultado).toEqual(['crm', 'cotizaciones']);
  });

  test('un módulo "integrado" NUNCA se excluye — compatibilidad con funcionalidades integradas', async () => {
    modulosVisibles.mockResolvedValue(['crm', 'instalaciones']);
    const db = {
      from: jest.fn(() => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [{ modulo_codigo: 'instalaciones', estado: 'integrado' }], error: null }) })),
    };
    const resultado = await resolverModulosAutorizadosParaIA(db, { companyId: COMPANY_A, rol: 'owner' });
    expect(resultado).toEqual(['crm', 'instalaciones']);
  });
});
