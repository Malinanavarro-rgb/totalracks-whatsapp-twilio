'use strict';

const mockGetText = jest.fn();
const mockDestroy = jest.fn().mockResolvedValue();
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

const {
  extraerFichaTecnica, subirDocumento, procesarDocumento, listarDocumentos, confirmarDocumento,
  generarUrlFirmadaDocumento, extensionDeMime, BUCKET,
} = require('../modules/documentos-proveedor');

function crearBuilder(resultado = { data: null, error: null }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
  return builder;
}

function crearMockStorage({ uploadError = null, downloadResultado = null, downloadError = null, signedUrlError = null } = {}) {
  return {
    from: jest.fn(() => ({
      upload: jest.fn().mockResolvedValue({ error: uploadError }),
      download: jest.fn().mockResolvedValue({ data: downloadResultado, error: downloadError }),
      createSignedUrl: jest.fn().mockResolvedValue({ data: signedUrlError ? null : { signedUrl: 'https://firmada.example/x' }, error: signedUrlError }),
    })),
  };
}

function crearMockDb(overrides = {}, storageOpts = {}) {
  const resultadosPorTabla = overrides;
  return {
    from: jest.fn((tabla) => crearBuilder(resultadosPorTabla[tabla] ?? { data: null, error: null })),
    storage: crearMockStorage(storageOpts),
  };
}

function crearMockOpenAI(jsonRespuesta) {
  return { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(jsonRespuesta) } }] }) } } };
}

const COMPANY_A = 'company-a-0001';
const BUFFER_FAKE = Buffer.from('contenido-fake');

beforeEach(() => jest.clearAllMocks());

describe('extensionDeMime()', () => {
  test('mapea pdf/imagen conocidos', () => {
    expect(extensionDeMime('application/pdf')).toBe('pdf');
    expect(extensionDeMime('image/png')).toBe('png');
  });
  test('mime desconocido: usa el subtipo como fallback', () => {
    expect(extensionDeMime('application/x-raro')).toBe('x-raro');
  });
});

describe('extraerFichaTecnica()', () => {
  test('imagen: usa visión, responde JSON parseado', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, marca: 'Huawei', modelo: 'SUN2000-40KTL', tipo: 'inversor', specs: { potencia_ac_kw: 40 } });
    const resultado = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'image/jpeg' });
    expect(resultado.es_ficha_tecnica).toBe(true);
    expect(resultado.marca).toBe('Huawei');
    expect(openai.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0 }));
  });

  test('PDF con texto legible: lee el texto y lo manda a la IA', async () => {
    mockGetText.mockResolvedValue({ text: 'FICHA TÉCNICA PANEL SOLAR 550W MONOCRISTALINO '.repeat(3) });
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, tipo: 'panel_solar', specs: { potencia_w: 550 } });

    const resultado = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf' });
    expect(resultado.tipo).toBe('panel_solar');
    expect(mockDestroy).toHaveBeenCalled();
  });

  test('PDF sin texto legible (escaneado): no llama a la IA, marca el motivo', async () => {
    mockGetText.mockResolvedValue({ text: '  ' });
    const openai = crearMockOpenAI({});
    const resultado = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf' });
    expect(resultado).toEqual({ es_ficha_tecnica: false, _motivo: 'pdf_sin_texto_legible' });
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  test('tipo de archivo no soportado: no llama a la IA', async () => {
    const openai = crearMockOpenAI({});
    const resultado = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/zip' });
    expect(resultado).toEqual({ es_ficha_tecnica: false, _motivo: 'tipo_de_archivo_no_soportado' });
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  test('respuesta de la IA no es JSON válido: no lanza, defaults seguros', async () => {
    const openai = { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'esto no es json' } }] }) } } };
    const resultado = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'image/jpeg' });
    expect(resultado).toEqual({ es_ficha_tecnica: false });
  });
});

