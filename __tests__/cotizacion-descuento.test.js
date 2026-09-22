'use strict';

const { resolverLimiteDescuento, aplicarDescuento, autorizarDescuento } = require('../modules/cotizacion-descuento');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

/** Mock por tabla — parametros_ingenieria responde el límite; cotizaciones responde según el caso. */
function crearMockDb({ cotizacionSelect, cotizacionUpdate, limiteEmpresa = null, limiteGlobal = { valor: 10 } } = {}) {
  let consultaParametros = 0;
  const capturas = { update: null };
  const db = {
    from: jest.fn((tabla) => {
      if (tabla === 'cotizaciones') {
        const builder = crearBuilder(cotizacionSelect ?? { data: null, error: null });
        builder.update = jest.fn((payload) => {
          capturas.update = payload;
          return crearBuilder(cotizacionUpdate ?? { data: { id: 1, ...payload }, error: null });
        });
        return builder;
      }
      if (tabla === 'parametros_ingenieria') {
        // resolverParametro: primero intenta el override de empresa, si no hay cae al global (company_id IS NULL)
        consultaParametros += 1;
        return crearBuilder(consultaParametros === 1 ? { data: limiteEmpresa, error: null } : { data: limiteGlobal, error: null });
      }
      return crearBuilder();
    }),
  };
  return { db, capturas };
}

const COMPANY_A = 'company-a';

describe('resolverLimiteDescuento()', () => {
  test('sin override de empresa → usa el default global (10%)', async () => {
    const { db } = crearMockDb();
    expect(await resolverLimiteDescuento(db, COMPANY_A)).toBe(10);
  });

  test('con override de empresa → gana sobre el global', async () => {
    const { db } = crearMockDb({ limiteEmpresa: { valor: 15 } });
    expect(await resolverLimiteDescuento(db, COMPANY_A)).toBe(15);
  });

  test('sin ningún parámetro configurado (ni override ni global) → cae al default interno de código (10), nunca sin regla', async () => {
    const { db } = crearMockDb({ limiteGlobal: null });
    expect(await resolverLimiteDescuento(db, COMPANY_A)).toBe(10);
  });
});

