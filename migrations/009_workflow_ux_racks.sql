-- TARA Matrix™ — FASE 4A / Fix UX T4B.1
-- Mejora el flujo comercial de Total Racks:
--   1. Corrige textos de nodos (elimina "andamio", lenguaje rack-específico)
--   2. Todos los nodos a prepend_ai (IA enriquece cada transición)
--   3. Agrega nodo cierre con resumen profesional antes del cierre
--
-- Aplica a los DOS workflows del company_id de Total Racks
-- (solicitud_cotizacion + interes_compra).

-- ── 1. Actualizar textos y modo_respuesta ─────────────────────────────────────
UPDATE workflow_nodes
SET
  modo_respuesta = 'prepend_ai',
  pregunta = CASE nombre
    WHEN 'nombre_contacto'  THEN '¿Con quién tengo el gusto?'
    WHEN 'empresa'          THEN '¿Para qué empresa o proyecto es?'
    WHEN 'tipo_proyecto'    THEN '¿Qué van a almacenar? Cuéntame sobre la mercancía o el tipo de carga.'
    WHEN 'volumen_estimado' THEN '¿Cuántas posiciones de rack necesitas, aproximadamente?'
    WHEN 'plazo'            THEN '¿Para cuándo lo necesitas? ¿Hay una fecha o es más flexible?'
    WHEN 'presupuesto'      THEN '¿Tienes idea del presupuesto? No es obligatorio, pero nos ayuda a afinar la propuesta.'
    ELSE pregunta
  END,
  -- presupuesto deja de ser el nodo final; encadena al cierre
  es_fin         = CASE nombre WHEN 'presupuesto' THEN false ELSE es_fin END,
  siguiente_nodo = CASE nombre WHEN 'presupuesto' THEN 'cierre' ELSE siguiente_nodo END
WHERE workflow_id IN (
  SELECT id FROM workflows
  WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
);

-- ── 2. Agregar nodo cierre (resumen + cierre profesional) ─────────────────────
-- prepend_ai: la IA genera un resumen de los datos capturados antes del texto fijo.
-- es_fin = true: si el cliente responde, la sesión se completa.
-- campo = null: no captura campo adicional.
INSERT INTO workflow_nodes (
  workflow_id, nombre, es_inicio, es_fin,
  pregunta, campo, tipo_campo, es_opcional,
  siguiente_nodo, modo_respuesta, acciones, orden
)
SELECT
  wf.id,
  'cierre',
  false,
  true,
  'Tu solicitud quedó registrada. Un especialista de Total Racks revisará el proyecto y te contactará con la propuesta técnica y comercial.',
  null,
  'text',
  true,
  null,
  'prepend_ai',
  '[]'::jsonb,
  7
FROM workflows wf
WHERE wf.company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';

-- ── 3. Verificación ───────────────────────────────────────────────────────────
SELECT
  wn.orden,
  wn.nombre,
  wn.modo_respuesta,
  wn.es_fin,
  LEFT(wn.pregunta, 65) AS pregunta_preview
FROM workflow_nodes wn
JOIN workflows w ON w.id = wn.workflow_id
WHERE w.company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
  AND w.trigger_value = 'solicitud_cotizacion'
ORDER BY wn.orden;
