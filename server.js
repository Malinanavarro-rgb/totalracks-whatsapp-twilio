/**
 * TARA Matrix™ — server.js
 * Rutas HTTP y arranque del servidor.
 * No contiene lógica de negocio ni de CRM.
 */

require('dotenv').config();
const express = require('express');
const twilio  = require('twilio');

const { supabase, COMPANY_SLUG }  = require('./modules/clients');
const { obtenerConfigEmpresa }    = require('./modules/config');
const { procesarMensajeTwilio }   = require('./modules/service');

const app = express();
app.use(express.urlencoded({ extended: false }));

// ── WEBHOOK TWILIO ────────────────────────────────────────────────────────────

app.post('/webhook/twilio', async (req, res) => {
  try {
    const telefono       = req.body.From.replace('whatsapp:', '');
    const mensajeCliente = req.body.Body;
    const respuesta      = await procesarMensajeTwilio(telefono, mensajeCliente);
    const twiml          = new twilio.twiml.MessagingResponse();
    twiml.message(respuesta);
    res.type('text/xml').send(twiml.toString());
  } catch (e) {
    console.error('Error webhook:', e);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Error técnico. Intenta de nuevo.');
    res.type('text/xml').send(twiml.toString());
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
      empresa:              COMPANY_SLUG,
      clientesTotales:      clientesCount || 0,
      oportunidadesAbiertas: oportunidades?.length || 0,
      pipelineEstimado:     Math.round(pipeline),
      timestamp:            new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ROOT ──────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.json({
  sistema:   'TARA Matrix™',
  version:   '1.1.0',
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
  console.log('🚀 TARA Matrix™ v1.1 — FASE 1 ACTIVA');
  console.log('============================================================');
  console.log(`Puerto:  ${PORT}`);
  console.log(`Empresa: ${COMPANY_SLUG}`);
  console.log(`Módulos: clients · config · crm · prompts · openai`);
  console.log(`         service · decision · summary`);
  console.log('============================================================\n');

  try {
    await obtenerConfigEmpresa();
  } catch (e) {
    console.error('⚠️  No se pudo cargar config de empresa:', e.message);
  }
});

module.exports = app;
