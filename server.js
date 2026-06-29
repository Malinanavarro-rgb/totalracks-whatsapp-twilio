/**
 * TARA Matrix™ — server.js
 * Rutas HTTP y arranque del servidor.
 * No contiene lógica de negocio ni de CRM.
 */

require('dotenv').config();
const express = require('express');

const { supabase, COMPANY_SLUG }  = require('./modules/clients');
const { obtenerConfigEmpresa }    = require('./modules/config');
const { crearOrchestrator }       = require('./modules/orchestrator');
const { TwilioWhatsAppAdapter }   = require('./adapters/channels/twilio-whatsapp');

const app         = express();
const adapter     = new TwilioWhatsAppAdapter();
const orchestrator = crearOrchestrator();

app.use(express.urlencoded({ extended: false }));

// ── WEBHOOK TWILIO ────────────────────────────────────────────────────────────

app.post('/webhook/twilio', async (req, res) => {
  try {
    if (!adapter.validateSignature(req)) {
      return res.status(403).type('text/plain').send('Firma inválida');
    }

    const message   = adapter.parseIncoming(req);
    const resultado = await orchestrator.procesarMensaje(message);
    res.type('text/xml').send(adapter.formatOutgoing(resultado.respuesta_texto, req.body));
  } catch (e) {
    console.error('❌ Error en webhook:', e);
    res.type('text/xml').send(adapter.formatOutgoing('Error técnico. Intenta de nuevo.', req.body));
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const { company } = await obtenerConfigEmpresa();
    res.json({
      status:    'OK',
      empresa:   company.nombre,
      slug:      COMPANY_SLUG,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: 'ERROR', error: e.message });
  }
});

// ── DIAGNÓSTICOS — validación de producción ──────────────────────────────────
// Verifica que todos los módulos del Core estén operativos.
// Usar durante el deploy y ante cualquier incidencia.

