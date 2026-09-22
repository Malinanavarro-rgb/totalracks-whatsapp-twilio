'use strict';

const mockGenerarYEnviarCotizacion = jest.fn().mockResolvedValue({ estado: 'enviado', message_id: 'msg-1' });
jest.mock('../modules/cotizacion-pdf', () => ({
  generarYEnviarCotizacion: (...args) => mockGenerarYEnviarCotizacion(...args),
}));

const {
  mapearCapturedFieldsAInfoTecnica, correrCotizacionDesdeWorkflow, puedeEnviarCotizacion, autorizarPrecioFinal,
  generarFolio, listarCotizaciones, obtenerCotizacion, correrCalculoCotizacionManual,
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
    neq:         jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
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
  const db = {
    from: jest.fn(() => crearBuilder(resultados[idx++] ?? { data: null, error: null })),
    rpc: jest.fn().mockResolvedValue({ data: 1, error: null }),
  };
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
    // Folio/oportunidad/hilo (Alina, 2026-08-10 — Panel de Cotizaciones):
    // resueltos en paralelo al crear la cotización, ver
    // correrCotizacionDesdeWorkflow(). oportunidades/hilos por defecto sin
    // match (cliente sin oportunidad abierta ni conversación) — mismo
    // criterio honesto de Fase 1: nunca inventar una relación.
    oportunidades: { data: null, error: null },
    hilos: { data: null, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return {
    from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })),
    rpc: jest.fn().mockResolvedValue({ data: 1, error: null }),
  };
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
      ubicacion: 'Monterrey, NL', consumoMensualKwh: 600, historialConsumo: null, importePromedioRecibo: 2400,
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

  // Bugs reales de piloto (Alina, 2026-08-10) — ver commit de este fix
  describe('pct_cobertura_deseado — afirmación al 90% ofrecido por el bot', () => {
    test('"sí"/"me gustaría"/variantes → 0.9, aceptó el default que el bot ya ofreció', () => {
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: 'si me gustaria' }).infoTecnica.pctCoberturaDeseado).toBe(0.9);
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: 'sí' }).infoTecnica.pctCoberturaDeseado).toBe(0.9);
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: 'está bien' }).infoTecnica.pctCoberturaDeseado).toBe(0.9);
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: 'claro' }).infoTecnica.pctCoberturaDeseado).toBe(0.9);
    });

    test('un número explícito sigue ganando sobre cualquier heurística de afirmación', () => {
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: '80' }).infoTecnica.pctCoberturaDeseado).toBe(0.8);
    });

    test('texto ambiguo o "no" → sigue null, nunca adivina fuera del "sí" claro', () => {
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: 'no lo sé' }).infoTecnica.pctCoberturaDeseado).toBeNull();
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: 'no' }).infoTecnica.pctCoberturaDeseado).toBeNull();
      expect(mapearCapturedFieldsAInfoTecnica({ pct_cobertura_deseado: '' }).infoTecnica.pctCoberturaDeseado).toBeNull();
    });
  });

  describe('voltaje_sitio — default 220V para casas (monofásica) sin dato explícito', () => {
    test('monofásica + "no lo sé" → 220V, el default que el propio bot ofreció', () => {
      const { infoTecnica } = mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'es mi casa', voltaje_sitio: 'no lo sé' });
      expect(infoTecnica.voltajeSitio).toBe(220);
    });

    test('voltaje explícito del cliente siempre gana sobre el default', () => {
      const { infoTecnica } = mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'casa', voltaje_sitio: '110' });
      expect(infoTecnica.voltajeSitio).toBe(110);
    });

    test('trifásica/bifásica sin voltaje explícito → sigue null, no hay default seguro para esos casos', () => {
      expect(mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'trifasica' }).infoTecnica.voltajeSitio).toBeNull();
      expect(mapearCapturedFieldsAInfoTecnica({ tipo_alimentacion: 'bifasica' }).infoTecnica.voltajeSitio).toBeNull();
    });

    test('tipo de alimentación desconocido → sin default, sigue null', () => {
      expect(mapearCapturedFieldsAInfoTecnica({ voltaje_sitio: 'no lo sé' }).infoTecnica.voltajeSitio).toBeNull();
    });
  });

  describe('historial_consumo_kwh — recibo CFE (Alina, 2026-08-10)', () => {
    test('12 valores → se mapea a [{kwh}], forma que exige calcularConsumoAnual()', () => {
      const doce = Array.from({ length: 12 }, (_, i) => 100 + i);
      const { infoTecnica } = mapearCapturedFieldsAInfoTecnica({ historial_consumo_kwh: doce });
      expect(infoTecnica.historialConsumo).toHaveLength(12);
      expect(infoTecnica.historialConsumo[0]).toEqual({ kwh: 100 });
    });

    test('menos de 12 valores → null, el motor no acepta un historial parcial como si fuera completo', () => {
      const seis = [100, 100, 110, 110, 120, 120];
      expect(mapearCapturedFieldsAInfoTecnica({ historial_consumo_kwh: seis }).infoTecnica.historialConsumo).toBeNull();
    });

    test('sin historial_consumo_kwh → null, no lanza', () => {
      expect(mapearCapturedFieldsAInfoTecnica({}).infoTecnica.historialConsumo).toBeNull();
    });
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

  test('descuento excede el límite y no ha sido autorizado → rechaza (ver modules/cotizacion-descuento.js)', async () => {
    const db = crearMockDb({ data: { ingenieria_validada_para_cotizar_en: '2026-08-04T10:00:00Z', limite_descuento_excedido: true, descuento_autorizado_por: null }, error: null });
    const resultado = await puedeEnviarCotizacion(db, 1);
    expect(resultado.puede).toBe(false);
    expect(resultado.motivo).toMatch(/descuento/i);
  });

  test('descuento excede el límite pero YA fue autorizado → acepta', async () => {
    const db = crearMockDb({ data: { ingenieria_validada_para_cotizar_en: '2026-08-04T10:00:00Z', limite_descuento_excedido: true, descuento_autorizado_por: 'user-1' }, error: null });
    const resultado = await puedeEnviarCotizacion(db, 1);
    expect(resultado).toEqual({ puede: true, motivo: null });
  });

  test('descuento dentro del límite (limite_descuento_excedido: false) → acepta aunque no tenga autorizador explícito', async () => {
    const db = crearMockDb({ data: { ingenieria_validada_para_cotizar_en: '2026-08-04T10:00:00Z', limite_descuento_excedido: false, descuento_autorizado_por: null }, error: null });
    const resultado = await puedeEnviarCotizacion(db, 1);
    expect(resultado).toEqual({ puede: true, motivo: null });
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

describe('correrCalculoCotizacionManual()', () => {
  test('normaliza infoTecnica snake_case a camelCase antes de guardarla (bug real 2026-09-17: antes se pasaba cruda y el motor nunca la entendía, siempre salía bloqueado en silencio)', async () => {
    let payloadInsertCalculo = null;
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'calculos_ingenieria') {
        const insertOriginal = builder.insert;
        builder.insert = jest.fn((payload) => { payloadInsertCalculo = payload[0]; return insertOriginal.call(builder, payload); });
      }
      return builder;
    });

    await correrCalculoCotizacionManual(db, {
      companyId: COMPANY_A, cotizacionId: 42,
      infoTecnica: {
        ubicacion: 'Monterrey, NL', consumo_mensual_kwh: '600', importe_promedio_recibo: '2400',
        pct_cobertura_deseado: '90', tipo_alimentacion: 'monofásica', voltaje_sitio: '220', area_disponible_m2: '40',
      },
    });

    expect(payloadInsertCalculo.datos_entrada).toMatchObject({
      consumoMensualKwh: 600, pctCoberturaDeseado: 0.9, tipoAlimentacion: 'monofasica', voltajeSitio: 220,
    });
  });

  test('pasa panelSeleccionadoId al motor (antes de este fix nunca se elegía panel, así que nunca podía dimensionar)', async () => {
    let idConsultado = null;
    const db = crearMockDbPorTabla({
      productos: { data: { id: 'panel-1', tipo: 'panel_solar' }, error: null },
    });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'productos') {
        const eqOriginal = builder.eq;
        builder.eq = jest.fn((campo, valor) => {
          if (campo === 'id') idConsultado = valor;
          return eqOriginal.call(builder, campo, valor);
        });
      }
      return builder;
    });

    await correrCalculoCotizacionManual(db, {
      companyId: COMPANY_A, cotizacionId: 42, infoTecnica: { ubicacion: 'Monterrey' }, panelSeleccionadoId: 'panel-1',
    });

    expect(idConsultado).toBe('panel-1');
  });

  test('sin panelSeleccionadoId, no filtra productos por id (el motor queda sin panel, no revienta)', async () => {
    let idConsultado = 'sin-tocar';
    const db = crearMockDbPorTabla();
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'productos') {
        const eqOriginal = builder.eq;
        builder.eq = jest.fn((campo, valor) => {
          if (campo === 'id') idConsultado = valor;
          return eqOriginal.call(builder, campo, valor);
        });
      }
      return builder;
    });

    await correrCalculoCotizacionManual(db, { companyId: COMPANY_A, cotizacionId: 42, infoTecnica: { ubicacion: 'Monterrey' } });
    expect(idConsultado).toBe('sin-tocar'); // nunca se llamó .eq('id', ...) — solo el catálogo de inversores por tipo/company_id
  });

  test('con numero_paneles técnico y un paquete que alcanza, guarda paquete_recomendado_id y regresa el paquete', async () => {
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: { id: 'calc-1', estado_calculo: 'completo', version: 1, alertas: [], resultados: { numero_paneles: { valor: 7 } } }, error: null },
      paquetes_solares: { data: { id: 'pkg-8', cantidad_paneles: 8, precio_contado: 64000 }, error: null },
    });

    const { paquete } = await correrCalculoCotizacionManual(db, {
      companyId: COMPANY_A, cotizacionId: 42, infoTecnica: { ubicacion: 'Monterrey' }, panelSeleccionadoId: 'panel-1',
    });

    expect(paquete).toEqual({ id: 'pkg-8', cantidad_paneles: 8, precio_contado: 64000 });
    expect(db.from).toHaveBeenCalledWith('paquetes_solares');
  });

  test('calculo bloqueado (sin numero_paneles) → nunca consulta paquetes_solares y regresa paquete null', async () => {
    const db = crearMockDbPorTabla(); // default: bloqueado, sin resultados.numero_paneles
    const { paquete } = await correrCalculoCotizacionManual(db, { companyId: COMPANY_A, cotizacionId: 42, infoTecnica: { ubicacion: 'Monterrey' } });
    expect(paquete).toBeNull();
    expect(db.from).not.toHaveBeenCalledWith('paquetes_solares');
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

// ─────────────────────────────────────────────────────────────────────────
// Panel de Cotizaciones (Alina, 2026-08-10)
// ─────────────────────────────────────────────────────────────────────────

describe('generarFolio()', () => {
  test('llama al RPC atómico con el company_id y formatea COT-{año}-{consecutivo con padding}', async () => {
    const anioActual = new Date().getFullYear();
    const db = { rpc: jest.fn().mockResolvedValue({ data: 7, error: null }) };
    const folio = await generarFolio(db, 'company-aaaa');
    expect(db.rpc).toHaveBeenCalledWith('incrementar_folio_cotizacion', { p_company_id: 'company-aaaa' });
    expect(folio).toBe(`COT-${anioActual}-0007`);
  });

  test('consecutivo grande no se trunca por el padding (5 dígitos se mantienen)', async () => {
    const db = { rpc: jest.fn().mockResolvedValue({ data: 12345, error: null }) };
    const folio = await generarFolio(db, 'company-aaaa');
    expect(folio).toMatch(/-12345$/);
  });

  test('error del RPC se propaga (nunca genera un folio silenciosamente inválido)', async () => {
    const db = { rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) };
    await expect(generarFolio(db, 'company-aaaa')).rejects.toThrow(/boom/);
  });
});

describe('correrCotizacionDesdeWorkflow() — normalización de ubicación (bug real de piloto, 2026-08-10)', () => {
  test('"estoy en monterrey" se normaliza a "Monterrey, Nuevo León" (nombre exacto del catálogo) antes de guardar el cálculo', async () => {
    let datosEntradaGuardados = null;
    const db = crearMockDbPorTabla({
      irradiacion_regional: { data: [{ nombre_ubicacion: 'Monterrey, Nuevo León', hsp_promedio_anual: 5.5 }], error: null },
    });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'calculos_ingenieria') {
        const insertOriginal = builder.insert;
        builder.insert = jest.fn((payload) => { datosEntradaGuardados = payload[0].datos_entrada; return insertOriginal.call(builder, payload); });
      }
      return builder;
    });

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: { ubicacion: 'estoy en monterrey' } });

    expect(datosEntradaGuardados.ubicacion).toBe('Monterrey, Nuevo León');
  });

  test('sin match en el catálogo → deja el texto original tal cual, nunca inventa una ciudad', async () => {
    let datosEntradaGuardados = null;
    const db = crearMockDbPorTabla({
      irradiacion_regional: { data: [{ nombre_ubicacion: 'Monterrey, Nuevo León', hsp_promedio_anual: 5.5 }], error: null },
    });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'calculos_ingenieria') {
        const insertOriginal = builder.insert;
        builder.insert = jest.fn((payload) => { datosEntradaGuardados = payload[0].datos_entrada; return insertOriginal.call(builder, payload); });
      }
      return builder;
    });

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: { ubicacion: 'vivo en Querétaro' } });

    expect(datosEntradaGuardados.ubicacion).toBe('vivo en Querétaro');
  });

  test('sin ubicación capturada → sigue null (no la inventa por tener un catálogo con opciones)', async () => {
    let datosEntradaGuardados = null;
    const db = crearMockDbPorTabla({
      irradiacion_regional: { data: [{ nombre_ubicacion: 'Monterrey, Nuevo León', hsp_promedio_anual: 5.5 }], error: null },
    });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'calculos_ingenieria') {
        const insertOriginal = builder.insert;
        builder.insert = jest.fn((payload) => { datosEntradaGuardados = payload[0].datos_entrada; return insertOriginal.call(builder, payload); });
      }
      return builder;
    });

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} });
    expect(datosEntradaGuardados.ubicacion).toBeNull();
  });
});

