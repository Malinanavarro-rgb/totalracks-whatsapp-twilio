-- TARA Matrix™ — FASE 4A / T4B.3
-- Refinamiento de experiencia comercial Total Racks:
--   1. Agrega nodo ubicacion (entre volumen_estimado y plazo)
--   2. Actualiza cadena siguiente_nodo y órdenes
--   3. Cambia cierre a full_ai (AI genera resumen completo)
--   4. Actualiza campos_requeridos en personality
--   5. Agrega reglas: no falsas promesas + instrucción de resumen al cierre
--
-- Aplica a los DOS workflows del company_id de Total Racks.

-- ── 1. Insertar nodo ubicacion en ambos workflows ─────────────────────────────
INSERT INTO workflow_nodes (
  workflow_id, nombre, es_inicio, es_fin,
  pregunta, campo, tipo_campo, es_opcional,
  siguiente_nodo, modo_respuesta, acciones, orden
)
SELECT
  wf.id,
  'ubicacion',
  false,
  false,
  '¿En qué ciudad o estado va el proyecto?',
  'ubicacion',
  'text',
  false,
  'plazo',
  'prepend_ai',
  '[]'::jsonb,
  5
FROM workflows wf
WHERE wf.company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';

-- ── 2. Actualizar cadena siguiente_nodo y órdenes ────────────────────────────
UPDATE workflow_nodes
SET siguiente_nodo = 'ubicacion'
WHERE campo = 'volumen_estimado'
  AND workflow_id IN (
    SELECT id FROM workflows
    WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
  );

-- Reasignar órdenes para reflejar el nuevo nodo
UPDATE workflow_nodes
SET orden = CASE nombre
  WHEN 'plazo'        THEN 6
  WHEN 'presupuesto'  THEN 7
  WHEN 'cierre'       THEN 8
  ELSE orden
END
WHERE workflow_id IN (
  SELECT id FROM workflows
  WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
);

-- ── 3. Cambiar cierre a full_ai ───────────────────────────────────────────────
-- full_ai: la IA genera la respuesta completa (resumen + cierre).
-- La pregunta del nodo queda como fallback pero no se usa en producción.
UPDATE workflow_nodes
SET
  modo_respuesta = 'full_ai',
  pregunta       = 'Tu solicitud quedó registrada. Un especialista de Total Racks revisará tu proyecto y te contactará con la propuesta técnica y comercial.'
WHERE nombre = 'cierre'
  AND workflow_id IN (
    SELECT id FROM workflows
    WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
  );

-- ── 4. Actualizar campos_requeridos en personality ───────────────────────────
UPDATE personalities
SET campos_requeridos = ARRAY[
  'nombre_contacto',
  'empresa',
  'tipo_proyecto',
  'volumen_estimado',
  'ubicacion',
  'plazo',
  'presupuesto'
]
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';

-- ── 5. Agregar reglas de comportamiento comercial ────────────────────────────
UPDATE personalities
SET reglas = array_cat(
  COALESCE(reglas, ARRAY[]::text[]),
  ARRAY[
    'No menciones visitas técnicas gratuitas, instalación ni compromisos de servicio adicionales. El proceso comercial es: solicitud → propuesta técnica y comercial → seguimiento del asesor.',
    'Al cerrar una solicitud de cotización (cuando el cliente haya dado todos sus datos del proyecto), genera un resumen estructurado con este formato exacto: "Proyecto registrado: / Cliente: [nombre] / Empresa: [empresa] / Solución recomendada: [tipo de rack según la carga descrita] / Carga: [peso por posición] / Capacidad: [número de posiciones] / Ubicación: [ciudad o estado] / Plazo: [fecha o etapa] / Presupuesto: [monto si lo proporcionó, o No especificado]". Luego añade: "Un especialista de Total Racks revisará tu proyecto y te contactará con la propuesta técnica y comercial."'
  ]
)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';

-- ── 6. Verificación ───────────────────────────────────────────────────────────
SELECT
  wn.orden,
  wn.nombre,
  wn.campo,
  wn.modo_respuesta,
  wn.es_fin,
  wn.siguiente_nodo,
  LEFT(wn.pregunta, 55) AS pregunta_preview
FROM workflow_nodes wn
JOIN workflows w ON w.id = wn.workflow_id
WHERE w.company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
  AND w.trigger_value = 'solicitud_cotizacion'
ORDER BY wn.orden;
