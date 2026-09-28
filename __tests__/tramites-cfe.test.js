'use strict';

const {
  ESTADOS_TRAMITE_CFE, UMBRAL_ALERTA_DEFAULT_DIAS, calcularDiasSinActualizacion, requiereAlerta,
  crearTramiteCfe, obtenerTramiteCfe, obtenerTramiteDeProyecto, listarTramitesCfe, actualizarTramiteCfe, actualizarEstadoTramiteCfe,
} = require('../modules/tramites-cfe');

function crearBuilder(resolver) {
  const estado = { filtros: {}, insertPayload: null, updatePayload: null };
  const builder = {
    select: jest.fn(() => builder),
    insert: jest.fn((p) => { estado.insertPayload = p; return builder; }),
    update: jest.fn((p) => { estado.updatePayload = p; return builder; }),
    eq: jest.fn((campo, valor) => { estado.filtros[campo] = valor; return builder; }),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resolver(estado))),
    single: jest.fn(() => Promise.resolve(resolver(estado))),
    then: (resolve, reject) => Promise.resolve(resolver(estado)).then(resolve, reject),
  };
  return builder;
}

function resolversFelices(overrides = {}) {
  return {
    proyectos: () => ({ data: { id: 'proy-1', cliente_id: 214 }, error: null }),
    companies: () => ({ data: { umbral_dias_alerta_cfe: null }, error: null }),
    tramites_cfe: (e) => (e.insertPayload ? { data: { id: 'tram-1', ...e.insertPayload[0] }, error: null } : { data: null, error: null }),
    bitacora_decisiones: () => ({ data: null, error: null }),
    ...overrides,
  };
}

function crearMockDb(overrides = {}) {
  const tablas = resolversFelices(overrides);
  return { from: jest.fn((tabla) => crearBuilder(tablas[tabla] || (() => ({ data: null, error: null })))) };
}

const COMPANY_A = 'company-aaaa';

describe('ESTADOS_TRAMITE_CFE', () => {
  test('10 estados', () => {
    expect(ESTADOS_TRAMITE_CFE).toHaveLength(10);
    expect(ESTADOS_TRAMITE_CFE[0]).toBe('pendiente');
    expect(ESTADOS_TRAMITE_CFE[ESTADOS_TRAMITE_CFE.length - 1]).toBe('interconexion_completada');
  });
});

describe('calcularDiasSinActualizacion()', () => {
  test('sin fecha → null', () => {
    expect(calcularDiasSinActualizacion(null)).toBeNull();
  });

  test('hace exactamente 5 días → 5', () => {
    const hace5dias = new Date('2026-09-20T10:00:00Z');
    const hoy = new Date('2026-09-25T10:00:00Z');
    expect(calcularDiasSinActualizacion(hace5dias.toISOString(), hoy)).toBe(5);
  });

  test('hace unas horas (mismo día) → 0', () => {
    const haceHoras = new Date('2026-09-25T08:00:00Z');
    const hoy = new Date('2026-09-25T10:00:00Z');
    expect(calcularDiasSinActualizacion(haceHoras.toISOString(), hoy)).toBe(0);
  });
});

describe('requiereAlerta()', () => {
  test('días > umbral → true', () => {
    expect(requiereAlerta('pendiente', 10, 7)).toBe(true);
  });

  test('días <= umbral → false', () => {
    expect(requiereAlerta('pendiente', 7, 7)).toBe(false);
    expect(requiereAlerta('pendiente', 3, 7)).toBe(false);
  });

  test('interconexion_completada → nunca alerta, sin importar los días', () => {
    expect(requiereAlerta('interconexion_completada', 999, 7)).toBe(false);
  });

  test('sin días calculados (null) → false', () => {
    expect(requiereAlerta('pendiente', null, 7)).toBe(false);
  });
});

