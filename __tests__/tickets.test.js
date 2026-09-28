'use strict';

const {
  ESTADOS_TICKET, PRIORIDADES_TICKET,
  crearTicket, obtenerTicket, listarTickets, actualizarTicket, actualizarEstadoTicket, agregarComentarioTicket,
} = require('../modules/tickets');

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
    clientes: () => ({ data: { id: 214, nombre: 'Juan Pérez', telefono: '8180000000' }, error: null }),
    proyectos: () => ({ data: { id: 'proy-1' }, error: null }),
    equipos_instalados: () => ({ data: { id: 'eq-1' }, error: null }),
    tickets: (e) => (e.insertPayload ? { data: { id: 'tick-1', ...e.insertPayload[0] }, error: null } : { data: null, error: null }),
    ticket_eventos: (e) => (e.insertPayload ? { data: null, error: null } : { data: [], error: null }),
    ...overrides,
  };
}

function crearMockDb(overrides = {}) {
  const tablas = resolversFelices(overrides);
  return { from: jest.fn((tabla) => crearBuilder(tablas[tabla] || (() => ({ data: null, error: null })))) };
}

const COMPANY_A = 'company-aaaa';

describe('ESTADOS_TICKET / PRIORIDADES_TICKET', () => {
  test('vocabularios esperados', () => {
    expect(ESTADOS_TICKET).toEqual(['abierto', 'en_proceso', 'esperando_cliente', 'resuelto', 'cerrado']);
    expect(PRIORIDADES_TICKET).toEqual(['baja', 'media', 'alta', 'urgente']);
  });
});

describe('crearTicket()', () => {
  test('sin asunto → 400', async () => {
    const db = crearMockDb();
    await expect(crearTicket(db, { companyId: COMPANY_A, clienteId: 214, asunto: '  ', categoria: 'general' })).rejects.toMatchObject({ status: 400 });
  });

  test('sin categoría → 400', async () => {
    const db = crearMockDb();
    await expect(crearTicket(db, { companyId: COMPANY_A, clienteId: 214, asunto: 'Duda de factura', categoria: '' })).rejects.toMatchObject({ status: 400 });
  });

  test('prioridad no reconocida → 400', async () => {
    const db = crearMockDb();
    await expect(crearTicket(db, { companyId: COMPANY_A, clienteId: 214, asunto: 'x', categoria: 'general', prioridad: 'inventada' })).rejects.toMatchObject({ status: 400 });
  });

  test('cliente no encontrado/de otra empresa → 404, nunca inserta', async () => {
    const db = crearMockDb({ clientes: () => ({ data: null, error: null }) });
    await expect(crearTicket(db, { companyId: COMPANY_A, clienteId: 999, asunto: 'x', categoria: 'general' })).rejects.toMatchObject({ status: 404 });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'tickets');
    expect(builder).toBeUndefined();
  });

  test('proyecto dado pero de otra empresa → 404', async () => {
    const db = crearMockDb({ proyectos: () => ({ data: null, error: null }) });
    await expect(crearTicket(db, { companyId: COMPANY_A, clienteId: 214, proyectoId: 'x', asunto: 'x', categoria: 'general' })).rejects.toMatchObject({ status: 404 });
  });

  test('equipo dado pero de otra empresa → 404', async () => {
    const db = crearMockDb({ equipos_instalados: () => ({ data: null, error: null }) });
    await expect(crearTicket(db, { companyId: COMPANY_A, clienteId: 214, equipoInstaladoId: 'x', asunto: 'x', categoria: 'general' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → crea en "abierto", prioridad default "media", registra evento "creado"', async () => {
    const db = crearMockDb();
    const r = await crearTicket(db, { companyId: COMPANY_A, clienteId: 214, asunto: 'Duda de factura', categoria: 'facturacion', usuarioId: 'user-1' });
    expect(r.prioridad).toBe('media');
    expect(r.cliente_nombre).toBe('Juan Pérez');

    const builderEventos = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'ticket_eventos').value;
    expect(builderEventos.insert).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'creado', autor_id: 'user-1' })]);
  });
});

