'use strict';

const {
  extraerReferralMeta, extraerReferralTwilio, extraerTokenCampana, resolverTokenCampana,
  buscarContextoPersistido, resolverReferralPanelesSolares, resolverContenidoExplicito,
  resolverContextoDeLead, registrarAtribucion,
} = require('../modules/lead-atribucion');

// ─── Mock builder por tabla (mismo molde que __tests__/cotizaciones-fase2.test.js) ──

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    neq:    jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    not:    jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    clientes:            { data: [], error: null },
    hilos:                { data: null, error: null },
    plantillas_industria: { data: null, error: null },
    companies:            { data: null, error: null },
    campanas_landing:     { data: null, error: null },
    atribucion_leads:     { data: { id: 'atr-1' }, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

const TELEFONO = '+528112345678';
const COMPANY_TARA_OS = 'company-tara-os';
const COMPANY_NORT = 'company-nort-energy';

// ─────────────────────────────────────────────────────────────────────────

describe('extraerReferralMeta()', () => {
  test('extrae el referral de un payload real de Click-to-WhatsApp Ads', () => {
    const reqBody = {
      entry: [{ changes: [{ value: { messages: [{ referral: {
        source_url: 'https://fb.me/anuncio123', source_type: 'ad', source_id: 'ad-1',
        headline: 'Ahorra con energía solar', body: 'Cotiza tus paneles hoy', ctwa_clid: 'clid-abc',
      } }] } }] }],
    };
    const referral = extraerReferralMeta(reqBody);
    expect(referral).toEqual({
      sourceUrl: 'https://fb.me/anuncio123', sourceType: 'ad', sourceId: 'ad-1',
      headline: 'Ahorra con energía solar', body: 'Cotiza tus paneles hoy', ctwaClid: 'clid-abc', mediaType: null,
    });
  });

  test('mensaje normal sin referral → null', () => {
    const reqBody = { entry: [{ changes: [{ value: { messages: [{ text: { body: 'Hola' } }] } }] }] };
    expect(extraerReferralMeta(reqBody)).toBeNull();
  });

  test('payload malformado/vacío → null, nunca lanza', () => {
    expect(extraerReferralMeta({})).toBeNull();
    expect(extraerReferralMeta(null)).toBeNull();
  });
});

describe('extraerReferralTwilio()', () => {
  test('extrae los campos Referral* cuando existen', () => {
    const reqBody = { ReferralHeadline: 'Paneles solares', ReferralBody: 'Cotiza ya', ReferralSourceUrl: 'https://fb.me/x' };
    expect(extraerReferralTwilio(reqBody)).toEqual(expect.objectContaining({ headline: 'Paneles solares', body: 'Cotiza ya' }));
  });

  test('sin campos Referral* → null', () => {
    expect(extraerReferralTwilio({ From: 'whatsapp:+52...', Body: 'Hola' })).toBeNull();
  });
});

describe('extraerTokenCampana()', () => {
  test('reconoce el patrón exacto #tara_camp:token', () => {
    expect(extraerTokenCampana('Hola quiero info #tara_camp:nort-fb-ago26')).toBe('nort-fb-ago26');
  });

  test('es insensible a mayúsculas', () => {
    expect(extraerTokenCampana('#TARA_CAMP:Nort-FB-Ago26')).toBe('nort-fb-ago26');
  });

  test('texto sin el patrón → null, nunca interpreta lenguaje natural', () => {
    expect(extraerTokenCampana('quiero paneles solares por favor')).toBeNull();
    expect(extraerTokenCampana('')).toBeNull();
    expect(extraerTokenCampana(null)).toBeNull();
  });
});

describe('resolverTokenCampana() — token inválido/manipulado nunca se confía', () => {
  test('token registrado y activo → devuelve la campaña', async () => {
    const db = crearMockDbPorTabla({ campanas_landing: { data: { id: 'c1', company_id: COMPANY_NORT, business_context: 'paneles_solares', activo: true }, error: null } });
    const resultado = await resolverTokenCampana(db, 'nort-fb-ago26');
    expect(resultado.company_id).toBe(COMPANY_NORT);
  });

  test('token inexistente (inventado por el cliente) → null', async () => {
    const db = crearMockDbPorTabla({ campanas_landing: { data: null, error: null } });
    expect(await resolverTokenCampana(db, 'token-que-no-existe')).toBeNull();
  });

  test('sin token → null, nunca consulta', async () => {
    const db = crearMockDbPorTabla();
    expect(await resolverTokenCampana(db, null)).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('buscarContextoPersistido() — nivel 1, no reclasificar', () => {
  test('hilo NO cerrado existente → devuelve su company_id (continúa la conversación)', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [{ id: 10, company_id: COMPANY_NORT }], error: null },
      hilos:    { data: { id: 'hilo-1', company_id: COMPANY_NORT, cliente_id: 10 }, error: null },
    });
    const resultado = await buscarContextoPersistido(db, TELEFONO);
    expect(resultado).toEqual({ companyId: COMPANY_NORT, hiloId: 'hilo-1', clienteId: 10 });
  });

  test('teléfono sin ningún cliente registrado → null', async () => {
    const db = crearMockDbPorTabla({ clientes: { data: [], error: null } });
    expect(await buscarContextoPersistido(db, TELEFONO)).toBeNull();
  });

  test('cliente existe pero su único hilo está cerrado → null (se vuelve a clasificar)', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [{ id: 10, company_id: COMPANY_NORT }], error: null },
      hilos:    { data: null, error: null }, // .neq('estado','cerrada') no encontró nada
    });
    expect(await buscarContextoPersistido(db, TELEFONO)).toBeNull();
  });
});

