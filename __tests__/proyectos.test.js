'use strict';

const mockObtenerCotizacion = jest.fn();
jest.mock('../modules/cotizaciones', () => ({
  obtenerCotizacion: (...args) => mockObtenerCotizacion(...args),
}));

const {
  generarFolioProyecto, construirSnapshotVendido, marcarCotizacionAceptadaYCrearProyecto,
  obtenerProyecto, obtenerProyectoDeCliente, obtenerProyectoDeCotizacion,
} = require('../modules/proyectos');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

/** Mock por nombre de tabla — cada tabla siempre responde lo mismo, sin importar cuántas veces se consulte. */
function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    companies: { data: { prefijo_proyecto: null }, error: null },
    clientes: { data: { nombre: 'Cliente Prueba', telefono: '+528100000000', direccion: 'Calle Cliente 123', asesor_id: 'asesor-1' }, error: null },
    oportunidades: { data: null, error: null },
    proyectos: { data: null, error: null }, // sin proyecto existente por default
    cotizaciones: { data: null, error: null },
    bitacora_decisiones: { data: { id: 'bit-1' }, error: null },
    sucursales: { data: { nombre: 'Sucursal Centro' }, error: null },
    asesores: { data: { nombre: 'Asesor Prueba' }, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return {
    from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })),
    rpc: jest.fn().mockResolvedValue({ data: 7, error: null }),
  };
}

const COMPANY_A = 'company-aaaa';

/**
 * Para las pruebas de "crea un proyecto nuevo": el SELECT de existencia
 * (antes del insert) debe responder null, y el INSERT().select().single()
 * debe responder la fila creada — crearBuilder comparte un solo `resultado`
 * para ambos, así que aquí se separan explícitamente por secuencia de
 * llamadas a `.maybeSingle()` vs `.single()`.
 */
function dbQueCreaProyectoNuevo(overrides = {}, filaCreada = { id: 'proy-1', numero_proyecto: 'PRY-2026-0007' }) {
  const db = crearMockDbPorTabla(overrides);
  const fromOriginal = db.from;
  db.from = jest.fn((tabla) => {
    const builder = fromOriginal(tabla);
    if (tabla === 'proyectos') {
      builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null }); // no existe todavía
      builder.single = jest.fn().mockResolvedValue({ data: filaCreada, error: null }); // insert().select().single()
    }
    return builder;
  });
  return db;
}

function cotizacionBase(over = {}) {
  return {
    id: 42, folio: 'COT-2026-0021', version: 1, cliente_id: 214, oportunidad_id: 99, sucursal_id: 'suc-1',
    estado: 'enviada', total: 40716, precio_final_autorizado: null, descuento_pct: null, descuento_monto: null, forma_pago: null,
    lineas: [{ descripcion: 'Jinko Tiger Neo 550 x8', cantidad: 8, precio_unitario: 3200, subtotal: 25600 }],
    paquetes_solares: { nombre: 'Paquete 8 paneles' },
    calculo: {
      resultados: {
        numero_paneles: { valor: 8 }, potencia_instalada_kwp: 4.4, cobertura_pct: 94.5,
        produccion: { anual: 6801 }, inversor_seleccionado: { inversorSeleccionado: { marca: 'Growatt', modelo: 'MIN 4000TL-X' } },
      },
      catalogo_usado: { panel: { marca: 'Jinko Solar', modelo: 'Tiger Neo 550' } },
    },
    ...over,
  };
}

beforeEach(() => { mockObtenerCotizacion.mockReset(); });

