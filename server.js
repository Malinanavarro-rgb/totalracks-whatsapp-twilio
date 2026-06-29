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