describe('resolverReferralPanelesSolares() — nivel 2', () => {
  const PLANTILLA = { palabras_clave: ['panel solar', 'paneles solares', 'energia solar', 'energía solar', 'fotovoltaico'] };

  test('headline/body del referral coinciden con el giro → resuelve a la empresa real de paneles solares', async () => {
    const db = crearMockDbPorTabla({
      plantillas_industria: { data: PLANTILLA, error: null },
      companies: { data: { id: COMPANY_NORT }, error: null },
    });
    const resultado = await resolverReferralPanelesSolares(db, { headline: 'Ahorra con energía solar', body: 'Cotiza tus paneles', sourceUrl: null });
    expect(resultado).toEqual({ companyId: COMPANY_NORT, businessContext: 'paneles_solares' });
  });

  test('referral de un anuncio no relacionado (ej. zapatos) → null, nunca fuerza el contexto', async () => {
    const db = crearMockDbPorTabla({ plantillas_industria: { data: PLANTILLA, error: null } });
    const resultado = await resolverReferralPanelesSolares(db, { headline: 'Zapatos en oferta', body: 'Compra ya', sourceUrl: null });
    expect(resultado).toBeNull();
  });

  test('sin referral → null', async () => {
    const db = crearMockDbPorTabla();
    expect(await resolverReferralPanelesSolares(db, null)).toBeNull();
  });

  test('coincide el giro pero no hay ninguna empresa real (no-demo) de paneles solares → null', async () => {
    const db = crearMockDbPorTabla({
      plantillas_industria: { data: PLANTILLA, error: null },
      companies: { data: null, error: null },
    });
    const resultado = await resolverReferralPanelesSolares(db, { headline: 'energía solar', body: '', sourceUrl: null });
    expect(resultado).toBeNull();
  });
});

