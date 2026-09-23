'use strict';

const { ESTADOS_COBRANZA, calcularEstadoCobranza, obtenerResumenCobranza, registrarAbono, actualizarAnticipoRequerido } = require('../modules/cobranza');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    pagos_cliente: { data: null, error: null }, // sin registro todavía por default
    proyectos: { data: { id: 'proy-1', cotizacion_id: 42, cliente_id: 214, config_vendida: { total: 40716, precio_final_autorizado: null } }, error: null },
    cotizaciones: { data: { anticipo_pct: null }, error: null },
    pagos_cliente_abonos: { data: [], error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-aaaa';

describe('ESTADOS_COBRANZA', () => {
  test('incluye los 5 estados pedidos', () => {
    expect(ESTADOS_COBRANZA).toEqual(['pendiente_anticipo', 'anticipo_recibido', 'pago_parcial', 'liquidado', 'vencido']);
  });
});

describe('calcularEstadoCobranza()', () => {
  test('sin total_vendido válido → todo null, con motivo, nunca inventa', () => {
    const r = calcularEstadoCobranza({ totalVendido: null, anticipoRequerido: null, totalPagado: 0 });
    expect(r.estado).toBeNull();
    expect(r.saldo).toBeNull();
    expect(r.motivo).toMatch(/total vendido/);
  });

  test('sin ningún pago → pendiente_anticipo, saldo = total, 0% pagado', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 0 });
    expect(r.estado).toBe('pendiente_anticipo');
    expect(r.saldo).toBe(40716);
    expect(r.pct_pagado).toBe(0);
  });

  test('con anticipo requerido definido, pago menor al anticipo → sigue pendiente_anticipo', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: 12000, totalPagado: 5000 });
    expect(r.estado).toBe('pendiente_anticipo');
  });

  test('pago EXACTO al anticipo requerido → anticipo_recibido', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: 12000, totalPagado: 12000 });
    expect(r.estado).toBe('anticipo_recibido');
  });

  test('pago por encima del anticipo pero menor al total → pago_parcial', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: 12000, totalPagado: 20000 });
    expect(r.estado).toBe('pago_parcial');
  });

  test('SIN anticipo definido (caso real hoy: ninguna cotización lo trae) → cualquier pago > 0 es directamente pago_parcial', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 5000 });
    expect(r.estado).toBe('pago_parcial');
  });

  test('pago que cubre el total → liquidado, saldo 0, 100%', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 40716 });
    expect(r.estado).toBe('liquidado');
    expect(r.saldo).toBe(0);
    expect(r.pct_pagado).toBe(100);
  });

  test('pago que excede el total (no debería pasar, pero nunca un saldo negativo) → liquidado, saldo se topa en 0', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 50000 });
    expect(r.saldo).toBe(0);
    expect(r.pct_pagado).toBe(100);
  });

  test('vencido: con fecha_limite_pago pasada Y saldo pendiente → vencido, tiene prioridad sobre pendiente_anticipo/pago_parcial', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 0, fechaLimitePago: '2020-01-01', hoy: new Date('2026-09-23') });
    expect(r.estado).toBe('vencido');
  });

  test('sin fecha_limite_pago → "vencido" nunca se activa, aunque pase mucho tiempo', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 0, fechaLimitePago: null, hoy: new Date('2030-01-01') });
    expect(r.estado).not.toBe('vencido');
  });

  test('fecha_limite_pago pasada pero YA liquidado → liquidado gana, nunca "vencido" sobre algo ya pagado', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 40716, fechaLimitePago: '2020-01-01', hoy: new Date('2026-09-23') });
    expect(r.estado).toBe('liquidado');
  });

  test('fecha_limite_pago es HOY (no antes) → todavía no vencido', () => {
    const r = calcularEstadoCobranza({ totalVendido: 40716, anticipoRequerido: null, totalPagado: 0, fechaLimitePago: '2026-09-23', hoy: new Date('2026-09-23T10:00:00Z') });
    expect(r.estado).not.toBe('vencido');
  });
});

