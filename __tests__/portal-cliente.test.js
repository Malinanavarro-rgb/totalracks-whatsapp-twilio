'use strict';

const crypto = require('crypto');
const {
  solicitarCodigoAcceso, verificarCodigoAcceso, resolverSesionPortal, cerrarSesionPortal,
} = require('../modules/portal-cliente');

function hashCodigo(companyId, clienteId, codigo) {
  return crypto.createHash('sha256').update(`${companyId}:${clienteId}:${codigo}`).digest('hex');
}

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    clientes: { data: { id: 214, nombre: 'Juan Pérez', email: 'juan@example.com' }, error: null },
    portal_codigos_acceso: { data: null, error: null },
    portal_sesiones: { data: { id: 'ses-1' }, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-aaaa';

describe('solicitarCodigoAcceso()', () => {
  test('cliente no existe → { enviado: true }, nunca llama a enviarCorreo (no revela si el correo está registrado)', async () => {
    const db = crearMockDbPorTabla({ clientes: { data: null, error: null } });
    const enviarCorreo = jest.fn();
    const r = await solicitarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'nadie@example.com' }, { enviarCorreo });
    expect(r).toEqual({ enviado: true });
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  test('cliente existe → inserta el código y llama a enviarCorreo con los datos correctos', async () => {
    let payload = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'portal_codigos_acceso') { const i = builder.insert; builder.insert = jest.fn((p) => { payload = p[0]; return i.call(builder, p); }); }
      return builder;
    });
    const enviarCorreo = jest.fn().mockResolvedValue();

    const r = await solicitarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'juan@example.com' }, { enviarCorreo });

    expect(r).toEqual({ enviado: true });
    expect(payload).toMatchObject({ company_id: COMPANY_A, cliente_id: 214, canal: 'correo', destino: 'juan@example.com' });
    expect(payload.codigo_hash).toEqual(expect.any(String));
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    expect(enviarCorreo).toHaveBeenCalledWith(expect.objectContaining({ destino: 'juan@example.com', nombre: 'Juan Pérez', minutosVigencia: 10 }));
    // el código enviado corresponde exactamente al hash guardado
    const codigoEnviado = enviarCorreo.mock.calls[0][0].codigo;
    expect(payload.codigo_hash).toBe(hashCodigo(COMPANY_A, 214, codigoEnviado));
  });

  test('segunda solicitud antes de 60s → 429, no envía otro código', async () => {
    const db = crearMockDbPorTabla({ portal_codigos_acceso: { data: { created_at: new Date().toISOString() }, error: null } });
    const enviarCorreo = jest.fn();
    await expect(solicitarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'juan@example.com' }, { enviarCorreo }))
      .rejects.toMatchObject({ status: 429 });
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  test('solicitud después de 60s → sí permite un código nuevo', async () => {
    const haceDosMinutos = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const db = crearMockDbPorTabla({ portal_codigos_acceso: { data: { created_at: haceDosMinutos }, error: null } });
    const enviarCorreo = jest.fn().mockResolvedValue();
    const r = await solicitarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'juan@example.com' }, { enviarCorreo });
    expect(r).toEqual({ enviado: true });
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });
});