app.get('/api/diagnostics', async (req, res) => {
  const resultado = {
    timestamp: new Date().toISOString(),
    version:   '2.0.0',
    empresa:   COMPANY_SLUG,
    checks:    {},
    resumen:   { ok: 0, fallo: 0, advertencia: 0 },
  };

  function check(nombre, estado, detalle, extra = {}) {
    resultado.checks[nombre] = { estado, detalle, ...extra };
    resultado.resumen[estado === 'ok' ? 'ok' : estado === 'fallo' ? 'fallo' : 'advertencia']++;
  }

  // ── 1. Variables de entorno críticas ─────────────────────────────────────
  const envVars = {
    SUPABASE_URL:           !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY:      !!process.env.SUPABASE_ANON_KEY,
    OPENAI_API_KEY:         !!process.env.OPENAI_API_KEY,
    TWILIO_ACCOUNT_SID:     !!process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN:      !!process.env.TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER: !!process.env.TWILIO_WHATSAPP_NUMBER,
    WEBHOOK_URL_WHATSAPP:   !!process.env.WEBHOOK_URL_WHATSAPP,
    COMPANY_SLUG:           !!process.env.COMPANY_SLUG,
  };
  const faltantes = Object.entries(envVars).filter(([, v]) => !v).map(([k]) => k);
  const criticas  = faltantes.filter(k => !['TWILIO_WHATSAPP_NUMBER', 'WEBHOOK_URL_WHATSAPP'].includes(k));

  if (criticas.length > 0) {
    check('env_vars', 'fallo', `Faltan variables críticas: ${criticas.join(', ')}`, { faltantes });
  } else if (faltantes.length > 0) {
    check('env_vars', 'advertencia', `Opcionales no definidas: ${faltantes.join(', ')} (firma de Twilio no validada)`, { faltantes });
  } else {
    check('env_vars', 'ok', 'Todas las variables definidas');
  }

  // ── 2. Supabase — lectura ─────────────────────────────────────────────────
  try {
    const t = Date.now();
    const { error } = await supabase.from('clientes').select('id').limit(1);
    if (error) throw error;
    check('supabase_lectura', 'ok', `Tabla clientes accesible`, { latencia_ms: Date.now() - t });
  } catch (e) {
    check('supabase_lectura', 'fallo', e.message);
  }

  // ── 3. Supabase — tabla decision_logs (INSERT real de prueba) ───────────
  // Un SELECT puede retornar { error: null } incluso si RLS bloquea inserts.
  // Validamos con un INSERT + DELETE para confirmar que AuditLogger puede escribir.
  try {
    const t          = Date.now();
    const testId     = '00000000-0000-0000-0000-000000000000'; // company_id ficticio
    const { error: insertError } = await supabase
      .from('decision_logs')
      .insert([{
        company_id:  testId,
        tipo:        'channel_event',
        canal:       'diagnostics',
        identificador: 'test',
        payload:     { subtipo: 'diagnostics_check' },
      }]);

    if (insertError) throw new Error(`INSERT falló: ${insertError.message}`);

    // Limpiar la fila de prueba
    await supabase
      .from('decision_logs')
      .delete()
      .eq('company_id', testId)
      .eq('canal', 'diagnostics');

    check('supabase_decision_logs', 'ok', 'Tabla decision_logs operativa (INSERT confirmado)', {
      latencia_ms: Date.now() - t,
    });
  } catch (e) {
    check('supabase_decision_logs', 'fallo',
      `AuditLogger no puede escribir — ejecutar migrations/001_decision_logs.sql: ${e.message}`);
  }

  // ── 4. Config de empresa ──────────────────────────────────────────────────
  try {
    const t = Date.now();
    const { company, personality, knowledge } = await obtenerConfigEmpresa();
    check('config_empresa', 'ok', `${company.nombre} — ${knowledge.length} secciones de knowledge`, {
      latencia_ms:       Date.now() - t,
      modelo_ia:         personality?.modelo || 'no definido',
      knowledge_count:   knowledge.length,
    });
  } catch (e) {
    check('config_empresa', 'fallo', e.message);
  }

  // ── 5. Módulos del Core ───────────────────────────────────────────────────
  // Usa el orchestrator ya instanciado — no crea una segunda instancia.
  try {
    require('./modules/context-builder');
    require('./modules/prompt-builder');
    require('./modules/ai-engine');
    require('./modules/audit-logger');
    require('./modules/orchestrator');

    // listarProveedores() retorna { proveedor, modelos, es_fallback }
    const proveedores = orchestrator._ai.listarProveedores()
      .map(p => ({ nombre: p.proveedor, es_fallback: p.es_fallback, modelos: p.modelos }));

    check('modulos_core', 'ok', 'Todos los módulos FASE 2 cargados', { proveedores });
  } catch (e) {
    check('modulos_core', 'fallo', e.message);
  }

  // ── 6. Pipeline ContextBuilder → PromptBuilder ───────────────────────────
  try {
    const { ContextBuilder } = require('./modules/context-builder');
    const { PromptBuilder }  = require('./modules/prompt-builder');

    const cb  = new ContextBuilder();
    const pb  = new PromptBuilder();
    const ctx = cb.construir({
      company_id:            'test-diag',
      canal:                 'whatsapp',
      identificador_cliente: '+5210000000000',
      mensaje_actual:        'prueba de diagnóstico',
      empresa_config: {
        company_id:           'test-diag',
        nombre_empresa:       'Test',
        personalidad:         'Asistente de diagnóstico.',
        objetivo_principal:   'Validar pipeline.',
        modelo:               'gpt-4o-mini',
        temperatura:          0.5,
        max_tokens:           300,
        knowledge_base:       '[TEST]\nContenido de prueba.',
        skills:               [],
        campos_requeridos:    [],
        reglas:               [],
        ai_max_turnos_memoria: 4,
        kb_max_secciones:     2,
      },
      datos_cliente:         null,
      historia_conversacion: [],
      resumen_cliente:       null,
      workflow_state:        null,
      capacidades:           ['crear_oportunidad'],
    });

    const prompt    = pb.construir(ctx);
    const aiInput   = cb.prepararParaIA(ctx, prompt);
    const tieneId   = !!aiInput.system_prompt;
    const tieneMsg  = !!aiInput.mensaje_actual;
    const bloques   = (prompt.match(/^## /gm) || []).length;

    check('pipeline_context_prompt', 'ok', `Context + Prompt generados — ${bloques} bloques`, {
      tokens_estimados:  ctx.optimizacion?.tokens_estimados || 0,
      nivel_compresion:  ctx.optimizacion?.nivel_compresion || 'ninguna',
      bloques_en_prompt: bloques,
      aiinput_completo:  tieneMsg,
    });
  } catch (e) {
    check('pipeline_context_prompt', 'fallo', e.message);
  }

  // ── 7. AI Engine con MockProvider ────────────────────────────────────────
  try {
    const { AIEngine }    = require('./modules/ai-engine');
    const { MockProvider } = require('./adapters/ai/mock-provider');
    const { ContextBuilder } = require('./modules/context-builder');
    const { PromptBuilder }  = require('./modules/prompt-builder');

    const cb      = new ContextBuilder();
    const pb      = new PromptBuilder();
    const mock    = new MockProvider({ latencia_ms: 0 });
    const engine  = new AIEngine(mock);

    const ctx = cb.construir({
      company_id:            'test-diag',
      canal:                 'whatsapp',
      identificador_cliente: '+5210000000000',
      mensaje_actual:        'diagnóstico',
      empresa_config: {
        company_id: 'test-diag', nombre_empresa: 'Test',
        personalidad: 'Test.', objetivo_principal: 'Test.',
        modelo: 'mock', temperatura: 0.5, max_tokens: 100,
        knowledge_base: '', skills: [], campos_requeridos: [],
        reglas: [], ai_max_turnos_memoria: 2, kb_max_secciones: 1,
      },
      datos_cliente: null, historia_conversacion: [],
      resumen_cliente: null, workflow_state: null, capacidades: [],
    });

    const t = Date.now();
    const aiInput  = cb.prepararParaIA(ctx, pb.construir(ctx));
    const aiOutput = await engine.procesar(aiInput);
    const latencia = Date.now() - t;

    check('ai_engine_mock', 'ok', `MockProvider responde correctamente`, {
      latencia_ms:         latencia,
      modelo_utilizado:    aiOutput.modelo_utilizado,
      confianza:           aiOutput.confianza,
      respuesta_preview:   aiOutput.respuesta_texto?.substring(0, 60),
    });
  } catch (e) {
    check('ai_engine_mock', 'fallo', e.message);
  }

  // ── Resumen final ─────────────────────────────────────────────────────────
  const todoOk = resultado.resumen.fallo === 0;
  resultado.estado_global = todoOk ? 'LISTO_PARA_PRODUCCION' : 'REQUIERE_ATENCION';

  res.status(todoOk ? 200 : 503).json(resultado);
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

app.get('/api/dashboard', async (req, res) => {
  try {
    const { count: clientesCount } = await supabase
      .from('clientes')
      .select('*', { count: 'exact', head: true });

    const { data: oportunidades } = await supabase
      .from('oportunidades')
      .select('presupuesto_estimado, probabilidad')
      .neq('estado', 'Ganado')
      .neq('estado', 'Perdido');

    const pipeline = (oportunidades || []).reduce(
      (s, o) => s + ((o.presupuesto_estimado || 0) * ((o.probabilidad || 30) / 100)), 0
    );

    res.json({
      empresa:               COMPANY_SLUG,
      clientesTotales:       clientesCount || 0,
      oportunidadesAbiertas: oportunidades?.length || 0,
      pipelineEstimado:      Math.round(pipeline),
      timestamp:             new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROOT ──────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.json({
  sistema:   'TARA Matrix™',
  version:   '2.0.0',
  empresa:   COMPANY_SLUG,
  endpoints: {
    webhook:   'POST /webhook/twilio',
    health:    'GET  /health',
    dashboard: 'GET  /api/dashboard',
  },
}));

// ── INICIO ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log('\n============================================================');
  console.log('🚀 TARA Matrix™ v2.0 — FASE 2 ACTIVA');
  console.log('============================================================');
  console.log(`Puerto:  ${PORT}`);
  console.log(`Empresa: ${COMPANY_SLUG}`);
  console.log('Core:');
  console.log('  M1  ChannelAdapter  — TwilioWhatsAppAdapter');
  console.log('  M2  AI Providers    — OpenAIProvider + MockProvider');
  console.log('  M3  AuditLogger     — fire-and-forget');
  console.log('  M4  ContextBuilder  — sync, puro');
  console.log('  M6  PromptBuilder   — 10 bloques');
  console.log('  M7  Orchestrator    — coordinador único');
  console.log('============================================================\n');

  try {
    await obtenerConfigEmpresa();
    console.log('✅ Config de empresa cargada correctamente\n');
  } catch (e) {
    console.error('⚠️  No se pudo cargar config de empresa:', e.message);
  }
});

module.exports = app;
