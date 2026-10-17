/**
 * TARA Matrix™ — modules/cotizaciones.js::validarRequisitosTecnicos()
 * ─────────────────────────────────────────────────────────────────────────────
 * Prioridad 2 de la estabilización de ingeniería solar (Alina, 2026-10-17,
 * tras el hallazgo real de la cotización 85/cálculo 192a6cfe): "¿están
 * presentes los campos?" (camposTecnicosFaltantes, ver orchestrator.test.js)
 * NO basta — una ubicación presente pero irresoluble ("en mty") producía un
 * cálculo real y bloqueado de todas formas. Esta suite reproduce el caso
 * real de Roberto Gzz y confirma que la nueva validación distingue
 * presente/válido/resoluble reutilizando resolverHSP/_normalizarUbicacion
 * (los mismos que usa el motor real, nunca una copia).
 *
 * @module __tests__/validar-requisitos-tecnicos.test
 */

'use strict';

const { validarRequisitosTecnicos } = require('../modules/cotizaciones');

/**
 * Fake mínimo de Supabase, solo para `irradiacion_regional` — reproduce
 * fielmente las 2 formas reales en que el código la consulta:
 * _normalizarUbicacion() trae TODAS las filas (sin filtro, `await` directo
 * sin .maybeSingle()) y las compara en JS; resolverHSP() filtra por
 * nombre_ubicacion exacto con .maybeSingle(). Un mock genérico "por tabla"
 * no distingue estas 2 formas — este fake sí, con datos reales en memoria.
 */
function fakeSupabaseIrradiacion(filas) {
  return {
    from(tabla) {
      if (tabla !== 'irradiacion_regional') {
        throw new Error(`fakeSupabaseIrradiacion: tabla no soportada en esta prueba: ${tabla}`);
      }
      let filtroNombre;
      const api = {
        select() { return api; },
        eq(campo, valor) { if (campo === 'nombre_ubicacion') filtroNombre = valor; return api; },
        then(resolve) { resolve({ data: filas, error: null }); },
        async maybeSingle() {
          const fila = filas.find(f => f.nombre_ubicacion === filtroNombre);
          return { data: fila || null, error: null };
        },
      };
      return api;
    },
  };
}

const CATALOGO_REAL = [
  { nombre_ubicacion: 'Monterrey, Nuevo León', hsp_promedio_anual: 5.5 },
  { nombre_ubicacion: 'Guadalajara, Jalisco', hsp_promedio_anual: 5.3 },
];

