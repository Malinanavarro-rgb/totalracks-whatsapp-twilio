'use strict';

const {
  mapearCapturedFieldsAInfoTecnica, correrCotizacionDesdeWorkflow, puedeEnviarCotizacion, autorizarPrecioFinal,
} = require('../modules/cotizaciones');
const {
  asociarSiHaySesionDeCotizacionActiva, reatarAdjuntosACotizacion,
} = require('../modules/cotizacion-adjuntos');

// ─── Mock builder (mismo molde que __tests__/workflow-admin.test.js) ──────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    or:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(...resultados) {
  let idx = 0;
  const db = { from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })) };
  return db;
}

/**
 * Mock por NOMBRE de tabla en vez de por orden de llamada — correrYGuardarCalculo
 * (Fase 1) dispara varias consultas en paralelo (Promise.all de
 * resolverParametrosPanelesSolares), cuyo orden exacto no es determinista.
 * Cada tabla siempre responde lo mismo sin importar cuántas veces se
 * consulte — suficiente para llegar a un estado_calculo determinista sin
 * tener que adivinar la secuencia interna de Fase 1.
 */
function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    workflow_sessions: { data: null, error: null },
    cotizaciones: { data: { id: 42, company_id: 'company-aaaa' }, error: null },
    cotizacion_adjuntos: { data: [], error: null },
    parametros_ingenieria: { data: { valor: 1, organismo_fuente: 'test', anio_fuente: 2026 }, error: null },
    productos: { data: null, error: null },
    irradiacion_regional: { data: null, error: null },
    calculos_ingenieria: { data: { id: 'calc-1', estado_calculo: 'bloqueado', version: 1, alertas: [{ tipo: 'consumo_faltante', severidad: 'bloqueo', mensaje: 'x' }] }, error: null },
    paquetes_solares: { data: null, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

const COMPANY_A = 'company-aaaa';

// ─────────────────────────────────────────────────────────────────────────

describe('mapearCapturedFieldsAInfoTecnica()', () => {
  test('mapea todos los campos numéricos correctamente', () => {
    const { infoTecnica } = mapearCapturedFieldsAInfoTecnica({
      ubicacion: 'Monterrey, NL', consumo_mensual_kwh: '600', importe_promedio_recibo: '2400',
      pct_cobertura_deseado: '90', tipo_alimentacion: 'monofásica', voltaje_sitio: '220', area_disponible_m2: '40',
    });
    expect(infoTecnica).toEqual({
      ubicacion: 'Monterrey, NL', consumoMensualKwh: 600, importePromedioRecibo: 2400,
      pctCoberturaDeseado: 0.9, tipoAlimentacion: 'monofasica', voltajeSitio: 220, areaDisponibleM2: 40,
      incluyeCargosFijos: false,
    });
  });

  test('pct_cobertura_deseado > 1 se interpreta como porcentaje (÷100)', () => {
    const { infoTecnica } = mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: '80' });
    expect(infoTecnica.pctCoberturaDeseado).toBe(0.8);
  });

  test('pct_cobertura_deseado ya en [0,1] se respeta tal cual (no se divide dos veces)', () => {
    const { infoTecnica } = mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: '0.8' });
    expect(infoTecnica.pctCoberturaDeseado).toBe(0.8);
  });

  test('tipo_alimentacion reconoce trifásica/bifásica/monofásica por palabra clave', () => {
    expect(mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'es trifásica' }).infoTecnica.tipoAlimentacion).toBe('trifasica');
    expect(mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'bifasica creo' }).infoTecnica.tipoAlimentacion).toBe('bifasica');
    expect(mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'es mi casa' }).infoTecnica.tipoAlimentacion).toBe('monofasica');
  });

  test('tipo_alimentacion no reconocible → null, nunca adivina', () => {
    expect(mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'no sé qué es eso' }).infoTecnica.tipoAlimentacion).toBeNull();
  });

  test('campo numérico no parseable → null, nunca NaN', () => {
    const { infoTecnica } = mapearCapturedFieldsAInfoTecnica({ consumo_mensual_kwh: 'no sé' });
    expect(infoTecnica.consumoMensualKwh).toBeNull();
    expect(Number.isNaN(infoTecnica.consumoMensualKwh)).toBe(false);
  });

  test('captured_fields vacío → todo null/false, no lanza', () => {
    const { infoTecnica, temperaturaMinSitio } = mapearCapturedFieldsAInfoTecnica({});
    expect(infoTecnica.consumoMensualKwh).toBeNull();
    expect(infoTecnica.incluyeCargosFijos).toBe(false);
    expect(temperaturaMinSitio).toBe(5);
  });
});

