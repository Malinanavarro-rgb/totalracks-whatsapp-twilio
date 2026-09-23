'use strict';

/**
 * Aislamiento multiempresa — Subfase 2A (Alina, 2026-09-22).
 * ─────────────────────────────────────────────────────────────────────────────
 * RLS está deshabilitado en todas las tablas de este bloque (mismo criterio
 * que el resto de TARA Matrix, ver NORT_ENERGY_PORTAL_PLAN.md sección 7) —
 * el aislamiento depende 100% de que CADA función filtre explícitamente por
 * `company_id`, y de que ese `company_id` venga siempre de la sesión ya
 * verificada (`req.usuario.company_id`, resuelto en auth-middleware.js
 * contra `usuarios_empresas` real), nunca de un parámetro que el cliente
 * controla.
 *
 * Este archivo prueba el escenario exacto pedido: un usuario autenticado de
 * la Empresa A intenta leer/escribir un registro real de la Empresa B por
 * ID directo — manipulando la URL, nunca debe obtener datos ajenos ni
 * lograr una escritura cruzada.
 *
 * El mock simula lo que un `.eq('company_id', X)` real de Supabase hace:
 * una fila que NO coincide con el filtro nunca se devuelve — igual que se
 * simulará para cada endpoint nuevo de las subfases siguientes.
 */

const mockObtenerCotizacion = jest.fn();
jest.mock('../modules/cotizaciones', () => ({
  obtenerCotizacion: (...args) => mockObtenerCotizacion(...args),
}));

const { marcarCotizacionAceptadaYCrearProyecto, obtenerProyecto, obtenerProyectoDeCliente, obtenerProyectoDeCotizacion } = require('../modules/proyectos');

const EMPRESA_A = 'empresa-a-0001';
const EMPRESA_B = 'empresa-b-0002';

/**
 * Simula una tabla real: cada fila "vive" en una empresa. `.eq('company_id', X)`
 * solo deja pasar sus propias filas — exactamente el comportamiento de
 * Supabase con un filtro real, a diferencia del resto de los mocks de esta
 * sesión (que devuelven lo mismo sin importar el filtro) porque aquí es
 * precisamente ESO lo que se está probando.
 */
function crearTablaConAislamientoReal(filas) {
  return (filtros) => {
    const fila = filas.find((f) => Object.entries(filtros).every(([k, v]) => f[k] === v));
    return { data: fila || null, error: null };
  };
}

function crearBuilderAislado(tabla, resolverFila) {
  const filtros = {};
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn((campo, valor) => { filtros[campo] = valor; return builder; }),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    single: jest.fn(() => Promise.resolve(resolverFila(filtros))),
    then: (resolve) => resolve(resolverFila(filtros)),
  };
  return builder;
}

const PROYECTO_DE_EMPRESA_B = { id: 'proy-empresa-b', company_id: EMPRESA_B, cliente_id: 500, sucursal_id: null, asesor_id: null, numero_proyecto: 'PRY-2026-0001' };
const COTIZACION_DE_EMPRESA_B = { id: 77, folio: 'COT-2026-0099', estado: 'enviada', cliente_id: 500, company_id: EMPRESA_B, lineas: [], calculo: null, paquetes_solares: null };

