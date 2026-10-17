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
  test('REPRODUCCIÓN DEL CASO REAL: ubicación presente ("en mty") pero irresoluble → suficientePreliminar=false, pide ubicación', async () => {
    const supabase = fakeSupabaseIrradiacion(CATALOGO_REAL);
    const resultado = await validarRequisitosTecnicos(supabase, {
      ubicacion: 'en mty', consumo_mensual_kwh: '3000', pct_cobertura_deseado: '90',
    });

    expect(resultado.suficientePreliminar).toBe(false);
    expect(resultado.camposFaltantes).toContain('ubicacion');
    expect(resultado.campos.ubicacion).toEqual({ presente: true, resoluble: false, valorResuelto: null });
    // consumo y cobertura SÍ eran válidos — no deben aparecer como faltantes
    expect(resultado.camposFaltantes).not.toContain('consumo_mensual_kwh');
    expect(resultado.camposFaltantes).not.toContain('pct_cobertura_deseado');
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
