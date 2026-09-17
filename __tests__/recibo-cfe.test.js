'use strict';

const mockPreSalvarDatosExtraidos = jest.fn().mockResolvedValue();
jest.mock('../modules/workflow-engine', () => ({
  WorkflowEngine: jest.fn().mockImplementation(() => ({
    preSalvarDatosExtraidos: mockPreSalvarDatosExtraidos,
  })),
}));

const mockGetText = jest.fn();
const mockDestroy = jest.fn().mockResolvedValue();
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

const { extraerDatosReciboCFE, normalizarDatosRecibo, procesarReciboCFE } = require('../modules/recibo-cfe');

// ─── Mock Supabase (por tabla) ──────────────────────────────────────────────

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockDb(overrides = {}) {
  const defaults = {
    workflow_sessions: { data: { id: 'sesion-1', workflow_id: 'wf-1' }, error: null },
    workflows: { data: { trigger_value: 'solicitud_cotizacion' }, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  return { from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })) };
}

function crearMockOpenAI(jsonRespuesta) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(jsonRespuesta) } }],
        }),
      },
    },
  };
}

const BUFFER_FAKE = Buffer.from('contenido-fake');

beforeEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────

describe('extraerDatosReciboCFE()', () => {
  test('imagen → llama a la API de visión con la imagen como data URL', async () => {
    const openai = crearMockOpenAI({ es_recibo_cfe: true, importe_total: 3850, consumo_kwh: 1120, periodo_inicio: '2026-06-05', periodo_fin: '2026-07-04', tarifa: '1', consumo_historico_kwh: null });
    const resultado = await extraerDatosReciboCFE(openai, { buffer: BUFFER_FAKE, mimeType: 'image/jpeg' });

    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
    const llamada = openai.chat.completions.create.mock.calls[0][0];
    expect(llamada.messages[1].content[0].type).toBe('image_url');
    expect(llamada.messages[1].content[0].image_url.url).toContain('data:image/jpeg;base64,');
    expect(resultado.es_recibo_cfe).toBe(true);
    expect(resultado.consumo_kwh).toBe(1120);
  });

  test('PDF con texto legible → lee el texto con pdf-parse y lo manda como texto (no imagen)', async () => {
    mockGetText.mockResolvedValue({ text: 'CFE Recibo Total a pagar $3,850.00 Consumo 1,120 kWh periodo 05/06/2026 al 04/07/2026' });
    const openai = crearMockOpenAI({ es_recibo_cfe: true, importe_total: 3850, consumo_kwh: 1120, periodo_inicio: '2026-06-05', periodo_fin: '2026-07-04', tarifa: '1', consumo_historico_kwh: null });

    const resultado = await extraerDatosReciboCFE(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf' });

    expect(mockGetText).toHaveBeenCalledTimes(1);
    expect(mockDestroy).toHaveBeenCalledTimes(1); // libera el parser siempre
    const llamada = openai.chat.completions.create.mock.calls[0][0];
    expect(typeof llamada.messages[1].content).toBe('string');
    expect(llamada.messages[1].content).toContain('3,850.00');
    expect(resultado.es_recibo_cfe).toBe(true);
  });

  test('PDF escaneado (sin texto real) → no llama a OpenAI, devuelve no legible', async () => {
    mockGetText.mockResolvedValue({ text: '   ' }); // menos de MIN_CARACTERES_PDF_LEGIBLE
    const openai = crearMockOpenAI({});

    const resultado = await extraerDatosReciboCFE(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf' });

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(resultado).toEqual({ es_recibo_cfe: false, _motivo: 'pdf_sin_texto_legible' });
    expect(mockDestroy).toHaveBeenCalledTimes(1); // se libera aunque no haya texto
  });

  test('tipo de archivo no soportado (ej. audio) → no llama a OpenAI', async () => {
    const openai = crearMockOpenAI({});
    const resultado = await extraerDatosReciboCFE(openai, { buffer: BUFFER_FAKE, mimeType: 'audio/ogg' });
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(resultado.es_recibo_cfe).toBe(false);
  });

  test('respuesta de OpenAI no es JSON válido → fallback seguro, nunca lanza', async () => {
    const openai = { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'esto no es json' } }] }) } } };
    const resultado = await extraerDatosReciboCFE(openai, { buffer: BUFFER_FAKE, mimeType: 'image/png' });
    expect(resultado).toEqual({ es_recibo_cfe: false });
  });
});

