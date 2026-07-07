/**
 * TARA Matrix™ — server.js
 * Rutas HTTP y arranque del servidor.
 * No contiene lógica de negocio ni de CRM.
 *
 * FASE 3: routing multi-tenant dinámico por channel_endpoints.
 * COMPANY_SLUG eliminado — el servidor ya no es single-tenant.
 */

require('dotenv').config();
const express = require('express');

const { supabase, twilioClient }        = require('./modules/clients');
const { obtenerConfigEmpresa }          = require('./modules/config');
const { crearOrchestrator }             = require('./modules/orchestrator');
const { TwilioWhatsAppAdapter }         = require('./adapters/channels/twilio-whatsapp');
const { ChannelRouter }                 = require('./modules/channel-router');

const app           = express();
const adapter       = new TwilioWhatsAppAdapter(twilioClient);
const orchestrator  = crearOrchestrator();
const channelRouter = new ChannelRouter(supabase);

app.use(express.urlencoded({ extended: false }));

// ── Cola por conversación ─────────────────────────────────────────────────────
// Serializa mensajes del mismo número para evitar race conditions cuando el
// cliente envía dos mensajes consecutivos antes de recibir respuesta al primero.

const processingQueue = new Map();

function enqueueForPhone(phone, fn) {
  const prev = processingQueue.get(phone) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(fn);
  let marker;
  marker = task.finally(() => {
    if (processingQueue.get(phone) === marker) processingQueue.delete(phone);
  });
  processingQueue.set(phone, marker);
  return task;
}

// ── WEBHOOK TWILIO ────────────────────────────────────────────────────────────

app.post('/webhook/twilio', async (req, res) => {
  try {
    if (!adapter.validateSignature(req)) {
      return res.status(403).type('text/plain').send('Firma inválida');
    }

    const message = adapter.parseIncoming(req);

    // FASE 3 — routing dinámico: resolver empresa por número receptor
    const routeResult = await channelRouter.enrutar(message.incoming_endpoint);
    if (!routeResult) {
      console.warn('⚠️  Endpoint sin empresa registrada:', message.incoming_endpoint);
      return res.type('text/xml').send('<Response></Response>');
    }
    message.company_id = routeResult.company_id;

    const resultado = await enqueueForPhone(
      message.from,
      () => orchestrator.procesarMensaje(message)
    );
    res.type('text/xml').send(adapter.formatOutgoing(resultado.respuesta_texto, req.body));
  } catch (e) {
    console.error('❌ Error en webhook:', e);
    res.type('text/xml').send(adapter.formatOutgoing('Error técnico. Intenta de nuevo.', req.body));
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const { data } = await supabase
      .from('companies')
      .select('nombre')
      .eq('estado', 'activo')
      .limit(1)
      .maybeSingle();

    res.json({
      status:    'OK',
      empresa:   data?.nombre || 'multi-tenant',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: 'ERROR', error: e.message });
  }
});

// ── DIAGNÓSTICOS ──────────────────────────────────────────────────────────────