describe('validarRequisitosTecnicos() — Prioridad 2 (2026-10-17)', () => {
  // ACTUALIZADO (P3, 2026-10-17): antes de P3, "en mty" NO resolvía — era
  // justo el caso real del incidente. P3 agrega el reconocimiento de
  // abreviaturas inequívocas conocidas (ABREVIATURAS_CIUDAD_CONOCIDAS,
  // modules/cotizaciones.js) — "mty" ahora sí resuelve a "Monterrey,
  // Nuevo León" cuando esa ciudad está en el catálogo real, como aquí.
  // Este es el comportamiento NUEVO deseado, no una regresión.
  test('CASO REAL (post-P3): ubicación "en mty" ahora SÍ resuelve a Monterrey vía abreviatura conocida → suficientePreliminar=true', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, {
      ubicacion: 'en mty', consumo_mensual_kwh: '3000', pct_cobertura_deseado: '90',
    });

    expect(resultado.suficientePreliminar).toBe(true);
    expect(resultado.campos.ubicacion).toEqual({ presente: true, resoluble: true, valorResuelto: 'Monterrey, Nuevo León' });
  });

  test('ubicación que SÍ resuelve ("Monterrey, Nuevo León" exacto) + consumo + cobertura → suficientePreliminar=true', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, {
      ubicacion: 'Monterrey, Nuevo León', consumo_mensual_kwh: '3000', pct_cobertura_deseado: '90',
    });

    expect(resultado.suficientePreliminar).toBe(true);
    expect(resultado.camposFaltantes).toEqual([]);
    expect(resultado.campos.ubicacion).toEqual({ presente: true, resoluble: true, valorResuelto: 'Monterrey, Nuevo León' });
  });

  test('ubicación ausente por completo → falta, nunca se inventa ni se intenta resolver', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { consumo_mensual_kwh: '3000', pct_cobertura_deseado: '90' });

    expect(resultado.suficientePreliminar).toBe(false);
    expect(resultado.campos.ubicacion).toEqual({ presente: false, resoluble: false, valorResuelto: null });
  });

  test('sin consumo_mensual_kwh ni historial_consumo_kwh → falta', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'Monterrey, Nuevo León', pct_cobertura_deseado: '90' });

    expect(resultado.suficientePreliminar).toBe(false);
    expect(resultado.camposFaltantes).toContain('consumo_mensual_kwh');
  });

  test('historial_consumo_kwh (≥12 meses) cuenta como alternativa válida a consumo_mensual_kwh — campos.consumo.fuente="historial"', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const historial12Meses = Array.from({ length: 12 }, () => 400); // _historialConsumoOrNull espera números planos, no {mes, kwh}
    const resultado = await validarRequisitosTecnicos(supabase, {
      ubicacion: 'Monterrey, Nuevo León', historial_consumo_kwh: historial12Meses, pct_cobertura_deseado: '90',
    });

    expect(resultado.suficientePreliminar).toBe(true);
    expect(resultado.campos.consumo).toEqual({ presente: true, valido: true, fuente: 'historial' });
  });

  test('pct_cobertura_deseado ausente → falta', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'Monterrey, Nuevo León', consumo_mensual_kwh: '3000' });

    expect(resultado.suficientePreliminar).toBe(false);
    expect(resultado.camposFaltantes).toContain('pct_cobertura_deseado');
  });

  test('tipo_alimentacion y voltaje_sitio AUSENTES no afectan suficientePreliminar — no son indispensables para un predimensionamiento preliminar', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, {
      ubicacion: 'Monterrey, Nuevo León', consumo_mensual_kwh: '3000', pct_cobertura_deseado: '90',
      // sin tipo_alimentacion ni voltaje_sitio
    });

    expect(resultado.suficientePreliminar).toBe(true);
    expect(resultado.camposFaltantes).toEqual([]);
  });

  test('capturedFields vacío ({}) → faltan los 3 requisitos indispensables, nunca lanza', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, {});

    expect(resultado.suficientePreliminar).toBe(false);
    expect(resultado.camposFaltantes.sort()).toEqual(['consumo_mensual_kwh', 'pct_cobertura_deseado', 'ubicacion']);
  });
});

describe('Prioridad 3 — normalización inteligente de ubicaciones (2026-10-17)', () => {
  // Catálogo REAL de producción auditado el 2026-10-17 — solo 2 ciudades.
  // Usar el catálogo real (no uno de prueba más grande) para que estas
  // pruebas reflejen exactamente lo que Lucía puede/no puede resolver HOY.
  const CATALOGO_PRODUCCION_REAL = [
    { nombre_ubicacion: 'Hermosillo, Sonora', hsp_promedio_anual: 6.2 },
    { nombre_ubicacion: 'Monterrey, Nuevo León', hsp_promedio_anual: 5.5 },
  ];

  test('"Estoy en Mty" → resuelve a Monterrey, Nuevo León (abreviatura inequívoca)', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'Estoy en Mty', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: true, valorResuelto: 'Monterrey, Nuevo León' });
  });

  test('"Es para Monterrey" → resuelve directo (ya funcionaba antes de P3, sin regresión)', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'Es para Monterrey', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: true, valorResuelto: 'Monterrey, Nuevo León' });
  });

  test('"En Hmo" → resuelve a Hermosillo, Sonora (abreviatura inequívoca, segunda ciudad real del catálogo)', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'En Hmo', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: true, valorResuelto: 'Hermosillo, Sonora' });
  });

  // Hallazgo de la auditoría (no un defecto de esta corrección): el
  // catálogo real HOY no tiene San Pedro ni Ciudad Victoria — ninguna
  // normalización de texto puede resolverlos sin inventar un HSP para una
  // ciudad que no está en los datos. Comportamiento correcto: no resuelve.
  test('"En San Pedro, NL" → NO resuelve (la ciudad no está en el catálogo real — vacío de datos, no de normalización)', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'En San Pedro, NL', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: false, valorResuelto: null });
  });

  test('"En Ciudad Victoria" → NO resuelve (la ciudad no está en el catálogo real)', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'En Ciudad Victoria', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: false, valorResuelto: null });
  });

  test('una abreviatura NO debe matchear como substring de otra palabra (límite de palabra completa)', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL);
    // "administy" contiene la letras "mty" pero no es la abreviatura "mty" como palabra — no debe resolver.
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'vivo en administy', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: false });
  });

  test('abreviatura de una ciudad que NO está en el catálogo (ej. "gdl") → no resuelve, nunca inventa el dato', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL); // Guadalajara no está en el catálogo real
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: 'estoy en gdl', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: false, valorResuelto: null });
  });
});