describe('normalizarDatosRecibo()', () => {
  test('es_recibo_cfe false → todo null', () => {
    expect(normalizarDatosRecibo({ es_recibo_cfe: false })).toEqual({
      esRecibo: false, consumoMensualKwh: null, importePromedioRecibo: null, tarifa: null, periodoDias: null, historialConsumoKwh: null,
    });
  });

  test('con periodo de ~60 días (bimestral real) → normaliza consumo e importe con el MISMO factor (÷2)', () => {
    const resultado = normalizarDatosRecibo({
      es_recibo_cfe: true, importe_total: 3850, consumo_kwh: 1120,
      periodo_inicio: '2026-06-05', periodo_fin: '2026-08-04', // 60 días
      tarifa: '1',
    });
    expect(resultado.periodoDias).toBe(60);
    expect(resultado.consumoMensualKwh).toBe(560); // 1120 × (30/60)
    expect(resultado.importePromedioRecibo).toBe(1925); // 3850 × (30/60)
    expect(resultado.tarifa).toBe('1');
  });

  test('periodo de 30 días exactos → factor 1, sin cambio', () => {
    const resultado = normalizarDatosRecibo({
      es_recibo_cfe: true, importe_total: 900, consumo_kwh: 300,
      periodo_inicio: '2026-06-01', periodo_fin: '2026-07-01',
    });
    expect(resultado.consumoMensualKwh).toBe(300);
    expect(resultado.importePromedioRecibo).toBe(900);
  });

  test('sin periodo legible → consumo/importe quedan null AUNQUE haya números crudos (nunca asume bimestral a ciegas)', () => {
    const resultado = normalizarDatosRecibo({ es_recibo_cfe: true, importe_total: 3850, consumo_kwh: 1120 });
    expect(resultado.consumoMensualKwh).toBeNull();
    expect(resultado.importePromedioRecibo).toBeNull();
  });

  test('periodo con fechas invertidas o inválidas → periodoDias null, no un número negativo', () => {
    const resultado = normalizarDatosRecibo({ es_recibo_cfe: true, consumo_kwh: 100, periodo_inicio: '2026-07-04', periodo_fin: '2026-06-05' });
    expect(resultado.periodoDias).toBeNull();
    expect(resultado.consumoMensualKwh).toBeNull();
  });

  test('histórico con 6 valores bimestrales → se expande a 12 mensuales (cada uno ÷2, duplicado)', () => {
    const resultado = normalizarDatosRecibo({
      es_recibo_cfe: true, consumo_historico_kwh: [1120, 1080, 1200, 1050, 900, 1300],
    });
    expect(resultado.historialConsumoKwh).toHaveLength(12);
    expect(resultado.historialConsumoKwh[0]).toBe(560);
    expect(resultado.historialConsumoKwh[1]).toBe(560);
    expect(resultado.historialConsumoKwh[2]).toBe(540);
  });

  test('histórico con menos de 6 valores → null, no arma un arreglo parcial', () => {
    const resultado = normalizarDatosRecibo({ es_recibo_cfe: true, consumo_historico_kwh: [1120, 1080] });
    expect(resultado.historialConsumoKwh).toBeNull();
  });

  test('histórico con valores no numéricos mezclados → se filtran antes de contar', () => {
    const resultado = normalizarDatosRecibo({ es_recibo_cfe: true, consumo_historico_kwh: [1120, null, 'no sé', 1080, 1200, 1050, 900] });
    expect(resultado.historialConsumoKwh).toBeNull(); // solo 5 numéricos válidos, menos de 6
  });
});

