/**
 * TARA Matrix™ — knowledge-requests.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centro de Conocimiento, Fase 5 — "aprendizaje del equipo": cuando alguien
 * no encuentra respuesta a algo en Modo Operador / Centro de Conocimiento,
 * puede reportarlo aquí para que gerencia lo revise y, si corresponde, lo
 * convierta en una entrada real de solar_faq/productos. CRUD simple sobre
 * `knowledge_requests` (migración 107) — sin IA, sin infraestructura nueva.
 *
 * @module modules/knowledge-requests
 */

'use strict';

async function crearSolicitud(supabase, companyId, { question, category, employee_id, source_needed } = {}) {
  if (!question?.trim()) throw new Error('knowledge-requests.crearSolicitud: question requerida');

  const { data, error } = await supabase.from('knowledge_requests')
    .insert({
      company_id: companyId, question: question.trim(), category: category || null,
      employee_id: employee_id || null, source_needed: source_needed || null,
    })
    .select().single();
  if (error) throw new Error(`knowledge-requests.crearSolicitud: ${error.message}`);
  return data;
}

async function listarSolicitudes(supabase, companyId, estado) {
  let query = supabase.from('knowledge_requests').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (estado) query = query.eq('answer_status', estado);

  const { data, error } = await query;
  if (error) throw new Error(`knowledge-requests.listarSolicitudes: ${error.message}`);
  return data || [];
}

async function responderSolicitud(supabase, companyId, id, { respuesta_validada, validado_por } = {}) {
  if (!respuesta_validada?.trim()) throw new Error('knowledge-requests.responderSolicitud: respuesta_validada requerida');

  const { data, error } = await supabase.from('knowledge_requests')
    .update({
      answer_status: 'respondida', respuesta_validada: respuesta_validada.trim(),
      validado_por: validado_por || null, validado_en: new Date().toISOString(),
    })
    .eq('id', id).eq('company_id', companyId).select().maybeSingle();
  if (error) throw new Error(`knowledge-requests.responderSolicitud: ${error.message}`);
  if (!data) throw new Error('knowledge-requests.responderSolicitud: solicitud no encontrada');
  return data;
}

async function rechazarSolicitud(supabase, companyId, id, { razon, validado_por } = {}) {
  const { data, error } = await supabase.from('knowledge_requests')
    .update({
      answer_status: 'rechazada', respuesta_validada: razon?.trim() || null,
      validado_por: validado_por || null, validado_en: new Date().toISOString(),
    })
    .eq('id', id).eq('company_id', companyId).select().maybeSingle();
  if (error) throw new Error(`knowledge-requests.rechazarSolicitud: ${error.message}`);
  if (!data) throw new Error('knowledge-requests.rechazarSolicitud: solicitud no encontrada');
  return data;
}

module.exports = { crearSolicitud, listarSolicitudes, responderSolicitud, rechazarSolicitud };
