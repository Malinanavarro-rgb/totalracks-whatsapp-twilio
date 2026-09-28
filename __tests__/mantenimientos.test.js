'use strict';

jest.mock('../modules/instalaciones', () => ({ obtenerChecklistConfig: jest.fn() }));
jest.mock('../modules/agenda', () => ({ schedulingEngineParaEmpresa: jest.fn() }));

const { obtenerChecklistConfig } = require('../modules/instalaciones');
const { schedulingEngineParaEmpresa } = require('../modules/agenda');
const {
  calcularEstadoMantenimiento, crearMantenimiento, obtenerMantenimiento, listarMantenimientosDeProyecto, listarMantenimientos,
  actualizarMantenimiento, actualizarChecklistItemMantenimiento, programarSiguienteMantenimiento,
} = require('../modules/mantenimientos');

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
    proyectos: () => ({ data: { id: 'proy-1', cliente_id: 214 }, error: null }),
    asesores: () => ({ data: { id: 'tec-1', nombre: 'Juan Técnico' }, error: null }),
    mantenimientos: (e) => (e.insertPayload ? { data: { id: 'mant-1', ...e.insertPayload[0] }, error: null } : { data: null, error: null }),
    ...overrides,
  };
}

function crearMockDb(overrides = {}) {
  const tablas = resolversFelices(overrides);
  return { from: jest.fn((tabla) => crearBuilder(tablas[tabla] || (() => ({ data: null, error: null })))) };
}

const COMPANY_A = 'company-aaaa';

beforeEach(() => {
  obtenerChecklistConfig.mockReset().mockResolvedValue([]);
  schedulingEngineParaEmpresa.mockReset();
});

describe('calcularEstadoMantenimiento()', () => {
  test('sin fecha_programada ni realizada → pendiente', () => {
    expect(calcularEstadoMantenimiento({ fechaProgramada: null, fechaRealizada: null })).toBe('pendiente');
  });

  test('con fecha_realizada → realizado, sin importar lo demás', () => {
    expect(calcularEstadoMantenimiento({ fechaProgramada: '2020-01-01', fechaRealizada: '2026-01-01' })).toBe('realizado');
  });

  test('fecha_programada futura → programado', () => {
    const hoy = new Date('2026-01-01T00:00:00Z');
    expect(calcularEstadoMantenimiento({ fechaProgramada: '2026-06-01', fechaRealizada: null, hoy })).toBe('programado');
  });

  test('fecha_programada pasada, sin realizar → vencido', () => {
    const hoy = new Date('2026-06-01T00:00:00Z');
    expect(calcularEstadoMantenimiento({ fechaProgramada: '2026-01-01', fechaRealizada: null, hoy })).toBe('vencido');
  });
});

describe('crearMantenimiento()', () => {
  test('sin tipo → 400', async () => {
    const db = crearMockDb();
    await expect(crearMantenimiento(db, { companyId: COMPANY_A, proyectoId: 'proy-1', tipo: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  test('proyecto no encontrado/de otra empresa → 404', async () => {
    const db = crearMockDb({ proyectos: () => ({ data: null, error: null }) });
    await expect(crearMantenimiento(db, { companyId: COMPANY_A, proyectoId: 'x', tipo: 'preventivo' })).rejects.toMatchObject({ status: 404 });
  });

  test('tecnico dado pero de otra empresa → 404', async () => {
    const db = crearMockDb({ asesores: () => ({ data: null, error: null }) });
    await expect(crearMantenimiento(db, { companyId: COMPANY_A, proyectoId: 'proy-1', tipo: 'preventivo', tecnicoId: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → snapshotea el checklist configurado (tipo=mantenimiento)', async () => {
    obtenerChecklistConfig.mockResolvedValue([{ clave: 'revisar_inversor', etiqueta: 'Revisar inversor' }]);
    const db = crearMockDb();
    const r = await crearMantenimiento(db, { companyId: COMPANY_A, proyectoId: 'proy-1', tipo: 'preventivo', usuarioId: 'user-1' });
    expect(obtenerChecklistConfig).toHaveBeenCalledWith(db, COMPANY_A, 'mantenimiento');
    expect(r.checklist).toEqual([{ clave: 'revisar_inversor', etiqueta: 'Revisar inversor' }]);
    expect(r.estado).toBe('pendiente'); // sin fecha_programada
  });
});

describe('obtenerMantenimiento() / listarMantenimientosDeProyecto() / listarMantenimientos()', () => {
  test('no encontrado → null', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: null, error: null }) });
    expect(await obtenerMantenimiento(db, COMPANY_A, 'x')).toBeNull();
  });

  test('agrega tecnico_nombre y estado derivado', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: { id: 'mant-1', tecnico_id: 'tec-1', fecha_programada: null, fecha_realizada: null }, error: null }) });
    const r = await obtenerMantenimiento(db, COMPANY_A, 'mant-1');
    expect(r.tecnico_nombre).toBe('Juan Técnico');
    expect(r.estado).toBe('pendiente');
  });

  test('listarMantenimientos error de DB → arreglo vacío', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: null, error: { message: 'boom' } }) });
    expect(await listarMantenimientos(db, COMPANY_A)).toEqual([]);
  });

  test('listarMantenimientosDeProyecto filtra por proyecto_id', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: [], error: null }) });
    await listarMantenimientosDeProyecto(db, COMPANY_A, 'proy-1');
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'mantenimientos').value;
    expect(builder.eq).toHaveBeenCalledWith('proyecto_id', 'proy-1');
  });
});