describe('generarFolioProyecto()', () => {
  test('sin prefijo_proyecto configurado → usa el default genérico "PRY"', async () => {
    const db = crearMockDbPorTabla({ companies: { data: { prefijo_proyecto: null }, error: null } });
    const folio = await generarFolioProyecto(db, COMPANY_A);
    expect(folio).toMatch(/^PRY-\d{4}-0007$/);
  });

  test('con prefijo_proyecto configurado (ej. Nort Energy) → lo usa', async () => {
    const db = crearMockDbPorTabla({ companies: { data: { prefijo_proyecto: 'NE' }, error: null } });
    const folio = await generarFolioProyecto(db, COMPANY_A);
    expect(folio).toMatch(/^NE-\d{4}-0007$/);
  });

  test('llama al RPC atómico con el company_id correcto', async () => {
    const db = crearMockDbPorTabla();
    await generarFolioProyecto(db, COMPANY_A);
    expect(db.rpc).toHaveBeenCalledWith('incrementar_folio_proyecto', { p_company_id: COMPANY_A });
  });

  test('el consecutivo se rellena con ceros a la izquierda (4 dígitos)', async () => {
    const db = crearMockDbPorTabla();
    db.rpc = jest.fn().mockResolvedValue({ data: 3, error: null });
    const folio = await generarFolioProyecto(db, COMPANY_A);
    expect(folio).toMatch(/-0003$/);
  });
});

describe('construirSnapshotVendido()', () => {
  test('cotización completa → snapshot con panel/inversor/kWp/precio/folio', () => {
    const snap = construirSnapshotVendido(cotizacionBase());
    expect(snap).toMatchObject({
      cotizacion_folio: 'COT-2026-0021', cotizacion_version: 1, paquete_recomendado: 'Paquete 8 paneles',
      panel: { marca: 'Jinko Solar', modelo: 'Tiger Neo 550', cantidad: 8 },
      inversor: { marca: 'Growatt', modelo: 'MIN 4000TL-X' },
      potencia_instalada_kwp: 4.4, total: 40716,
    });
    expect(snap.lineas).toHaveLength(1);
  });

  test('sin cálculo de ingeniería (cotización nunca calculada) → panel/inversor null, nunca lanza', () => {
    const snap = construirSnapshotVendido(cotizacionBase({ calculo: null }));
    expect(snap.panel).toBeNull();
    expect(snap.inversor).toBeNull();
    expect(snap.potencia_instalada_kwp).toBeNull();
  });

  test('sin paquete recomendado (BOM desglosado o venta a la medida) → paquete_recomendado null', () => {
    const snap = construirSnapshotVendido(cotizacionBase({ paquetes_solares: null }));
    expect(snap.paquete_recomendado).toBeNull();
  });

  test('sin líneas → lineas: []', () => {
    const snap = construirSnapshotVendido(cotizacionBase({ lineas: [] }));
    expect(snap.lineas).toEqual([]);
  });

  test('precio_final_autorizado presente → se conserva junto con total (ambos, sin elegir uno)', () => {
    const snap = construirSnapshotVendido(cotizacionBase({ precio_final_autorizado: 38000 }));
    expect(snap.precio_final_autorizado).toBe(38000);
    expect(snap.total).toBe(40716);
  });
});

