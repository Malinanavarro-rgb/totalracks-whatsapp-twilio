/**
 * TARA Matrix™ — plantillas-industria.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Motor de auto-configuración de empresas nuevas por industria. El catálogo
 * de industrias vive como DATOS en la tabla `plantillas_industria`
 * (migración 044) — agregar la industria #3, #4, ... #200 es un INSERT
 * nuevo ahí, cero cambios de código en este módulo.
 *
 * La detección es deliberadamente simple hoy (keyword-matching) — swapeable
 * después por algo más sofisticado (embeddings, clasificación por IA) sin
 * cambiar la firma de detectarIndustria(), que es lo único que le importa
 * al resto del sistema.
 *
 * aplicarPlantilla() reutiliza tal cual las funciones de administración ya
 * construidas en el pivote a producto — cero lógica de negocio duplicada,
 * mismas validaciones que ya usa Configuración/Workflows:
 *   - modules/configuracion.js: crearKnowledgeBase, crearServicio, crearPipelineEtapa
 *   - modules/workflow-admin.js: crearWorkflow, crearNodo
 *
 * `personalities` es la única pieza sin una función reusable existente,
 * porque configuracion.js solo actualiza personalidades ya existentes
 * (nunca crea la primera fila de una empresa) — este módulo sí hace ese
 * INSERT inicial, con los parámetros técnicos en un default sensato.
 *
 * Cero cambios al Core congelado (ADR-005): las plantillas solo usan el
 * catálogo YA existente de intenciones (modules/prompt-builder.js) y de
 * acciones (registro de ActionRunner en modules/orchestrator.js) — no se
 * inventan intenciones ni acciones nuevas.
 *
 * @module modules/plantillas-industria
 */

'use strict';

const { crearKnowledgeBase, crearServicio, crearPipelineEtapa } = require('./configuracion');
const { crearWorkflow, crearNodo } = require('./workflow-admin');
const { crearOrganizacionConCompany } = require('./organizaciones');

/**
 * Detecta la plantilla que mejor coincide con la descripción del negocio,
 * por conteo simple de palabras clave. Devuelve null si ninguna plantilla
 * tiene al menos una coincidencia.
 *
 * @param {Array} plantillas - filas de `plantillas_industria`
 * @param {string} descripcionNegocio
 * @returns {Object|null}
 */
function detectarIndustria(plantillas, descripcionNegocio) {
  const texto = (descripcionNegocio || '').toLowerCase();
  let mejor = null;
  let mejorScore = 0;

  for (const plantilla of plantillas) {
    const score = (plantilla.palabras_clave || []).filter(
      (palabra) => texto.includes(palabra.toLowerCase())
    ).length;

    if (score > mejorScore) {
      mejorScore = score;
      mejor = plantilla;
    }
  }

  return mejor;
}

/**
 * Aplica una plantilla de industria a una empresa recién creada: inserta
 * personalidad, knowledge base, servicios (si aplica), catálogo de pipeline
 * y el workflow con sus nodos.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @param {Object} plantilla - fila de `plantillas_industria`
 */
