/**
 * TARA Matrix™ — Tests: catalogo-tecnico.js
 * ─────────────────────────────────────────────────────────────────────────────
 * TARA especialista solar (Alina, 2026-09-15 — Nort Energy). Cubre:
 *   - sanearProducto(): nunca deja pasar campos internos de costo/margen
 *   - buscarProductosMencionados(): match por marca/modelo, score, límite
 *   - formatearParaKnowledge(): jerarquía de fuente explícita por producto
 *   - obtenerCatalogoTecnicoRelevante(): punto de entrada único
 */

'use strict';

const {
  sanearProducto,
  buscarProductosMencionados,
  formatearParaKnowledge,
  obtenerCatalogoTecnicoRelevante,
  CAMPOS_INTERNOS,
} = require('../modules/catalogo-tecnico');

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

function crearBuilder(resultado = { data: null, error: null }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    then:   (resolve) => resolve(resultado),
  };
}

function crearMockDb(resultado) {
  return { from: jest.fn(() => crearBuilder(resultado)) };
}

function productoBase(overrides = {}) {
  return {
    id: 'p1', company_id: COMPANY_A, tipo: 'inversor', marca: 'Growatt', modelo: 'MIN 4000TL-X',
    proveedor: 'SOLES', specs: { potencia_ac_nominal_kw: 4 }, ficha_tecnica_completa: true,
    activo: true, precio: 9500,
    costo_proveedor: 6000, costo_interno_nort_energy: 6500, costo_instalacion: 1200,
    costo_materiales: 300, margen: 3500,
    ...overrides,
  };
}

describe('sanearProducto()', () => {
  test('quita todos los campos internos de costo/margen', () => {
    const limpio = sanearProducto(productoBase());
    for (const campo of CAMPOS_INTERNOS) {
      expect(limpio[campo]).toBeUndefined();
    }
  });

  test('conserva los campos customer-facing (precio, specs, marca, modelo)', () => {
    const limpio = sanearProducto(productoBase());
    expect(limpio.precio).toBe(9500);
    expect(limpio.marca).toBe('Growatt');
    expect(limpio.specs).toEqual({ potencia_ac_nominal_kw: 4 });
  });
});

describe('buscarProductosMencionados()', () => {
  test('mensaje vacío → arreglo vacío, sin consultar la DB', async () => {
    const db = crearMockDb({ data: [], error: null });
    const resultado = await buscarProductosMencionados(db, COMPANY_A, '');
    expect(resultado).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
  });

  test('encuentra por marca y modelo mencionados en el texto, sin importar mayúsculas/acentos', async () => {
    const db = crearMockDb({
      data: [
        productoBase({ marca: 'LUXEN', modelo: 'LNCU-620ND' }),
        productoBase({ marca: 'Jinko Solar', modelo: 'Tiger Neo 550' }),
      ],
      error: null,
    });
    const resultado = await buscarProductosMencionados(db, COMPANY_A, 'me ofrecen paneles LUXEN lncu-620nd');
    expect(resultado).toHaveLength(1);
    expect(resultado[0].marca).toBe('LUXEN');
  });

  test('ningún producto coincide → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDb({ data: [productoBase()], error: null });
    const resultado = await buscarProductosMencionados(db, COMPANY_A, 'hola buenas tardes');
    expect(resultado).toEqual([]);
  });

  test('sin productos activos en la empresa → arreglo vacío', async () => {
    const db = crearMockDb({ data: [], error: null });
    const resultado = await buscarProductosMencionados(db, COMPANY_A, 'Growatt MIN 4000');
    expect(resultado).toEqual([]);
  });

  test('error de DB → arreglo vacío, nunca lanza', async () => {
    const db = crearMockDb({ data: null, error: new Error('boom') });
    const resultado = await buscarProductosMencionados(db, COMPANY_A, 'Growatt MIN 4000');
    expect(resultado).toEqual([]);
  });

  test('respeta el límite y prioriza mayor score', async () => {
    const db = crearMockDb({
      data: [
        productoBase({ id: 'p1', marca: 'Growatt', modelo: 'MAX 50KTL3-XL2' }),
        productoBase({ id: 'p2', marca: 'Growatt', modelo: 'MAX 60KTL3-XL2' }),
        productoBase({ id: 'p3', marca: 'Growatt', modelo: 'MAX 70KTL3-XL2' }),
      ],
      error: null,
    });
    const resultado = await buscarProductosMencionados(db, COMPANY_A, 'Growatt MAX 60KTL3-XL2', 2);
    expect(resultado).toHaveLength(2);
    expect(resultado[0].modelo).toBe('MAX 60KTL3-XL2'); // score más alto: coincide marca + modelo completo
  });

  test('resultados siempre saneados — nunca incluyen campos internos', async () => {
    const db = crearMockDb({ data: [productoBase()], error: null });
    const resultado = await buscarProductosMencionados(db, COMPANY_A, 'Growatt MIN 4000TL-X');
    expect(resultado[0].costo_proveedor).toBeUndefined();
    expect(resultado[0].margen).toBeUndefined();
  });
});

describe('formatearParaKnowledge()', () => {
  test('arreglo vacío → string vacío', () => {
    expect(formatearParaKnowledge([])).toBe('');
    expect(formatearParaKnowledge(null)).toBe('');
  });

  test('producto con ficha_tecnica_completa=true no dice "pendiente de confirmar"', () => {
    const texto = formatearParaKnowledge([sanearProducto(productoBase({ ficha_tecnica_completa: true }))]);
    expect(texto).toContain('FICHA TÉCNICA CONFIRMADA');
    expect(texto).not.toContain('PENDIENTE DE CONFIRMAR');
  });

  test('producto con ficha_tecnica_completa=false advierte explícitamente no inventar', () => {
    const texto = formatearParaKnowledge([sanearProducto(productoBase({ ficha_tecnica_completa: false }))]);
    expect(texto).toContain('PENDIENTE DE CONFIRMAR');
    expect(texto).toMatch(/no presentes estos datos como completos/i);
  });

  test('incluye marca, modelo y proveedor de cada producto', () => {
    const texto = formatearParaKnowledge([sanearProducto(productoBase())]);
    expect(texto).toContain('Growatt');
    expect(texto).toContain('MIN 4000TL-X');
    expect(texto).toContain('SOLES');
  });
});

describe('obtenerCatalogoTecnicoRelevante()', () => {
  test('sin match → string vacío (el llamador en Orchestrator no agrega nada a knowledge_base)', async () => {
    const db = crearMockDb({ data: [productoBase()], error: null });
    const resultado = await obtenerCatalogoTecnicoRelevante(db, COMPANY_A, 'hola, buenas tardes');
    expect(resultado).toBe('');
  });

  test('con match → texto formateado listo para knowledge_base', async () => {
    const db = crearMockDb({ data: [productoBase()], error: null });
    const resultado = await obtenerCatalogoTecnicoRelevante(db, COMPANY_A, 'Growatt MIN 4000TL-X');
    expect(resultado).toContain('CATÁLOGO TÉCNICO REAL');
    expect(resultado).toContain('Growatt');
  });
});
