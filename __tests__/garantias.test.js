'use strict';

const {
  ESTADOS_RECLAMACION, calcularVigenciaGarantia,
  crearGarantiaDesdeEquipo, obtenerGarantia, obtenerGarantiaDeEquipo, listarGarantias, actualizarGarantia,
  crearReclamacion, obtenerReclamacion, listarReclamacionesDeGarantia, actualizarEstadoReclamacion, agregarComentarioReclamacion,
} = require('../modules/garantias');

function crearBuilder(resolver) {
  const estado = { filtros: {}, insertPayload: null, updatePayload: null };
  const builder = {
    select: jest.fn(() => builder),
    insert: jest.fn((p) => { estado.insertPayload = p; return builder; }),
    update: jest.fn((p) => { estado.updatePayload = p; return builder; }),
    eq: jest.fn((campo, valor) => { estado.filtros[campo] = valor; return builder; }),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resolver(estado))),
    single: jest.fn(() => Promise.resolve(resolver(estado))),
    then: (resolve, reject) => Promise.resolve(resolver(estado)).then(resolve, reject),
  };
  return builder;
}

function resolversFelices(overrides = {}) {
  return {
    equipos_instalados: () => ({ data: { id: 'eq-1', tipo_equipo: 'panel', marca: 'OSDA', modelo: 'X1', numero_serie: 'SN-1', fecha_instalacion: '2026-01-15', garantia_meses: 120, proveedor: 'OSDA México', proyecto_id: 'proy-1' }, error: null }),
    garantias: (e) => (e.insertPayload ? { data: { id: 'gar-1', ...e.insertPayload[0] }, error: null } : { data: null, error: null }),
    garantia_reclamaciones: (e) => (e.insertPayload ? { data: { id: 'rec-1', ...e.insertPayload[0] }, error: null } : { data: null, error: null }),
    garantia_reclamacion_eventos: (e) => (e.insertPayload ? { data: null, error: null } : { data: [], error: null }),
    ...overrides,
  };
}

function crearMockDb(overrides = {}) {
  const tablas = resolversFelices(overrides);
  return { from: jest.fn((tabla) => crearBuilder(tablas[tabla] || (() => ({ data: null, error: null })))) };
}

const COMPANY_A = 'company-aaaa';

describe('ESTADOS_RECLAMACION', () => {
  test('5 estados', () => {
    expect(ESTADOS_RECLAMACION).toEqual(['abierta', 'en_revision', 'aprobada', 'rechazada', 'resuelta']);
  });
});

describe('calcularVigenciaGarantia()', () => {
  test('sin fecha_inicio → todo null', () => {
    expect(calcularVigenciaGarantia(null, 120)).toEqual({ fecha_fin: null, dias_restantes: null, vigente: null });
  });

  test('sin meses_garantia (NaN) → todo null, nunca inventa un vencimiento', () => {
    expect(calcularVigenciaGarantia('2026-01-01', null)).toEqual({ fecha_fin: null, dias_restantes: null, vigente: null });
  });

  test('garantía vigente → vigente:true, dias_restantes positivo', () => {
    const hoy = new Date('2026-06-01T00:00:00Z');
    const r = calcularVigenciaGarantia('2026-01-01', 12, hoy);
    expect(r.fecha_fin).toBe('2027-01-01');
    expect(r.vigente).toBe(true);
    expect(r.dias_restantes).toBeGreaterThan(0);
  });

  test('garantía vencida → vigente:false, dias_restantes negativo', () => {
    const hoy = new Date('2026-06-01T00:00:00Z');
    const r = calcularVigenciaGarantia('2020-01-01', 12, hoy);
    expect(r.fecha_fin).toBe('2021-01-01');
    expect(r.vigente).toBe(false);
    expect(r.dias_restantes).toBeLessThan(0);
  });
});

