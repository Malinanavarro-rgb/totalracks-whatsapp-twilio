/**
 * TARA Matrix™ — enviar-recordatorios
 * ─────────────────────────────────────────────────────────────────────────────
 * Entrypoint standalone para el Render Cron Job (ANEXO A, TA.7).
 * No es parte del servidor Express — corre una vez y termina.
 *
 * Uso: node scripts/enviar-recordatorios.js
 *
 * @module scripts/enviar-recordatorios
 */

'use strict';

require('dotenv').config();

const { supabase, openai, twilioClient } = require('../modules/clients');
const { AIEngine }               = require('../modules/ai-engine');
const { OpenAIProvider }         = require('../adapters/ai/openai-provider');
const { MockProvider }           = require('../adapters/ai/mock-provider');
const { TwilioWhatsAppAdapter }  = require('../adapters/channels/twilio-whatsapp');
const { ChannelRouter }           = require('../modules/channel-router');
const { enviarRecordatoriosPendientes } = require('../modules/recordatorios');

(async () => {
  const mock     = new MockProvider({ latencia_ms: 0 });
  const aiEngine = new AIEngine(mock);
  aiEngine.registerProvider(new OpenAIProvider(openai));

  const channelAdapter = new TwilioWhatsAppAdapter(twilioClient);
  const channelRouter  = new ChannelRouter(supabase);

  const resultado = await enviarRecordatoriosPendientes({ supabase, aiEngine, channelAdapter, channelRouter });
  console.log(`✅ Recordatorios: ${resultado.enviados} enviados, ${resultado.fallidos} fallidos`);
  process.exit(0);
})().catch(err => {
  console.error('❌ Error fatal en enviar-recordatorios:', err);
  process.exit(1);
});