describe('subirDocumento()', () => {
  test('sube al bucket y crea la fila con el path (no una URL)', async () => {
    const fila = { id: 1, company_id: COMPANY_A, archivo_url: 'x.pdf' };
    const db = crearMockDb({ documentos_proveedor: { data: fila, error: null } });

    const resultado = await subirDocumento(db, { company_id: COMPANY_A, proveedor: 'SOLES', tipo_documento: 'ficha_tecnica', buffer: BUFFER_FAKE, mimeType: 'application/pdf', nombre_archivo: 'panel.pdf', subido_por: 'user-1' });

    expect(db.storage.from).toHaveBeenCalledWith(BUCKET);
    expect(resultado).toEqual(fila);
  });

  test('sin company_id: lanza sin tocar storage/DB', async () => {
    const db = crearMockDb();
    await expect(subirDocumento(db, { buffer: BUFFER_FAKE })).rejects.toThrow('company_id requerido');
    expect(db.storage.from).not.toHaveBeenCalled();
  });

  test('sin buffer: lanza sin tocar storage/DB', async () => {
    const db = crearMockDb();
    await expect(subirDocumento(db, { company_id: COMPANY_A, buffer: null })).rejects.toThrow('archivo vacío o faltante');
  });

  test('error subiendo al bucket: lanza con el mensaje real, nunca crea la fila', async () => {
    const db = crearMockDb({}, { uploadError: { message: 'bucket lleno' } });
    await expect(subirDocumento(db, { company_id: COMPANY_A, buffer: BUFFER_FAKE })).rejects.toThrow('bucket lleno');
  });
});

describe('procesarDocumento()', () => {
  function crearArchivoFake(mimeType) {
    return { type: mimeType, arrayBuffer: async () => BUFFER_FAKE.buffer.slice(BUFFER_FAKE.byteOffset, BUFFER_FAKE.byteOffset + BUFFER_FAKE.byteLength) };
  }

  test('descarga el archivo, extrae y guarda datos_extraidos + procesado_en', async () => {
    const documento = { id: 5, company_id: COMPANY_A, archivo_url: `${COMPANY_A}/x.jpg` };
    const filaActualizada = { ...documento, datos_extraidos: { es_ficha_tecnica: true }, procesado_en: '2026-09-16T00:00:00Z' };
    const db = crearMockDb(
      { documentos_proveedor: { data: filaActualizada, error: null } },
      { downloadResultado: crearArchivoFake('image/jpeg') }
    );
    // El primer select (buscar el documento) necesita devolver `documento`, no la fila final —
    // se simula sobreescribiendo maybeSingle en la primera llamada.
    let llamadasSelect = 0;
    db.from = jest.fn((tabla) => {
      const builder = crearBuilder({ data: filaActualizada, error: null });
      if (tabla === 'documentos_proveedor') {
        builder.maybeSingle = jest.fn(() => {
          llamadasSelect += 1;
          return Promise.resolve({ data: llamadasSelect === 1 ? documento : filaActualizada, error: null });
        });
      }
      return builder;
    });

    const openai = crearMockOpenAI({ es_ficha_tecnica: true, marca: 'Trina', tipo: 'panel_solar', specs: { potencia_w: 550 } });
    const resultado = await procesarDocumento(openai, db, COMPANY_A, 5);

    expect(db.storage.from).toHaveBeenCalledWith(BUCKET);
    expect(resultado.datos_extraidos).toBeTruthy();
  });

  test('documento no encontrado: lanza sin tocar storage', async () => {
    const db = crearMockDb({ documentos_proveedor: { data: null, error: null } });
    await expect(procesarDocumento({}, db, COMPANY_A, 999)).rejects.toThrow('no encontrado');
    expect(db.storage.from).not.toHaveBeenCalled();
  });

  test('error descargando del bucket: lanza con el mensaje real', async () => {
    const documento = { id: 5, company_id: COMPANY_A, archivo_url: `${COMPANY_A}/x.jpg` };
    const db = crearMockDb({ documentos_proveedor: { data: documento, error: null } }, { downloadError: { message: 'archivo no encontrado en storage' } });
    await expect(procesarDocumento({}, db, COMPANY_A, 5)).rejects.toThrow('archivo no encontrado en storage');
  });
});