describe('crearGarantiaDesdeEquipo()', () => {
  test('equipo no encontrado/de otra empresa → 404, nunca inserta', async () => {
    const db = crearMockDb({ equipos_instalados: () => ({ data: null, error: null }) });
    await expect(crearGarantiaDesdeEquipo(db, { companyId: COMPANY_A, equipoInstaladoId: 'x' })).rejects.toMatchObject({ status: 404 });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'garantias');
    expect(builder).toBeUndefined();
  });

  test('éxito → snapshotea fecha_inicio/meses_garantia/proveedor del equipo', async () => {
    const db = crearMockDb();
    const r = await crearGarantiaDesdeEquipo(db, { companyId: COMPANY_A, equipoInstaladoId: 'eq-1', usuarioId: 'user-1' });
    expect(r.fecha_inicio).toBe('2026-01-15');
    expect(r.meses_garantia).toBe(120);
    expect(r.proveedor).toBe('OSDA México');
    expect(r.equipo.marca).toBe('OSDA');
  });

  test('ya existía (23505) → devuelve la existente, nunca lanza', async () => {
    const db = crearMockDb({
      garantias: (e) => (e.insertPayload
        ? { data: null, error: { code: '23505' } }
        : { data: { id: 'gar-existente', equipo_instalado_id: 'eq-1', fecha_inicio: '2026-01-15', meses_garantia: 120 }, error: null }),
    });
    const r = await crearGarantiaDesdeEquipo(db, { companyId: COMPANY_A, equipoInstaladoId: 'eq-1' });
    expect(r.id).toBe('gar-existente');
  });
});

describe('obtenerGarantia() / obtenerGarantiaDeEquipo() / listarGarantias()', () => {
  test('no encontrada → null', async () => {
    const db = crearMockDb({ garantias: () => ({ data: null, error: null }) });
    expect(await obtenerGarantia(db, COMPANY_A, 'x')).toBeNull();
    expect(await obtenerGarantiaDeEquipo(db, COMPANY_A, 'eq-x')).toBeNull();
  });

  test('trae el equipo + vigencia calculada', async () => {
    const db = crearMockDb({ garantias: () => ({ data: { id: 'gar-1', equipo_instalado_id: 'eq-1', fecha_inicio: '2026-01-15', meses_garantia: 120 }, error: null }) });
    const r = await obtenerGarantia(db, COMPANY_A, 'gar-1');
    expect(r.equipo.numero_serie).toBe('SN-1');
    expect(r.vigente).toBe(true);
  });

  test('listarGarantias error de DB → arreglo vacío', async () => {
    const db = crearMockDb({ garantias: () => ({ data: null, error: { message: 'boom' } }) });
    expect(await listarGarantias(db, COMPANY_A)).toEqual([]);
  });
});

describe('actualizarGarantia()', () => {
  test('no encontrada → 404', async () => {
    const db = crearMockDb({ garantias: () => ({ data: null, error: null }) });
    await expect(actualizarGarantia(db, { companyId: COMPANY_A, garantiaId: 'x', cambios: { notas: 'y' } })).rejects.toMatchObject({ status: 404 });
  });

  test('solo aplica campos de la allowlist', async () => {
    const db = crearMockDb({ garantias: (e) => ({ data: { id: 'gar-1', equipo_instalado_id: 'eq-1', ...e.updatePayload }, error: null }) });
    await actualizarGarantia(db, { companyId: COMPANY_A, garantiaId: 'gar-1', cambios: { proveedor: 'Nuevo', company_id: 'otra-empresa' } });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'garantias').value;
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty('company_id');
    expect(builder.update.mock.calls[0][0].proveedor).toBe('Nuevo');
  });
});