describe('correrCotizacionDesdeWorkflow() — folio/oportunidad/hilo en el INSERT', () => {
  test('el INSERT a cotizaciones incluye folio, oportunidad_id y hilo_id resueltos', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla({
      oportunidades: { data: { id: 'op-1' }, error: null },
      hilos: { data: { id: 'hilo-1' }, error: null },
    });
    db.rpc = jest.fn().mockResolvedValue({ data: 3, error: null });
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'cotizaciones') {
        const insertOriginal = builder.insert;
        builder.insert = jest.fn((payload) => { payloadInsert = payload[0]; return insertOriginal.call(builder, payload); });
      }
      return builder;
    });

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} });

    const anioActual = new Date().getFullYear();
    expect(payloadInsert).toMatchObject({
      folio: `COT-${anioActual}-0003`, oportunidad_id: 'op-1', hilo_id: 'hilo-1',
    });
  });

  test('sin oportunidad ni hilo (cliente nuevo, ej. datos de prueba) → ambos quedan null, no lanza', async () => {
    let payloadInsert = null;
    const db = crearMockDbPorTabla(); // oportunidades/hilos: sin match por default
    const fromOriginal = db.from;
    db.from = jest.fn((tabla) => {
      const builder = fromOriginal(tabla);
      if (tabla === 'cotizaciones') {
        const insertOriginal = builder.insert;
        builder.insert = jest.fn((payload) => { payloadInsert = payload[0]; return insertOriginal.call(builder, payload); });
      }
      return builder;
    });

    await expect(correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} })).resolves.toBeDefined();
    expect(payloadInsert.oportunidad_id).toBeNull();
    expect(payloadInsert.hilo_id).toBeNull();
  });
});

