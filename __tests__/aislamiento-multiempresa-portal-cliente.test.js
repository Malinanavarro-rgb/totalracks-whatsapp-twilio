'use strict';

/**
 * Aislamiento multiempresa — Portal del cliente (Alina, 2026-09-25). Mismo
 * criterio que 2A/2B/2C/2D: nada de lo que expone el portal debe poder
 * cruzar de una empresa a otra, aunque el atacante conozca IDs reales de
 * otra empresa.
 *
 * Dos superficies distintas a cubrir:
 *   1. modules/portal-cliente.js — el cliente de la Empresa A NUNCA debe
 *      poder pedir/usar un código, ni resolver una sesión, que pertenezca
 *      a un cliente de la Empresa B (aun con el correo correcto pero un
 *      companyId equivocado, o viceversa).
 *   2. Las rutas /api/portal/mi-proyecto, /mis-equipos, /mi-cobranza —
 *      confían en req.portalCliente (resuelto del token de sesión, nunca
 *      de un campo del body/URL) y llaman a obtenerProyectoDeCliente con
 *      ese companyId+clienteId — ya cubierto indirectamente por los tests
 *      de aislamiento de modules/proyectos.js, pero aquí se prueba
 *      explícitamente que resolverSesionPortal nunca devuelve una sesión
 *      de otra empresa.
 */

const crypto = require('crypto');
const { solicitarCodigoAcceso, verificarCodigoAcceso, resolverSesionPortal } = require('../modules/portal-cliente');

function hashCodigo(companyId, clienteId, codigo) {
  return crypto.createHash('sha256').update(`${companyId}:${clienteId}:${codigo}`).digest('hex');
}

const EMPRESA_A = 'empresa-a-0001';
const EMPRESA_B = 'empresa-b-0002';

// Mismo cliente (mismo correo) existe en ambas empresas, con IDs distintos —
// el escenario real más peligroso: un correo que SÍ está registrado, pero
// en la empresa equivocada.
const CLIENTE_A = { id: 111, nombre: 'Juan Pérez (Empresa A)', email: 'juan@example.com' };
const CLIENTE_B = { id: 222, nombre: 'Juan Pérez (Empresa B)', email: 'juan@example.com' };

function crearBuilder(resolver) {
  const filtros = {};
  const builder = {
    select: jest.fn(() => builder),
    insert: jest.fn((payload) => { builder._payload = payload; return builder; }),
    update: jest.fn((payload) => { builder._payload = payload; return builder; }),
    eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
    ilike: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
    is: jest.fn(() => builder),
    gt: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(resolver(filtros, builder._payload))),
    single: jest.fn(() => Promise.resolve(resolver(filtros, builder._payload))),
    then: (resolve) => resolve(resolver(filtros, builder._payload)),
  };
  return builder;
}

/** DB falsa con clientes reales en dos empresas distintas y las tablas del portal vacías por default. */
function crearDbDosEmpresas({ codigosAcceso = [], sesiones = [] } = {}) {
  return {
    from: jest.fn((tabla) => {
      if (tabla === 'clientes') {
        return crearBuilder((f) => {
          const candidatos = [CLIENTE_A, CLIENTE_B].filter((c) => f.company_id === (c === CLIENTE_A ? EMPRESA_A : EMPRESA_B));
          const match = candidatos.find((c) => c.email.toLowerCase() === String(f.email || '').toLowerCase());
          return { data: match || null, error: null };
        });
      }
      if (tabla === 'portal_codigos_acceso') {
        return crearBuilder((f, payload) => {
          if (payload) { codigosAcceso.push({ id: `cod-${codigosAcceso.length + 1}`, intentos: 0, ...payload[0] }); return { data: null, error: null }; }
          const fila = codigosAcceso.find((c) => c.company_id === f.company_id && c.cliente_id === f.cliente_id && !c.usado_en);
          return { data: fila || null, error: null };
        });
      }
      if (tabla === 'portal_sesiones') {
        return crearBuilder((f, payload) => {
          if (payload && Array.isArray(payload)) { sesiones.push(payload[0]); return { data: null, error: null }; }
          const fila = sesiones.find((s) => s.token === f.token && !s.cerrado_en);
          return { data: fila ? { company_id: fila.company_id, cliente_id: fila.cliente_id } : null, error: null };
        });
      }
      return crearBuilder(() => ({ data: null, error: null }));
    }),
  };
}