describe('marcarCotizacionAceptadaYCrearProyecto()', () => {
  test('cotización inexistente o de otra empresa → 404, nunca toca proyectos', async () => {
    mockObtenerCotizacion.mockResolvedValue(null);
    const db = crearMockDbPorTabla();
    await expect(marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 999, usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 404 });
    expect(db.from).not.toHaveBeenCalledWith('proyectos');
  });

  test('estado "rechazada" → 409, no marca aceptada ni crea proyecto', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase({ estado: 'rechazada' }));
    const db = crearMockDbPorTabla();
    await expect(marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 409 });
    expect(db.from).not.toHaveBeenCalledWith('proyectos');
  });

  test('estado "vencida" → 409', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase({ estado: 'vencida' }));
    const db = crearMockDbPorTabla();
    await expect(marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' }))
      .rejects.toMatchObject({ status: 409 });
  });

  test.each(['borrador', 'enviada', 'vista'])('estado "%s" → transición completa: marca aceptada + crea proyecto + bitácora', async (estadoOrigen) => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase({ estado: estadoOrigen }));
    let payloadUpdateCotizacion = null;
    let payloadInsertProyecto = null;
    let payloadInsertBitacora = null;
    const db = dbQueCreaProyectoNuevo();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'cotizaciones') { const u = builder.update; builder.update = jest.fn((p) => { payloadUpdateCotizacion = p; return u.call(builder, p); }); }
      if (tabla === 'proyectos') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsertProyecto = p[0]; return i.call(builder, p); }); }
      if (tabla === 'bitacora_decisiones') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsertBitacora = p[0]; return i.call(builder, p); }); }
      return builder;
    });

    const r = await marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'user-1' });

    expect(payloadUpdateCotizacion).toMatchObject({ estado: 'aceptada', aceptada_por: 'user-1' });
    expect(payloadUpdateCotizacion.aceptada_en).toEqual(expect.any(String));
    expect(payloadInsertProyecto).toMatchObject({
      company_id: COMPANY_A, tipo: 'venta', cliente_id: 214, oportunidad_id: 99, cotizacion_id: 42, sucursal_id: 'suc-1', asesor_id: 'asesor-1',
    });
    expect(payloadInsertProyecto.numero_proyecto).toMatch(/^PRY-\d{4}-0007$/);
    expect(payloadInsertProyecto.config_vendida.panel.marca).toBe('Jinko Solar');
    expect(payloadInsertBitacora).toMatchObject({ company_id: COMPANY_A, autor_id: 'user-1', cliente_id: 214, proyecto_id: 'proy-1' });
    expect(r.proyectoYaExistia).toBe(false);
    expect(r.cotizacionYaEstabaAceptada).toBe(false);
  });

  test('ubicación de instalación: prioriza dirección/colonia/ciudad de la OPORTUNIDAD sobre la dirección general del cliente', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase());
    let payloadInsertProyecto = null;
    const db = dbQueCreaProyectoNuevo({
      oportunidades: { data: { direccion: 'Av. Solar 456', colonia: 'Centro', ciudad: 'Monterrey' }, error: null },
    });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'proyectos') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsertProyecto = p[0]; return i.call(builder, p); }); }
      return builder;
    });

    await marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' });
    expect(payloadInsertProyecto.ubicacion_instalacion).toBe('Av. Solar 456, Centro, Monterrey');
  });

  test('sin oportunidad con dirección → usa la dirección del cliente', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase({ oportunidad_id: null }));
    let payloadInsertProyecto = null;
    const db = dbQueCreaProyectoNuevo();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'proyectos') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsertProyecto = p[0]; return i.call(builder, p); }); }
      return builder;
    });

    await marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' });
    expect(payloadInsertProyecto.ubicacion_instalacion).toBe('Calle Cliente 123');
  });

  test('cotización YA estaba "aceptada" → no vuelve a actualizar cotizaciones (preserva aceptada_en original), pero sí asegura el proyecto', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase({ estado: 'aceptada' }));
    let seLlamoUpdateCotizacion = false;
    const db = crearMockDbPorTabla({ proyectos: { data: { id: 'proy-1' }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'cotizaciones') { const u = builder.update; builder.update = jest.fn((p) => { seLlamoUpdateCotizacion = true; return u.call(builder, p); }); }
      return builder;
    });

    const r = await marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' });
    expect(seLlamoUpdateCotizacion).toBe(false);
    expect(r.cotizacionYaEstabaAceptada).toBe(true);
  });

  test('IDEMPOTENCIA — ya existe un proyecto para esta cotización → lo devuelve, nunca inserta uno nuevo ni duplica la bitácora', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase());
    let seIntentoInsertarProyecto = false;
    let seIntentoInsertarBitacora = false;
    const db = crearMockDbPorTabla({
      proyectos: { data: { id: 'proy-existente', numero_proyecto: 'PRY-2026-0003', cliente_id: 214 }, error: null },
    });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'proyectos') { const i = builder.insert; builder.insert = jest.fn((p) => { seIntentoInsertarProyecto = true; return i.call(builder, p); }); }
      if (tabla === 'bitacora_decisiones') { const i = builder.insert; builder.insert = jest.fn((p) => { seIntentoInsertarBitacora = true; return i.call(builder, p); }); }
      return builder;
    });

    const r = await marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' });
    expect(seIntentoInsertarProyecto).toBe(false);
    expect(seIntentoInsertarBitacora).toBe(false);
    expect(r.proyectoYaExistia).toBe(true);
    expect(r.proyecto.id).toBe('proy-existente');
  });

  test('CARRERA REAL (23505 del índice único) — el insert choca, se recupera el proyecto ganador sin lanzar', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase());
    let numeroDeSelects = 0;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      if (tabla === 'proyectos') {
        const builder = crearBuilder();
        builder.maybeSingle = jest.fn(() => {
          numeroDeSelects += 1;
          // primer SELECT (antes de insertar): nada; segundo SELECT (después del 23505): el que ganó la carrera
          return Promise.resolve(numeroDeSelects === 1 ? { data: null, error: null } : { data: { id: 'proy-ganador', numero_proyecto: 'PRY-2026-0009' }, error: null });
        });
        builder.insert = jest.fn(() => builder);
        builder.select = jest.fn(() => builder);
        builder.single = jest.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
        return builder;
      }
      return fromOriginal(tabla);
    });

    const r = await marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' });
    expect(r.proyectoYaExistia).toBe(true);
    expect(r.proyecto.id).toBe('proy-ganador');
  });

  test('error real de DB (no 23505) al crear el proyecto → sí lanza, nunca lo oculta', async () => {
    mockObtenerCotizacion.mockResolvedValue(cotizacionBase());
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      if (tabla === 'proyectos') {
        const builder = crearBuilder();
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        builder.insert = jest.fn(() => builder);
        builder.select = jest.fn(() => builder);
        builder.single = jest.fn().mockResolvedValue({ data: null, error: { code: '23503', message: 'foreign key violation' } });
        return builder;
      }
      return fromOriginal(tabla);
    });

    await expect(marcarCotizacionAceptadaYCrearProyecto(db, { companyId: COMPANY_A, cotizacionId: 42, usuarioId: 'u1' })).rejects.toThrow('foreign key violation');
  });
});

