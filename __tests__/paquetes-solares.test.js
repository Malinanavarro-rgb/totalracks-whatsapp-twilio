'use strict';

const {
  listarPaquetes, crearPaquete, actualizarPaquete, desactivarPaquete, eliminarPaquete, seleccionarPaqueteRecomendado,
} = require('../modules/paquetes-solares');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  return { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-aaaa';

describe('crearPaquete()', () => {
  test('lanza si faltan campos requeridos', async () => {
    const db = crearMockDb();
    await expect(crearPaquete(db, COMPANY_A, { nombre: 'X' })).rejects.toMatchObject({ status: 400 });
  });

  test('inserta con company_id y solo los campos permitidos', async () => {
    const db = crearMockDb({ data: { id: 'p1' }, error: null });
    await crearPaquete(db, COMPANY_A, {
      nombre: 'Paquete 12 paneles', cantidad_paneles: 12, precio_contado: 94000,
      campo_no_permitido: 'no debe colarse',
    });
    const builder = db.from.mock.results[0].value;
    const payload = builder.insert.mock.calls[0][0][0];
    expect(payload).toMatchObject({ company_id: COMPANY_A, nombre: 'Paquete 12 paneles', cantidad_paneles: 12, precio_contado: 94000 });
    expect(payload.campo_no_permitido).toBeUndefined();
  });
});

describe('actualizarPaquete()', () => {
  test('paquete inexistente (o de otra empresa) → 404', async () => {
    const db = crearMockDb({ data: null, error: null });
    await expect(actualizarPaquete(db, COMPANY_A, 'p1', { precio_contado: 99000 })).rejects.toMatchObject({ status: 404 });
  });

  test('actualiza solo los campos enviados', async () => {
    const db = crearMockDb({ data: { id: 'p1', precio_contado: 99000 }, error: null });
    await actualizarPaquete(db, COMPANY_A, 'p1', { precio_contado: 99000 });
    const builder = db.from.mock.results[0].value;
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ precio_contado: 99000 }));
  });
});

describe('desactivarPaquete()', () => {
  test('pone activo=false en vez de borrar', async () => {
    const db = crearMockDb({ data: { id: 'p1', activo: false }, error: null });
    await desactivarPaquete(db, COMPANY_A, 'p1');
    const builder = db.from.mock.results[0].value;
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ activo: false }));
    expect(builder.delete).not.toHaveBeenCalled();
  });
});

describe('seleccionarPaqueteRecomendado() — la lógica más crítica de esta pieza', () => {
  test('7 paneles técnicos → recomienda el paquete de 8 (inmediato superior, nunca redondea hacia abajo)', async () => {
    const db = crearMockDb({ data: { id: 'pkg-8', cantidad_paneles: 8, precio_contado: 64000 }, error: null });
    const paquete = await seleccionarPaqueteRecomendado(db, { companyId: COMPANY_A, numeroPanelesTecnico: 7 });
    expect(paquete).toEqual({ id: 'pkg-8', cantidad_paneles: 8, precio_contado: 64000 });

    const builder = db.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('activo', true);
    expect(builder.gte).toHaveBeenCalledWith('cantidad_paneles', 7);
    expect(builder.order).toHaveBeenCalledWith('cantidad_paneles', { ascending: true }); // el más chico que alcance, no el más grande
  });

  test('9 paneles técnicos → recomienda el de 10, no el de 8 (que se quedaría corto)', async () => {
    // No se puede probar la lógica SQL real con un mock, pero si el filtro
    // gte(cantidad_paneles, 9) se rompiera y alguien lo cambiara a lte(),
    // este test documenta la expectativa exacta de la llamada — un mutante
    // que invierta gte→lte lo haría fallar aquí.
    const db = crearMockDb({ data: { id: 'pkg-10', cantidad_paneles: 10 }, error: null });
    await seleccionarPaqueteRecomendado(db, { companyId: COMPANY_A, numeroPanelesTecnico: 9 });
    const builder = db.from.mock.results[0].value;
    expect(builder.gte).toHaveBeenCalledWith('cantidad_paneles', 9);
  });

  test('ningún paquete alcanza (técnico excede el catálogo) → null explícito, nunca inventa', async () => {
    const db = crearMockDb({ data: null, error: null });
    const paquete = await seleccionarPaqueteRecomendado(db, { companyId: COMPANY_A, numeroPanelesTecnico: 30 });
    expect(paquete).toBeNull();
  });

  test('solo considera paquetes activos y vigentes (hoy dentro del rango)', async () => {
    const db = crearMockDb({ data: { id: 'pkg-8' }, error: null });
    await seleccionarPaqueteRecomendado(db, { companyId: COMPANY_A, numeroPanelesTecnico: 8 });
    const builder = db.from.mock.results[0].value;
    expect(builder.lte).toHaveBeenCalledWith('vigencia_desde', expect.any(String));
    expect(builder.or).toHaveBeenCalledWith(expect.stringContaining('vigencia_hasta.is.null'));
  });

  test('sin companyId o numeroPanelesTecnico inválido → null sin consultar la DB', async () => {
    const db = crearMockDb();
    expect(await seleccionarPaqueteRecomendado(db, { companyId: null, numeroPanelesTecnico: 8 })).toBeNull();
    expect(await seleccionarPaqueteRecomendado(db, { companyId: COMPANY_A, numeroPanelesTecnico: 0 })).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  test('error de DB → null (fail-safe, no lanza)', async () => {
    const db = crearMockDb({ data: null, error: { message: 'timeout' } });
    const paquete = await seleccionarPaqueteRecomendado(db, { companyId: COMPANY_A, numeroPanelesTecnico: 8 });
    expect(paquete).toBeNull();
  });
});