describe('listarDocumentos()', () => {
  test('sin filtros: todos ordenados por created_at desc', async () => {
    const filas = [{ id: 1 }, { id: 2 }];
    const db = crearMockDb({ documentos_proveedor: { data: filas, error: null } });
    const resultado = await listarDocumentos(db, COMPANY_A);
    expect(resultado).toEqual(filas);
  });

  test('sin filas: arreglo vacío, no null', async () => {
    const db = crearMockDb({ documentos_proveedor: { data: null, error: null } });
    const resultado = await listarDocumentos(db, COMPANY_A);
    expect(resultado).toEqual([]);
  });

  test('error de DB: lanza con el mensaje real', async () => {
    const db = crearMockDb({ documentos_proveedor: { data: null, error: { message: 'fallo db' } } });
    await expect(listarDocumentos(db, COMPANY_A)).rejects.toThrow('fallo db');
  });
});

describe('confirmarDocumento()', () => {
  test('sin producto_id: solo marca confirmado_por/confirmado_en, nunca toca productos', async () => {
    const documento = { id: 5, company_id: COMPANY_A, datos_extraidos: { es_ficha_tecnica: true, specs: { potencia_w: 550 } }, producto_id: null };
    const filaConfirmada = { ...documento, confirmado_por: 'user-1', confirmado_en: '2026-09-16T00:00:00Z' };
    const db = crearMockDb({ documentos_proveedor: { data: documento, error: null } });
    db.from = jest.fn((tabla) => {
      const builder = crearBuilder({ data: tabla === 'documentos_proveedor' ? filaConfirmada : null, error: null });
      builder.maybeSingle = jest.fn().mockResolvedValue({ data: tabla === 'documentos_proveedor' ? documento : null, error: null });
      return builder;
    });

    const resultado = await confirmarDocumento(db, COMPANY_A, 5, { usuario_id: 'user-1' });
    expect(resultado).toBeTruthy();
    // No se consultó la tabla productos porque no se dio producto_id.
    expect(db.from).not.toHaveBeenCalledWith('productos');
  });

  test('con producto_id: mezcla specs, el producto YA EXISTENTE gana sobre lo nuevo', async () => {
    const documento = { id: 5, company_id: COMPANY_A, datos_extraidos: { es_ficha_tecnica: true, specs: { potencia_w: 550, voltaje_v: 41 } } };
    const producto = { id: 99, company_id: COMPANY_A, specs: { potencia_w: 999 }, ficha_tecnica_completa: false }; // 999 real ya confirmado antes

    let capturedUpdate = null;
    const db = { storage: crearMockStorage() };
    db.from = jest.fn((tabla) => {
      if (tabla === 'documentos_proveedor') {
        const builder = crearBuilder({ data: { ...documento, confirmado_en: 'x' }, error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: documento, error: null });
        return builder;
      }
      if (tabla === 'productos') {
        const builder = crearBuilder({ error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: producto, error: null });
        builder.update = jest.fn((cambios) => { capturedUpdate = cambios; return builder; });
        return builder;
      }
      return crearBuilder();
    });

    await confirmarDocumento(db, COMPANY_A, 5, { producto_id: 99, usuario_id: 'user-1' });

    expect(capturedUpdate.specs).toEqual({ potencia_w: 999, voltaje_v: 41 }); // 999 (existente) gana sobre 550 (nuevo)
    expect(capturedUpdate.ficha_tecnica_completa).toBe(false); // no se marcó esFichaCompleta
  });

  test('esFichaCompleta=true la sube, pero nunca la baja de true a false', async () => {
    const documento = { id: 5, company_id: COMPANY_A, datos_extraidos: { es_ficha_tecnica: true, specs: {} } };
    const productoYaCompleto = { id: 99, company_id: COMPANY_A, specs: {}, ficha_tecnica_completa: true };

    let capturedUpdate = null;
    const db = { storage: crearMockStorage() };
    db.from = jest.fn((tabla) => {
      if (tabla === 'documentos_proveedor') {
        const builder = crearBuilder({ data: documento, error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: documento, error: null });
        return builder;
      }
      if (tabla === 'productos') {
        const builder = crearBuilder({ error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: productoYaCompleto, error: null });
        builder.update = jest.fn((cambios) => { capturedUpdate = cambios; return builder; });
        return builder;
      }
      return crearBuilder();
    });

    // esFichaCompleta: false en esta llamada — no debe degradar el producto que ya era true.
    await confirmarDocumento(db, COMPANY_A, 5, { producto_id: 99, usuario_id: 'user-1', esFichaCompleta: false });
    expect(capturedUpdate.ficha_tecnica_completa).toBe(true);
  });

  test('documento no encontrado: lanza', async () => {
    const db = crearMockDb({ documentos_proveedor: { data: null, error: null } });
    await expect(confirmarDocumento(db, COMPANY_A, 999, {})).rejects.toThrow('no encontrado');
  });

  test('documento sin procesar todavía (sin datos_extraidos): lanza explícito', async () => {
    const documento = { id: 5, company_id: COMPANY_A, datos_extraidos: null };
    const db = crearMockDb({ documentos_proveedor: { data: documento, error: null } });
    await expect(confirmarDocumento(db, COMPANY_A, 5, {})).rejects.toThrow('todavía no ha sido procesado');
  });

  test('producto_id de otra empresa: lanza (nunca cruza company_id)', async () => {
    const documento = { id: 5, company_id: COMPANY_A, datos_extraidos: { es_ficha_tecnica: true, specs: {} } };
    const db = { storage: crearMockStorage() };
    db.from = jest.fn((tabla) => {
      const builder = crearBuilder({ data: null, error: null });
      if (tabla === 'documentos_proveedor') builder.maybeSingle = jest.fn().mockResolvedValue({ data: documento, error: null });
      if (tabla === 'productos') builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null }); // no matchea porque es de otra empresa
      return builder;
    });

    await expect(confirmarDocumento(db, COMPANY_A, 5, { producto_id: 999, usuario_id: 'user-1' })).rejects.toThrow('producto no encontrado');
  });
});

