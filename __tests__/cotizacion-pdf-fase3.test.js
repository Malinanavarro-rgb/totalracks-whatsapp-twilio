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

const mockObtenerPlantillaDeEmpresa = jest.fn().mockResolvedValue({ cotizacion_pdf_config: { hero: { titulo: 'Propuesta' }, beneficios: [], componentesIconos: {} } });
jest.mock('../modules/plantillas-industria', () => ({ obtenerPlantillaDeEmpresa: (...args) => mockObtenerPlantillaDeEmpresa(...args) }));

const mockResumenEjecutivoParaPdf = jest.fn().mockReturnValue([]);
const mockObtenerMotor = jest.fn().mockReturnValue({ resumenEjecutivoParaPdf: mockResumenEjecutivoParaPdf });
jest.mock('../modules/motores-ingenieria', () => ({ obtenerMotor: (...args) => mockObtenerMotor(...args) }));

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
    cotizaciones: { data: { id: 1, company_id: 'c1', cliente_id: 7, ejecutivo_id: null, paquete_recomendado_id: null, version: 1, folio: 'COT-001', subtotal: 100, iva: 16, total: 116, ingenieria_validada_para_cotizar_en: '2026-08-04T10:00:00Z' }, error: null },
    cotizacion_lineas: { data: [{ descripcion: 'Paquete 12 paneles', cantidad: 1, precio_unitario: 94000, descuento_pct: 0, subtotal: 94000 }], error: null },
    clientes: { data: { nombre: 'Jorge Villarreal', empresa: null }, error: null },
    companies: { data: { nombre: 'Empresa Demo Paneles Solares', logo_url: null, color_acento: null, correo_contacto: null, sitio_web: null }, error: null },
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