describe('aplicarDescuento()', () => {
  test('ni descuentoPct ni descuentoMonto → 400, no toca la cotización', async () => {
    const { db } = crearMockDb();
    await expect(aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'u1', rolUsuario: 'asesor' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('descuentoPct Y descuentoMonto a la vez → 400', async () => {
    const { db } = crearMockDb();
    await expect(aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'u1', rolUsuario: 'asesor', descuentoPct: 5, descuentoMonto: 100 }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('cotización inexistente o de otra empresa → 404', async () => {
    const { db } = crearMockDb({ cotizacionSelect: { data: null, error: null } });
    await expect(aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 999, usuarioId: 'u1', rolUsuario: 'asesor', descuentoPct: 5 }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('asesor pide un % DENTRO del límite → se aplica de una vez, autorizado por sí mismo (sin excepción de gerencial)', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: 60000 }, error: null } });
    const r = await aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor', descuentoPct: 5, motivo: 'cliente frecuente' });

    expect(capturas.update.limite_descuento_excedido).toBe(false);
    expect(capturas.update.descuento_autorizado_por).toBe('asesor-1');
    expect(capturas.update.descuento_autorizado_en).not.toBeNull();
    expect(capturas.update.descuento_motivo).toBe('cliente frecuente');
    expect(r.requiere_autorizacion).toBe(false);
    expect(r.limite_pct).toBe(10);
  });

  test('asesor pide un % que EXCEDE el límite → queda pendiente, sin autorizador', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: 60000 }, error: null } });
    const r = await aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor', descuentoPct: 20 });

    expect(capturas.update.limite_descuento_excedido).toBe(true);
    expect(capturas.update.descuento_autorizado_por).toBeNull();
    expect(capturas.update.descuento_autorizado_en).toBeNull();
    expect(r.requiere_autorizacion).toBe(true);
  });

  test('un GERENCIAL que pide un % que excede el límite → se autoriza a sí mismo en el mismo acto', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: 60000 }, error: null } });
    const r = await aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'gerente-1', rolUsuario: 'owner', descuentoPct: 25 });

    expect(capturas.update.limite_descuento_excedido).toBe(true);
    expect(capturas.update.descuento_autorizado_por).toBe('gerente-1');
    expect(r.requiere_autorizacion).toBe(false);
  });

  test('descuentoMonto se traduce a % equivalente contra el total para comparar con el límite', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: 60000 }, error: null } });
    // 3000 / 60000 = 5% → dentro del límite de 10%
    await aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor', descuentoMonto: 3000 });
    expect(capturas.update.limite_descuento_excedido).toBe(false);

    // 9000 / 60000 = 15% → excede
    const { db: db2, capturas: cap2 } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: 60000 }, error: null } });
    await aplicarDescuento(db2, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor', descuentoMonto: 9000 });
    expect(cap2.update.limite_descuento_excedido).toBe(true);
  });

  test('descuentoMonto sin total conocido (cotización sin líneas, total 0/null) → NUNCA se asume dentro del límite, requiere autorización', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: null }, error: null } });
    const r = await aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor', descuentoMonto: 500 });
    expect(capturas.update.limite_descuento_excedido).toBe(true);
    expect(r.requiere_autorizacion).toBe(true);
  });

  test('descuentoPct: 0 (quitar el descuento) → siempre dentro del límite, se aplica directo', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: 60000 }, error: null } });
    await aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor', descuentoPct: 0 });
    expect(capturas.update.limite_descuento_excedido).toBe(false);
    expect(capturas.update.descuento_pct).toBe(0);
  });

  test('siempre registra quién y cuándo lo SOLICITÓ, sin importar si queda pendiente o se aplica de una vez', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, total: 60000 }, error: null } });
    await aplicarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor', descuentoPct: 20 });
    expect(capturas.update.descuento_solicitado_por).toBe('asesor-1');
    expect(capturas.update.descuento_solicitado_en).not.toBeNull();
  });
});

describe('autorizarDescuento()', () => {
  test('un no-gerencial no puede autorizar → 403', async () => {
    const { db } = crearMockDb();
    await expect(autorizarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'asesor-1', rolUsuario: 'asesor' }))
      .rejects.toMatchObject({ status: 403 });
  });

  test('cotización inexistente → 404', async () => {
    const { db } = crearMockDb({ cotizacionSelect: { data: null, error: null } });
    await expect(autorizarDescuento(db, { companyId: COMPANY_A, cotizacionId: 999, usuarioId: 'g1', rolUsuario: 'owner' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('la cotización no tiene ningún descuento pendiente → 409', async () => {
    const { db } = crearMockDb({ cotizacionSelect: { data: { id: 1, limite_descuento_excedido: false, descuento_autorizado_por: null }, error: null } });
    await expect(autorizarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'g1', rolUsuario: 'owner' }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('ya fue autorizado antes → 409, nunca lo re-autoriza', async () => {
    const { db } = crearMockDb({ cotizacionSelect: { data: { id: 1, limite_descuento_excedido: true, descuento_autorizado_por: 'otro-gerente' }, error: null } });
    await expect(autorizarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'g1', rolUsuario: 'owner' }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('gerencial autoriza un descuento pendiente → registra quién y cuándo', async () => {
    const { db, capturas } = crearMockDb({ cotizacionSelect: { data: { id: 1, limite_descuento_excedido: true, descuento_autorizado_por: null }, error: null } });
    await autorizarDescuento(db, { companyId: COMPANY_A, cotizacionId: 1, usuarioId: 'gerente-2', rolUsuario: 'supervisor' });
    expect(capturas.update).toEqual({ descuento_autorizado_por: 'gerente-2', descuento_autorizado_en: expect.any(String) });
  });
});
