'use strict';

const mockPdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-fake'));
const mockSetContent = jest.fn().mockResolvedValue();
const mockNewPage = jest.fn().mockResolvedValue({ setContent: mockSetContent, pdf: mockPdf });
const mockClose = jest.fn().mockResolvedValue();
const mockLaunch = jest.fn().mockResolvedValue({ newPage: mockNewPage, close: mockClose });
jest.mock('puppeteer', () => ({ launch: (...args) => mockLaunch(...args) }));

const mockEnviarDocumentoPorWhatsApp = jest.fn();
jest.mock('../modules/envio-documentos', () => ({ enviarDocumentoPorWhatsApp: (...args) => mockEnviarDocumentoPorWhatsApp(...args) }));

jest.mock('../modules/clients', () => ({ supabaseServicio: {}, twilioClient: {} }));

const mockResolverEndpoint = jest.fn().mockResolvedValue('5218100000000');
jest.mock('../modules/channel-router', () => ({
  ChannelRouter: jest.fn().mockImplementation(() => ({ resolverEndpointDeEmpresa: (...args) => mockResolverEndpoint(...args) })),
}));

const mockGenerarQrDataUri = jest.fn().mockResolvedValue('data:image/png;base64,FAKE');
jest.mock('../modules/qr', () => ({ generarQrDataUri: (...args) => mockGenerarQrDataUri(...args) }));

const mockObtenerPlantillaDeEmpresa = jest.fn().mockResolvedValue({ cotizacion_pdf_config: {}, imagenes_stock_default: null });
jest.mock('../modules/plantillas-industria', () => ({ obtenerPlantillaDeEmpresa: (...args) => mockObtenerPlantillaDeEmpresa(...args) }));

const mockResumenEjecutivoParaPdf = jest.fn().mockReturnValue([]);
const mockObtenerMotor = jest.fn().mockReturnValue({ resumenEjecutivoParaPdf: mockResumenEjecutivoParaPdf });
jest.mock('../modules/motores-ingenieria', () => ({ obtenerMotor: (...args) => mockObtenerMotor(...args) }));

const {
  construirHtmlCotizacion, generarPdfCotizacion, generarYEnviarCotizacion, resolverImagenBloque, BUCKET_COTIZACIONES_PDF,
} = require('../modules/cotizacion-pdf');

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
    cotizaciones: { data: { id: 1, company_id: 'c1', cliente_id: 7, ejecutivo_id: null, paquete_recomendado_id: null, version: 1, folio: 'COT-001', subtotal: 100, iva: 16, total: 116, ingenieria_validada_para_cotizar_en: '2026-08-04T10:00:00Z' }, error: null },
    cotizacion_lineas: { data: [{ descripcion: 'Paquete 12 paneles', cantidad: 1, precio_unitario: 94000, descuento_pct: 0, subtotal: 94000 }], error: null },
    clientes: { data: { nombre: 'Jorge Villarreal', empresa: null }, error: null },
    companies: { data: { nombre: 'Empresa Demo Paneles Solares', logo_url: null, color_acento: null, correo_contacto: null, sitio_web: null, imagen_hero_url: null }, error: null },
    calculos_ingenieria: { data: { resultados: {}, datos_entrada: {}, motor: 'paneles_solares' }, error: null },
    paquetes_solares: { data: null, error: null },
    usuarios: { data: null, error: null },
  };
  const resultados = { ...defaults, ...overrides };
  const storageUpload = jest.fn().mockResolvedValue({ error: null });
  const db = {
    from: jest.fn((tabla) => crearBuilder(resultados[tabla] ?? { data: null, error: null })),
    storage: { from: jest.fn(() => ({ upload: storageUpload })) },
  };
  return { db, storageUpload };
}

describe('resolverImagenBloque() — cascada Nivel 1 → 2 → 3', () => {
  test('con foto propia (Nivel 1), la usa aunque también exista stock', () => {
    expect(resolverImagenBloque('propia.jpg', 'stock.jpg')).toBe('propia.jpg');
  });
  test('sin foto propia, usa el stock de la industria (Nivel 2)', () => {
    expect(resolverImagenBloque(null, 'stock.jpg')).toBe('stock.jpg');
  });
  test('sin ninguna, devuelve null (Nivel 3 — el caller pinta lo editorial)', () => {
    expect(resolverImagenBloque(null, undefined, '')).toBeNull();
  });
});