describe('obtenerResumenCobranza()', () => {
  test('sin registro de cobranza todavía → lo crea usando el snapshot del proyecto (total_vendido, sin anticipo)', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente') {
        builder.maybeSingle = jest.fn()
          .mockResolvedValueOnce({ data: null, error: null }) // no existe
          .mockResolvedValue({ data: { id: 'pc-1', total_vendido: 40716, anticipo_requerido_pct: null, anticipo_requerido_monto: null, fecha_limite_pago: null }, error: null });
        const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsert = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'pc-1', total_vendido: 40716, anticipo_requerido_pct: null, anticipo_requerido_monto: null, fecha_limite_pago: null }, error: null });
      }
      return builder;
    });

    const r = await obtenerResumenCobranza(db, COMPANY_A, 'proy-1');
    expect(payloadInsert).toMatchObject({ company_id: COMPANY_A, proyecto_id: 'proy-1', cotizacion_id: 42, cliente_id: 214, total_vendido: 40716, anticipo_requerido_pct: null });
    expect(r.estado).toBe('pendiente_anticipo');
    expect(r.total_pagado).toBe(0);
  });

  test('usa precio_final_autorizado sobre total cuando ambos existen en el snapshot', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla({ proyectos: { data: { id: 'proy-1', cotizacion_id: 42, cliente_id: 214, config_vendida: { total: 45000, precio_final_autorizado: 40000 } }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente') {
        builder.maybeSingle = jest.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValue({ data: { id: 'pc-1', total_vendido: 40000 }, error: null });
        const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsert = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'pc-1', total_vendido: 40000 }, error: null });
      }
      return builder;
    });
    await obtenerResumenCobranza(db, COMPANY_A, 'proy-1');
    expect(payloadInsert.total_vendido).toBe(40000);
  });

  test('proyecto sin total vendido en el snapshot → 409, no crea el registro de cobranza', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: { id: 'proy-1', cotizacion_id: 42, cliente_id: 214, config_vendida: {} }, error: null } });
    await expect(obtenerResumenCobranza(db, COMPANY_A, 'proy-1')).rejects.toMatchObject({ status: 409 });
  });

  test('proyecto inexistente o de otra empresa → 404', async () => {
    const db = crearMockDbPorTabla({ proyectos: { data: null, error: null } });
    await expect(obtenerResumenCobranza(db, COMPANY_A, 'proy-x')).rejects.toMatchObject({ status: 404 });
  });

  test('con registro existente y abonos previos → suma total_pagado y deriva el estado correctamente', async () => {
    const db = crearMockDbPorTabla({
      pagos_cliente: { data: { id: 'pc-1', total_vendido: 40716, anticipo_requerido_monto: null, fecha_limite_pago: null }, error: null },
      pagos_cliente_abonos: { data: [{ monto: 10000 }, { monto: 5000 }], error: null },
    });
    const r = await obtenerResumenCobranza(db, COMPANY_A, 'proy-1');
    expect(r.total_pagado).toBe(15000);
    expect(r.saldo).toBe(25716);
    expect(r.estado).toBe('pago_parcial');
  });

  test('con anticipo requerido copiado de la cotización real', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla({ cotizaciones: { data: { anticipo_pct: 30 }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente') {
        builder.maybeSingle = jest.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValue({ data: { id: 'pc-1' }, error: null });
        const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsert = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'pc-1', total_vendido: 40716 }, error: null });
      }
      return builder;
    });
    await obtenerResumenCobranza(db, COMPANY_A, 'proy-1');
    expect(payloadInsert.anticipo_requerido_pct).toBe(30);
    expect(payloadInsert.anticipo_requerido_monto).toBeCloseTo(40716 * 0.3, 2);
  });

  test('CARRERA REAL (23505) al crear pagos_cliente → recupera el registro ganador, nunca lanza', async () => {
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    let numeroDeSelects = 0;
    db.from = jest.fn((tabla) => {
      if (tabla === 'pagos_cliente') {
        const builder = crearBuilder();
        builder.maybeSingle = jest.fn(() => {
          numeroDeSelects += 1;
          return Promise.resolve(numeroDeSelects === 1 ? { data: null, error: null } : { data: { id: 'pc-ganador', total_vendido: 40716 }, error: null });
        });
        builder.insert = jest.fn(() => builder);
        builder.select = jest.fn(() => builder);
        builder.single = jest.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
        return builder;
      }
      return fromOriginal(tabla);
    });

    const r = await obtenerResumenCobranza(db, COMPANY_A, 'proy-1');
    expect(r.id).toBe('pc-ganador');
  });
});

