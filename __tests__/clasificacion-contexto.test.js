/**
 * TARA Matrix™ — Tests: catálogo compartido de clasificación de contexto (ADR-010)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre que el catálogo es una única fuente de verdad y que prompt-builder.js
 * + openai-provider.js realmente la consumen (no una copia paralela).
 */

'use strict';

const {
  CATEGORIAS_CLASIFICACION_CONTEXTO,
  VALORES_CLASIFICACION_CONTEXTO,
  CLASIFICACION_POR_DEFECTO,
} = require('../modules/clasificacion-contexto');

describe('modules/clasificacion-contexto', () => {
  test('expone exactamente 8 categorías', () => {
    expect(CATEGORIAS_CLASIFICACION_CONTEXTO).toHaveLength(8);
  });

  test('cada categoría tiene valor y descripción no vacíos', () => {
    for (const c of CATEGORIAS_CLASIFICACION_CONTEXTO) {
      expect(typeof c.valor).toBe('string');
      expect(c.valor.length).toBeGreaterThan(0);
      expect(typeof c.descripcion).toBe('string');
      expect(c.descripcion.length).toBeGreaterThan(0);
    }
  });

  test('VALORES_CLASIFICACION_CONTEXTO contiene exactamente los valores de CATEGORIAS_CLASIFICACION_CONTEXTO', () => {
    const esperados = CATEGORIAS_CLASIFICACION_CONTEXTO.map(c => c.valor);
    expect([...VALORES_CLASIFICACION_CONTEXTO].sort()).toEqual([...esperados].sort());
  });

  test('CLASIFICACION_POR_DEFECTO nunca es "prospecto"', () => {
    expect(CLASIFICACION_POR_DEFECTO).not.toBe('prospecto');
  });

  test('CLASIFICACION_POR_DEFECTO está dentro del catálogo válido', () => {
    expect(VALORES_CLASIFICACION_CONTEXTO.has(CLASIFICACION_POR_DEFECTO)).toBe(true);
  });
});

describe('Centralización — prompt-builder.js y openai-provider.js consumen el mismo catálogo', () => {
  test('bloque_schema_json() incluye exactamente las mismas 8 categorías del catálogo compartido', () => {
    const { bloque_schema_json } = require('../modules/prompt-builder');
    const result = bloque_schema_json({ empresa: {}, knowledge: {}, cliente: {} });
    for (const c of CATEGORIAS_CLASIFICACION_CONTEXTO) {
      expect(result).toContain(c.valor);
    }
  });

  test('bloque_clasificacion_contexto() incluye exactamente las mismas 8 categorías del catálogo compartido', () => {
    const { bloque_clasificacion_contexto } = require('../modules/prompt-builder');
    const result = bloque_clasificacion_contexto();
    for (const c of CATEGORIAS_CLASIFICACION_CONTEXTO) {
      expect(result).toContain(`"${c.valor}"`);
    }
  });

  test('openai-provider.js valida contra el mismo Set exportado por el catálogo compartido (misma referencia, no una copia)', () => {
    const { CLASIFICACIONES_VALIDAS } = require('../adapters/ai/openai-provider');
    expect(CLASIFICACIONES_VALIDAS).toBe(VALORES_CLASIFICACION_CONTEXTO);
  });

  test('agregar una categoría al catálogo compartido la propaga automáticamente a ambos consumidores', () => {
    jest.resetModules();
    jest.doMock('../modules/clasificacion-contexto', () => ({
      CATEGORIAS_CLASIFICACION_CONTEXTO: [
        { valor: 'categoria_de_prueba', descripcion: 'una categoría agregada solo para este test.' },
      ],
      VALORES_CLASIFICACION_CONTEXTO: new Set(['categoria_de_prueba']),
      CLASIFICACION_POR_DEFECTO: 'categoria_de_prueba',
    }));

    const { bloque_schema_json } = require('../modules/prompt-builder');
    const { CLASIFICACIONES_VALIDAS } = require('../adapters/ai/openai-provider');

    expect(bloque_schema_json({ empresa: {}, knowledge: {}, cliente: {} })).toContain('categoria_de_prueba');
    expect(CLASIFICACIONES_VALIDAS.has('categoria_de_prueba')).toBe(true);

    jest.dontMock('../modules/clasificacion-contexto');
    jest.resetModules();
  });
});
