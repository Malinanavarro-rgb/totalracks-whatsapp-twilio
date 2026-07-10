/**
 * TARA Matrix™ — recordatorios (ANEXO A, TA.7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Disparador de recordatorios de citas. Primera pieza de TARA que no
 * reacciona a un mensaje entrante — corre por sí sola (Render Cron Job,
 * ver scripts/enviar-recordatorios.js).
 *
 * Regla de mensajes operativos (Anexo, sección 4.2.1): la plantilla es
 * siempre la fuente confiable de fecha/hora/asesor. La personalización de
 * IA es un paso posterior, opcional, con timeout corto — si no responde a
 * tiempo o falla, se envía la plantilla base tal cual. El envío nunca se
 * bloquea esperando a OpenAI.
 *
 * Todo se recibe por parámetro (supabase, aiEngine, channelAdapter) — mismo
 * principio de inyección de dependencias que SchedulingEngine.
 *
 * @module modules/recordatorios
 */

'use strict';

const { renderizarPlantilla } = require('./mensaje-automatico');

const ZONA_HORARIA_DEFAULT = 'America/Monterrey';
const CITAS_RECORDABLES = ['agendada', 'confirmada'];

function formatearFecha(fechaISO) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA_HORARIA_DEFAULT, day: 'numeric', month: 'long',
  }).format(new Date(fechaISO));
}

function formatearHora(fechaISO) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA_HORARIA_DEFAULT, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(fechaISO));
}

function conTimeout(promesa, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout de personalización IA')), ms);
  });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(timeoutId));
}

/**
 * Envía recordatorios para las citas próximas dentro de la ventana indicada.
 * Cada cita se procesa de forma aislada — una que falla no detiene al resto
 * (mismo principio que Orchestrator._ejecutarAcciones).
 *
 * @param {Object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {import('./ai-engine').AIEngine} params.aiEngine
 * @param {import('../adapters/channels/channel-adapter').ChannelAdapter} params.channelAdapter
 * @param {import('./channel-router').ChannelRouter} params.channelRouter - resuelve el número
 *   de WhatsApp propio de cada empresa (channel_endpoints) — nunca se asume un único número global.
 * @param {Date}   [params.ahora=new Date()]
 * @param {number} [params.ventanaHoras=24]
 * @param {number} [params.timeoutIaMs=3000]
 * @returns {Promise<{enviados: number, fallidos: number}>}
 */
async function enviarRecordatoriosPendientes({
  supabase, aiEngine, channelAdapter, channelRouter,
  ahora = new Date(), ventanaHoras = 24, timeoutIaMs = 3000,
}) {
  const hasta = new Date(ahora.getTime() + ventanaHoras * 3600 * 1000);

  const { data: citas, error } = await supabase
    .from('citas')
    .select('*, clientes(nombre, telefono), asesores(nombre)')
    .in('estado', CITAS_RECORDABLES)
    .eq('recordatorio_enviado', false)
    .gte('inicio', ahora.toISOString())
    .lte('inicio', hasta.toISOString());

  if (error) {
    console.error('❌ recordatorios: fallo consultando citas pendientes:', error.message);
    return { enviados: 0, fallidos: 0 };
  }

  let enviados = 0;
  let fallidos = 0;

  for (const cita of citas || []) {
    try {
      const seEnvio = await _procesarRecordatorio(cita, { supabase, aiEngine, channelAdapter, channelRouter, timeoutIaMs });
      if (seEnvio) enviados++;
    } catch (err) {
      fallidos++;
      console.error(`❌ recordatorios: fallo procesando cita ${cita.id}:`, err.message);
    }
  }

  return { enviados, fallidos };
}

async function _procesarRecordatorio(cita, { supabase, aiEngine, channelAdapter, channelRouter, timeoutIaMs }) {
  const { data: plantillaRow, error: errorPlantilla } = await supabase
    .from('mensajes_automaticos')
    .select('*')
    .eq('company_id', cita.company_id)
    .eq('tipo', 'recordatorio_cita')
    .eq('activo', true)
    .maybeSingle();

  if (errorPlantilla || !plantillaRow) {
    console.warn(`⚠️  recordatorios: sin plantilla activa de recordatorio_cita para empresa ${cita.company_id}`);
    return false;
  }

  const variables = {
    nombre: cita.clientes?.nombre || '',
    asesor: cita.asesores?.nombre || '',
    fecha:  formatearFecha(cita.inicio),
    hora:   formatearHora(cita.inicio),
  };

  let mensaje = renderizarPlantilla(plantillaRow.plantilla, variables);

  if (plantillaRow.permite_ia) {
    try {
      const aiOutput = await conTimeout(
        aiEngine.procesar({
          system_prompt: 'Genera solo una frase breve y cálida (máximo 8 palabras) para anteponer a un recordatorio de cita. No agregues datos nuevos ni fechas.',
          mensaje_actual: mensaje,
          memoria_corta: [],
          temperatura: 0.7,
          max_tokens: 30,
          modelo: 'gpt-4o-mini',
        }),
        timeoutIaMs
      );
      if (aiOutput?.respuesta_texto) {
        mensaje = `${aiOutput.respuesta_texto.trim()} ${mensaje}`;
      }
    } catch (err) {
      console.warn(`⚠️  recordatorios: personalización IA no disponible a tiempo (${err.message}) — se envía la plantilla base`);
    }
  }

  const numeroOrigen = await channelRouter.resolverEndpointDeEmpresa(cita.company_id);
  await channelAdapter.sendProactive(mensaje, cita.clientes.telefono, numeroOrigen);

  await supabase
    .from('citas')
    .update({ recordatorio_enviado: true })
    .eq('id', cita.id);

  return true;
}

module.exports = { enviarRecordatoriosPendientes };