describe('obtenerProyecto()', () => {
  test('proyecto inexistente o de otra empresa → null', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: null, error: null } });
    expect(await obtenerProyecto(db, COMPANY_A, 'proy-x')).toBeNull();
  });

  test('proyecto real → enriquecido con nombre de cliente/sucursal/asesor', async () => {
    const db = crearMockDbPorTabla({
      proyectos: { data: { id: 'proy-1', company_id: COMPANY_A, cliente_id: 214, sucursal_id: 'suc-1', asesor_id: 'asesor-1' }, error: null },
    });
    const r = await obtenerProyecto(db, COMPANY_A, 'proy-1');
    expect(r).toMatchObject({ cliente_nombre: 'Cliente Prueba', sucursal_nombre: 'Sucursal Centro', asesor_nombre: 'Asesor Prueba' });
  });

  test('sin sucursal_id/asesor_id → no consulta esas tablas, nombres en null', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: { id: 'proy-1', cliente_id: 214, sucursal_id: null, asesor_id: null }, error: null } });
    const r = await obtenerProyecto(db, COMPANY_A, 'proy-1');
    expect(db.from).not.toHaveBeenCalledWith('sucursales');
    expect(db.from).not.toHaveBeenCalledWith('asesores');
    expect(r.sucursal_nombre).toBeNull();
    expect(r.asesor_nombre).toBeNull();
  });
});

describe('obtenerProyectoDeCliente() / obtenerProyectoDeCotizacion()', () => {
  test('obtenerProyectoDeCliente: filtra por cliente_id, company_id y tipo=venta', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: { id: 'proy-1', numero_proyecto: 'PRY-2026-0001' }, error: null } });
    const r = await obtenerProyectoDeCliente(db, COMPANY_A, 214);
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'proyectos').value;
    expect(builder.eq).toHaveBeenCalledWith('cliente_id', 214);
    expect(builder.eq).toHaveBeenCalledWith('tipo', 'venta');
    expect(r.numero_proyecto).toBe('PRY-2026-0001');
  });

  test('obtenerProyectoDeCliente: sin proyecto → null, no undefined', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: null, error: null } });
    expect(await obtenerProyectoDeCliente(db, COMPANY_A, 214)).toBeNull();
  });

  test('obtenerProyectoDeCotizacion: filtra por cotizacion_id', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: { id: 'proy-1' }, error: null } });
    await obtenerProyectoDeCotizacion(db, COMPANY_A, 42);
    const builder = db.from.mock.results.find((_, i) => db.from.mock.calls[i][0] === 'proyectos').value;
    expect(builder.eq).toHaveBeenCalledWith('cotizacion_id', 42);
  });
});