describe('puedeEnviarCotizacion()', () => {
  test('rechaza si ingenieria_validada_para_cotizar_en está vacío', async () => {
    const db = crearMockDb({ data: { ingenieria_validada_para_cotizar_en: null }, error: null });
    const resultado = await puedeEnviarCotizacion(db, 1);
    expect(resultado).toEqual({ puede: false, motivo: expect.stringContaining('validada') });
  });

  test('acepta si ingenieria_validada_para_cotizar_en tiene fecha', async () => {
    const db = crearMockDb({ data: { ingenieria_validada_para_cotizar_en: '2026-08-04T10:00:00Z' }, error: null });
    const resultado = await puedeEnviarCotizacion(db, 1);
    expect(resultado).toEqual({ puede: true, motivo: null });
  });

  test('cotización inexistente → rechaza con motivo claro', async () => {
    const db = crearMockDb({ data: null, error: null });
    const resultado = await puedeEnviarCotizacion(db, 999);
    expect(resultado.puede).toBe(false);
    expect(resultado.motivo).toMatch(/no encontrada/i);
  });
});

describe('correrCotizacionDesdeWorkflow()', () => {
  test('crea la cotización, corre el motor y envía seguimiento de BLOQUEO cuando el resultado viene bloqueado', async () => {
    const enviarProactivo = jest.fn().mockResolvedValue();
    const db = crearMockDbPorTabla();

    const resultado = await correrCotizacionDesdeWorkflow(db, {
      companyId: COMPANY_A, clienteId: 7, capturedFields: { ubicacion: 'Monterrey' },
      destinatario: '+528100000000', enviarProactivo,
    });

    expect(resultado.estado_calculo).toBe('bloqueado');
    expect(db.from).toHaveBeenCalledWith('cotizaciones');
    expect(enviarProactivo).toHaveBeenCalledTimes(1);
    const [dbArg, companyArg, destinatarioArg, texto] = enviarProactivo.mock.calls[0];
    expect(companyArg).toBe(COMPANY_A);
    expect(destinatarioArg).toBe('+528100000000');
    expect(texto).toMatch(/especialista/i); // mensaje de bloqueo, no el de "listo"
  });

  test('envía seguimiento de ÉXITO (texto distinto) cuando el resultado viene completo', async () => {
    const enviarProactivo = jest.fn().mockResolvedValue();
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: { id: 'calc-2', estado_calculo: 'completo', version: 1, alertas: [] }, error: null },
    });

    await correrCotizacionDesdeWorkflow(db, {
      companyId: COMPANY_A, clienteId: 7, capturedFields: {}, destinatario: '+528100000000', enviarProactivo,
    });

    const texto = enviarProactivo.mock.calls[0][3];
    expect(texto).toMatch(/predimensionamiento inicial/i);
    expect(texto).not.toMatch(/especialista/i);
  });

  test('sin destinatario, no intenta enviar seguimiento (no lanza)', async () => {
    const enviarProactivo = jest.fn();
    const db = crearMockDbPorTabla();

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {}, enviarProactivo });
    expect(enviarProactivo).not.toHaveBeenCalled();
  });

  test('con sesión completada existente, re-ata los adjuntos huérfanos a la cotización nueva', async () => {
    const db = crearMockDbPorTabla({
      workflow_sessions: { data: { id: 'sesion-9' }, error: null },
      cotizacion_adjuntos: { data: [{ id: 'adj-1' }], error: null },
    });

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} });

    expect(db.from).toHaveBeenCalledWith('cotizacion_adjuntos');
  });

  test('si el proveedor de seguimiento falla, no rompe la corrida (el cálculo ya se guardó)', async () => {
    const enviarProactivo = jest.fn().mockRejectedValue(new Error('Twilio caído'));
    const db = crearMockDbPorTabla();

    await expect(correrCotizacionDesdeWorkflow(db, {
      companyId: COMPANY_A, clienteId: 7, capturedFields: {}, destinatario: '+528100000000', enviarProactivo,
    })).resolves.toMatchObject({ estado_calculo: 'bloqueado' });
  });

  test('estado_calculo bloqueado (sin numero_paneles en resultados) → NUNCA consulta paquetes_solares', async () => {
    const db = crearMockDbPorTabla(); // default: bloqueado, sin resultados.numero_paneles
    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} });
    expect(db.from).not.toHaveBeenCalledWith('paquetes_solares');
  });

  test('con numero_paneles técnico y un paquete que alcanza → guarda paquete_recomendado_id y el precio como SNAPSHOT', async () => {
    let payloadUpdateCotizacion = null;
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: { id: 'calc-1', estado_calculo: 'completo', version: 1, alertas: [], resultados: { numero_paneles: { valor: 7 } } }, error: null },
      paquetes_solares: { data: { id: 'pkg-8', cantidad_paneles: 8, precio_contado: 64000 }, error: null },
    });
    // Interceptar específicamente el UPDATE a cotizaciones para capturar el payload
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'cotizaciones') {
        const updateOriginal = builder.update;
        builder.update = jest.fn((payload) => { payloadUpdateCotizacion = payload; return updateOriginal.call(builder, payload); });
      }
      return builder;
    });

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} });

    expect(db.from).toHaveBeenCalledWith('paquetes_solares');
    expect(payloadUpdateCotizacion).toEqual({ paquete_recomendado_id: 'pkg-8', precio_paquete_recomendado: 64000 });
  });

  test('con numero_paneles técnico pero NINGÚN paquete alcanza → no actualiza cotizaciones con paquete (queda null)', async () => {
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: { id: 'calc-1', estado_calculo: 'completo', version: 1, alertas: [], resultados: { numero_paneles: { valor: 30 } } }, error: null },
      paquetes_solares: { data: null, error: null }, // ningún paquete del catálogo alcanza
    });
    let seLlamoUpdateConPaquete = false;
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'cotizaciones') {
        const updateOriginal = builder.update;
        builder.update = jest.fn((payload) => { if (payload.paquete_recomendado_id !== undefined) seLlamoUpdateConPaquete = true; return updateOriginal.call(builder, payload); });
      }
      return builder;
    });

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} });
    expect(seLlamoUpdateConPaquete).toBe(false);
  });
});

