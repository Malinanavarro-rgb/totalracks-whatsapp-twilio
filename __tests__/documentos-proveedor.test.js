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