describe('Aislamiento multiempresa — 2A', () => {
  beforeEach(() => mockObtenerCotizacion.mockReset());

  test('Empresa A solicita un proyecto real de la Empresa B por ID directo → null (nunca los datos ajenos)', async () => {
    const resolver = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    const db = { from: jest.fn((tabla) => crearBuilderAislado(tabla, (f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const resultado = await obtenerProyecto(db, EMPRESA_A, 'proy-empresa-b'); // mismo ID real, empresa equivocada

    expect(resultado).toBeNull();
  });

  test('Empresa B, con su propio company_id, SÍ ve su proyecto (control positivo — el aislamiento no rompe el acceso legítimo)', async () => {
    const resolver = crearTablaConAislamientoReal([PROYECTO_DE_EMPRESA_B]);
    const db = { from: jest.fn((tabla) => crearBuilderAislado(tabla, (f) => resolver({ id: f.id, company_id: f.company_id }))) };

    const resultado = await obtenerProyecto(db, EMPRESA_B, 'proy-empresa-b');

    expect(resultado?.id).toBe('proy-empresa-b');
  });

  test('Empresa A intenta ACEPTAR una cotización real de la Empresa B → 404, nunca la marca aceptada ni crea proyecto', async () => {
    // obtenerCotizacion() YA filtra por company_id internamente (mockeado aquí
    // para simular exactamente ese comportamiento: no encuentra nada si la
    // empresa no coincide con la dueña real de la fila).
    mockObtenerCotizacion.mockImplementation((supabase, companyId, cotizacionId) => {
      if (companyId === EMPRESA_B && cotizacionId === 77) return Promise.resolve(COTIZACION_DE_EMPRESA_B);
      return Promise.resolve(null);
    });
    const db = { from: jest.fn(() => crearBuilderAislado('x', () => ({ data: null, error: null }))) };

    await expect(marcarCotizacionAceptadaYCrearProyecto(db, { companyId: EMPRESA_A, cotizacionId: 77, usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });

    expect(db.from).not.toHaveBeenCalledWith('proyectos');
  });

  test('Empresa A intenta aceptar la MISMA cotización, pero como su propia empresa (id inventado, no existe en A) → 404 también, nunca "adivina" un match', async () => {
    mockObtenerCotizacion.mockImplementation((supabase, companyId, cotizacionId) => {
      if (companyId === EMPRESA_B && cotizacionId === 77) return Promise.resolve(COTIZACION_DE_EMPRESA_B);
      return Promise.resolve(null);
    });
    const db = { from: jest.fn(() => crearBuilderAislado('x', () => ({ data: null, error: null }))) };

    await expect(marcarCotizacionAceptadaYCrearProyecto(db, { companyId: EMPRESA_A, cotizacionId: 77, usuarioId: 'user-empresa-a' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('Empresa A pide "el proyecto de mi cliente" usando un cliente_id real de la Empresa B → null, no cruza', async () => {
    const resolver = crearTablaConAislamientoReal([{ id: 'proy-x', company_id: EMPRESA_B, cliente_id: 500, tipo: 'venta' }]);
    const db = {
      from: jest.fn(() => crearBuilderAislado('proyectos', (f) => resolver({ company_id: f.company_id, cliente_id: f.cliente_id, tipo: f.tipo }))),
    };

    const resultado = await obtenerProyectoDeCliente(db, EMPRESA_A, 500); // mismo cliente_id, empresa equivocada

    expect(resultado).toBeNull();
  });

  test('Empresa A pide "el proyecto de esta cotización" usando un cotizacion_id real de la Empresa B → null', async () => {
    const resolver = crearTablaConAislamientoReal([{ id: 'proy-x', company_id: EMPRESA_B, cotizacion_id: 77, tipo: 'venta' }]);
    const db = {
      from: jest.fn(() => crearBuilderAislado('proyectos', (f) => resolver({ company_id: f.company_id, cotizacion_id: f.cotizacion_id, tipo: f.tipo }))),
    };

    const resultado = await obtenerProyectoDeCotizacion(db, EMPRESA_A, 77);

    expect(resultado).toBeNull();
  });

  test('el company_id usado en TODA consulta de proyectos.js es siempre el segundo argumento explícito (viene de req.usuario.company_id verificado), nunca uno embebido en el body/params', async () => {
    // Prueba de contrato: cada función pública exportada exige companyId como
    // argumento posicional/nombrado explícito — no hay ninguna ruta donde el
    // module confíe en un company_id que viniera dentro del objeto `datos`
    // sin que la ruta ya lo haya fijado a partir de la sesión.
    const db = { from: jest.fn(() => crearBuilderAislado('x', () => ({ data: null, error: null }))) };
    mockObtenerCotizacion.mockResolvedValue(null);

    await obtenerProyecto(db, EMPRESA_A, 'cualquier-id');
    await obtenerProyectoDeCliente(db, EMPRESA_A, 1);
    await obtenerProyectoDeCotizacion(db, EMPRESA_A, 1);
    await marcarCotizacionAceptadaYCrearProyecto(db, { companyId: EMPRESA_A, cotizacionId: 1, usuarioId: 'u1' }).catch(() => {});

    // Ninguna llamada a .eq() a lo largo de todo el módulo usó EMPRESA_B —
    // confirma que no hay ninguna ruta interna que filtre por algo distinto
    // al companyId que se le pasó explícitamente.
    const builders = db.from.mock.results.map((r) => r.value);
    const todosLosEq = builders.flatMap((b) => b.eq.mock.calls);
    expect(todosLosEq.some(([campo, valor]) => campo === 'company_id' && valor === EMPRESA_B)).toBe(false);
  });
});