describe('autorizarPrecioFinal()', () => {
  test('sin precioFinal explícito, usa precio_paquete_recomendado', async () => {
    const db = crearMockDb(
      { data: { precio_paquete_recomendado: 64000 }, error: null },
      { data: { id: 1, precio_final_autorizado: 64000 }, error: null },
    );
    const resultado = await autorizarPrecioFinal(db, { cotizacionId: 1, usuarioId: 'u1' });
    const builderUpdate = db.from.mock.results[1].value;
    expect(builderUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ precio_final_autorizado: 64000, precio_final_autorizado_por: 'u1' }));
    expect(resultado.precio_final_autorizado).toBe(64000);
  });

  test('con precioFinal explícito, lo usa en vez del recomendado (el asesor ajustó)', async () => {
    const db = crearMockDb(
      { data: { precio_paquete_recomendado: 64000 }, error: null },
      { data: { id: 1, precio_final_autorizado: 60000 }, error: null },
    );
    await autorizarPrecioFinal(db, { cotizacionId: 1, usuarioId: 'u1', precioFinal: 60000 });
    const builderUpdate = db.from.mock.results[1].value;
    expect(builderUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ precio_final_autorizado: 60000 }));
  });

  test('cotización inexistente → 404', async () => {
    const db = crearMockDb({ data: null, error: null });
    await expect(autorizarPrecioFinal(db, { cotizacionId: 999, usuarioId: 'u1' })).rejects.toMatchObject({ status: 404 });
  });

  test('sin precio_paquete_recomendado NI precioFinal explícito → 400, nunca autoriza sin monto', async () => {
    const db = crearMockDb({ data: { precio_paquete_recomendado: null }, error: null });
    await expect(autorizarPrecioFinal(db, { cotizacionId: 1, usuarioId: 'u1' })).rejects.toMatchObject({ status: 400 });
  });

  test('siempre registra quién y cuándo autorizó (nunca queda implícito)', async () => {
    const db = crearMockDb(
      { data: { precio_paquete_recomendado: 64000 }, error: null },
      { data: { id: 1 }, error: null },
    );
    await autorizarPrecioFinal(db, { cotizacionId: 1, usuarioId: 'usuario-42' });
    const builderUpdate = db.from.mock.results[1].value;
    const payload = builderUpdate.update.mock.calls[0][0];
    expect(payload.precio_final_autorizado_por).toBe('usuario-42');
    expect(payload.precio_final_autorizado_en).toEqual(expect.any(String));
  });
});

