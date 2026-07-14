/**
 * TARA — asistente-consultas.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fase Demo Comercial: "Pregúntale a TARA" en la ficha de un cliente —
 * preguntas libres ("¿qué pasó con este cliente?", "¿ya puedo enviar la
 * cotización?") respondidas con una llamada de IA real, basada en la
 * conversación que TARA acaba de tener con ese cliente.
 *
 * Deliberadamente separado del motor conversacional (modules/orchestrator.js,
 * congelado por ADR-005): esto es una consulta de solo lectura para el
 * usuario del panel, nunca escribe en `conversaciones` ni activa un
 * workflow — un uso de OpenAI aparte, con su propio prompt.
 *
 * @module modules/asistente-consultas
 */

'use strict';

const { openai } = require('./clients');
const { obtenerHistorial } = require('./conversaciones');

const SYSTEM_PROMPT = [
  'Eres TARA, la asistente de ventas de esta empresa.',
  'Responde en español, en 1-3 oraciones, directo y honesto.',
  'Básate ÚNICAMENTE en el contexto de este cliente que se te da a continuación.',
  'Si no hay suficiente información para responder con certeza, dilo claramente en vez de inventar.',
].join(' ');

function _armarContexto({ cliente, oportunidad, capturedFields, historial }) {
  const partes = [
    `Cliente: ${cliente?.nombre || 'Sin nombre'}${cliente?.empresa ? ` (${cliente.empresa})` : ''}`,
    oportunidad
      ? `Oportunidad actual: etapa "${oportunidad.estado}"${oportunidad.descripcion ? ` — ${oportunidad.descripcion}` : ''}${oportunidad.presupuesto_confirmado || oportunidad.presupuesto_estimado ? ` — presupuesto: $${oportunidad.presupuesto_confirmado ?? oportunidad.presupuesto_estimado}` : ''}`
      : 'Sin oportunidad registrada todavía.',
    capturedFields && Object.keys(capturedFields).length > 0
      ? `Datos capturados en la conversación: ${JSON.stringify(capturedFields)}`
      : null,
    `Conversación completa:\n${
      historial.length > 0
        ? historial.map(m => `${m.de === 'cliente' ? 'Cliente' : 'TARA'}: ${m.texto}`).join('\n')
        : '(sin mensajes todavía)'
    }`,
  ];
  return partes.filter(Boolean).join('\n\n');
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {string|number} clienteId
 * @param {string} pregunta
 * @returns {Promise<string>} la respuesta de TARA, en texto plano
 */
async function responderSobreCliente(supabase, company_id, clienteId, pregunta) {
  const [historial, clienteRes, oportunidadesRes, sesionRes] = await Promise.all([
    obtenerHistorial(supabase, company_id, clienteId),
    supabase.from('clientes').select('nombre, empresa, estado, score_interes')
      .eq('id', clienteId).eq('company_id', company_id).maybeSingle(),
    supabase.from('oportunidades').select('estado, descripcion, presupuesto_estimado, presupuesto_confirmado, proxima_accion')
      .eq('cliente_id', clienteId).eq('company_id', company_id)
      .order('updated_at', { ascending: false }).limit(1),
    supabase.from('workflow_sessions').select('captured_fields')
      .eq('cliente_id', clienteId).eq('company_id', company_id)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const contexto = _armarContexto({
    cliente:        clienteRes.data,
    oportunidad:    (oportunidadesRes.data || [])[0] || null,
    capturedFields: sesionRes.data?.captured_fields,
    historial,
  });

  try {
    const response = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `${contexto}\n\nPregunta: ${pregunta}` },
      ],
      temperature: 0.4,
      max_tokens:  300,
    });
    return response.choices[0].message.content.trim();
  } catch (e) {
    console.error('Error en asistente-consultas.responderSobreCliente:', e.message);
    return 'No pude generar una respuesta en este momento — intenta de nuevo en unos segundos.';
  }
}

module.exports = { responderSobreCliente };
