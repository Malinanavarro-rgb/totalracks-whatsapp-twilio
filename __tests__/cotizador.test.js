'use strict';

const { calcularCotizacion } = require('../modules/cotizador');

function crearMockSupabase(resultado) {
  return {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      then:   (resolve) => resolve(resultado),
    })),
  };
}

const COMPANY_A = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('cotizador.calcularCotizacion()', () => {
  test('calcula el rango real (mín–máx del catálogo activo) × cantidad', async () => {
    const supabase = crearMockSupabase({
      data: [{ precio: 299 }, { precio: 399 }],
      error: null,
    });

    const resultado = await calcularCotizacion(supabase, COMPANY_A, {
      cantidad: '100 talla 12 (niño) y las demás talla 14',
    });

    expect(resultado).toEqual({
      cantidad: 100,
      precioMin: 299,
      precioMax: 399,
      total: 34900, // punto medio (349) × 100
      envioGratis: true,
    });
  });

  test('cantidad menor al mínimo de envío gratis, envioGratis es false', async () => {
    const supabase = crearMockSupabase({ data: [{ precio: 299 }, { precio: 399 }], error: null });
    const resultado = await calcularCotizacion(supabase, COMPANY_A, { cantidad: '5' });
    expect(resultado.envioGratis).toBe(false);
  });

  test('sin cantidad capturada, devuelve null', async () => {
    const supabase = crearMockSupabase({ data: [{ precio: 299 }], error: null });
    expect(await calcularCotizacion(supabase, COMPANY_A, {})).toBeNull();
  });

  test('cantidad sin ningún número reconocible, devuelve null', async () => {
    const supabase = crearMockSupabase({ data: [{ precio: 299 }], error: null });
    expect(await calcularCotizacion(supabase, COMPANY_A, { cantidad: 'varios' })).toBeNull();
  });

  test('catálogo vacío o con error, devuelve null', async () => {
    const supabase = crearMockSupabase({ data: [], error: null });
    expect(await calcularCotizacion(supabase, COMPANY_A, { cantidad: '10' })).toBeNull();
  });

  test('un solo producto activo: min y max son el mismo precio', async () => {
    const supabase = crearMockSupabase({ data: [{ precio: 350 }], error: null });
    const resultado = await calcularCotizacion(supabase, COMPANY_A, { cantidad: '20' });
    expect(resultado).toEqual({ cantidad: 20, precioMin: 350, precioMax: 350, total: 7000, envioGratis: true });
  });
});