describe('generarUrlFirmadaDocumento()', () => {
  test('devuelve la URL firmada', async () => {
    const db = crearMockDb();
    const url = await generarUrlFirmadaDocumento(db, `${COMPANY_A}/x.pdf`);
    expect(url).toBe('https://firmada.example/x');
  });

  test('error generando la URL: lanza con el mensaje real', async () => {
    const db = crearMockDb({}, { signedUrlError: { message: 'path no existe' } });
    await expect(generarUrlFirmadaDocumento(db, 'no-existe.pdf')).rejects.toThrow('path no existe');
  });
});

// ─── Modelo objetivo + claves canónicas (2026-09-19) ─────────────────────────
// Falla real que motivó esto: una ficha LONGi de la serie 605/610/615 W devolvió la
// columna de 605 W para un producto de 615 W, y con claves libres que el motor de
// ingeniería nunca lee. Ver modules/specs-canonicas.js.

describe('extraerFichaTecnica() — con modelo objetivo', () => {
  const OBJETIVO = { marca: 'LONGi Solar', modelo: 'LR7-72HTH-615M', tipo: 'panel_solar' };
  const SPECS_615 = { potencia_wp: 615, voc: 52.57, vmp: 44.33, isc: 14.87, imp: 13.88, coef_temp_voc: -0.23, peso_kg: 28.5 };

  beforeEach(() => mockGetText.mockResolvedValue({ text: 'FICHA TÉCNICA LONGI SERIE LR7-72HTH '.repeat(4) }));

  test('el prompt nombra el modelo EXACTO y exige las claves canónicas del motor', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'LR7-72HTH-615M', tipo: 'panel_solar', specs: SPECS_615 });
    await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJETIVO });

    const prompt = openai.chat.completions.create.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/LR7-72HTH-615M/);
    expect(prompt).toMatch(/ÚNICAMENTE de la columna/);
    expect(prompt).toMatch(/"coef_temp_voc"/);
  });

  test('modelo leído = objetivo → specs canónicas, sin faltantes ni advertencias, extras conservados', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'LR7-72HTH-615M', tipo: 'panel_solar', specs: SPECS_615 });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJETIVO });

    expect(r.modelo_coincide).toBe(true);
    expect(r.specs).toMatchObject({ potencia_wp: 615, voc: 52.57, vmp: 44.33, isc: 14.87, imp: 13.88, coef_temp_voc: -0.23, peso_kg: 28.5 });
    expect(r.campos_faltantes).toEqual([]);
    expect(r.advertencias).toEqual([]);
    expect(r.objetivo).toEqual(OBJETIVO);
  });

  test('normaliza claves libres (sinónimos) aunque la IA no obedezca el esquema', async () => {
    const openai = crearMockOpenAI({
      es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'LR7-72HTH-615M', tipo: 'panel_solar',
      specs: { potencia_w: 615, voltaje_circuito_abierto_v: 52.57, voltaje_en_potencia_max_v: 44.33, corriente_corta_circuito_a: 14.87, corriente_en_potencia_max_a: 13.88, coeficiente_temperatura_voc_pct_por_c: -0.23 },
    });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJETIVO });
    expect(r.campos_faltantes).toEqual([]);
    expect(r.specs.voc).toBe(52.57);
  });

  test('la IA leyó la columna de OTRO modelo de la serie (605M) → specs vacías + advertencia, nunca cifras ajenas', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'LR7-72HTH-605M', tipo: 'panel_solar', specs: { potencia_wp: 605, voc: 52.3, vmp: 44.03, isc: 14.74, imp: 13.75, coef_temp_voc: -0.23 } });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJETIVO });

    expect(r.modelo_coincide).toBe(false);
    expect(r.specs).toEqual({});
    expect(r.campos_faltantes.length).toBe(6);
    expect(r.advertencias[0]).toMatch(/no coincide/);
  });

  test('modelo_encontrado=false → specs vacías + advertencia de que el modelo no aparece', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: false, modelo: null, tipo: 'panel_solar', specs: {} });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJETIVO });

    expect(r.modelo_coincide).toBe(false);
    expect(r.advertencias[0]).toMatch(/no aparece/);
  });

  test('valores incoherentes (vmp×imp no cuadra con la potencia) → se proponen pero con advertencia', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'LR7-72HTH-615M', tipo: 'panel_solar', specs: { ...SPECS_615, vmp: 44.03, imp: 13.75 } });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJETIVO });

    expect(r.modelo_coincide).toBe(true);
    expect(r.advertencias.join(' ')).toMatch(/columna de otro modelo/);
  });

  test('no es ficha técnica → se devuelve tal cual, sin postproceso', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: false });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJETIVO });
    expect(r).toEqual({ es_ficha_tecnica: false });
  });

  test('sin objetivo → extracción genérica de siempre (prompt genérico, sin campos de postproceso)', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, tipo: 'panel_solar', specs: { potencia_w: 550 } });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf' });

    expect(r.modelo_coincide).toBeUndefined();
    expect(openai.chat.completions.create.mock.calls[0][0].messages[0].content).not.toMatch(/modelo EXACTO/);
  });

  test('objetivo de un tipo sin campos canónicos (ej. bateria) → extracción genérica', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, tipo: 'bateria', specs: { capacidad_kwh: 5 } });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: { marca: 'X', modelo: 'B1', tipo: 'bateria' } });
    expect(r.modelo_coincide).toBeUndefined();
  });
});