describe('Aislamiento multiempresa — Portal del cliente', () => {
  test('mismo correo registrado en ambas empresas → el código de la Empresa A nunca sirve para entrar como cliente de la Empresa B', async () => {
    const codigosAcceso = [];
    const db = crearDbDosEmpresas({ codigosAcceso });
    const enviarCorreo = jest.fn().mockResolvedValue();

    await solicitarCodigoAcceso(db, { companyId: EMPRESA_A, correo: 'juan@example.com' }, { enviarCorreo });
    const codigoDeA = enviarCorreo.mock.calls[0][0].codigo;

    // El código quedó hasheado con EMPRESA_A + CLIENTE_A.id — intentar
    // "colarlo" contra EMPRESA_B (mismo correo, cliente distinto) debe
    // fallar con el mismo 401 genérico, nunca autenticar como el cliente B.
    await expect(verificarCodigoAcceso(db, { companyId: EMPRESA_B, correo: 'juan@example.com', codigo: codigoDeA }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('código correcto de la Empresa A → la sesión creada pertenece a EMPRESA_A/CLIENTE_A, nunca a la B', async () => {
    const codigosAcceso = [];
    const sesiones = [];
    const db = crearDbDosEmpresas({ codigosAcceso, sesiones });
    const enviarCorreo = jest.fn().mockResolvedValue();

    await solicitarCodigoAcceso(db, { companyId: EMPRESA_A, correo: 'juan@example.com' }, { enviarCorreo });
    const codigo = enviarCorreo.mock.calls[0][0].codigo;
    const r = await verificarCodigoAcceso(db, { companyId: EMPRESA_A, correo: 'juan@example.com', codigo });

    expect(r.cliente.id).toBe(CLIENTE_A.id);
    expect(sesiones[0]).toMatchObject({ company_id: EMPRESA_A, cliente_id: CLIENTE_A.id });
  });

  test('resolverSesionPortal nunca mezcla la empresa del token con otra — el token de A resuelve solo companyId=EMPRESA_A', async () => {
    const sesiones = [{ token: 'tok-a', company_id: EMPRESA_A, cliente_id: CLIENTE_A.id, expira_en: new Date(Date.now() + 999999).toISOString(), cerrado_en: null }];
    const db = crearDbDosEmpresas({ sesiones });

    const resuelta = await resolverSesionPortal(db, 'tok-a');
    expect(resuelta).toEqual({ companyId: EMPRESA_A, clienteId: CLIENTE_A.id });
  });

  test('un token válido de la Empresa A no resuelve nada si se busca por un token inventado de la Empresa B', async () => {
    const sesiones = [{ token: 'tok-a', company_id: EMPRESA_A, cliente_id: CLIENTE_A.id, expira_en: new Date(Date.now() + 999999).toISOString(), cerrado_en: null }];
    const db = crearDbDosEmpresas({ sesiones });

    expect(await resolverSesionPortal(db, 'tok-b-inventado')).toBeNull();
  });

  test('solicitar código con companyId de A pero correo que solo existe en B → { enviado:true } sin filtrar, y NUNCA envía correo (no revela nada de la otra empresa)', async () => {
    const db = crearDbDosEmpresas();
    const enviarCorreo = jest.fn();
    // Mismo correo en ambas empresas en este set de datos, así que se prueba
    // con un correo que en realidad no debería resolver cliente en A si A no
    // lo tuviera — aquí forzamos el caso simulando que A no tiene clientes.
    const dbSinClienteEnA = {
      from: jest.fn((tabla) => {
        if (tabla === 'clientes') return crearBuilder((f) => ({ data: f.company_id === EMPRESA_A ? null : CLIENTE_B, error: null }));
        return crearBuilder(() => ({ data: null, error: null }));
      }),
    };
    const r = await solicitarCodigoAcceso(dbSinClienteEnA, { companyId: EMPRESA_A, correo: 'juan@example.com' }, { enviarCorreo });
    expect(r).toEqual({ enviado: true });
    expect(enviarCorreo).not.toHaveBeenCalled();
  });
});
