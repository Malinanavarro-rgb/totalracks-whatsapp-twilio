/**
 * TARA Matrix™ — workflow-admin.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pivote a producto, Fase 3: capa de administración (CRUD) sobre las tablas
 * ya genéricas `workflows`/`workflow_nodes` (migraciones 004/005) — para que
 * cualquier empresa pueda definir su propio proceso comercial (nodos,
 * preguntas, orden) sin que alguien escriba SQL a mano, como hasta hoy
 * (Total Racks, Salón de Uñas).
 *
 * CERO cambios a modules/workflow-engine.js ni modules/orchestrator.js
 * (ambos congelados, ADR-005) — este módulo solo hace CRUD sobre datos que
 * el motor ya sabe leer genéricamente.
 *
 * Restricción deliberada de esta fase (ver plan de pivote a producto): el
 * único trigger disponible es 'intent' — el único que
 * modules/workflow-engine.js::evaluar() implementa hoy ('keyword'/'always'
 * están en el schema pero sin código que los evalúe) — y trigger_value solo
 * acepta el catálogo fijo de intenciones que ya reconoce el prompt
 * (modules/prompt-builder.js:182). Hacer esto dinámico tocaría el Core —
 * queda documentado como brecha para un ADR posterior (ADR-008).
 *
 * `workflow_nodes` no tiene columna company_id (solo workflow_id) — el
 * aislamiento multiempresa se verifica primero contra `workflows`
 * (_verificarWorkflowDeEmpresa) antes de tocar cualquier nodo.
 *
 * @module modules/workflow-admin
 */

'use strict';

const INTENCIONES_VALIDAS = [
  'interes_compra', 'solicitud_cotizacion', 'soporte', 'seguimiento', 'cancelar_flujo', 'consulta_general',
];

const CAMPOS_WORKFLOW = ['nombre', 'descripcion', 'trigger_value', 'prioridad', 'activo'];
const CAMPOS_NODO = [
  'nombre', 'es_inicio', 'es_fin', 'pregunta', 'campo', 'tipo_campo',
  'es_opcional', 'validacion', 'siguiente_nodo', 'acciones', 'modo_respuesta', 'orden',
];

function validarTriggerValue(trigger_value) {
  if (!INTENCIONES_VALIDAS.includes(trigger_value)) {
    const err = new Error(`trigger_value debe ser una de: ${INTENCIONES_VALIDAS.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

// ── WORKFLOWS ─────────────────────────────────────────────────────────────────

async function listarWorkflows(supabase, company_id) {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('company_id', company_id)
    .order('prioridad');

  return error ? [] : (data || []);
}

async function crearWorkflow(supabase, company_id, { nombre, descripcion, trigger_value, prioridad }) {
  validarTriggerValue(trigger_value);

  const { data, error } = await supabase
    .from('workflows')
    .insert([{
      company_id,
      nombre,
      descripcion:   descripcion || null,
      trigger:       'intent', // único trigger soportado en esta fase, ver docstring
      trigger_value,
      prioridad:     prioridad ?? 10,
      activo:        true,
    }])
    .select()
    .single();

  if (error) throw new Error(`workflow-admin.crearWorkflow: ${error.message}`);
  return data;
}

async function actualizarWorkflow(supabase, company_id, id, cambios) {
  if (cambios.trigger_value !== undefined) validarTriggerValue(cambios.trigger_value);

  const payload = {};
  for (const campo of CAMPOS_WORKFLOW) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  if (Object.keys(payload).length === 0) {
    const err = new Error('Sin campos válidos para actualizar');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('workflows')
    .update(payload)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el workflow');
  return data;
}

async function eliminarWorkflow(supabase, company_id, id) {
  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id);

  if (error) throw new Error('No se pudo eliminar el workflow');
}

/**
 * Verifica que un workflow pertenezca a la empresa antes de tocar sus
 * nodos — workflow_nodes no tiene company_id propio (aislamiento
 * multiempresa vive en la tabla padre).
 */
async function _verificarWorkflowDeEmpresa(supabase, company_id, workflowId) {
  const { data, error } = await supabase
    .from('workflows')
    .select('id')
    .eq('id', workflowId)
    .eq('company_id', company_id)
    .maybeSingle();

  if (error || !data) {
    const err = new Error('Workflow no encontrado');
    err.status = 404;
    throw err;
  }
}

// ── NODOS ─────────────────────────────────────────────────────────────────────

async function listarNodos(supabase, company_id, workflowId) {
  await _verificarWorkflowDeEmpresa(supabase, company_id, workflowId);

  const { data, error } = await supabase
    .from('workflow_nodes')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('orden');

  return error ? [] : (data || []);
}

async function crearNodo(supabase, company_id, workflowId, datos) {
  await _verificarWorkflowDeEmpresa(supabase, company_id, workflowId);

  if (!datos.nombre) {
    const err = new Error('nombre es requerido');
    err.status = 400;
    throw err;
  }

  const payload = { workflow_id: workflowId };
  for (const campo of CAMPOS_NODO) {
    if (datos[campo] !== undefined) payload[campo] = datos[campo];
  }

  const { data, error } = await supabase
    .from('workflow_nodes')
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error(`workflow-admin.crearNodo: ${error.message}`);
  return data;
}

async function actualizarNodo(supabase, company_id, nodoId, cambios) {
  const { data: nodo, error: errNodo } = await supabase
    .from('workflow_nodes')
    .select('workflow_id')
    .eq('id', nodoId)
    .maybeSingle();

  if (errNodo || !nodo) throw new Error('Nodo no encontrado');
  await _verificarWorkflowDeEmpresa(supabase, company_id, nodo.workflow_id);

  const payload = {};
  for (const campo of CAMPOS_NODO) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  if (Object.keys(payload).length === 0) {
    const err = new Error('Sin campos válidos para actualizar');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('workflow_nodes')
    .update(payload)
    .eq('id', nodoId)
    .select()
    .maybeSingle();

  if (error || !data) throw new Error('No se pudo actualizar el nodo');
  return data;
}

async function eliminarNodo(supabase, company_id, nodoId) {
  const { data: nodo, error: errNodo } = await supabase
    .from('workflow_nodes')
    .select('workflow_id')
    .eq('id', nodoId)
    .maybeSingle();

  if (errNodo || !nodo) throw new Error('Nodo no encontrado');
  await _verificarWorkflowDeEmpresa(supabase, company_id, nodo.workflow_id);

  const { error } = await supabase.from('workflow_nodes').delete().eq('id', nodoId);
  if (error) throw new Error('No se pudo eliminar el nodo');
}

module.exports = {
  INTENCIONES_VALIDAS,
  listarWorkflows,
  crearWorkflow,
  actualizarWorkflow,
  eliminarWorkflow,
  listarNodos,
  crearNodo,
  actualizarNodo,
  eliminarNodo,
};