describe('subirDocumento() — producto_id', () => {
  test('guarda el producto_id enlazado en la fila (para que procesar sepa qué modelo leer)', async () => {
    let insertado = null;
    const db = crearMockDb();
    db.from = jest.fn(() => {
      const builder = crearBuilder({ data: { id: 1 }, error: null });
      builder.insert = jest.fn((fila) => { insertado = fila; return builder; });
      return builder;
    });

    await subirDocumento(db, { company_id: COMPANY_A, buffer: BUFFER_FAKE, mimeType: 'application/pdf', producto_id: 'prod-uuid-1' });
    expect(insertado.producto_id).toBe('prod-uuid-1');
  });

  test('sin producto_id → null (comportamiento previo)', async () => {
    let insertado = null;
    const db = crearMockDb();
    db.from = jest.fn(() => {
      const builder = crearBuilder({ data: { id: 1 }, error: null });
      builder.insert = jest.fn((fila) => { insertado = fila; return builder; });
      return builder;
    });

    await subirDocumento(db, { company_id: COMPANY_A, buffer: BUFFER_FAKE, mimeType: 'application/pdf' });
    expect(insertado.producto_id).toBeNull();
  });
});

describe('procesarDocumento() — documento enlazado a un producto', () => {
  function armarDb(documento, producto) {
    const tablasConsultadas = [];
    const db = crearMockDb({}, { downloadResultado: { type: 'application/pdf', arrayBuffer: async () => BUFFER_FAKE.buffer.slice(BUFFER_FAKE.byteOffset, BUFFER_FAKE.byteOffset + BUFFER_FAKE.byteLength) } });
    db.from = jest.fn((tabla) => {
      tablasConsultadas.push(tabla);
      const builder = crearBuilder({ data: null, error: null });
      builder.maybeSingle = jest.fn().mockResolvedValue({ data: tabla === 'productos' ? producto : documento, error: null });
      return builder;
    });
    return { db, tablasConsultadas };
  }

  test('lee marca/modelo/tipo del producto y los usa como objetivo de la extracción', async () => {
    mockGetText.mockResolvedValue({ text: 'FICHA TÉCNICA LONGI SERIE LR7-72HTH '.repeat(4) });
    const { db, tablasConsultadas } = armarDb(
      { id: 5, company_id: COMPANY_A, archivo_url: 'x.pdf', producto_id: 'prod-1' },
      { marca: 'LONGi Solar', modelo: 'LR7-72HTH-615M', tipo: 'panel_solar' },
    );
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'LR7-72HTH-615M', tipo: 'panel_solar', specs: { potencia_wp: 615 } });

    await procesarDocumento(openai, db, COMPANY_A, 5);

    expect(tablasConsultadas).toContain('productos');
    expect(openai.chat.completions.create.mock.calls[0][0].messages[0].content).toMatch(/LR7-72HTH-615M/);
  });

  test('sin producto enlazado → nunca consulta productos y usa el prompt genérico', async () => {
    mockGetText.mockResolvedValue({ text: 'FICHA TÉCNICA PANEL '.repeat(5) });
    const { db, tablasConsultadas } = armarDb({ id: 5, company_id: COMPANY_A, archivo_url: 'x.pdf', producto_id: null }, null);
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, specs: {} });

    await procesarDocumento(openai, db, COMPANY_A, 5);

    expect(tablasConsultadas).not.toContain('productos');
    expect(openai.chat.completions.create.mock.calls[0][0].messages[0].content).not.toMatch(/modelo EXACTO/);
  });
});