describe('resolverContenidoExplicito() — nivel 4, regla de seguridad', () => {
  test('mención del nombre completo de la empresa → resuelve', async () => {
    const db = crearMockDbPorTabla({
      companies: { data: [{ id: COMPANY_NORT, nombre: 'Nort Energy', industria_slug: 'paneles_solares' }], error: null },
    });
    const resultado = await resolverContenidoExplicito(db, 'Hola, vengo de Nort Energy, quiero información', COMPANY_TARA_OS);
    expect(resultado).toEqual({ companyId: COMPANY_NORT, businessContext: 'paneles_solares' });
  });

  test('REGLA DE SEGURIDAD: palabra suelta del giro ("paneles solares") NUNCA dispara este nivel', async () => {
    const db = crearMockDbPorTabla({
      companies: { data: [{ id: COMPANY_NORT, nombre: 'Nort Energy', industria_slug: 'paneles_solares' }], error: null },
    });
    const resultado = await resolverContenidoExplicito(db, 'Hola quiero información de paneles solares, precio por favor', COMPANY_TARA_OS);
    expect(resultado).toBeNull();
  });

  test('REGLA DE SEGURIDAD: mención de "Alina" nunca dispara ningún cambio de contexto', async () => {
    const db = crearMockDbPorTabla({
      companies: { data: [{ id: COMPANY_NORT, nombre: 'Nort Energy', industria_slug: 'paneles_solares' }], error: null },
    });
    const resultado = await resolverContenidoExplicito(db, 'Hola, soy amiga de Alina, ¿está por ahí?', COMPANY_TARA_OS);
    expect(resultado).toBeNull();
  });

  test('sin texto → null, nunca consulta', async () => {
    const db = crearMockDbPorTabla();
    expect(await resolverContenidoExplicito(db, '', COMPANY_TARA_OS)).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('resolverContextoDeLead() — jerarquía completa', () => {
  const PLANTILLA = { palabras_clave: ['panel solar', 'paneles solares', 'energia solar', 'energía solar'] };

  test('nivel 1 gana: hay contexto persistido → ni siquiera mira el referral/token/texto', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [{ id: 10, company_id: COMPANY_NORT }], error: null },
      hilos:    { data: { id: 'hilo-1', company_id: COMPANY_NORT, cliente_id: 10 }, error: null },
    });
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody: {}, proveedor: 'meta', mensajeTexto: 'Sí, cuánto cuesta',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado).toEqual(expect.objectContaining({ companyId: COMPANY_NORT, resueltoPor: 'contexto_persistido', esNuevaDecision: false }));
  });

  test('caso 1 (prueba obligatoria): payload Meta CTWA con referral verificable → paneles_solares', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [], error: null },
      plantillas_industria: { data: PLANTILLA, error: null },
      companies: { data: { id: COMPANY_NORT }, error: null },
    });
    const reqBody = {
      entry: [{ changes: [{ value: { messages: [{ referral: {
        headline: 'Energía solar para tu casa', body: 'Cotiza gratis', source_url: 'https://fb.me/x', ctwa_clid: 'clid-1',
      } }] } }] }],
    };
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody, proveedor: 'meta', mensajeTexto: 'Hola',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado.companyId).toBe(COMPANY_NORT);
    expect(resultado.resueltoPor).toBe('referral_meta');
    expect(resultado.esNuevaDecision).toBe(true);
    expect(resultado.campaignData.ctwaClid).toBe('clid-1');
  });

  test('caso 2 (prueba obligatoria): payload Meta normal sin referral, sin nada más → fallback, se queda en TARA-OS', async () => {
    const db = crearMockDbPorTabla({ clientes: { data: [], error: null } });
    const reqBody = { entry: [{ changes: [{ value: { messages: [{ text: { body: 'Hola, información' } }] } }] }] };
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody, proveedor: 'meta', mensajeTexto: 'Hola, información',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado).toEqual(expect.objectContaining({ companyId: COMPANY_TARA_OS, resueltoPor: 'fallback_default' }));
  });

  test('caso 4 (prueba obligatoria): mensaje personal con "Alina" y sin metadata → permanece en TARA-OS', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [], error: null },
      companies: { data: [{ id: COMPANY_NORT, nombre: 'Nort Energy', industria_slug: 'paneles_solares' }], error: null },
    });
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody: {}, proveedor: 'meta', mensajeTexto: 'Hola, ¿está Alina? Le quería preguntar algo personal',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado.companyId).toBe(COMPANY_TARA_OS);
    expect(resultado.resueltoPor).toBe('fallback_default');
  });

  test('caso 7 (prueba obligatoria): teléfono SIN historia de atribución previa → fallback no genera fila (evita ruido)', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [], error: null },
      atribucion_leads: { data: null, error: null }, // nunca antes atribuido
    });
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody: {}, proveedor: 'meta', mensajeTexto: 'Hola',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado).toEqual(expect.objectContaining({ resueltoPor: 'fallback_default', esNuevaDecision: false }));
  });

  test('caso 7 (prueba obligatoria): teléfono CON historia de atribución previa → una conversación nueva (aunque caiga en fallback) también se registra, para no perder trazabilidad', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [], error: null },
      atribucion_leads: { data: { id: 'atr-anterior' }, error: null }, // ya tuvo una atribución antes (otra conversación)
    });
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody: {}, proveedor: 'meta', mensajeTexto: 'Hola de nuevo',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado).toEqual(expect.objectContaining({ resueltoPor: 'fallback_default', esNuevaDecision: true }));
  });

  test('caso 5 (prueba obligatoria): token válido de landing page → resuelve al contexto de la campaña', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [], error: null },
      campanas_landing: { data: { id: 'c1', company_id: COMPANY_NORT, business_context: 'paneles_solares', campaign_name: 'Google Ago26', fuente: 'google_ads', activo: true }, error: null },
    });
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody: {}, proveedor: 'meta', mensajeTexto: 'Hola quiero info #tara_camp:nort-google-ago26',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado.companyId).toBe(COMPANY_NORT);
    expect(resultado.resueltoPor).toBe('token_campana');
    expect(resultado.leadSource).toBe('google_ads');
  });

  test('caso 6 (prueba obligatoria): token inválido/manipulado → no se confía, cae a fallback', async () => {
    const db = crearMockDbPorTabla({
      clientes: { data: [], error: null },
      campanas_landing: { data: null, error: null }, // token no registrado
    });
    const resultado = await resolverContextoDeLead(db, {
      telefono: TELEFONO, reqBody: {}, proveedor: 'meta', mensajeTexto: 'Hola #tara_camp:token-inventado-por-mi',
      companyIdFallback: COMPANY_TARA_OS,
    });
    expect(resultado.companyId).toBe(COMPANY_TARA_OS);
    expect(resultado.resueltoPor).toBe('fallback_default');
  });
});

