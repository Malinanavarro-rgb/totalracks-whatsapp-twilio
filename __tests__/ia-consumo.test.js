'use strict';

const { registrarConsumoIA } = require('../modules/ia-consumo');

function crearMockDb() {
  const insertados = [];
  return {
    _insertados: insertados,
    from: jest.fn((tabla) => ({
      insert: jest.fn((filas) => { insertados.push({ tabla, filas }); return Promise.resolve({ data: filas, error: null }); }),
    })),
  };
}

describe('registrarConsumoIA()', () => {
  test('openai + modelo conocido + tokens reales → calcula costo real, nunca pendiente', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion',
      tokensEntrada: 1000, tokensSalida: 500, resultado: 'exito', latenciaMs: 850,
    });

    const fila = db._insertados[0].filas[0];
    expect(db._insertados[0].tabla).toBe('ia_consumo_logs');
    expect(fila.costo_pendiente_estimacion).toBe(false);
    expect(fila.costo_estimado_usd).toBeCloseTo((1000 / 1_000_000) * 0.15 + (500 / 1_000_000) * 0.60, 8);
    expect(fila.company_id).toBe('company-1');
    expect(fila.operacion).toBe('conversacion');
    expect(fila.resultado).toBe('exito');
    expect(fila.latencia_ms).toBe(850);
  });

  test('proveedor "none" (fallback total, FALLBACK_OUTPUT) → pendiente de estimación, nunca inventa $0 como costo confirmado', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'none', modelo: 'fallback', operacion: 'conversacion',
      tokensEntrada: 0, tokensSalida: 0, resultado: 'fallback',
    });

    const fila = db._insertados[0].filas[0];
    expect(fila.costo_pendiente_estimacion).toBe(true);
    expect(fila.costo_estimado_usd).toBeNull();
  });

  test('modelo desconocido/no catalogado de un proveedor "openai" → pendiente de estimación, nunca adivina con el precio de otro modelo', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'openai', modelo: 'gpt-6-que-no-existe-todavia', operacion: 'conversacion',
      tokensEntrada: 100, tokensSalida: 50, resultado: 'exito',
    });

    const fila = db._insertados[0].filas[0];
    expect(fila.costo_pendiente_estimacion).toBe(true);
    expect(fila.costo_estimado_usd).toBeNull();
  });

  test('proveedor distinto de "openai" (ej. "anthropic" a futuro) → pendiente de estimación hasta tener su propia tabla de precios', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'anthropic', modelo: 'claude-3', operacion: 'conversacion',
      tokensEntrada: 100, tokensSalida: 50, resultado: 'exito',
    });

    const fila = db._insertados[0].filas[0];
    expect(fila.costo_pendiente_estimacion).toBe(true);
  });

  test('tokens ausentes/no numéricos (ej. error antes de obtener respuesta) → pendiente de estimación, nunca NaN', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion',
      tokensEntrada: null, tokensSalida: null, resultado: 'error',
    });

    const fila = db._insertados[0].filas[0];
    expect(fila.costo_pendiente_estimacion).toBe(true);
    expect(fila.costo_estimado_usd).toBeNull();
    expect(fila.tokens_entrada).toBeNull();
    expect(fila.tokens_salida).toBeNull();
  });

  test('tokens en cero reales (0 y 0) también se tratan como pendiente — no hay forma de confirmar que de verdad costó $0', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion',
      tokensEntrada: 0, tokensSalida: 0, resultado: 'error',
    });

    expect(db._insertados[0].filas[0].costo_pendiente_estimacion).toBe(true);
  });

  test('nunca registra contenido de conversación ni credenciales — solo las claves de metadata esperadas', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion',
      tokensEntrada: 10, tokensSalida: 10, resultado: 'exito',
    });

    const fila = db._insertados[0].filas[0];
    const clavesPermitidas = new Set([
      'company_id', 'organization_id', 'proveedor', 'modelo', 'operacion',
      'tokens_entrada', 'tokens_salida', 'costo_estimado_usd', 'costo_pendiente_estimacion', 'resultado', 'latencia_ms',
    ]);
    Object.keys(fila).forEach((clave) => expect(clavesPermitidas.has(clave)).toBe(true));
  });

  test('alcance plataforma (sin companyId) → company_id null, nunca inventa una empresa', async () => {
    const db = crearMockDb();
    await registrarConsumoIA(db, {
      companyId: undefined, proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'modo_operador',
      tokensEntrada: 10, tokensSalida: 10, resultado: 'exito',
    });

    expect(db._insertados[0].filas[0].company_id).toBeNull();
  });

  test('nunca lanza, ni siquiera si el insert de Supabase falla', async () => {
    const db = { from: jest.fn(() => ({ insert: jest.fn().mockRejectedValue(new Error('conexión caída')) })) };
    await expect(registrarConsumoIA(db, {
      companyId: 'company-1', proveedor: 'openai', modelo: 'gpt-4o-mini', operacion: 'conversacion',
      tokensEntrada: 10, tokensSalida: 10, resultado: 'exito',
    })).resolves.toBeUndefined();
  });

  test('sin argumentos — nunca lanza', async () => {
    await expect(registrarConsumoIA(crearMockDb())).resolves.toBeUndefined();
  });
});