describe('registrarAbono()', () => {
  function dbConPagosClienteExistente(overrides = {}) {
    return crearMockDbPorTabla({
      pagos_cliente: { data: { id: 'pc-1', total_vendido: 40716, anticipo_requerido_monto: null, fecha_limite_pago: null }, error: null },
      pagos_cliente_abonos: { data: [], error: null },
      ...overrides,
    });
  }

  test('monto <= 0 → 400, nunca inserta', async () => {
    const db = dbConPagosClienteExistente();
    await expect(registrarAbono(db, { companyId: COMPANY_A, proyectoId: 'proy-1', monto: 0, usuarioId: 'u1' })).rejects.toMatchObject({ status: 400 });
    await expect(registrarAbono(db, { companyId: COMPANY_A, proyectoId: 'proy-1', monto: -100, usuarioId: 'u1' })).rejects.toMatchObject({ status: 400 });
  });

  test('abono válido → se inserta con los datos correctos y devuelve el resumen actualizado', async () => {
    let payloadInsert = null;
    const db = dbConPagosClienteExistente();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente_abonos') {
        const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsert = p[0]; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'abono-1', ...payloadInsert }, error: null });
      }
      return builder;
    });

    const r = await registrarAbono(db, { companyId: COMPANY_A, proyectoId: 'proy-1', monto: 12000, formaPago: 'transferencia', referencia: 'SPEI123', usuarioId: 'user-1' });
    expect(payloadInsert).toMatchObject({ company_id: COMPANY_A, pagos_cliente_id: 'pc-1', monto: 12000, forma_pago: 'transferencia', referencia: 'SPEI123', registrado_por: 'user-1' });
    expect(r.abono.id).toBe('abono-1');
  });

  test('abono que excede el saldo pendiente → 409, nunca lo inserta (nunca saldo negativo)', async () => {
    let seIntentoInsertar = false;
    const db = dbConPagosClienteExistente({ pagos_cliente_abonos: { data: [{ monto: 35000 }], error: null } }); // saldo restante: 5716
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente_abonos') { const i = builder.insert; builder.insert = jest.fn((p) => { seIntentoInsertar = true; return i.call(builder, p); }); }
      return builder;
    });

    await expect(registrarAbono(db, { companyId: COMPANY_A, proyectoId: 'proy-1', monto: 10000, usuarioId: 'u1' })).rejects.toMatchObject({ status: 409 });
    expect(seIntentoInsertar).toBe(false);
  });

  test('abono que cubre EXACTO el saldo restante → se permite (liquida)', async () => {
    const db = dbConPagosClienteExistente({ pagos_cliente_abonos: { data: [{ monto: 30716 }], error: null } }); // saldo: 10000
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente_abonos') builder.single = jest.fn().mockResolvedValue({ data: { id: 'abono-final' }, error: null });
      return builder;
    });

    await expect(registrarAbono(db, { companyId: COMPANY_A, proyectoId: 'proy-1', monto: 10000, usuarioId: 'u1' })).resolves.toMatchObject({ abono: { id: 'abono-final' } });
  });

  test('sin registro de cobranza todavía → lo crea de paso, primer abono queda ligado a él', async () => {
    let pagosClienteIdUsado = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente') {
        builder.maybeSingle = jest.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValue({ data: { id: 'pc-nuevo', total_vendido: 40716 }, error: null });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'pc-nuevo', total_vendido: 40716 }, error: null });
      }
      if (tabla === 'pagos_cliente_abonos') {
        const i = builder.insert; builder.insert = jest.fn((p) => { pagosClienteIdUsado = p[0].pagos_cliente_id; return i.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'abono-1' }, error: null });
      }
      return builder;
    });

    await registrarAbono(db, { companyId: COMPANY_A, proyectoId: 'proy-1', monto: 5000, usuarioId: 'u1' });
    expect(pagosClienteIdUsado).toBe('pc-nuevo');
  });
});

describe('actualizarAnticipoRequerido()', () => {
  test('recalcula el monto a partir del % y el total_vendido ya guardado', async () => {
    let payloadUpdate = null;
    const db = crearMockDbPorTabla({ pagos_cliente: { data: { id: 'pc-1', total_vendido: 40716 }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente') {
        const u = builder.update; builder.update = jest.fn((p) => { payloadUpdate = p; return u.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'pc-1', anticipo_requerido_pct: 20 }, error: null });
      }
      return builder;
    });

    await actualizarAnticipoRequerido(db, { companyId: COMPANY_A, proyectoId: 'proy-1', anticipoPct: 20, usuarioId: 'u1' });
    expect(payloadUpdate.anticipo_requerido_pct).toBe(20);
    expect(payloadUpdate.anticipo_requerido_monto).toBeCloseTo(40716 * 0.2, 2);
  });

  test('anticipoPct: null → limpia el anticipo (monto también null)', async () => {
    let payloadUpdate = null;
    const db = crearMockDbPorTabla({ pagos_cliente: { data: { id: 'pc-1', total_vendido: 40716 }, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'pagos_cliente') {
        const u = builder.update; builder.update = jest.fn((p) => { payloadUpdate = p; return u.call(builder, p); });
        builder.single = jest.fn().mockResolvedValue({ data: { id: 'pc-1' }, error: null });
      }
      return builder;
    });

    await actualizarAnticipoRequerido(db, { companyId: COMPANY_A, proyectoId: 'proy-1', anticipoPct: null, usuarioId: 'u1' });
    expect(payloadUpdate.anticipo_requerido_pct).toBeNull();
    expect(payloadUpdate.anticipo_requerido_monto).toBeNull();
  });
});