describe('registrarAtribucion()', () => {
  test('inserta la fila de auditoría con los campos esperados', async () => {
    const db = crearMockDbPorTabla({ atribucion_leads: { data: { id: 'atr-1' }, error: null } });
    const resultado = await registrarAtribucion(db, {
      telefono: TELEFONO, companyId: COMPANY_NORT, businessContext: 'paneles_solares', leadSource: 'meta_ads',
      resueltoPor: 'referral_meta', campaignData: { ctwaClid: 'clid-1', sourceUrl: 'https://fb.me/x' },
      mensajeTexto: 'Hola',
    });
    expect(resultado).toEqual({ id: 'atr-1' });

    const builder = db.from.mock.results[0].value;
    expect(builder.insert).toHaveBeenCalledWith([expect.objectContaining({
      telefono: TELEFONO, company_id: COMPANY_NORT, business_context: 'paneles_solares',
      lead_source: 'meta_ads', resuelto_por: 'referral_meta', ctwa_clid: 'clid-1',
    })]);
  });

  test('si falla el insert, devuelve null en vez de lanzar (auditoría no debe tumbar el turno)', async () => {
    const db = crearMockDbPorTabla({ atribucion_leads: { data: null, error: { message: 'boom' } } });
    const resultado = await registrarAtribucion(db, { telefono: TELEFONO, companyId: COMPANY_NORT, businessContext: 'x', leadSource: 'x', resueltoPor: 'fallback_default' });
    expect(resultado).toBeNull();
  });
});