describe('cotizacion-adjuntos — asociarSiHaySesionDeCotizacionActiva()', () => {
  test('sin sesión activa → no asocia, devuelve null y nunca consulta workflows ni inserta', async () => {
    const db = crearMockDb({ data: null, error: null });
    const resultado = await asociarSiHaySesionDeCotizacionActiva(db, { companyId: COMPANY_A, clienteId: 1, mensajeId: 'msg-1' });
    expect(resultado).toBeNull();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  test('sesión activa pero de otro workflow (solicitud_visita_tecnica) → no asocia y nunca intenta el INSERT', async () => {
    const db = crearMockDb(
      { data: { id: 'sesion-1', workflow_id: 'wf-visita' }, error: null },
      { data: { trigger_value: 'solicitud_visita_tecnica' }, error: null },
    );
    const resultado = await asociarSiHaySesionDeCotizacionActiva(db, { companyId: COMPANY_A, clienteId: 1, mensajeId: 'msg-1' });
    expect(resultado).toBeNull();
    // No basta con que el resultado sea null (un INSERT mockeado con data:null
    // también daría null) — hay que confirmar que el guard cortó ANTES del
    // tercer .from() (el insert a cotizacion_adjuntos), solo 2 consultas.
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  test('sesión activa del workflow de cotización directa → asocia y devuelve la fila', async () => {
    const db = crearMockDb(
      { data: { id: 'sesion-1', workflow_id: 'wf-cotiza' }, error: null },
      { data: { trigger_value: 'solicitud_cotizacion' }, error: null },
      { data: { id: 'ca-1', adjunto_id: 'msg-1' }, error: null },
    );
    const resultado = await asociarSiHaySesionDeCotizacionActiva(db, { companyId: COMPANY_A, clienteId: 1, mensajeId: 'msg-1', tipoDocumento: 'recibo_cfe' });
    expect(resultado).toEqual({ id: 'ca-1', adjunto_id: 'msg-1' });
  });

  test('reintento de webhook (mismo mensaje) → error 23505 se ignora, devuelve null sin lanzar', async () => {
    const db = crearMockDb(
      { data: { id: 'sesion-1', workflow_id: 'wf-cotiza' }, error: null },
      { data: { trigger_value: 'solicitud_cotizacion' }, error: null },
      { data: null, error: { code: '23505', message: 'duplicate key' } },
    );
    const resultado = await asociarSiHaySesionDeCotizacionActiva(db, { companyId: COMPANY_A, clienteId: 1, mensajeId: 'msg-1' });
    expect(resultado).toBeNull();
  });
});

describe('cotizacion-adjuntos — reatarAdjuntosACotizacion()', () => {
  test('sin workflowSessionId → no hace nada, devuelve 0', async () => {
    const db = crearMockDb();
    expect(await reatarAdjuntosACotizacion(db, { workflowSessionId: null, cotizacionId: 1 })).toBe(0);
  });

  test('re-ata los adjuntos huérfanos de la sesión y cuenta cuántos', async () => {
    const db = crearMockDb({ data: [{ id: 'ca-1' }, { id: 'ca-2' }], error: null });
    const resultado = await reatarAdjuntosACotizacion(db, { workflowSessionId: 'sesion-1', cotizacionId: 42 });
    expect(resultado).toBe(2);
    const builder = db.from.mock.results[0].value;
    expect(builder.update).toHaveBeenCalledWith({ cotizacion_id: 42 });
    expect(builder.is).toHaveBeenCalledWith('cotizacion_id', null);
  });
});
