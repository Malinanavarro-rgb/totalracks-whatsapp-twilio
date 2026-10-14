/**
 * TARA Matrix™ — clasificacion-cliente.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistencia de la clasificación de conversación (Alina, 2026-10-14, Nort
 * Energy — punto 8 del plan de corrección). Reutiliza el catálogo de
 * modules/clasificacion-contexto.js — la IA ya clasifica cada turno, esto
 * finalmente guarda ese dato en vez de descartarlo después de loguearlo.
 *
 * Dos caminos, con una sola regla: una clasificación MANUAL nunca se pisa
 * con una automática posterior.
 *   - actualizarClasificacionAutomatica(): la llama el Orchestrator en cada
 *     turno (capa de plataforma, vía dependencia inyectada — el Core nunca
 *     importa este módulo, mismo patrón que modules/crm.js).
 *   - reclasificarManualmente(): la llama un empleado desde el CRM. Siempre
 *     gana, y queda registrada en bitacora_decisiones (igual que cualquier
 *     otra decisión de negocio sobre un cliente — tabla ya existente, no se
 *     crea una nueva solo para esto).
 *
 * @module modules/clasificacion-cliente
 */

'use strict';

const { VALORES_CLASIFICACION_CONTEXTO } = require('./clasificacion-contexto');

// Subconjunto expuesto para reclasificación MANUAL (CrmClienteDetalle.jsx) —
// 'proveedor' e 'informacion_administrativa' quedan fuera de la UI manual
// (un empleado no necesita marcar eso a mano), pero siguen siendo valores
// válidos de la columna porque la IA sí puede asignarlos automáticamente.
// Todos son valores REALES del catálogo existente — ninguno nuevo.
const OPCIONES_RECLASIFICACION_MANUAL = [
  { valor: 'prospecto',            etiqueta: 'Prospecto comercial' },
  { valor: 'cliente_existente',    etiqueta: 'Cliente' },
  { valor: 'conversacion_personal', etiqueta: 'Conversación personal' },
  { valor: 'numero_equivocado',     etiqueta: 'Número equivocado' },
  { valor: 'spam',                  etiqueta: 'Spam' },
  { valor: 'contexto_insuficiente', etiqueta: 'Pendiente de clasificar' },
];

/**
 * Clasificación automática — un turno de conversación. Nunca lanza (no debe
 * poder tumbar la respuesta al cliente); nunca pisa una clasificación
 * 'manual' ya existente.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} clienteId
 * @param {string} companyId
 * @param {string|null|undefined} clasificacion - aiOutput.clasificacion_contexto del turno actual
 */
async function actualizarClasificacionAutomatica(supabase, clienteId, companyId, clasificacion) {
  if (!clienteId || !clasificacion || !VALORES_CLASIFICACION_CONTEXTO.has(clasificacion)) return;

  const { data: cliente } = await supabase
    .from('clientes').select('tipo_contacto_fuente').eq('id', clienteId).eq('company_id', companyId).maybeSingle();
  if (cliente?.tipo_contacto_fuente === 'manual') return;

  await supabase.from('clientes').update({
    tipo_contacto: clasificacion,
    tipo_contacto_fuente: 'ia',
    tipo_contacto_actualizado_en: new Date().toISOString(),
    tipo_contacto_actualizado_por: null,
  }).eq('id', clienteId).eq('company_id', companyId);
}

/**
 * Reclasificación manual — siempre gana sobre lo automático. Queda
 * registrada en bitacora_decisiones (mismo patrón que cualquier otra
 * decisión de negocio sobre un cliente/proyecto en este sistema).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{clienteId: string, companyId: string, nuevaClasificacion: string, usuarioId: string}} datos
 * @returns {Promise<Object>} el cliente ya actualizado
 */
async function reclasificarManualmente(supabase, { clienteId, companyId, nuevaClasificacion, usuarioId }) {
  if (!OPCIONES_RECLASIFICACION_MANUAL.some((o) => o.valor === nuevaClasificacion)) {
    const err = new Error(`Clasificación "${nuevaClasificacion}" no es una opción manual válida.`);
    err.status = 400;
    throw err;
  }

  const { data: anterior } = await supabase
    .from('clientes').select('nombre, tipo_contacto').eq('id', clienteId).eq('company_id', companyId).maybeSingle();
  if (!anterior) {
    const err = new Error('Cliente no encontrado.');
    err.status = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('clientes')
    .update({
      tipo_contacto: nuevaClasificacion,
      tipo_contacto_fuente: 'manual',
      tipo_contacto_actualizado_en: new Date().toISOString(),
      tipo_contacto_actualizado_por: usuarioId || null,
    })
    .eq('id', clienteId)
    .eq('company_id', companyId)
    .select()
    .single();
  if (error) throw new Error(`clasificacion-cliente.reclasificarManualmente: ${error.message}`);

  const etiquetaAnterior = OPCIONES_RECLASIFICACION_MANUAL.find((o) => o.valor === anterior.tipo_contacto)?.etiqueta || anterior.tipo_contacto || 'sin clasificar';
  const etiquetaNueva = OPCIONES_RECLASIFICACION_MANUAL.find((o) => o.valor === nuevaClasificacion)?.etiqueta;
  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId,
    texto: `Cliente reclasificado manualmente: "${etiquetaAnterior}" → "${etiquetaNueva}".`,
    contexto: 'Reclasificación de contacto', autor_id: usuarioId || null, cliente_id: clienteId,
  }]);

  return data;
}

module.exports = { actualizarClasificacionAutomatica, reclasificarManualmente, OPCIONES_RECLASIFICACION_MANUAL };