describe('procesarReciboCFE()', () => {
  const DATOS_BASE = { buffer: BUFFER_FAKE, mimeType: 'image/jpeg', companyId: 'company-a', clienteId: 138 };

  test('faltan companyId/clienteId → no consulta la DB', async () => {
    const db = crearMockDb();
    const resultado = await procesarReciboCFE({}, db, { buffer: BUFFER_FAKE, mimeType: 'image/jpeg' });
    expect(resultado.aplico).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });

  test('sin sesión de workflow activa → no llama a OpenAI ni preSalvarDatosExtraidos', async () => {
    const db = crearMockDb({ workflow_sessions: { data: null, error: null } });
    const openai = crearMockOpenAI({});
    const resultado = await procesarReciboCFE(openai, db, DATOS_BASE);
    expect(resultado).toEqual({ aplico: false, motivo: 'sin_sesion_activa' });
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(mockPreSalvarDatosExtraidos).not.toHaveBeenCalled();
  });

  test('sesión activa pero de OTRO workflow (visita técnica) → no procesa, mismo criterio que cotizacion-adjuntos.js', async () => {
    const db = crearMockDb({ workflows: { data: { trigger_value: 'solicitud_visita_tecnica' }, error: null } });
    const openai = crearMockOpenAI({});
    const resultado = await procesarReciboCFE(openai, db, DATOS_BASE);
    expect(resultado.aplico).toBe(false);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  test('extracción exitosa con datos usables → guarda con preSalvarDatosExtraidos y devuelve los campos', async () => {
    const db = crearMockDb();
    const openai = crearMockOpenAI({
      es_recibo_cfe: true, importe_total: 3850, consumo_kwh: 1120,
      periodo_inicio: '2026-06-05', periodo_fin: '2026-08-04', tarifa: '1', consumo_historico_kwh: null,
    });

    const resultado = await procesarReciboCFE(openai, db, DATOS_BASE);

    expect(resultado.aplico).toBe(true);
    expect(resultado.camposGuardados).toEqual(expect.arrayContaining(['consumo_mensual_kwh', 'importe_promedio_recibo']));
    expect(mockPreSalvarDatosExtraidos).toHaveBeenCalledWith('sesion-1', expect.objectContaining({
      consumo_mensual_kwh: 560, importe_promedio_recibo: 1925,
    }));
  });

  test('el documento no es un recibo de CFE → no guarda nada', async () => {
    const db = crearMockDb();
    const openai = crearMockOpenAI({ es_recibo_cfe: false });
    const resultado = await procesarReciboCFE(openai, db, DATOS_BASE);
    expect(resultado.aplico).toBe(false);
    expect(mockPreSalvarDatosExtraidos).not.toHaveBeenCalled();
  });

  test('es un recibo pero sin datos suficientemente claros (ej. sin periodo) → no guarda nada', async () => {
    const db = crearMockDb();
    const openai = crearMockOpenAI({ es_recibo_cfe: true, importe_total: 3850, consumo_kwh: 1120 }); // sin periodo → normaliza a null
    const resultado = await procesarReciboCFE(openai, db, DATOS_BASE);
    expect(resultado).toEqual({ aplico: false, motivo: 'recibo_reconocido_pero_sin_datos_suficientemente_claros' });
    expect(mockPreSalvarDatosExtraidos).not.toHaveBeenCalled();
  });

  test('error de OpenAI se propaga (server.js ya lo captura con .catch en la capa de arriba)', async () => {
    const db = crearMockDb();
    const openai = { chat: { completions: { create: jest.fn().mockRejectedValue(new Error('rate limit')) } } };
    await expect(procesarReciboCFE(openai, db, DATOS_BASE)).rejects.toThrow('rate limit');
  });
});