describe('correrCotizacionDesdeWorkflow() — cierre automático y envío de PDF (recibo CFE, 2026-08-10)', () => {
  const COTIZACION_CON_CALCULO = { id: 42, company_id: COMPANY_A, calculo_ingenieria_id: 'calc-1', paquete_recomendado_id: 'pkg-8', precio_paquete_recomendado: 64000 };
  const CALCULO_COMPLETO_CON_PAQUETE = { id: 'calc-1', estado_calculo: 'completo', version: 1, alertas: [], resultados: { numero_paneles: { valor: 7 } } };
  const PAQUETE_QUE_ALCANZA = { id: 'pkg-8', nombre: 'Paquete 8 paneles', cantidad_paneles: 8, precio_contado: 64000 };

  beforeEach(() => {
    mockGenerarYEnviarCotizacion.mockClear();
  });

  test('cálculo completo + paquete que alcanza + destinatario → valida, aplica a líneas, y envía el PDF automáticamente', async () => {
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: CALCULO_COMPLETO_CON_PAQUETE, error: null },
      paquetes_solares: { data: PAQUETE_QUE_ALCANZA, error: null },
      cotizaciones: { data: COTIZACION_CON_CALCULO, error: null },
    });
    const enviarProactivo = jest.fn().mockResolvedValue();

    await correrCotizacionDesdeWorkflow(db, {
      companyId: COMPANY_A, clienteId: 7, capturedFields: {}, destinatario: '+528100000000', enviarProactivo,
    });

    expect(mockGenerarYEnviarCotizacion).toHaveBeenCalledWith(db, { cotizacionId: 42, destinatario: '+528100000000' });
    const textos = enviarProactivo.mock.calls.map(c => c[3]);
    expect(textos.some(t => t.includes('cotización preliminar'))).toBe(true);
    // El mensaje genérico de "un asesor lo va a revisar" NO debe mandarse — ya se mandó el PDF real
    expect(textos.some(t => t.includes('especialista') || t.includes('asesores'))).toBe(false);
  });

  test('cálculo bloqueado → NO intenta el cierre automático, solo el seguimiento genérico de siempre', async () => {
    const db = crearMockDbPorTabla(); // default: bloqueado
    const enviarProactivo = jest.fn().mockResolvedValue();
    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {}, destinatario: '+528100000000', enviarProactivo });
    expect(mockGenerarYEnviarCotizacion).not.toHaveBeenCalled();
  });

  test('completo pero SIN paquete que alcance (necesita uno a la medida) → no auto-envía, requiere revisión humana', async () => {
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: { ...CALCULO_COMPLETO_CON_PAQUETE, resultados: { numero_paneles: { valor: 30 } } }, error: null },
      paquetes_solares: { data: null, error: null }, // ningún paquete del catálogo alcanza
    });
    const enviarProactivo = jest.fn().mockResolvedValue();
    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {}, destinatario: '+528100000000', enviarProactivo });
    expect(mockGenerarYEnviarCotizacion).not.toHaveBeenCalled();
  });

  test('sin destinatario → no intenta el cierre automático (no hay a quién enviar el PDF)', async () => {
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: CALCULO_COMPLETO_CON_PAQUETE, error: null },
      paquetes_solares: { data: PAQUETE_QUE_ALCANZA, error: null },
    });
    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {} });
    expect(mockGenerarYEnviarCotizacion).not.toHaveBeenCalled();
  });

  test('el envío del PDF resulta "fallido" (sin lanzar) → cae al seguimiento genérico en vez de quedarse callado', async () => {
    mockGenerarYEnviarCotizacion.mockResolvedValueOnce({ estado: 'fallido', error_proveedor: 'boom' });
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: CALCULO_COMPLETO_CON_PAQUETE, error: null },
      paquetes_solares: { data: PAQUETE_QUE_ALCANZA, error: null },
      cotizaciones: { data: COTIZACION_CON_CALCULO, error: null },
    });
    const enviarProactivo = jest.fn().mockResolvedValue();

    await correrCotizacionDesdeWorkflow(db, { companyId: COMPANY_A, clienteId: 7, capturedFields: {}, destinatario: '+528100000000', enviarProactivo });

    const textos = enviarProactivo.mock.calls.map(c => c[3]);
    expect(textos.some(t => t.includes('predimensionamiento inicial'))).toBe(true);
  });

  test('marcarIngenieriaValidada falla (ej. cotización sin calculo_ingenieria_id todavía) → no rompe la corrida, cae al seguimiento genérico', async () => {
    const db = crearMockDbPorTabla({
      calculos_ingenieria: { data: CALCULO_COMPLETO_CON_PAQUETE, error: null },
      paquetes_solares: { data: PAQUETE_QUE_ALCANZA, error: null },
      // cotizaciones usa el default de crearMockDbPorTabla (sin calculo_ingenieria_id) → marcarIngenieriaValidada lanza 409
    });
    const enviarProactivo = jest.fn().mockResolvedValue();

    await expect(correrCotizacionDesdeWorkflow(db, {
      companyId: COMPANY_A, clienteId: 7, capturedFields: {}, destinatario: '+528100000000', enviarProactivo,
    })).resolves.toBeDefined();

    expect(mockGenerarYEnviarCotizacion).not.toHaveBeenCalled();
    expect(enviarProactivo).toHaveBeenCalled(); // el seguimiento genérico sí se manda
  });
});