describe('verificarCodigoAcceso()', () => {
  test('cliente no existe → 401 genérico', async () => {
    const db = crearMockDbPorTabla({ clientes: { data: null, error: null } });
    await expect(verificarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'nadie@example.com', codigo: '123456' }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('sin ningún código pendiente/vigente → 401 genérico', async () => {
    const db = crearMockDbPorTabla({ portal_codigos_acceso: { data: null, error: null } });
    await expect(verificarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'juan@example.com', codigo: '123456' }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('código incorrecto → 401 genérico y suma un intento', async () => {
    let payloadUpdate = null;
    const filaCodigo = { id: 'cod-1', intentos: 0, codigo_hash: hashCodigo(COMPANY_A, 214, '999999') };
    const db = crearMockDbPorTabla({ portal_codigos_acceso: { data: filaCodigo, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'portal_codigos_acceso') { const u = builder.update; builder.update = jest.fn((p) => { payloadUpdate = p; return u.call(builder, p); }); }
      return builder;
    });

    await expect(verificarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'juan@example.com', codigo: '111111' }))
      .rejects.toMatchObject({ status: 401 });
    expect(payloadUpdate).toEqual({ intentos: 1 });
  });

  test('ya alcanzó el máximo de intentos → 429, sin comparar siquiera el código', async () => {
    const filaCodigo = { id: 'cod-1', intentos: 5, codigo_hash: hashCodigo(COMPANY_A, 214, '111111') };
    const db = crearMockDbPorTabla({ portal_codigos_acceso: { data: filaCodigo, error: null } });
    await expect(verificarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'juan@example.com', codigo: '111111' }))
      .rejects.toMatchObject({ status: 429 });
  });

  test('código correcto → marca usado_en, crea la sesión y devuelve token + cliente', async () => {
    let payloadUpdateCodigo = null;
    let payloadInsertSesion = null;
    const filaCodigo = { id: 'cod-1', intentos: 0, codigo_hash: hashCodigo(COMPANY_A, 214, '654321') };
    const db = crearMockDbPorTabla({ portal_codigos_acceso: { data: filaCodigo, error: null } });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'portal_codigos_acceso') { const u = builder.update; builder.update = jest.fn((p) => { payloadUpdateCodigo = p; return u.call(builder, p); }); }
      if (tabla === 'portal_sesiones') { const i = builder.insert; builder.insert = jest.fn((p) => { payloadInsertSesion = p[0]; return i.call(builder, p); }); }
      return builder;
    });

    const r = await verificarCodigoAcceso(db, { companyId: COMPANY_A, correo: 'juan@example.com', codigo: '654321' });

    expect(payloadUpdateCodigo.usado_en).toEqual(expect.any(String));
    expect(payloadInsertSesion).toMatchObject({ company_id: COMPANY_A, cliente_id: 214 });
    expect(payloadInsertSesion.token).toEqual(expect.any(String));
    expect(payloadInsertSesion.token.length).toBeGreaterThanOrEqual(32);
    expect(r).toMatchObject({ token: payloadInsertSesion.token, cliente: { id: 214, nombre: 'Juan Pérez' } });
  });
});

describe('resolverSesionPortal()', () => {
  test('sin token → null', async () => {
    const db = crearMockDbPorTabla();
    expect(await resolverSesionPortal(db, null)).toBeNull();
  });

  test('token inexistente/expirado/cerrado → null', async () => {
    const db = crearMockDbPorTabla({ portal_sesiones: { data: null, error: null } });
    expect(await resolverSesionPortal(db, 'token-x')).toBeNull();
  });

  test('token válido → devuelve companyId/clienteId', async () => {
    const db = crearMockDbPorTabla({ portal_sesiones: { data: { company_id: COMPANY_A, cliente_id: 214 }, error: null } });
    expect(await resolverSesionPortal(db, 'token-real')).toEqual({ companyId: COMPANY_A, clienteId: 214 });
  });
});

describe('cerrarSesionPortal()', () => {
  test('marca cerrado_en de la sesión', async () => {
    let payload = null;
    const db = crearMockDbPorTabla();
    db.from = jest.fn((tabla) => {
      const builder = crearBuilder({ data: null, error: null });
      if (tabla === 'portal_sesiones') { const u = builder.update; builder.update = jest.fn((p) => { payload = p; return u.call(builder, p); }); }
      return builder;
    });
    await cerrarSesionPortal(db, 'token-1');
    expect(payload.cerrado_en).toEqual(expect.any(String));
  });

  test('sin token → no hace nada, no truena', async () => {
    const db = crearMockDbPorTabla();
    await expect(cerrarSesionPortal(db, null)).resolves.toBeUndefined();
  });
});