describe('confirmarDocumento() — ficha completa por campos', () => {
  const PANEL_SIN_FICHA = { id: 99, company_id: COMPANY_A, tipo: 'panel_solar', specs: { potencia_wp: 615 }, ficha_tecnica_completa: false };
  const SPECS_NUEVAS = { voc: 52.57, vmp: 44.33, isc: 14.87, imp: 13.88, coef_temp_voc: -0.23 };

  async function confirmarCon(datosExtraidos, producto) {
    let cambios = null;
    const documento = { id: 5, company_id: COMPANY_A, datos_extraidos: datosExtraidos };
    const db = { storage: crearMockStorage() };
    db.from = jest.fn((tabla) => {
      const builder = crearBuilder({ data: documento, error: null });
      builder.maybeSingle = jest.fn().mockResolvedValue({ data: tabla === 'productos' ? producto : documento, error: null });
      if (tabla === 'productos') builder.update = jest.fn((c) => { cambios = c; return builder; });
      return builder;
    });
    await confirmarDocumento(db, COMPANY_A, 5, { producto_id: 99, usuario_id: 'user-1' });
    return cambios;
  }

  test('tras mezclar el producto tiene TODOS los campos del motor y no hay advertencias → sube a completa sola', async () => {
    const cambios = await confirmarCon({ es_ficha_tecnica: true, specs: SPECS_NUEVAS, advertencias: [] }, PANEL_SIN_FICHA);
    expect(cambios.specs).toMatchObject({ potencia_wp: 615, voc: 52.57, coef_temp_voc: -0.23 });
    expect(cambios.ficha_tecnica_completa).toBe(true);
  });

  test('con advertencias sin resolver → NO se marca completa sola (decide el humano con esFichaCompleta)', async () => {
    const cambios = await confirmarCon({ es_ficha_tecnica: true, specs: SPECS_NUEVAS, advertencias: ['Vmp × Imp no cuadra'] }, PANEL_SIN_FICHA);
    expect(cambios.ficha_tecnica_completa).toBe(false);
  });

  test('aún faltan campos del motor → NO se marca completa', async () => {
    const cambios = await confirmarCon({ es_ficha_tecnica: true, specs: { voc: 52.57 }, advertencias: [] }, PANEL_SIN_FICHA);
    expect(cambios.ficha_tecnica_completa).toBe(false);
  });

  test('producto de un tipo sin campos canónicos → nunca se marca completa por campos', async () => {
    const cambios = await confirmarCon({ es_ficha_tecnica: true, specs: { capacidad_kwh: 5 }, advertencias: [] }, { id: 99, company_id: COMPANY_A, tipo: 'bateria', specs: {}, ficha_tecnica_completa: false });
    expect(cambios.ficha_tecnica_completa).toBe(false);
  });
});

