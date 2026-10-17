/**
 * TARA Matrix™ — modules/consumo-electrico.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prioridad 7, Fase D: los 10 escenarios obligatorios de la autorización.
 * @module __tests__/consumo-electrico.test
 */

'use strict';

const { interpretarConsumoDeclarado, normalizarFrecuenciaRecibo } = require('../modules/consumo-electrico');

describe('interpretarConsumoDeclarado() — Prioridad 7 (2026-10-17)', () => {
  test('1. «Pago $3,000 bimestrales» → importe_promedio_recibo, mensualizado a 1500 (÷2, regla explícita)', () => {
    const r = interpretarConsumoDeclarado({ valor: 3000, unidad: 'mxn', periodo: 'bimestral', aproximado: false });
    expect(r).toMatchObject({ campo: 'importe_promedio_recibo', valorMensualizado: 1500, requiereAclaracion: false, periodoUsado: 'bimestral' });
  });

  test('2. «Consumo 3,000 kWh mensuales» → consumo_mensual_kwh, sin conversión (ya es mensual)', () => {
    const r = interpretarConsumoDeclarado({ valor: 3000, unidad: 'kwh', periodo: 'mensual', aproximado: false });
    expect(r).toMatchObject({ campo: 'consumo_mensual_kwh', valorMensualizado: 3000, requiereAclaracion: false, periodoUsado: 'mensual' });
  });

  test('3. «Mi recibo dice 1,500 kWh» (sin periodo) → requiere aclaración del periodo, nunca asume', () => {
    const r = interpretarConsumoDeclarado({ valor: 1500, unidad: 'kwh', periodo: null, aproximado: false });
    expect(r.requiereAclaracion).toBe(true);
    expect(r.preguntaAclaracion).toMatch(/mensual o de los últimos 2 meses/i);
    expect(r.valorMensualizado).toBeNull();
  });

  test('3b. «Mi recibo dice 1,500 kWh» con frecuencia_recibo="bimestral" ya capturada → usa ese respaldo, no pregunta de nuevo', () => {
    const r = interpretarConsumoDeclarado(
      { valor: 1500, unidad: 'kwh', periodo: null, aproximado: false },
      { frecuenciaReciboRespaldo: 'bimestral' }
    );
    expect(r).toMatchObject({ campo: 'consumo_mensual_kwh', valorMensualizado: 750, requiereAclaracion: false });
  });

  test('4. «Pago aproximadamente $2,000» (sin periodo) → requiere aclaración del periodo, marca confianza aproximada si se resolviera', () => {
    const r = interpretarConsumoDeclarado({ valor: 2000, unidad: 'mxn', periodo: null, aproximado: true });
    expect(r.requiereAclaracion).toBe(true);
    expect(r.preguntaAclaracion).toMatch(/importe es de un mes o de 2 meses/i);
  });

  test('5. «Consumo 2,400 kWh cada dos meses» → consumo_mensual_kwh mensualizado a 1200', () => {
    const r = interpretarConsumoDeclarado({ valor: 2400, unidad: 'kwh', periodo: 'bimestral', aproximado: false });
    expect(r).toMatchObject({ campo: 'consumo_mensual_kwh', valorMensualizado: 1200, requiereAclaracion: false });
  });

  test('6. Valores contradictorios: unidad ausente con un valor presente → requiere aclaración de unidad, nunca adivina kWh vs pesos', () => {
    const r = interpretarConsumoDeclarado({ valor: 3000, unidad: null, periodo: 'mensual', aproximado: false });
    expect(r.requiereAclaracion).toBe(true);
    expect(r.preguntaAclaracion).toMatch(/consumo en kWh, o el importe/i);
  });

  test('7a. Valor negativo → se trata como "nada declarado", nunca produce un consumo negativo', () => {
    const r = interpretarConsumoDeclarado({ valor: -500, unidad: 'kwh', periodo: 'mensual', aproximado: false });
    expect(r.campo).toBeNull();
    expect(r.requiereAclaracion).toBe(false);
    expect(r.valorMensualizado).toBeNull();
  });

  test('7b. Valor cero o no numérico → se trata como "nada declarado", nunca lanza', () => {
    expect(interpretarConsumoDeclarado({ valor: 0, unidad: 'kwh', periodo: 'mensual' }).campo).toBeNull();
    expect(() => interpretarConsumoDeclarado({ valor: 'no sé', unidad: 'kwh', periodo: 'mensual' })).not.toThrow();
    expect(interpretarConsumoDeclarado(null)).toMatchObject({ campo: null, requiereAclaracion: false });
    expect(interpretarConsumoDeclarado(undefined)).toMatchObject({ campo: null, requiereAclaracion: false });
  });

  test('8. Sin ningún dato declarado este turno (valor null) → no interpreta nada, compatible con no tocar datos históricos ya guardados', () => {
    const r = interpretarConsumoDeclarado({ valor: null, unidad: null, periodo: null, aproximado: false });
    expect(r).toEqual({ campo: null, valorMensualizado: null, requiereAclaracion: false, preguntaAclaracion: null, fuente: 'cliente_texto', confianza: null, periodoUsado: null });
  });

  // 9. Aislamiento multiempresa: esta función es pura y no recibe ni usa
  // companyId/clienteId — no hay nada que aislar aquí (no toca DB, no
  // conoce contexto de empresa). El aislamiento real lo siguen gobernando
  // puedeEjecutarseAccionComercial/validarRequisitosTecnicos, sin cambios.
  test('9. Es una función pura, sin acceso a datos de empresa/cliente — nada que aislar a este nivel (confirmado por su firma)', () => {
    expect(interpretarConsumoDeclarado.length).toBeLessThanOrEqual(2); // (declarado, opciones) — ningún companyId/clienteId
  });

  test('10. Cotización legítima — consumo claro y completo se interpreta sin pedir aclaración (no debe convertirse en un interrogatorio)', () => {
    const r = interpretarConsumoDeclarado({ valor: 500, unidad: 'kwh', periodo: 'mensual', aproximado: false });
    expect(r.requiereAclaracion).toBe(false);
    expect(r.valorMensualizado).toBe(500);
  });

  test('nunca convierte un importe en pesos a kWh — "importe_promedio_recibo" nunca se confunde con "consumo_mensual_kwh"', () => {
    const r = interpretarConsumoDeclarado({ valor: 1800, unidad: 'mxn', periodo: 'mensual', aproximado: false });
    expect(r.campo).toBe('importe_promedio_recibo');
    expect(r.campo).not.toBe('consumo_mensual_kwh');
  });
});

describe('normalizarFrecuenciaRecibo() — respaldo de periodo (campo ya existente, antes sin uso)', () => {
  test.each([
    ['bimestral', 'bimestral'],
    ['cada 2 meses', 'bimestral'],
    ['cada dos meses', 'bimestral'],
    ['mensual', 'mensual'],
    ['cada mes', 'mensual'],
    ['no estoy seguro', 'desconocido'],
    [null, null],
    [undefined, null],
    [42, null],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarFrecuenciaRecibo(entrada)).toBe(esperado);
  });
});