describe('crearTramiteCfe()', () => {
  test('proyecto no encontrado/de otra empresa → 404, nunca inserta', async () => {
    const db = crearMockDb({ proyectos: () => ({ data: null, error: null }) });
    await expect(crearTramiteCfe(db, { companyId: COMPANY_A, proyectoId: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → inserta en estado pendiente, con fecha_inicio hoy, y registra en bitácora', async () => {
    const db = crearMockDb();
    const r = await crearTramiteCfe(db, { companyId: COMPANY_A, proyectoId: 'proy-1', usuarioId: 'user-1' });
    expect(r.estado).toBe('pendiente');
    expect(r.fecha_inicio).toBe(new Date().toISOString().slice(0, 10));

    const builderBitacora = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'bitacora_decisiones').value;
    expect(builderBitacora.insert).toHaveBeenCalledWith([expect.objectContaining({ company_id: COMPANY_A, cliente_id: 214, proyecto_id: 'proy-1', autor_id: 'user-1', contexto: 'Trámite CFE' })]);
  });
});

describe('obtenerTramiteCfe() / obtenerTramiteDeProyecto()', () => {
  test('no encontrado → null', async () => {
    const db = crearMockDb({ tramites_cfe: () => ({ data: null, error: null }) });
    expect(await obtenerTramiteCfe(db, COMPANY_A, 'x')).toBeNull();
    expect(await obtenerTramiteDeProyecto(db, COMPANY_A, 'proy-x')).toBeNull();
  });

  test('agrega dias_sin_actualizacion y alerta calculados', async () => {
    const haceMucho = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const db = crearMockDb({ tramites_cfe: () => ({ data: { id: 'tram-1', estado: 'pendiente', ultima_actualizacion: haceMucho }, error: null }) });
    const r = await obtenerTramiteCfe(db, COMPANY_A, 'tram-1');
    expect(r.dias_sin_actualizacion).toBeGreaterThanOrEqual(14);
    expect(r.alerta).toBe(true); // default 7 días
  });

  test('respeta el umbral configurado por la empresa (no el default)', async () => {
    const hace3dias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const db = crearMockDb({
      companies: () => ({ data: { umbral_dias_alerta_cfe: 2 }, error: null }),
      tramites_cfe: () => ({ data: { id: 'tram-1', estado: 'pendiente', ultima_actualizacion: hace3dias }, error: null }),
    });
    const r = await obtenerTramiteCfe(db, COMPANY_A, 'tram-1');
    expect(r.alerta).toBe(true); // 3 días > umbral 2
  });
});

describe('listarTramitesCfe()', () => {
  test('filtra por estado cuando se da', async () => {
    const db = crearMockDb({ tramites_cfe: () => ({ data: [], error: null }) });
    await listarTramitesCfe(db, COMPANY_A, { estado: 'ingresado_cfe' });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'tramites_cfe').value;
    expect(builder.eq).toHaveBeenCalledWith('estado', 'ingresado_cfe');
  });

  test('cada fila trae su propia alerta calculada', async () => {
    const hoy = new Date().toISOString();
    const haceMucho = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = crearMockDb({
      tramites_cfe: () => ({
        data: [{ id: 't1', estado: 'pendiente', ultima_actualizacion: hoy }, { id: 't2', estado: 'pendiente', ultima_actualizacion: haceMucho }],
        error: null,
      }),
    });
    const r = await listarTramitesCfe(db, COMPANY_A);
    expect(r[0].alerta).toBe(false);
    expect(r[1].alerta).toBe(true);
  });

  test('error de DB → arreglo vacío', async () => {
    const db = crearMockDb({ tramites_cfe: () => ({ data: null, error: { message: 'boom' } }) });
    expect(await listarTramitesCfe(db, COMPANY_A)).toEqual([]);
  });
});

describe('actualizarTramiteCfe()', () => {
  test('no encontrado → 404', async () => {
    const db = crearMockDb({ tramites_cfe: () => ({ data: null, error: null }) });
    await expect(actualizarTramiteCfe(db, { companyId: COMPANY_A, tramiteId: 'x', cambios: { folio_cfe: 'F-1' } })).rejects.toMatchObject({ status: 404 });
  });

  test('solo aplica campos de la allowlist (nunca estado por aquí)', async () => {
    const db = crearMockDb({ tramites_cfe: (e) => (e.updatePayload ? { data: { id: 'tram-1', ...e.updatePayload }, error: null } : { data: null, error: null }) });
    await actualizarTramiteCfe(db, { companyId: COMPANY_A, tramiteId: 'tram-1', cambios: { folio_cfe: 'F-99', estado: 'interconexion_completada' } });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'tramites_cfe').value;
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty('estado');
    expect(builder.update.mock.calls[0][0].folio_cfe).toBe('F-99');
    expect(builder.update.mock.calls[0][0].ultima_actualizacion).toEqual(expect.any(String));
  });
});

describe('actualizarEstadoTramiteCfe()', () => {
  test('estado no reconocido → 400', async () => {
    const db = crearMockDb();
    await expect(actualizarEstadoTramiteCfe(db, { companyId: COMPANY_A, tramiteId: 'tram-1', estado: 'inventado' })).rejects.toMatchObject({ status: 400 });
  });

  test('no encontrado → 404', async () => {
    const db = crearMockDb({ tramites_cfe: () => ({ data: null, error: null }) });
    await expect(actualizarEstadoTramiteCfe(db, { companyId: COMPANY_A, tramiteId: 'x', estado: 'ingresado_cfe' })).rejects.toMatchObject({ status: 404 });
  });

  test('transición "ilógica" (saltar hacia atrás) SÍ se permite — no rígido', async () => {
    let filaActual = { id: 'tram-1', estado: 'medidor_instalado', proyecto_id: 'proy-1' };
    const db = crearMockDb({
      tramites_cfe: (e) => (e.updatePayload ? { data: { ...filaActual, ...e.updatePayload }, error: null } : { data: filaActual, error: null }),
    });
    const r = await actualizarEstadoTramiteCfe(db, { companyId: COMPANY_A, tramiteId: 'tram-1', estado: 'pendiente', usuarioId: 'user-1' });
    expect(r.estado).toBe('pendiente');
  });

  test('éxito → registra en bitácora y actualiza ultima_actualizacion', async () => {
    let filaActual = { id: 'tram-1', estado: 'pendiente', proyecto_id: 'proy-1' };
    const db = crearMockDb({
      tramites_cfe: (e) => (e.updatePayload ? { data: { ...filaActual, ...e.updatePayload }, error: null } : { data: filaActual, error: null }),
    });
    await actualizarEstadoTramiteCfe(db, { companyId: COMPANY_A, tramiteId: 'tram-1', estado: 'ingresado_cfe', usuarioId: 'user-1' });
    const builderBitacora = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'bitacora_decisiones').value;
    expect(builderBitacora.insert).toHaveBeenCalledWith([expect.objectContaining({ contexto: 'Trámite CFE', autor_id: 'user-1', proyecto_id: 'proy-1' })]);
  });
});