describe('crearReclamacion()', () => {
  test('sin descripción → 400', async () => {
    const db = crearMockDb();
    await expect(crearReclamacion(db, { companyId: COMPANY_A, garantiaId: 'gar-1', descripcion: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  test('garantía no encontrada/de otra empresa → 404, nunca inserta', async () => {
    const db = crearMockDb({ garantias: () => ({ data: null, error: null }) });
    await expect(crearReclamacion(db, { companyId: COMPANY_A, garantiaId: 'x', descripcion: 'Panel no genera' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → crea la reclamación en "abierta" y registra el evento "creada"', async () => {
    const db = crearMockDb({ garantias: () => ({ data: { id: 'gar-1' }, error: null }) });
    const r = await crearReclamacion(db, { companyId: COMPANY_A, garantiaId: 'gar-1', descripcion: 'Panel no genera', usuarioId: 'user-1' });
    expect(r.descripcion).toBe('Panel no genera');

    const builderEventos = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'garantia_reclamacion_eventos').value;
    expect(builderEventos.insert).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'creada', autor_id: 'user-1' })]);
  });
});

describe('actualizarEstadoReclamacion()', () => {
  test('estado no reconocido → 400', async () => {
    const db = crearMockDb();
    await expect(actualizarEstadoReclamacion(db, { companyId: COMPANY_A, reclamacionId: 'rec-1', estado: 'inventado' })).rejects.toMatchObject({ status: 400 });
  });

  test('no encontrada → 404', async () => {
    const db = crearMockDb({ garantia_reclamaciones: () => ({ data: null, error: null }) });
    await expect(actualizarEstadoReclamacion(db, { companyId: COMPANY_A, reclamacionId: 'x', estado: 'en_revision' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → cambia estado y registra evento "cambio_estado"', async () => {
    let filaActual = { id: 'rec-1', estado: 'abierta' };
    const db = crearMockDb({
      garantia_reclamaciones: (e) => (e.updatePayload ? { data: { ...filaActual, ...e.updatePayload }, error: null } : { data: filaActual, error: null }),
    });
    const r = await actualizarEstadoReclamacion(db, { companyId: COMPANY_A, reclamacionId: 'rec-1', estado: 'en_revision', usuarioId: 'user-1' });
    expect(r.estado).toBe('en_revision');

    const builderEventos = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'garantia_reclamacion_eventos').value;
    expect(builderEventos.insert).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'cambio_estado', texto: '"abierta" → "en_revision"', autor_id: 'user-1' })]);
  });
});

describe('agregarComentarioReclamacion()', () => {
  test('sin texto → 400', async () => {
    const db = crearMockDb();
    await expect(agregarComentarioReclamacion(db, { companyId: COMPANY_A, reclamacionId: 'rec-1', texto: '' })).rejects.toMatchObject({ status: 400 });
  });

  test('reclamación no encontrada → 404', async () => {
    const db = crearMockDb({ garantia_reclamaciones: () => ({ data: null, error: null }) });
    await expect(agregarComentarioReclamacion(db, { companyId: COMPANY_A, reclamacionId: 'x', texto: 'nota' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → agrega el evento y no toca el estado', async () => {
    const db = crearMockDb({ garantia_reclamaciones: () => ({ data: { id: 'rec-1', estado: 'abierta' }, error: null }) });
    await agregarComentarioReclamacion(db, { companyId: COMPANY_A, reclamacionId: 'rec-1', texto: 'Se contactó al proveedor', usuarioId: 'user-1' });
    const builderEventos = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'garantia_reclamacion_eventos').value;
    expect(builderEventos.insert).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'comentario', texto: 'Se contactó al proveedor' })]);
  });
});

describe('listarReclamacionesDeGarantia() / obtenerReclamacion()', () => {
  test('obtenerReclamacion trae los eventos ordenados', async () => {
    const db = crearMockDb({
      garantia_reclamaciones: () => ({ data: { id: 'rec-1', estado: 'abierta' }, error: null }),
      garantia_reclamacion_eventos: () => ({ data: [{ id: 'ev-1', tipo: 'creada' }], error: null }),
    });
    const r = await obtenerReclamacion(db, COMPANY_A, 'rec-1');
    expect(r.eventos).toHaveLength(1);
  });

  test('listarReclamacionesDeGarantia error de DB → arreglo vacío', async () => {
    const db = crearMockDb({ garantia_reclamaciones: () => ({ data: null, error: { message: 'boom' } }) });
    expect(await listarReclamacionesDeGarantia(db, COMPANY_A, 'gar-1')).toEqual([]);
  });
});