app.get('/api/diagnostics', async (req, res) => {
  const resultado = {
    timestamp: new Date().toISOString(),
    version:   '3.0.0',
    modo:      'multi-tenant',
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
  };
  const faltantes = Object.entries(envVars).filter(([, v]) => !v).map(([k]) => k);
  const criticas  = faltantes.filter(k => !['TWILIO_WHATSAPP_NUMBER', 'WEBHOOK_URL_WHATSAPP'].includes(k));

  if (criticas.length > 0) {
    check('env_vars', 'fallo', `Faltan variables críticas: ${criticas.join(', ')}`, { faltantes });
  } else if (faltantes.length > 0) {
    check('env_vars', 'advertencia', `Opcionales no definidas: ${faltantes.join(', ')}`, { faltantes });
  } else {
    check('env_vars', 'ok', 'Todas las variables definidas');
  }

  // ── 2. Supabase — lectura ─────────────────────────────────────────────────
  try {
    const t = Date.now();
    const { error } = await supabase.from('clientes').select('id').limit(1);
    if (error) throw error;
    check('supabase_lectura', 'ok', 'Tabla clientes accesible', { latencia_ms: Date.now() - t });
  } catch (e) {
    check('supabase_lectura', 'fallo', e.message);
  }

  // ── 3. Supabase — decision_logs (INSERT real de prueba) ──────────────────
  try {
    const t      = Date.now();
    const testId = '00000000-0000-0000-0000-000000000000';
    const { error: insertError } = await supabase
      .from('decision_logs')
      .insert([{ company_id: testId, tipo: 'channel_event', canal: 'diagnostics',
                 identificador: 'test', payload: { subtipo: 'diagnostics_check' } }]);

    if (insertError) throw new Error(`INSERT falló: ${insertError.message}`);

    await supabase.from('decision_logs').delete()
      .eq('company_id', testId).eq('canal', 'diagnostics');

    check('supabase_decision_logs', 'ok', 'Tabla decision_logs operativa (INSERT confirmado)',
      { latencia_ms: Date.now() - t });
  } catch (e) {
    check('supabase_decision_logs', 'fallo', e.message);
  }

  // ── 4. channel_endpoints — routing multi-tenant ───────────────────────────
  try {
    const t = Date.now();
    const { data: endpoints, error } = await supabase
      .from('channel_endpoints')
      .select('endpoint, canal, activo, companies(nombre)')
      .eq('activo', true);

    if (error) throw error;
    if (!endpoints || endpoints.length === 0) {
      check('channel_routing', 'fallo', 'No hay endpoints activos en channel_endpoints');
    } else {
      check('channel_routing', 'ok',
        `${endpoints.length} endpoint(s) activo(s)`,
        { latencia_ms: Date.now() - t,
          endpoints: endpoints.map(e => `${e.canal}:${e.companies?.nombre || '?'}`) });
    }
  } catch (e) {
    check('channel_routing', 'fallo', e.message);
  }

  // ── 5. Config de empresa (primer endpoint activo) ─────────────────────────
  try {
    const t = Date.now();
    const { data: ep } = await supabase
      .from('channel_endpoints').select('company_id').eq('activo', true).limit(1).maybeSingle();

    if (!ep) throw new Error('No hay endpoints activos para probar config');

    const { company, personality, knowledge } = await obtenerConfigEmpresa(ep.company_id);
    check('config_empresa', 'ok',
      `${company.nombre} — ${knowledge.length} secciones de knowledge`,
      { latencia_ms: Date.now() - t, modelo_ia: personality?.modelo || 'no definido',
        knowledge_count: knowledge.length });
  } catch (e) {
    check('config_empresa', 'fallo', e.message);
  }

  // ── 6. Módulos del Core ───────────────────────────────────────────────────
  try {
    require('./modules/context-builder');
    require('./modules/prompt-builder');
    require('./modules/ai-engine');
    require('./modules/audit-logger');
    require('./modules/orchestrator');

    const proveedores = orchestrator._ai.listarProveedores()
      .map(p => ({ nombre: p.proveedor, es_fallback: p.es_fallback, modelos: p.modelos }));

    check('modulos_core', 'ok', 'Todos los módulos FASE 3 cargados', { proveedores });
  } catch (e) {
    check('modulos_core', 'fallo', e.message);
  }

  // ── 7. Pipeline ContextBuilder → PromptBuilder ───────────────────────────
  try {
    const { ContextBuilder } = require('./modules/context-builder');
    const { PromptBuilder }  = require('./modules/prompt-builder');

    const cb  = new ContextBuilder();
    const pb  = new PromptBuilder();
    const ctx = cb.construir({
      company_id: 'test-diag', canal: 'whatsapp',
      identificador_cliente: '+5210000000000',
      mensaje_actual: 'prueba de diagnóstico',
      empresa_config: {
        company_id: 'test-diag', nombre_empresa: 'Test',
        personalidad: 'Asistente de diagnóstico.', objetivo_principal: 'Validar pipeline.',
        modelo: 'gpt-4o-mini', temperatura: 0.5, max_tokens: 300,
        knowledge_base: '[TEST]\nContenido de prueba.',
        skills: [], campos_requeridos: [], reglas: [],
        ai_max_turnos_memoria: 4, kb_max_secciones: 2,
      },
      datos_cliente: null, historia_conversacion: [],
      resumen_cliente: null, workflow_state: null, capacidades: ['crear_oportunidad'],
    });

    const prompt   = pb.construir(ctx);
    const aiInput  = cb.prepararParaIA(ctx, prompt);
    const bloques  = (prompt.match(/^## /gm) || []).length;

    check('pipeline_context_prompt', 'ok', `Context + Prompt generados — ${bloques} bloques`, {
      tokens_estimados:  ctx.optimizacion?.tokens_estimados || 0,
      nivel_compresion:  ctx.optimizacion?.nivel_compresion || 'ninguna',
      bloques_en_prompt: bloques,
      aiinput_completo:  !!aiInput.mensaje_actual,
    });
  } catch (e) {
    check('pipeline_context_prompt', 'fallo', e.message);
  }

  // ── 8. AI Engine con MockProvider ────────────────────────────────────────
  try {
    const { AIEngine }        = require('./modules/ai-engine');
    const { MockProvider }    = require('./adapters/ai/mock-provider');
    const { ContextBuilder }  = require('./modules/context-builder');
    const { PromptBuilder }   = require('./modules/prompt-builder');

    const cb     = new ContextBuilder();
    const pb     = new PromptBuilder();
    const mock   = new MockProvider({ latencia_ms: 0 });
    const engine = new AIEngine(mock);

    const ctx = cb.construir({
      company_id: 'test-diag', canal: 'whatsapp',
      identificador_cliente: '+5210000000000', mensaje_actual: 'diagnóstico',
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

    const t       = Date.now();
    const aiInput  = cb.prepararParaIA(ctx, pb.construir(ctx));
    const aiOutput = await engine.procesar(aiInput);

    check('ai_engine_mock', 'ok', 'MockProvider responde correctamente', {
      latencia_ms:       Date.now() - t,
      modelo_utilizado:  aiOutput.modelo_utilizado,
      confianza:         aiOutput.confianza,
      respuesta_preview: aiOutput.respuesta_texto?.substring(0, 60),
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
      .from('clientes').select('*', { count: 'exact', head: true });

    const { data: oportunidades } = await supabase
      .from('oportunidades').select('presupuesto_estimado, probabilidad')
      .neq('estado', 'Ganado').neq('estado', 'Perdido');

    const pipeline = (oportunidades || []).reduce(
      (s, o) => s + ((o.presupuesto_estimado || 0) * ((o.probabilidad || 30) / 100)), 0
    );

    res.json({
      modo:                  'multi-tenant',
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
  version:   '3.0.0',
  modo:      'multi-tenant',
  endpoints: {
    webhook:     'POST /webhook/twilio',
    health:      'GET  /health',
    diagnostics: 'GET  /api/diagnostics',
    dashboard:   'GET  /api/dashboard',
  },
}));

// ── INICIO ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log('\n============================================================');
  console.log('🚀 TARA Matrix™ v3.0 — FASE 3 ACTIVA — Multi-tenant');
  console.log('============================================================');
  console.log(`Puerto: ${PORT}`);
  console.log('Routing: dinámico por channel_endpoints (no COMPANY_SLUG)');
  console.log('Core:');
  console.log('  M1  ChannelAdapter  — TwilioWhatsAppAdapter');
  console.log('  M2  AI Providers    — OpenAIProvider + MockProvider');
  console.log('  M3  AuditLogger     — fire-and-forget');
  console.log('  M4  ContextBuilder  — sync, puro');
  console.log('  M6  PromptBuilder   — 10 bloques');
  console.log('  M7  Orchestrator    — coordinador único');
  console.log('  RT  ChannelRouter   — enrutamiento multi-tenant');
  console.log('============================================================\n');

  try {
    const { data: endpoints } = await supabase
      .from('channel_endpoints').select('endpoint, companies(nombre)').eq('activo', true);
    if (endpoints?.length) {
      endpoints.forEach(e => console.log(`  ✅ ${e.endpoint} → ${e.companies?.nombre}`));
    } else {
      console.warn('  ⚠️  No hay channel_endpoints activos en Supabase');
    }
    console.log('');
  } catch (e) {
    console.error('  ⚠️  No se pudieron cargar channel_endpoints:', e.message);
  }
});

module.exports = app;
