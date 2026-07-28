/**
 * TARA Matrix™ — Tests: cuenta-plataforma.js (ADR-012)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre:
 *   - resolverCuentaPorTelefono(): resuelve/no resuelve, incluye empresas
 *   - obtenerResumenSuscripcion(): plan real vs. sin suscripción vs. sin organización
 *   - obtenerIntegracionesActivas(): consolida 2 tablas dispersas
 *   - listarTicketsAbiertos() / crearTicket(): CRUD real
 *   - Interfaces todavía no construidas: siempre {disponible: false}, nunca inventan datos
 *   - construirResumenCuentaParaKnowledge(): punto de entrada único para el Core
 */

'use strict';

jest.mock('../modules/plataforma-billing', () => ({
  obtenerSuscripcionVigente: jest.fn(),
}));

const { obtenerSuscripcionVigente } = require('../modules/plataforma-billing');
const {
  resolverCuentaPorTelefono,
  obtenerResumenSuscripcion,
  obtenerIntegracionesActivas,
  listarTicketsAbiertos,
  crearTicket,
  obtenerFacturas,
  obtenerEstadoImplementacion,
  obtenerMonitoreoServicio,
  construirResumenCuentaParaKnowledge,
} = require('../modules/cuenta-plataforma');

// ── Mock Builder (mismo patrón ya usado en meta-auth.test.js/auth.test.js) ────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    single:      jest.fn().mockResolvedValue(resultado),
    then:        (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  return { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
}

beforeEach(() => jest.clearAllMocks());

// ═════════════════════════════════════════════════════════════════════════════
// resolverCuentaPorTelefono()
// ═════════════════════════════════════════════════════════════════════════════

describe('resolverCuentaPorTelefono()', () => {
  test('null si no se pasa teléfono', async () => {
    expect(await resolverCuentaPorTelefono(crearMockDb(), null)).toBeNull();
  });

  test('null si el teléfono no resuelve a ningún usuario', async () => {
    const db = crearMockDb({ data: null, error: null });
    expect(await resolverCuentaPorTelefono(db, '+5218112345678')).toBeNull();
  });

  test('resuelve usuario + empresas cuando el teléfono coincide', async () => {
    const db = crearMockDb(
      { data: { id: 'usuario-1', nombre: 'Alina', email: 'a@x.com' }, error: null },
      { data: [{ company_id: 'co-1', rol: 'owner', companies: { nombre: 'Total Racks', organization_id: 'org-1' } }], error: null }
    );

    const resultado = await resolverCuentaPorTelefono(db, '+5218112345678');

    expect(resultado.usuario.nombre).toBe('Alina');
    expect(resultado.empresas).toEqual([
      { company_id: 'co-1', nombre: 'Total Racks', rol: 'owner', organization_id: 'org-1' },
    ]);
  });

  test('usuario sin empresas activas devuelve empresas: []', async () => {
    const db = crearMockDb(
      { data: { id: 'usuario-1', nombre: 'Alina', email: 'a@x.com' }, error: null },
      { data: [], error: null }
    );
    const resultado = await resolverCuentaPorTelefono(db, '+5218112345678');
    expect(resultado.empresas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// obtenerResumenSuscripcion()
// ═════════════════════════════════════════════════════════════════════════════

describe('obtenerResumenSuscripcion()', () => {
  test('disponible:false si no hay organizationId', async () => {
    const resultado = await obtenerResumenSuscripcion(crearMockDb(), null);
    expect(resultado).toEqual({ disponible: false, motivo: expect.any(String) });
  });

  test('disponible:false si la organización no tiene suscripción', async () => {
    obtenerSuscripcionVigente.mockResolvedValue(null);
    const resultado = await obtenerResumenSuscripcion(crearMockDb(), 'org-1');
    expect(resultado.disponible).toBe(false);
  });

  test('disponible:true con los datos reales del plan cuando existe suscripción', async () => {
    obtenerSuscripcionVigente.mockResolvedValue({
      estado: 'active',
      fecha_prueba_fin: null,
      fecha_periodo_actual_fin: '2026-08-15T00:00:00Z',
      planes: { nombre: 'TARA Professional', periodo: 'mensual' },
    });

    const resultado = await obtenerResumenSuscripcion(crearMockDb(), 'org-1');

    expect(resultado).toEqual({
      disponible:       true,
      plan:             'TARA Professional',
      estado:           'active',
      periodo:          'mensual',
      fecha_fin_prueba: null,
      proximo_cobro:    '2026-08-15T00:00:00Z',
    });
  });

  test('reusa obtenerSuscripcionVigente (no duplica la query) — se llama con organizationId', async () => {
    obtenerSuscripcionVigente.mockResolvedValue(null);
    const db = crearMockDb();
    await obtenerResumenSuscripcion(db, 'org-42');
    expect(obtenerSuscripcionVigente).toHaveBeenCalledWith(db, 'org-42');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// obtenerIntegracionesActivas()
// ═════════════════════════════════════════════════════════════════════════════

describe('obtenerIntegracionesActivas()', () => {
  test('[] si no se pasa companyId', async () => {
    expect(await obtenerIntegracionesActivas(crearMockDb(), null)).toEqual([]);
  });

  test('consolida calendar_credentials + meta_whatsapp_credentials en una sola lista', async () => {
    const db = crearMockDb(
      { data: { proveedor: 'google', activo: true }, error: null },
      { data: { estado: 'activo', activo: true }, error: null }
    );

    const resultado = await obtenerIntegracionesActivas(db, 'co-1');

    expect(resultado).toEqual([
      { tipo: 'google_calendar', activo: true, detalle: 'google' },
      { tipo: 'whatsapp_meta', activo: true, detalle: 'activo' },
    ]);
  });

  test('integración no conectada aparece con activo:false, no se omite', async () => {
    const db = crearMockDb(
      { data: null, error: null },
      { data: null, error: null }
    );
    const resultado = await obtenerIntegracionesActivas(db, 'co-1');
    expect(resultado).toEqual([
      { tipo: 'google_calendar', activo: false, detalle: null },
      { tipo: 'whatsapp_meta', activo: false, detalle: null },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// listarTicketsAbiertos() / crearTicket()
// ═════════════════════════════════════════════════════════════════════════════

describe('listarTicketsAbiertos()', () => {
  test('[] si no se pasa organizationId', async () => {
    expect(await listarTicketsAbiertos(crearMockDb(), null)).toEqual([]);
  });

  test('devuelve los tickets abiertos/en_proceso', async () => {
    const tickets = [{ id: 't1', asunto: 'No llegan mensajes', estado: 'abierto', prioridad: 'alta' }];
    const db = crearMockDb({ data: tickets, error: null });
    expect(await listarTicketsAbiertos(db, 'org-1')).toEqual(tickets);
  });

  test('[] si Supabase devuelve error (fallo seguro, nunca lanza)', async () => {
    const db = crearMockDb({ data: null, error: { message: 'fallo' } });
    expect(await listarTicketsAbiertos(db, 'org-1')).toEqual([]);
  });
});

describe('crearTicket()', () => {
  test('lanza si falta organizationId', async () => {
    await expect(crearTicket(crearMockDb(), { asunto: 'x' })).rejects.toThrow('organizationId es requerido');
  });

  test('lanza si falta asunto', async () => {
    await expect(crearTicket(crearMockDb(), { organizationId: 'org-1' })).rejects.toThrow('asunto es requerido');
  });

  test('inserta el ticket con defaults correctos (prioridad media, canal whatsapp)', async () => {
    const db = crearMockDb({ data: { id: 'ticket-1' }, error: null });
    const resultado = await crearTicket(db, { organizationId: 'org-1', asunto: 'No llegan mensajes' });

    expect(resultado).toEqual({ id: 'ticket-1' });
    const builder = db.from.mock.results[0].value;
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: 'org-1',
      asunto:          'No llegan mensajes',
      prioridad:       'media',
      canal:           'whatsapp',
      usuario_id:      null,
    }));
  });

  test('lanza con mensaje claro si Supabase falla', async () => {
    const db = crearMockDb({ data: null, error: { message: 'columna inexistente' } });
    await expect(crearTicket(db, { organizationId: 'org-1', asunto: 'x' })).rejects.toThrow('columna inexistente');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Interfaces todavía no construidas — nunca inventan datos
// ═════════════════════════════════════════════════════════════════════════════

describe('Interfaces no construidas (facturación, implementación, monitoreo)', () => {
  test.each([
    ['obtenerFacturas', obtenerFacturas],
    ['obtenerEstadoImplementacion', obtenerEstadoImplementacion],
    ['obtenerMonitoreoServicio', obtenerMonitoreoServicio],
  ])('%s() siempre devuelve disponible:false con un motivo honesto', async (_nombre, fn) => {
    const resultado = await fn(crearMockDb(), 'org-1');
    expect(resultado.disponible).toBe(false);
    expect(typeof resultado.motivo).toBe('string');
    expect(resultado.motivo.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// construirResumenCuentaParaKnowledge() — punto de entrada único del Core
// ═════════════════════════════════════════════════════════════════════════════

describe('construirResumenCuentaParaKnowledge()', () => {
  test('[] si el teléfono no resuelve a ninguna cuenta (prospecto normal)', async () => {
    const db = crearMockDb({ data: null, error: null }); // resolverCuentaPorTelefono → usuario null
    const resultado = await construirResumenCuentaParaKnowledge(db, 'company-tara-os', '+5218100000000');
    expect(resultado).toEqual([]);
  });

  test('devuelve una entrada {categoria, contenido} cuando sí resuelve una cuenta', async () => {
    obtenerSuscripcionVigente.mockResolvedValue({
      estado: 'trial', fecha_prueba_fin: '2026-08-01T00:00:00Z', fecha_periodo_actual_fin: null,
      planes: { nombre: 'TARA Launch', periodo: 'mensual' },
    });

    const db = crearMockDb(
      { data: { id: 'usuario-1', nombre: 'Alina', email: 'a@x.com' }, error: null }, // usuarios
      { data: [{ company_id: 'co-1', rol: 'owner', companies: { nombre: 'Total Racks', organization_id: 'org-1' } }], error: null }, // usuarios_empresas
      { data: { proveedor: 'google', activo: true }, error: null }, // calendar_credentials
      { data: null, error: null }, // meta_whatsapp_credentials
      { data: [], error: null }, // tickets_soporte
    );

    const resultado = await construirResumenCuentaParaKnowledge(db, 'company-tara-os', '+5218112345678');

    expect(resultado).toHaveLength(1);
    expect(resultado[0].categoria).toBe('CUENTA_REAL_DEL_CONTACTO');
    expect(resultado[0].contenido).toContain('Total Racks');
    expect(resultado[0].contenido).toContain('TARA Launch');
    expect(resultado[0].contenido).toContain('Sin tickets de soporte abiertos');
  });

  test('nunca inventa un plan — si la suscripción no está disponible, dice el motivo honesto', async () => {
    obtenerSuscripcionVigente.mockResolvedValue(null);
    const db = crearMockDb(
      { data: { id: 'usuario-1', nombre: 'Alina', email: 'a@x.com' }, error: null },
      { data: [{ company_id: 'co-1', rol: 'owner', companies: { nombre: 'Total Racks', organization_id: 'org-1' } }], error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: [], error: null },
    );

    const resultado = await construirResumenCuentaParaKnowledge(db, 'company-tara-os', '+5218112345678');
    expect(resultado[0].contenido).not.toContain('undefined');
    expect(resultado[0].contenido).toContain('no tiene una suscripción registrada');
  });
});