describe('listarCotizaciones()', () => {
  test('cotización con paquete_recomendado_id → producto es el nombre del paquete, sin consultar líneas', async () => {
    const db = {
      from: jest.fn((tabla) => crearBuilder(
        tabla === 'cotizaciones'
          ? { data: [{ id: 1, folio: 'COT-2026-0001', paquete_recomendado_id: 'pkg-1', paquetes_solares: { nombre: 'Paquete 12 paneles' } }], error: null }
          : { data: [], error: null }
      )),
    };
    const resultado = await listarCotizaciones(db, COMPANY_A);
    expect(resultado[0].producto).toBe('Paquete 12 paneles');
    expect(db.from).not.toHaveBeenCalledWith('cotizacion_lineas');
  });

  test('cotización sin paquete → producto viene de la primera línea (por orden)', async () => {
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'cotizaciones') {
          return crearBuilder({ data: [{ id: 2, folio: 'COT-2026-0002', paquete_recomendado_id: null, paquetes_solares: null }], error: null });
        }
        if (tabla === 'cotizacion_lineas') {
          // El mock no simula el ORDER BY real de Postgres — se entrega ya
          // en el orden que la query pediría (orden ascendente), igual que
          // el resto de los tests de este archivo hacen con .order().
          return crearBuilder({
            data: [
              { cotizacion_id: 2, descripcion: 'Primera línea', concepto_libre: 'Concepto libre 1', orden: 0 },
              { cotizacion_id: 2, descripcion: 'Segunda línea', concepto_libre: null, orden: 1 },
            ], error: null,
          });
        }
        return crearBuilder({ data: [], error: null });
      }),
    };
    const resultado = await listarCotizaciones(db, COMPANY_A);
    expect(resultado[0].producto).toBe('Concepto libre 1'); // la de orden 0, prioriza concepto_libre sobre descripcion
  });

  test('error de DB → arreglo vacío, nunca lanza (el panel no debe caerse por esto)', async () => {
    const db = { from: jest.fn(() => crearBuilder({ data: null, error: { message: 'boom' } })) };
    expect(await listarCotizaciones(db, COMPANY_A)).toEqual([]);
  });

  // Expediente Solar 360° (2026-09-17) — tab "Cotizaciones" del expediente.
  describe('filtro por clienteId', () => {
    test('con clienteId: filtra por cliente_id además de company_id', async () => {
      const builder = crearBuilder({ data: [], error: null });
      const db = { from: jest.fn(() => builder) };
      await listarCotizaciones(db, COMPANY_A, undefined, { clienteId: 42 });
      expect(builder.eq).toHaveBeenCalledWith('cliente_id', 42);
    });

    test('sin clienteId: no agrega el filtro (comportamiento previo intacto)', async () => {
      const builder = crearBuilder({ data: [], error: null });
      const db = { from: jest.fn(() => builder) };
      await listarCotizaciones(db, COMPANY_A);
      expect(builder.eq).not.toHaveBeenCalledWith('cliente_id', expect.anything());
    });
  });
});

describe('obtenerCotizacion()', () => {
  test('encontrada → trae lineas y envios además del encabezado', async () => {
    const db = {
      from: jest.fn((tabla) => {
        if (tabla === 'cotizaciones') return crearBuilder({ data: { id: 20, folio: 'COT-2026-0020', company_id: COMPANY_A }, error: null });
        if (tabla === 'cotizacion_lineas') return crearBuilder({ data: [{ id: 'l1' }], error: null });
        if (tabla === 'envios_documento') return crearBuilder({ data: [{ id: 'e1', estado: 'enviado' }], error: null });
        return crearBuilder({ data: null, error: null });
      }),
    };
    const resultado = await obtenerCotizacion(db, COMPANY_A, 20);
    expect(resultado.folio).toBe('COT-2026-0020');
    expect(resultado.lineas).toEqual([{ id: 'l1' }]);
    expect(resultado.envios).toEqual([{ id: 'e1', estado: 'enviado' }]);
  });

  test('no encontrada o de otra empresa → null, nunca lanza', async () => {
    const db = { from: jest.fn(() => crearBuilder({ data: null, error: null })) };
    expect(await obtenerCotizacion(db, COMPANY_A, 999)).toBeNull();
  });
});
