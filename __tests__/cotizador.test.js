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
  test('calcula el total con el precio real del catálogo y la cantidad capturada', async () => {
    const supabase = crearMockSupabase({
      data: [
        { nombre: 'Uniforme de fútbol — Local', precio: 1850 },
        { nombre: 'Uniforme de básquetbol', precio: 1350 },
      ],
      error: null,
    });

    const resultado = await calcularCotizacion(supabase, COMPANY_A, {
      deporte: 'fútbol', cantidad: '100 talla 12 (niño) y las demás talla 14',
    });

    expect(resultado).toEqual({
      servicio: 'Uniforme de fútbol — Local',
      precioUnitario: 1850,
      cantidad: 100,
      total: 185000,
    });
  });

  test('sin deporte o cantidad capturados, devuelve null', async () => {
    const supabase = crearMockSupabase({ data: [], error: null });
    expect(await calcularCotizacion(supabase, COMPANY_A, { deporte: 'fútbol' })).toBeNull();
    expect(await calcularCotizacion(supabase, COMPANY_A, { cantidad: '100' })).toBeNull();
  });

  test('deporte capturado sin producto equivalente en el catálogo, devuelve null', async () => {
    const supabase = crearMockSupabase({
      data: [{ nombre: 'Uniforme de básquetbol', precio: 1350 }],
      error: null,
    });
    const resultado = await calcularCotizacion(supabase, COMPANY_A, { deporte: 'rugby', cantidad: '20' });
    expect(resultado).toBeNull();
  });

  test('cantidad sin ningún número reconocible, devuelve null', async () => {
    const supabase = crearMockSupabase({
      data: [{ nombre: 'Uniforme de fútbol — Local', precio: 1850 }],
      error: null,
    });
    const resultado = await calcularCotizacion(supabase, COMPANY_A, { deporte: 'fútbol', cantidad: 'varios' });
    expect(resultado).toBeNull();
  });

  test('catálogo vacío o con error, devuelve null', async () => {
    const supabase = crearMockSupabase({ data: [], error: null });
    const resultado = await calcularCotizacion(supabase, COMPANY_A, { deporte: 'fútbol', cantidad: '10' });
    expect(resultado).toBeNull();
  });
});