describe('construirHtmlCotizacion() — propuesta comercial premium', () => {
  const base = {
    cotizacion: { id: 1, folio: 'COT-001', version: 1, created_at: '2026-08-04T10:00:00Z', subtotal: 94000, iva: 15040, total: 109040 },
    lineas: [{ descripcion: 'Paquete 12 paneles', cantidad: 1, precio_unitario: 94000, descuento_pct: 0, subtotal: 94000 }],
    cliente: { nombre: 'Ana López', empresa: null },
    empresa: { nombre: 'Vive Solar' },
    paquete: null,
    resumenEjecutivo: [],
    pdfConfig: { hero: { titulo: 'Tu nuevo sistema solar', subtitulo: 'Ahorra desde el primer mes.' }, beneficios: [], confianza: [] },
    calculoDatosEntrada: {},
    asesorNombre: 'Karla Reyes',
    whatsappEmpresa: '5218100000000',
    qrDataUri: 'data:image/png;base64,FAKE',
    imagenHero: null,
  };

  test('nunca usa emoji/iconos — el documento es 100% tipografía y geometría', () => {
    const html = construirHtmlCotizacion({
      ...base,
      paquete: { nombre: 'Paquete 12', marca_panel: 'OSDA', marca_inversor: 'Hoymiles', componentes_incluidos: ['monitoreo'], garantias: {} },
      pdfConfig: { ...base.pdfConfig, beneficios: [{ titulo: 'Mayor producción con menos espacio', detalleTecnico: 'Alta eficiencia' }], confianza: [{ titulo: 'Compatible con CFE', detalle: 'Trámite incluido' }] },
    });
    // Ningún emoji común de las versiones anteriores debe sobrevivir
    expect(html).not.toMatch(/[☀️⚡🔋💰💵📊🌱⏱️🔩🔧🔌📋📡🛡️📈🏠📱🌍💸✔️]/u);
  });

  test('portada: título viene ANTES que el precio, siempre', () => {
    const html = construirHtmlCotizacion(base);
    const posTitulo = html.indexOf('Tu nuevo sistema solar');
    const posPrecio = html.indexOf('109,040.00');
    expect(posTitulo).toBeGreaterThan(-1);
    expect(posPrecio).toBeGreaterThan(-1);
    expect(posTitulo).toBeLessThan(posPrecio);
    expect(html).toContain('Ana López');
    expect(html).toContain('Karla Reyes');
  });

  test('portada sin imagenHero: composición editorial (SVG geométrico), nunca una <img> de portada', () => {
    const html = construirHtmlCotizacion({ ...base, imagenHero: null });
    expect(html).toContain('visual-editorial');
    expect(html).not.toContain('visual-foto');
  });

  test('portada con imagenHero (Nivel 1 o 2): usa <img> real, no la composición editorial', () => {
    const html = construirHtmlCotizacion({ ...base, imagenHero: 'https://cdn/instalacion-real.jpg' });
    expect(html).toContain('visual-foto');
    expect(html).toContain('instalacion-real.jpg');
    expect(html).not.toContain('visual-editorial');
  });

  test('"por qué este sistema": narrativa + máximo 3 cifras (nunca 8 tarjetas)', () => {
    const html = construirHtmlCotizacion({
      ...base,
      resumenEjecutivo: [
        { clave: 'ahorro_mensual', etiqueta: 'Ahorro mensual', disponible: true, valorTexto: '$3,401' },
        { clave: 'cobertura', etiqueta: 'Cobertura', disponible: true, valorTexto: '94.5%' },
        { clave: 'numero_paneles', etiqueta: 'Paneles', disponible: true, valorTexto: '12 paneles' },
        { clave: 'ahorro_anual', etiqueta: 'Ahorro anual', disponible: true, valorTexto: '$40,808' },
        { clave: 'reduccion_co2', etiqueta: 'CO2', disponible: true, valorTexto: '4,530 kg' },
      ],
    });
    const coincidencias = (html.match(/class="cifra"/g) || []).length;
    expect(coincidencias).toBeLessThanOrEqual(3);
    expect(html).toContain('$3,401');
  });

  test('"qué recibirás": ficha de panel/inversor sin foto usa monograma editorial, con foto usa la imagen real', () => {
    const sinFotos = construirHtmlCotizacion({ ...base, paquete: { nombre: 'Paquete 12', marca_panel: 'OSDA', modelo_panel: null, marca_inversor: 'Hoymiles', modelo_inversor: 'HMS-2250', componentes_incluidos: [], garantias: {} } });
    expect(sinFotos).toContain('OSDA');
    expect(sinFotos).toContain('visual-editorial');

    const conFotos = construirHtmlCotizacion({ ...base, paquete: { nombre: 'Paquete 12', marca_panel: 'OSDA', imagen_panel_url: 'https://cdn/panel-real.jpg', marca_inversor: 'Hoymiles', componentes_incluidos: [], garantias: {} } });
    expect(conFotos).toContain('panel-real.jpg');
  });

  test('beneficios: título de beneficio primero, dato técnico como detalle chico — nunca "710W" como titular', () => {
    const html = construirHtmlCotizacion({ ...base, pdfConfig: { ...base.pdfConfig, beneficios: [{ titulo: 'Mayor producción con menos espacio', detalleTecnico: 'Panel de 710W de alta eficiencia' }] } });
    const posTitulo = html.indexOf('Mayor producción con menos espacio');
    const posDetalle = html.indexOf('710W de alta eficiencia');
    expect(posTitulo).toBeGreaterThan(-1);
    expect(posTitulo).toBeLessThan(posDetalle);
  });

  test('confianza: combina pdfConfig.confianza con garantías reales del paquete cuando existen', () => {
    const html = construirHtmlCotizacion({
      ...base,
      paquete: { nombre: 'X', componentes_incluidos: [], garantias: { panel: { producto_anios: 12, rendimiento_anios: 25 } } },
      pdfConfig: { ...base.pdfConfig, confianza: [{ titulo: 'Compatible con CFE', detalle: 'Trámite incluido' }] },
    });
    expect(html).toContain('Compatible con CFE');
    expect(html).toContain('12 años producto');
  });

  test('sin garantías reales ni confianza configurada, la sección no aparece (nunca placeholder inventado)', () => {
    const html = construirHtmlCotizacion({ ...base, paquete: { nombre: 'X', componentes_incluidos: [], garantias: {} }, pdfConfig: { ...base.pdfConfig, confianza: [] } });
    expect(html).not.toContain('Respaldo y confianza');
  });

  test('inversión: sin tabla pesada (no usa <table>), muestra líneas + totales + condiciones', () => {
    const html = construirHtmlCotizacion({ ...base, cotizacion: { ...base.cotizacion, anticipo_pct: 50, forma_pago: 'Transferencia', vigencia_dias: 15 } });
    expect(html).not.toContain('<table>');
    expect(html).toContain('50%');
    expect(html).toContain('Transferencia');
    expect(html).toContain('15 días');
  });

  test('footer: incluye la frase de transparencia de TARA exacta', () => {
    const html = construirHtmlCotizacion(base);
    expect(html).toContain('Esta propuesta fue generada mediante nuestro sistema inteligente de análisis y posteriormente revisada y validada por un especialista.');
  });

  test('información de cálculo interno (fórmulas/pctCoberturaDeseado) nunca se filtra al HTML', () => {
    const html = construirHtmlCotizacion({ ...base, calculoDatosEntrada: { ubicacion: 'Monterrey, NL', pctCoberturaDeseado: 0.9, consumoMensualKwh: 900 } });
    expect(html).not.toContain('pctCoberturaDeseado');
    expect(html).not.toContain('consumoMensualKwh');
  });

  test('escapa HTML en campos de texto — nunca inyecta markup', () => {
    const html = construirHtmlCotizacion({ ...base, cliente: { nombre: '<script>alert(1)</script>', empresa: null } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('generarPdfCotizacion()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPdf.mockResolvedValue(Buffer.from('%PDF-fake'));
    mockResumenEjecutivoParaPdf.mockReturnValue([]);
    mockObtenerMotor.mockReturnValue({ resumenEjecutivoParaPdf: mockResumenEjecutivoParaPdf });
    mockObtenerPlantillaDeEmpresa.mockResolvedValue({ cotizacion_pdf_config: {}, imagenes_stock_default: null });
    mockResolverEndpoint.mockResolvedValue('5218100000000');
    mockGenerarQrDataUri.mockResolvedValue('data:image/png;base64,FAKE');
  });

  test('rechaza si puedeEnviarCotizacion() es false — NUNCA genera el PDF', async () => {
    const { db, storageUpload } = crearMockDbPorTabla({ cotizaciones: { data: { id: 1, ingenieria_validada_para_cotizar_en: null }, error: null } });
    await expect(generarPdfCotizacion(db, 1)).rejects.toMatchObject({ status: 409 });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test('resuelve imagenHero en cascada: sin foto de empresa, usa el stock de la plantilla', async () => {
    mockObtenerPlantillaDeEmpresa.mockResolvedValue({ cotizacion_pdf_config: {}, imagenes_stock_default: { hero: 'https://stock/hero.jpg' } });
    const { db } = crearMockDbPorTabla({ companies: { data: { nombre: 'X', imagen_hero_url: null }, error: null } });
    const resultado = await generarPdfCotizacion(db, 1);
    expect(resultado).toBeDefined();
    expect(mockSetContent).toHaveBeenCalledWith(expect.stringContaining('hero.jpg'), expect.anything());
  });

  test('genera el PDF, lo sube y guarda pdf_url', async () => {
    const { db, storageUpload } = crearMockDbPorTabla();
    const resultado = await generarPdfCotizacion(db, 1);
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(storageUpload).toHaveBeenCalledWith(expect.stringContaining('c1/1/'), expect.any(Buffer), expect.objectContaining({ contentType: 'application/pdf' }));
    expect(resultado.storageBucket).toBe(BUCKET_COTIZACIONES_PDF);
  });

  test('si Puppeteer lanza, el browser igual se cierra', async () => {
    const { db } = crearMockDbPorTabla();
    mockSetContent.mockRejectedValueOnce(new Error('timeout de render'));
    await expect(generarPdfCotizacion(db, 1)).rejects.toThrow('timeout de render');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

describe('generarYEnviarCotizacion()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPdf.mockResolvedValue(Buffer.from('%PDF-fake'));
    mockObtenerMotor.mockReturnValue({ resumenEjecutivoParaPdf: jest.fn().mockReturnValue([]) });
    mockObtenerPlantillaDeEmpresa.mockResolvedValue({ cotizacion_pdf_config: {}, imagenes_stock_default: null });
    mockResolverEndpoint.mockResolvedValue('5218100000000');
    mockGenerarQrDataUri.mockResolvedValue('x');
  });

  test('genera el PDF y lo envía; si el envío tiene éxito, marca la cotización como enviada', async () => {
    const { db } = crearMockDbPorTabla();
    mockEnviarDocumentoPorWhatsApp.mockResolvedValue({ estado: 'enviado', message_id: 'wamid.1' });
    const resultado = await generarYEnviarCotizacion(db, { cotizacionId: 1, destinatario: '+528100000000' });
    expect(resultado.estado).toBe('enviado');
  });

  test('si la cotización no está validada, ni siquiera intenta enviar', async () => {
    const { db } = crearMockDbPorTabla({ cotizaciones: { data: { id: 1, ingenieria_validada_para_cotizar_en: null }, error: null } });
    await expect(generarYEnviarCotizacion(db, { cotizacionId: 1, destinatario: '+528100000000' })).rejects.toMatchObject({ status: 409 });
    expect(mockEnviarDocumentoPorWhatsApp).not.toHaveBeenCalled();
  });
});