async function aplicarPlantilla(supabase, company_id, plantilla) {
  const p = plantilla.personalidad;

  const { error: errPersonalidad } = await supabase.from('personalities').insert([{
    company_id,
    nombre_asistente:      p.nombre_asistente,
    cargo:                 p.cargo,
    tono:                  p.tono,
    objetivo:              p.objetivo,
    idioma:                p.idioma || 'es',
    zona_horaria:          p.zona_horaria || 'America/Monterrey',
    modelo:                p.modelo || 'gpt-4o-mini',
    temperatura:           p.temperatura ?? 0.7,
    max_tokens:            p.max_tokens ?? 500,
    skills:                [],
    campos_requeridos:     p.campos_requeridos || [],
    reglas:                p.reglas || [],
    max_turnos_memoria:    6,
    kb_max_secciones:      2,
    mensaje_bienvenida:    p.mensaje_bienvenida || '',
    firma:                 p.firma || '',
    mensaje_fuera_horario: p.mensaje_fuera_horario,
    mensaje_error_tecnico: p.mensaje_error_tecnico,
    longitud_respuesta:    'normales',
    uso_emojis:            'moderado',
    nivel_iniciativa:      'sugerir_productos',
  }]);
  if (errPersonalidad) throw new Error(`plantillas-industria.aplicarPlantilla (personalidad): ${errPersonalidad.message}`);

  for (const kb of plantilla.knowledge_base_seed || []) {
    await crearKnowledgeBase(supabase, company_id, kb);
  }

  if (plantilla.requiere_agenda) {
    for (const servicio of plantilla.servicios_seed || []) {
      await crearServicio(supabase, company_id, servicio);
    }
  }

  for (const etapa of plantilla.pipeline_etapas_seed || []) {
    await crearPipelineEtapa(supabase, company_id, etapa);
  }

  const wf = plantilla.workflow_seed;
  const workflow = await crearWorkflow(supabase, company_id, {
    nombre:        wf.nombre,
    descripcion:   wf.descripcion,
    trigger_value: wf.trigger_value,
    prioridad:     10,
  });

  for (const nodo of wf.nodos || []) {
    await crearNodo(supabase, company_id, workflow.id, nodo);
  }
}

/**
 * Crea una empresa nueva y la configura automáticamente según la industria
 * detectada a partir de su descripción de negocio.
 *
 * Desde FASE 8.1, `companies.organization_id` es NOT NULL (Constitución Art.
 * 9/16: toda Company cuelga de una Organization) — por eso esta función ya
 * no inserta en `companies` directo, sino que pasa por
 * `crearOrganizacionConCompany()` (organizaciones.js), el único camino de
 * escritura permitido para esa tabla.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{nombre: string, descripcionNegocio: string, slug: string}} datos
 * @returns {Promise<{organization: Object, company: Object, industriaDetectada: string|null, huboCoincidencia: boolean}>}
 */
async function crearEmpresaConIndustria(supabase, { nombre, descripcionNegocio, slug }) {
  const { data: plantillas, error: errPlantillas } = await supabase
    .from('plantillas_industria')
    .select('*');

  if (errPlantillas) throw new Error(`plantillas-industria.crearEmpresaConIndustria: ${errPlantillas.message}`);

  const plantilla = detectarIndustria(plantillas || [], descripcionNegocio);

  const { organization, company } = await crearOrganizacionConCompany(supabase, {
    nombre, descripcion: descripcionNegocio, slug, industriaSlug: plantilla?.slug || null,
  });

  if (plantilla) {
    await aplicarPlantilla(supabase, company.id, plantilla);
  }

  return {
    organization,
    company,
    industriaDetectada: plantilla?.nombre_visible || null,
    huboCoincidencia: Boolean(plantilla),
  };
}

/**
 * Resuelve la plantilla de industria de una empresa YA existente — usado por
 * el Motor Universal (dashboard-engine.js, cotizador.js) para leer su config
 * (`dashboard_kpis_seed`, `cotizacion_config`, `ui_config`) sin ningún `if`
 * de industria en el código que la consume.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} company_id
 * @returns {Promise<Object|null>} la fila de `plantillas_industria`, o null si la empresa no tiene industria asignada o no hay plantilla para ese slug
 */
async function obtenerPlantillaDeEmpresa(supabase, company_id) {
  const { data: company, error: errCompany } = await supabase
    .from('companies').select('industria_slug').eq('id', company_id).maybeSingle();
  if (errCompany || !company?.industria_slug) return null;

  const { data: plantilla, error: errPlantilla } = await supabase
    .from('plantillas_industria').select('*').eq('slug', company.industria_slug).maybeSingle();
  if (errPlantilla) return null;
  return plantilla;
}

module.exports = { detectarIndustria, aplicarPlantilla, crearEmpresaConIndustria, obtenerPlantillaDeEmpresa };