describe('actualizarMantenimiento()', () => {
  test('no encontrado → 404', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: null, error: null }) });
    await expect(actualizarMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'x', cambios: { notas: 'y' } })).rejects.toMatchObject({ status: 404 });
  });

  test('solo aplica campos de la allowlist', async () => {
    const db = crearMockDb({ mantenimientos: (e) => (e.updatePayload ? { data: { id: 'mant-1', ...e.updatePayload }, error: null } : { data: null, error: null }) });
    await actualizarMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'mant-1', cambios: { notas: 'listo', proyecto_id: 'HACKEADO' } });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'mantenimientos').value;
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty('proyecto_id');
    expect(builder.update.mock.calls[0][0].notas).toBe('listo');
  });

  test('tecnicoId dado pero de otra empresa → 404, nunca actualiza', async () => {
    const db = crearMockDb({ asesores: () => ({ data: null, error: null }) });
    await expect(actualizarMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'mant-1', cambios: { tecnicoId: 'x' } })).rejects.toMatchObject({ status: 404 });
  });
});

describe('actualizarChecklistItemMantenimiento()', () => {
  test('mantenimiento no encontrado → 404', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: null, error: null }) });
    await expect(actualizarChecklistItemMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'x', clave: 'a', completado: true })).rejects.toMatchObject({ status: 404 });
  });

  test('clave inexistente en el checklist snapshoteado → 404', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: { checklist: [{ clave: 'otra', etiqueta: 'Otra' }] }, error: null }) });
    await expect(actualizarChecklistItemMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'mant-1', clave: 'no_existe', completado: true })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → marca completado con usuario y fecha', async () => {
    const db = crearMockDb({
      mantenimientos: (e) => (e.updatePayload
        ? { data: { id: 'mant-1', checklist: e.updatePayload.checklist }, error: null }
        : { data: { checklist: [{ clave: 'revisar_inversor', etiqueta: 'Revisar inversor', completado: false }] }, error: null }),
    });
    const r = await actualizarChecklistItemMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'mant-1', clave: 'revisar_inversor', completado: true, usuarioId: 'user-1' });
    expect(r.checklist[0].completado).toBe(true);
    expect(r.checklist[0].completado_por).toBe('user-1');
  });
});

describe('programarSiguienteMantenimiento()', () => {
  const INICIO = new Date('2026-12-01T15:00:00Z');
  const FIN = new Date('2026-12-01T16:00:00Z');

  test('mantenimiento no encontrado → 404', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: null, error: null }) });
    await expect(programarSiguienteMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'x', inicio: INICIO, fin: FIN }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('sin técnico asignado → 409, nunca llama al scheduling engine', async () => {
    const db = crearMockDb({ mantenimientos: () => ({ data: { id: 'mant-1', proyecto_id: 'proy-1', tecnico_id: null }, error: null }) });
    await expect(programarSiguienteMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'mant-1', inicio: INICIO, fin: FIN }))
      .rejects.toMatchObject({ status: 409 });
    expect(schedulingEngineParaEmpresa).not.toHaveBeenCalled();
  });

  test('proyecto sin cliente_id → 409', async () => {
    const db = crearMockDb({
      mantenimientos: () => ({ data: { id: 'mant-1', proyecto_id: 'proy-1', tecnico_id: 'tec-1' }, error: null }),
      proyectos: () => ({ data: { id: 'proy-1', cliente_id: null }, error: null }),
    });
    await expect(programarSiguienteMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'mant-1', inicio: INICIO, fin: FIN }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('éxito → llama a engine.agendarCita con el cliente/técnico correctos, crea el mantenimiento siguiente ligado a la cita, y marca proximo_mantenimiento en el actual', async () => {
    const agendarCita = jest.fn().mockResolvedValue({ id: 'cita-1', estado: 'agendada' });
    schedulingEngineParaEmpresa.mockResolvedValue({ agendarCita });
    obtenerChecklistConfig.mockResolvedValue([]);

    const db = crearMockDb({
      mantenimientos: (e) => {
        if (e.insertPayload) return { data: { id: 'mant-siguiente', ...e.insertPayload[0] }, error: null };
        if (e.updatePayload) return { data: { id: 'mant-1', ...e.updatePayload }, error: null };
        return { data: { id: 'mant-1', proyecto_id: 'proy-1', tipo: 'preventivo', tecnico_id: 'tec-1' }, error: null };
      },
    });

    const r = await programarSiguienteMantenimiento(db, { companyId: COMPANY_A, mantenimientoId: 'mant-1', inicio: INICIO, fin: FIN, usuarioId: 'user-1' });

    expect(agendarCita).toHaveBeenCalledWith(COMPANY_A, { clienteId: 214, asesorId: 'tec-1', inicio: INICIO, fin: FIN });
    expect(r.cita.id).toBe('cita-1');
    expect(r.mantenimientoSiguiente.cita_id).toBe('cita-1');
    expect(r.mantenimientoSiguiente.tipo).toBe('preventivo'); // heredado del mantenimiento actual

    const builders = db.from.mock.results.filter((_, i) => db.from.mock.calls[i][0] === 'mantenimientos').map((res) => res.value);
    const actualizacionDelActual = builders.find((b) => b.update.mock.calls.some((c) => c[0].proximo_mantenimiento));
    expect(actualizacionDelActual).toBeTruthy();
  });
});