describe('extraerFichaTecnica() — verificación por potencia del catálogo', () => {
  const OBJ = { marca: 'TaleSun', modelo: 'TM7G72M', tipo: 'panel_solar', potencia_wp: 590 };
  beforeEach(() => mockGetText.mockResolvedValue({ text: 'FICHA TALESUN TM7G72M '.repeat(6) }));

  test('el prompt incluye la potencia esperada para elegir la columna', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'TM7G72M', tipo: 'panel_solar', specs: { potencia_wp: 590, voc: 52.3, vmp: 43.7, isc: 14.2, imp: 13.5, coef_temp_voc: -0.25 } });
    await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJ });
    expect(openai.chat.completions.create.mock.calls[0][0].messages[0].content).toMatch(/590 W/);
  });

  test('potencia leída = catálogo → se acepta', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'TM7G72M', tipo: 'panel_solar', specs: { potencia_wp: 590, voc: 52.3, vmp: 43.7, isc: 14.2, imp: 13.5, coef_temp_voc: -0.25 } });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJ });
    expect(r.modelo_coincide).toBe(true);
    expect(r.specs.voc).toBe(52.3);
  });

  test('el nombre coincide pero la potencia leída es de OTRA variante (585 vs 590) → se descarta todo', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'TM7G72M', tipo: 'panel_solar', specs: { potencia_wp: 585, voc: 52.1, vmp: 43.5, isc: 14.1, imp: 13.45, coef_temp_voc: -0.25 } });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: OBJ });

    expect(r.modelo_coincide).toBe(false);
    expect(r.specs).toEqual({});
    expect(r.advertencias[0]).toMatch(/585 W.*590 W/);
  });

  test('catálogo sin potencia conocida → no se aplica esta verificación', async () => {
    const openai = crearMockOpenAI({ es_ficha_tecnica: true, modelo_encontrado: true, modelo: 'TM7G72M', tipo: 'panel_solar', specs: { potencia_wp: 585 } });
    const r = await extraerFichaTecnica(openai, { buffer: BUFFER_FAKE, mimeType: 'application/pdf', objetivo: { ...OBJ, potencia_wp: undefined } });
    expect(r.modelo_coincide).toBe(true);
  });
});