describe('obtenerTicket() / listarTickets()', () => {
  test('no encontrado → null', async () => {
    const db = crearMockDb({ tickets: () => ({ data: null, error: null }) });
    expect(await obtenerTicket(db, COMPANY_A, 'x')).toBeNull();
  });

  test('listarTickets filtra por estado/prioridad/cliente cuando se dan', async () => {
    const db = crearMockDb({ tickets: () => ({ data: [], error: null }) });
    await listarTickets(db, COMPANY_A, { estado: 'abierto', prioridad: 'alta', clienteId: 214 });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'tickets').value;
    expect(builder.eq).toHaveBeenCalledWith('estado', 'abierto');
    expect(builder.eq).toHaveBeenCalledWith('prioridad', 'alta');
    expect(builder.eq).toHaveBeenCalledWith('cliente_id', 214);
  });

  test('error de DB → arreglo vacío', async () => {
    const db = crearMockDb({ tickets: () => ({ data: null, error: { message: 'boom' } }) });
    expect(await listarTickets(db, COMPANY_A)).toEqual([]);
  });
});

describe('actualizarTicket()', () => {
  test('prioridad inválida → 400', async () => {
    const db = crearMockDb();
    await expect(actualizarTicket(db, { companyId: COMPANY_A, ticketId: 'tick-1', cambios: { prioridad: 'inventada' } })).rejects.toMatchObject({ status: 400 });
  });

  test('no encontrado → 404', async () => {
    const db = crearMockDb({ tickets: () => ({ data: null, error: null }) });
    await expect(actualizarTicket(db, { companyId: COMPANY_A, ticketId: 'x', cambios: { asunto: 'y' } })).rejects.toMatchObject({ status: 404 });
  });

  test('solo aplica campos de la allowlist (nunca estado por aquí)', async () => {
    const db = crearMockDb({ tickets: (e) => ({ data: { id: 'tick-1', cliente_id: 214, ...e.updatePayload }, error: null }) });
    await actualizarTicket(db, { companyId: COMPANY_A, ticketId: 'tick-1', cambios: { prioridad: 'alta', estado: 'resuelto' } });
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'tickets').value;
    expect(builder.update.mock.calls[0][0]).not.toHaveProperty('estado');
    expect(builder.update.mock.calls[0][0].prioridad).toBe('alta');
  });
});

describe('actualizarEstadoTicket()', () => {
  test('estado no reconocido → 400', async () => {
    const db = crearMockDb();
    await expect(actualizarEstadoTicket(db, { companyId: COMPANY_A, ticketId: 'tick-1', estado: 'inventado' })).rejects.toMatchObject({ status: 400 });
  });

  test('no encontrado → 404', async () => {
    const db = crearMockDb({ tickets: () => ({ data: null, error: null }) });
    await expect(actualizarEstadoTicket(db, { companyId: COMPANY_A, ticketId: 'x', estado: 'en_proceso' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → cambia estado y registra evento', async () => {
    let filaActual = { id: 'tick-1', estado: 'abierto', cliente_id: 214 };
    const db = crearMockDb({
      tickets: (e) => (e.updatePayload ? { data: { ...filaActual, ...e.updatePayload }, error: null } : { data: filaActual, error: null }),
    });
    const r = await actualizarEstadoTicket(db, { companyId: COMPANY_A, ticketId: 'tick-1', estado: 'en_proceso', usuarioId: 'user-1' });
    expect(r.estado).toBe('en_proceso');
    const builderEventos = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'ticket_eventos').value;
    expect(builderEventos.insert).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'cambio_estado', texto: '"abierto" → "en_proceso"' })]);
  });
});

describe('agregarComentarioTicket()', () => {
  test('sin texto → 400', async () => {
    const db = crearMockDb();
    await expect(agregarComentarioTicket(db, { companyId: COMPANY_A, ticketId: 'tick-1', texto: '' })).rejects.toMatchObject({ status: 400 });
  });

  test('no encontrado → 404', async () => {
    const db = crearMockDb({ tickets: () => ({ data: null, error: null }) });
    await expect(agregarComentarioTicket(db, { companyId: COMPANY_A, ticketId: 'x', texto: 'nota' })).rejects.toMatchObject({ status: 404 });
  });

  test('éxito → agrega el evento sin tocar el estado', async () => {
    const db = crearMockDb({ tickets: () => ({ data: { id: 'tick-1', estado: 'abierto', cliente_id: 214 }, error: null }) });
    await agregarComentarioTicket(db, { companyId: COMPANY_A, ticketId: 'tick-1', texto: 'Se envió respuesta al cliente', usuarioId: 'user-1' });
    const builderEventos = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'ticket_eventos').value;
    expect(builderEventos.insert).toHaveBeenCalledWith([expect.objectContaining({ tipo: 'comentario', texto: 'Se envió respuesta al cliente' })]);
  });
});