describe('Prioridad 8 (2026-10-17) — resolución de Ciudad Victoria/Tampico con catálogo ampliado (simulado, sin insertar nada real)', () => {
  // Catálogo simulado: Monterrey/Hermosillo (reales, ya en producción) +
  // Ciudad Victoria/Tampico como si YA estuvieran insertados — para probar
  // la resolución de nombres sin tocar el catálogo real todavía.
  const CATALOGO_AMPLIADO_SIMULADO = [
    { nombre_ubicacion: 'Monterrey, Nuevo León', hsp_promedio_anual: 5.5 },
    { nombre_ubicacion: 'Hermosillo, Sonora', hsp_promedio_anual: 6.0 },
    { nombre_ubicacion: 'Ciudad Victoria, Tamaulipas', hsp_promedio_anual: 5.51 },
    { nombre_ubicacion: 'Tampico, Tamaulipas', hsp_promedio_anual: 5.23 },
  ];

  test.each([
    ['Ciudad Victoria', 'Ciudad Victoria, Tamaulipas'],
    ['Cd. Victoria', 'Ciudad Victoria, Tamaulipas'],
    ['Cd Victoria', 'Ciudad Victoria, Tamaulipas'],
    ['Victoria, Tamaulipas', 'Ciudad Victoria, Tamaulipas'],
    ['victoria tamaulipas', 'Ciudad Victoria, Tamaulipas'],
    ['Tampico', 'Tampico, Tamaulipas'],
  ])('"%s" → resuelve a "%s"', async (texto, esperado) => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_AMPLIADO_SIMULADO);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: texto, consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: true, valorResuelto: esperado });
  });

  test.each([
    ['Victoria'], ['vivo en Victoria'], ['soy de victoria'], ['Victoria es mi nombre'],
  ])('"%s" (sin contexto geográfico) → NUNCA resuelve automáticamente, aunque Ciudad Victoria exista en el catálogo', async (texto) => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_AMPLIADO_SIMULADO);
    const resultado = await validarRequisitosTecnicos(supabase, { ubicacion: texto, consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(resultado.campos.ubicacion).toMatchObject({ resoluble: false, valorResuelto: null });
  });

  test('regresión: Monterrey y Hermosillo siguen resolviendo exactamente igual con el catálogo ampliado', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_AMPLIADO_SIMULADO);
    const rMty = await validarRequisitosTecnicos(supabase, { ubicacion: 'estoy en mty', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(rMty.campos.ubicacion.valorResuelto).toBe('Monterrey, Nuevo León');
    const rHmo = await validarRequisitosTecnicos(supabase, { ubicacion: 'en hmo', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(rHmo.campos.ubicacion.valorResuelto).toBe('Hermosillo, Sonora');
  });

  test('dimensionamiento con consumo real: con ubicación de Ciudad Victoria resuelta + consumo + cobertura → suficientePreliminar=true', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_AMPLIADO_SIMULADO);
    const resultado = await validarRequisitosTecnicos(supabase, {
      ubicacion: 'Ciudad Victoria, Tamaulipas', consumo_mensual_kwh: '600', pct_cobertura_deseado: '90',
    });
    expect(resultado.suficientePreliminar).toBe(true);
  });

  test('con el catálogo de PRODUCCIÓN real (solo Monterrey/Hermosillo, Ciudad Victoria/Tampico todavía NO insertados) → "Ciudad Victoria"/"Tampico" NO resuelven', async () => {
    const CATALOGO_PRODUCCION_REAL_HOY = [
      { nombre_ubicacion: 'Hermosillo, Sonora', hsp_promedio_anual: 6.2 },
      { nombre_ubicacion: 'Monterrey, Nuevo León', hsp_promedio_anual: 5.5 },
    ];
    const supabase = fakeSupabaseIrradiacion(CATALOGO_PRODUCCION_REAL_HOY);
    const rVictoria = await validarRequisitosTecnicos(supabase, { ubicacion: 'Ciudad Victoria', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(rVictoria.campos.ubicacion).toMatchObject({ resoluble: false, valorResuelto: null });
    const rTampico = await validarRequisitosTecnicos(supabase, { ubicacion: 'Tampico', consumo_mensual_kwh: '500', pct_cobertura_deseado: '90' });
    expect(rTampico.campos.ubicacion).toMatchObject({ resoluble: false, valorResuelto: null });
  });
});
