'use strict';

const mockPdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-fake'));
const mockSetContent = jest.fn().mockResolvedValue();
const mockNewPage = jest.fn().mockResolvedValue({ setContent: mockSetContent, pdf: mockPdf });
const mockClose = jest.fn().mockResolvedValue();
const mockLaunch = jest.fn().mockResolvedValue({ newPage: mockNewPage, close: mockClose });
jest.mock('puppeteer', () => ({ launch: (...args) => mockLaunch(...args) }));

const mockEnviarDocumentoPorWhatsApp = jest.fn();
jest.mock('../modules/envio-documentos', () => ({ enviarDocumentoPorWhatsApp: (...args) => mockEnviarDocumentoPorWhatsApp(...args) }));

const { construirHtmlCotizacion, generarPdfCotizacion, generarYEnviarCotizacion, BUCKET_COTIZACIONES_PDF } = require('../modules/cotizacion-pdf');

function crearBuilder(resultado = { data: null, error: null }) {
  return {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resultado),
    maybeSingle: jest.fn().mockResolvedValue(resultado),
    then: (resolve) => resolve(resultado),
  };
}

function crearMockDbPorTabla(overrides = {}) {
  const defaults = {
    cotizaciones: { data: { id: 1, company_id: 'c1', cliente_id: 7, version: 1, folio: 'COT-001', subtotal: 100, iva: 16, total: 116, ingenieria_validada_para_cotizar_en: '2026-08-04T10:00:00Z' }, error: null },
    cotizacion_lineas: { data: [{ descripcion: 'Panel', cantidad: 8, precio_unitario: 3200, descuento_pct: 0, subtotal: 25600 }], error: null },
    clientes: { data: { nombre: 'Jorge Villarreal', empresa: null }, error: null },
    companies: { data: { nombre: 'Empresa Demo Paneles Solares' }, error: null },
    calculos_ingenieria: { data: { id: 'calc-1' }, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  const storageUpload = jest.fn().mockResolvedValue({ error: null });
  const db = {
    from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })),
    storage: { from: jest.fn(() => ({ upload: storageUpload })) },
  };
  return { db, storageUpload };
}

describe('construirHtmlCotizacion() — plantilla pura', () => {
  const base = {
    cotizacion: { id: 1, folio: 'COT-001', version: 1, subtotal: 1000, iva: 160, total: 1160 },
    lineas: [{ descripcion: 'Panel solar', cantidad: 8, precio_unitario: 100, descuento_pct: 0, subtotal: 800 }],
    cliente: { nombre: 'Ana López', empresa: null },
    empresa: { nombre: 'Empresa Demo Paneles Solares' },
    calculo: { id: 'calc-1' },
  };

  test('incluye folio, cliente, totales formateados en pesos', () => {
    const html = construirHtmlCotizacion(base);
    expect(html).toContain('COT-001');
    expect(html).toContain('Ana López');
    expect(html).toContain('$1,160.00');
  });

  test('escapa HTML en campos de texto (nunca inyecta markup del cliente/producto)', () => {
    const html = construirHtmlCotizacion({
      ...base,
      cliente: { nombre: '<script>alert(1)</script>', empresa: null },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('siempre incluye el aviso de predimensionamiento cuando hay cálculo asociado', () => {
    const html = construirHtmlCotizacion(base);
    expect(html).toMatch(/predimensionamiento/i);
  });

  test('sin cálculo asociado, no incluye el aviso (cotización manual pura)', () => {
    const html = construirHtmlCotizacion({ ...base, calculo: null });
    expect(html).not.toMatch(/predimensionamiento/i);
  });

  test('línea pendiente de levantamiento se marca visualmente', () => {
    const html = construirHtmlCotizacion({
      ...base,
      lineas: [{ descripcion: 'Cableado', cantidad: 1, precio_unitario: 0, descuento_pct: 0, subtotal: 0, pendiente_levantamiento: true }],
    });
    expect(html).toMatch(/sujeto a levantamiento/i);
  });
});

describe('generarPdfCotizacion()', () => {
  beforeEach(() => { jest.clearAllMocks(); mockPdf.mockResolvedValue(Buffer.from('%PDF-fake')); });

  test('rechaza si puedeEnviarCotizacion() es false — NUNCA genera el PDF', async () => {
    const { db, storageUpload } = crearMockDbPorTabla({
      cotizaciones: { data: { id: 1, ingenieria_validada_para_cotizar_en: null }, error: null },
    });
    await expect(generarPdfCotizacion(db, 1)).rejects.toMatchObject({ status: 409 });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test('con ingeniería validada: genera el PDF, lo sube y guarda pdf_url', async () => {
    const { db, storageUpload } = crearMockDbPorTabla();
    const resultado = await generarPdfCotizacion(db, 1);

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1); // el browser SIEMPRE se cierra
    expect(storageUpload).toHaveBeenCalledWith(expect.stringContaining('c1/1/'), expect.any(Buffer), expect.objectContaining({ contentType: 'application/pdf' }));
    expect(resultado.storageBucket).toBe(BUCKET_COTIZACIONES_PDF);
  });

  test('si Puppeteer lanza, el browser igual se cierra (no deja procesos huérfanos)', async () => {
    const { db } = crearMockDbPorTabla();
    mockSetContent.mockRejectedValueOnce(new Error('timeout de render'));
    await expect(generarPdfCotizacion(db, 1)).rejects.toThrow('timeout de render');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

describe('generarYEnviarCotizacion()', () => {
  beforeEach(() => { jest.clearAllMocks(); mockPdf.mockResolvedValue(Buffer.from('%PDF-fake')); });

  test('genera el PDF y lo envía; si el envío tiene éxito, marca la cotización como enviada', async () => {
    const { db } = crearMockDbPorTabla();
    mockEnviarDocumentoPorWhatsApp.mockResolvedValue({ estado: 'enviado', message_id: 'wamid.1' });

    const resultado = await generarYEnviarCotizacion(db, { cotizacionId: 1, destinatario: '+528100000000' });

    expect(mockEnviarDocumentoPorWhatsApp).toHaveBeenCalledWith(db, expect.objectContaining({
      cotizacionId: 1, destinatario: '+528100000000', cotizacionVersion: 1,
    }));
    const builderUpdate = db.from.mock.results.find(r => r.value.update.mock.calls.some(c => c[0].estado === 'enviada'));
    expect(builderUpdate).toBeDefined();
    expect(resultado.estado).toBe('enviado');
  });

  test('si el envío falla, NO marca la cotización como enviada (el PDF ya generado no se pierde)', async () => {
    const { db } = crearMockDbPorTabla();
    mockEnviarDocumentoPorWhatsApp.mockResolvedValue({ estado: 'fallido', error_proveedor: 'Twilio caído' });

    const resultado = await generarYEnviarCotizacion(db, { cotizacionId: 1, destinatario: '+528100000000' });

    const seMarcoEnviada = db.from.mock.results.some(r => r.value.update?.mock?.calls?.some(c => c[0]?.estado === 'enviada'));
    expect(seMarcoEnviada).toBe(false);
    expect(resultado.estado).toBe('fallido');
  });

  test('si la cotización no está validada, ni siquiera intenta enviar', async () => {
    const { db } = crearMockDbPorTabla({ cotizaciones: { data: { id: 1, ingenieria_validada_para_cotizar_en: null }, error: null } });
    await expect(generarYEnviarCotizacion(db, { cotizacionId: 1, destinatario: '+528100000000' })).rejects.toMatchObject({ status: 409 });
    expect(mockEnviarDocumentoPorWhatsApp).not.toHaveBeenCalled();
  });
});
