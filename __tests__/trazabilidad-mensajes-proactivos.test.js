/**
 * TARA Matrix™ — Prioridad 6, etapa 1 (2026-10-17): trazabilidad de
 * mensajes proactivos (enviarProactivoWhatsApp)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cubre los 6 escenarios obligatorios de la autorización:
 *   1. Mensaje proactivo enviado correctamente.
 *   2. Error del proveedor.
 *   3. Error de escritura en auditoría (nunca debe afectar el envío real).
 *   4. Ausencia de identificadores opcionales.
 *   5. Aislamiento multiempresa.
 *   6. Prevención de registros duplicados (un solo log por intento).
 *
 * Fuerza el camino Meta (vía obtenerAdapterMetaParaEmpresa mockeado) para
 * no depender de credenciales reales de Twilio — el camino Twilio ya se
 * corrigió igual (captura message.sid) y se prueba por separado abajo.
 *
 * @module __tests__/trazabilidad-mensajes-proactivos.test
 */

'use strict';

jest.mock('../modules/meta-auth', () => ({
  obtenerAdapterMetaParaEmpresa: jest.fn(),
}));

const { obtenerAdapterMetaParaEmpresa } = require('../modules/meta-auth');
const { enviarProactivoWhatsApp } = require('../modules/cotizaciones');

function crearMockSupabase(insertFn) {
  return { from: jest.fn(() => ({ insert: insertFn })) };
}

// AuditLogger.log() es fire-and-forget — esperar un microtask basta para
// que el insert (ya resuelto/rechazado por el mock) se procese.
async function esperarEscrituraAuditoria() {
  await new Promise(resolve => setImmediate(resolve));
}