describe('construirHtmlCotizacion() — plantilla pura', () => {
  const base = {
    cotizacion: { id: 1, folio: 'COT-001', version: 1, created_at: '2026-08-04T10:00:00Z', subtotal: 94000, iva: 15040, total: 109040 },
    lineas: [{ descripcion: 'Paquete 12 paneles', cantidad: 1, precio_unitario: 94000, descuento_pct: 0, subtotal: 94000 }],
    cliente: { nombre: 'Ana López', empresa: null },
    empresa: { nombre: 'Vive Solar' },
    paquete: null,
    resumenEjecutivo: [],
    pdfConfig: { hero: { titulo: 'Propuesta de Sistema Fotovoltaico', subtitulo: 'Ahorra en tu recibo de luz.' }, beneficios: [], componentesIconos: {} },
    calculoDatosEntrada: {},
    asesorNombre: 'Karla Reyes',
    whatsappEmpresa: '5218100000000',
    qrDataUri: 'data:image/png;base64,FAKE',
  };

  test('portada: título/subtítulo/cliente/folio/asesor — nunca el precio primero', () => {
    const html = construirHtmlCotizacion(base);
    const posPortada = html.indexOf('Propuesta de Sistema Fotovoltaico');
    const posPrecio = html.indexOf('109,040.00');
    expect(posPortada).toBeGreaterThan(-1);
    expect(posPrecio).toBeGreaterThan(-1);
    expect(posPortada).toBeLessThan(posPrecio); // portada ANTES que el precio, siempre
    expect(html).toContain('Ana López');
    expect(html).toContain('COT-001');
    expect(html).toContain('Karla Reyes');
  });

  test('sin logo_url, usa iniciales de la empresa como fallback', () => {
    const html = construirHtmlCotizacion({ ...base, empresa: { nombre: 'Vive Solar' } });
    expect(html).toContain('logo-iniciales');
    expect(html).toContain('>VS<');
  });

  test('con logo_url, usa la imagen real, no iniciales', () => {
    const html = construirHtmlCotizacion({ ...base, empresa: { nombre: 'Vive Solar', logo_url: 'https://x/logo.png' } });
    expect(html).toContain('logo-img');
    expect(html).not.toContain('class="logo-iniciales"');
  });

  test('resumen ejecutivo: solo muestra tarjetas con disponible=true', () => {
    const html = construirHtmlCotizacion({
      ...base,
      resumenEjecutivo: [
        { clave: 'numero_paneles', etiqueta: 'Paneles recomendados', icono: '☀️', disponible: true, valorTexto: '12 paneles' },
        { clave: 'retorno', etiqueta: 'Retorno de tu inversión', icono: '⏱️', disponible: false, valorTexto: null },
      ],
    });
    expect(html).toContain('12 paneles');
    expect(html).not.toContain('Retorno de tu inversión');
  });

  test('sin ninguna tarjeta disponible, no rompe (sección vacía, no "undefined")', () => {
    const html = construirHtmlCotizacion({ ...base, resumenEjecutivo: [{ clave: 'x', etiqueta: 'X', icono: '?', disponible: false, valorTexto: null }] });
    expect(html).not.toContain('undefined');
  });

  test('sistema recomendado: con paquete, muestra fichas y componentes con icono; sin paquete, no revienta', () => {
    const conPaquete = construirHtmlCotizacion({
      ...base,
      paquete: {
        nombre: 'Paquete 12 paneles', potencia_total_kwp: 8.52,
        marca_panel: 'OSDA', modelo_panel: null, potencia_panel_wp: 710,
        tipo_inversor: 'microinversor', marca_inversor: 'Hoymiles', modelo_inversor: 'HMS-2250', cantidad_inversores: 3, entradas_por_inversor: 4,
        componentes_incluidos: ['monitoreo', 'estructura de aluminio'],
        garantias: {},
      },
      pdfConfig: { ...base.pdfConfig, componentesIconos: { monitoreo: '📡' } },
    });
    expect(conPaquete).toContain('OSDA');
    expect(conPaquete).toContain('Hoymiles');
    expect(conPaquete).toContain('HMS-2250');
    expect(conPaquete).toContain('📡'); // icono mapeado
    expect(conPaquete).toContain('✔️'); // icono fallback para "estructura de aluminio", no mapeado

    const sinPaquete = construirHtmlCotizacion({ ...base, paquete: null });
    expect(sinPaquete).not.toContain('undefined');
  });

  test('beneficios: renderiza la lista de pdfConfig.beneficios', () => {
    const html = construirHtmlCotizacion({ ...base, pdfConfig: { ...base.pdfConfig, beneficios: [{ icono: '💸', texto: 'Reduce tu recibo de CFE' }] } });
    expect(html).toContain('Reduce tu recibo de CFE');
    expect(html).toContain('💸');
  });

  test('garantías: sin datos reales, muestra "Consulta con tu asesor" — nunca un número inventado', () => {
    const html = construirHtmlCotizacion({ ...base, paquete: { nombre: 'X', componentes_incluidos: [], garantias: {} } });
    expect(html).toContain('Consulta con tu asesor');
    expect(html).not.toMatch(/\d+\s*años/); // ningún año de garantía inventado
  });

  test('garantías: con datos reales del paquete, los muestra (nunca placeholder si hay dato)', () => {
    const html = construirHtmlCotizacion({
      ...base,
      paquete: { nombre: 'X', componentes_incluidos: [], garantias: { panel: { producto_anios: 12, rendimiento_anios: 25 }, inversor: { garantia_anios: 10, vida_util_anios: 15 } } },
    });
    expect(html).toContain('12 años');
    expect(html).toContain('25 años');
    expect(html).not.toContain('Consulta con tu asesor');
  });

  test('inversión: muestra anticipo/forma_pago/vigencia cuando existen', () => {
    const html = construirHtmlCotizacion({ ...base, cotizacion: { ...base.cotizacion, anticipo_pct: 50, forma_pago: 'Transferencia bancaria', vigencia_dias: 15 } });
    expect(html).toContain('50%');
    expect(html).toContain('Transferencia bancaria');
    expect(html).toContain('15 días');
  });

  test('información técnica: solo campos de contexto, NUNCA fórmulas ni cálculos', () => {
    const html = construirHtmlCotizacion({ ...base, calculoDatosEntrada: { ubicacion: 'Monterrey, NL', tipoAlimentacion: 'trifasica', areaDisponibleM2: 80, pctCoberturaDeseado: 0.9, consumoMensualKwh: 900 } });
    expect(html).toContain('Monterrey, NL');
    expect(html).toContain('trifasica');
    // Nunca se filtran los campos de cálculo interno (Alina: "no colocar fórmulas ni cálculos internos")
    expect(html).not.toContain('pctCoberturaDeseado');
    expect(html).not.toContain('>0.9<');
    expect(html).not.toContain('consumoMensualKwh');
  });

  test('footer: whatsapp/correo/sitio_web/QR', () => {
    const html = construirHtmlCotizacion({ ...base, empresa: { ...base.empresa, correo_contacto: 'hola@vivesolar.mx', sitio_web: 'vivesolar.mx' } });
    expect(html).toContain('5218100000000');
    expect(html).toContain('hola@vivesolar.mx');
    expect(html).toContain('vivesolar.mx');
    expect(html).toContain('data:image/png;base64,FAKE');
  });

  test('escapa HTML en campos de texto (cliente, asesor, beneficios) — nunca inyecta markup', () => {
    const html = construirHtmlCotizacion({ ...base, cliente: { nombre: '<script>alert(1)</script>', empresa: null } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('generarPdfCotizacion()', () => {
  beforeEach(() => { jest.clearAllMocks(); mockPdf.mockResolvedValue(Buffer.from('%PDF-fake')); mockResumenEjecutivoParaPdf.mockReturnValue([]); mockObtenerMotor.mockReturnValue({ resumenEjecutivoParaPdf: mockResumenEjecutivoParaPdf }); mockObtenerPlantillaDeEmpresa.mockResolvedValue({ cotizacion_pdf_config: {} }); mockResolverEndpoint.mockResolvedValue('5218100000000'); mockGenerarQrDataUri.mockResolvedValue('data:image/png;base64,FAKE'); });

  test('rechaza si puedeEnviarCotizacion() es false — NUNCA genera el PDF', async () => {
    const { db, storageUpload } = crearMockDbPorTabla({ cotizaciones: { data: { id: 1, ingenieria_validada_para_cotizar_en: null }, error: null } });
    await expect(generarPdfCotizacion(db, 1)).rejects.toMatchObject({ status: 409 });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  test('con ingeniería validada: usa el motor correcto según calculos_ingenieria.motor para el resumen ejecutivo', async () => {
    const { db } = crearMockDbPorTabla({ calculos_ingenieria: { data: { resultados: { numero_paneles: { valor: 12 } }, datos_entrada: {}, motor: 'paneles_solares' }, error: null } });
    await generarPdfCotizacion(db, 1);
    expect(mockObtenerMotor).toHaveBeenCalledWith('paneles_solares');
    expect(mockResumenEjecutivoParaPdf).toHaveBeenCalledWith({ numero_paneles: { valor: 12 } });
  });

  test('sin cálculo guardado, no truena — resumenEjecutivo queda vacío', async () => {
    const { db } = crearMockDbPorTabla({ calculos_ingenieria: { data: null, error: null } });
    await expect(generarPdfCotizacion(db, 1)).resolves.toBeDefined();
    expect(mockObtenerMotor).not.toHaveBeenCalled();
  });

  test('genera el PDF, lo sube y guarda pdf_url', async () => {
    const { db, storageUpload } = crearMockDbPorTabla();
    const resultado = await generarPdfCotizacion(db, 1);
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(storageUpload).toHaveBeenCalledWith(expect.stringContaining('c1/1/'), expect.any(Buffer), expect.objectContaining({ contentType: 'application/pdf' }));
    expect(resultado.storageBucket).toBe(BUCKET_COTIZACIONES_PDF);
  });

  test('si no se puede resolver el WhatsApp de la empresa, no truena — el PDF se genera sin QR', async () => {
    mockResolverEndpoint.mockRejectedValue(new Error('sin endpoint'));
    const { db } = crearMockDbPorTabla();
    await expect(generarPdfCotizacion(db, 1)).resolves.toBeDefined();
    expect(mockGenerarQrDataUri).not.toHaveBeenCalled();
  });

  test('si Puppeteer lanza, el browser igual se cierra (no deja procesos huérfanos)', async () => {
    const { db } = crearMockDbPorTabla();
    mockSetContent.mockRejectedValueOnce(new Error('timeout de render'));
    await expect(generarPdfCotizacion(db, 1)).rejects.toThrow('timeout de render');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

describe('generarYEnviarCotizacion()', () => {
  beforeEach(() => { jest.clearAllMocks(); mockPdf.mockResolvedValue(Buffer.from('%PDF-fake')); mockObtenerMotor.mockReturnValue({ resumenEjecutivoParaPdf: jest.fn().mockReturnValue([]) }); mockObtenerPlantillaDeEmpresa.mockResolvedValue({ cotizacion_pdf_config: {} }); mockResolverEndpoint.mockResolvedValue('5218100000000'); mockGenerarQrDataUri.mockResolvedValue('x'); });

  test('genera el PDF y lo envía; si el envío tiene éxito, marca la cotización como enviada', async () => {
    const { db } = crearMockDbPorTabla();
    mockEnviarDocumentoPorWhatsApp.mockResolvedValue({ estado: 'enviado', message_id: 'wamid.1' });
    const resultado = await generarYEnviarCotizacion(db, { cotizacionId: 1, destinatario: '+528100000000' });
    expect(mockEnviarDocumentoPorWhatsApp).toHaveBeenCalledWith(db, expect.objectContaining({ cotizacionId: 1, destinatario: '+528100000000', cotizacionVersion: 1 }));
    expect(resultado.estado).toBe('enviado');
  });

  test('si el envío falla, NO marca la cotización como enviada', async () => {
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