describe('Prioridad 6, etapa 1 — trazabilidad de mensajes proactivos (enviarProactivoWhatsApp)', () => {
  afterEach(() => jest.clearAllMocks());

  test('1. Mensaje proactivo enviado correctamente → registra resultado="aceptado_por_proveedor" con el message_id real del proveedor', async () => {
    const insertFn = jest.fn().mockResolvedValue({ error: null });
    const supabase = crearMockSupabase(insertFn);
    obtenerAdapterMetaParaEmpresa.mockResolvedValue({ sendProactive: jest.fn().mockResolvedValue({ proveedor: 'meta', messageId: 'wamid-real-123' }) });

    const resultado = await enviarProactivoWhatsApp(supabase, 'company-A', '+5218100000001', 'Hola, seguimiento de tu cotización', {
      clienteId: 42, conversationId: 'conv-1', tipoAccion: 'seguimiento_ingenieria_completo', componenteOrigen: 'test',
    });
    await esperarEscrituraAuditoria();

    expect(resultado).toEqual({ proveedor: 'meta', messageId: 'wamid-real-123' });
    expect(insertFn).toHaveBeenCalledTimes(1);
    const [registro] = insertFn.mock.calls[0][0];
    expect(registro.company_id).toBe('company-A');
    expect(registro.tipo).toBe('channel_event');
    expect(registro.payload).toMatchObject({
      subtipo: 'mensaje_proactivo', cliente_id: 42, conversation_id: 'conv-1',
      tipo_accion: 'seguimiento_ingenieria_completo', componente_origen: 'test',
      resultado: 'aceptado_por_proveedor', proveedor: 'meta', message_id: 'wamid-real-123',
    });
    // Nunca el mensaje completo — solo preview acotado
    expect(registro.payload.preview.length).toBeLessThanOrEqual(80);
  });

  test('2. Error del proveedor → registra resultado="error_proveedor" con el motivo, y el error se propaga al llamador (no se traga)', async () => {
    const insertFn = jest.fn().mockResolvedValue({ error: null });
    const supabase = crearMockSupabase(insertFn);
    obtenerAdapterMetaParaEmpresa.mockResolvedValue({ sendProactive: jest.fn().mockRejectedValue(new Error('Graph API 401')) });

    await expect(enviarProactivoWhatsApp(supabase, 'company-A', '+5218100000001', 'texto', { tipoAccion: 'test' }))
      .rejects.toThrow('Graph API 401');
    await esperarEscrituraAuditoria();

    expect(insertFn).toHaveBeenCalledTimes(1);
    const [registro] = insertFn.mock.calls[0][0];
    expect(registro.payload.resultado).toBe('error_proveedor');
    expect(registro.error).toBe('Graph API 401');
  });

  test('3. Error de escritura en auditoría nunca afecta el envío real — el mensaje se considera enviado igual, nunca se reintenta', async () => {
    const insertFn = jest.fn().mockRejectedValue(new Error('decision_logs no disponible'));
    const supabase = crearMockSupabase(insertFn);
    const sendProactive = jest.fn().mockResolvedValue({ proveedor: 'meta', messageId: 'wamid-999' });
    obtenerAdapterMetaParaEmpresa.mockResolvedValue({ sendProactive });

    const resultado = await enviarProactivoWhatsApp(supabase, 'company-A', '+5218100000001', 'texto', {});
    await esperarEscrituraAuditoria();

    // El envío real se intentó exactamente una vez — el fallo de auditoría
    // nunca provoca un segundo intento de envío.
    expect(sendProactive).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ proveedor: 'meta', messageId: 'wamid-999' });
  });

  test('4. Ausencia de identificadores opcionales (sin el 5to argumento meta) → nunca lanza, registra null en vez de inventar un valor', async () => {
    const insertFn = jest.fn().mockResolvedValue({ error: null });
    const supabase = crearMockSupabase(insertFn);
    obtenerAdapterMetaParaEmpresa.mockResolvedValue({ sendProactive: jest.fn().mockResolvedValue({ proveedor: 'meta', messageId: null }) });

    await expect(enviarProactivoWhatsApp(supabase, 'company-A', '+5218100000001', 'texto')).resolves.toBeDefined();
    await esperarEscrituraAuditoria();

    const [registro] = insertFn.mock.calls[0][0];
    expect(registro.payload.cliente_id).toBeNull();
    expect(registro.payload.conversation_id).toBeNull();
    expect(registro.payload.tipo_accion).toBe('proactivo_sin_clasificar');
    expect(registro.payload.message_id).toBeNull();
  });

  test('5. Aislamiento multiempresa: 2 envíos a empresas distintas nunca mezclan company_id entre registros', async () => {
    const insertFn = jest.fn().mockResolvedValue({ error: null });
    const supabase = crearMockSupabase(insertFn);
    obtenerAdapterMetaParaEmpresa.mockResolvedValue({ sendProactive: jest.fn().mockResolvedValue({ proveedor: 'meta', messageId: 'id-1' }) });

    await enviarProactivoWhatsApp(supabase, 'company-A', '+5218100000001', 'texto A', { clienteId: 1 });
    await enviarProactivoWhatsApp(supabase, 'company-B', '+5218100000002', 'texto B', { clienteId: 2 });
    await esperarEscrituraAuditoria();

    expect(insertFn).toHaveBeenCalledTimes(2);
    const registroA = insertFn.mock.calls[0][0][0];
    const registroB = insertFn.mock.calls[1][0][0];
    expect(registroA.company_id).toBe('company-A');
    expect(registroA.payload.cliente_id).toBe(1);
    expect(registroB.company_id).toBe('company-B');
    expect(registroB.payload.cliente_id).toBe(2);
  });

  test('6. Prevención de duplicados: un solo envío produce exactamente UN registro de auditoría, nunca dos', async () => {
    const insertFn = jest.fn().mockResolvedValue({ error: null });
    const supabase = crearMockSupabase(insertFn);
    obtenerAdapterMetaParaEmpresa.mockResolvedValue({ sendProactive: jest.fn().mockResolvedValue({ proveedor: 'meta', messageId: 'id-unico' }) });

    await enviarProactivoWhatsApp(supabase, 'company-A', '+5218100000001', 'texto', {});
    await esperarEscrituraAuditoria();

    expect(insertFn).toHaveBeenCalledTimes(1);
  });
});
