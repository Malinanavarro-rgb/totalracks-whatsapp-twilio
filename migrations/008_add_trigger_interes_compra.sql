-- TARA Matrix™ — FASE 4A / Fix T4A.11
-- Agrega trigger 'interes_compra' al workflow Descubrimiento Comercial de Total Racks.
-- Copia todos los nodos del workflow existente (solicitud_cotizacion) al nuevo.
--
-- Problema: mensajes como "Hola me interesan unos racks" → intención 'interes_compra'
-- pero el workflow solo disparaba con 'solicitud_cotizacion'. Fix: segunda fila de
-- workflow apuntando a los mismos campos, prioridad 2 (menor que solicitud_cotizacion).

WITH wf_source AS (
  SELECT id
  FROM workflows
  WHERE company_id   = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
    AND trigger_value = 'solicitud_cotizacion'
    AND nombre        = 'Descubrimiento Comercial'
  LIMIT 1
),
wf_new AS (
  INSERT INTO workflows (company_id, nombre, descripcion, trigger, trigger_value, prioridad)
  VALUES (
    '8b5fb3b8-68be-446d-a925-78bc868ca8e4',
    'Descubrimiento Comercial',
    'Captura datos clave de un prospecto con interés inicial en compra.',
    'intent',
    'interes_compra',
    2
  )
  RETURNING id
)
INSERT INTO workflow_nodes (
  workflow_id,
  nombre,
  es_inicio,
  es_fin,
  pregunta,
  campo,
  tipo_campo,
  es_opcional,
  siguiente_nodo,
  modo_respuesta,
  acciones,
  orden
)
SELECT
  wf_new.id,
  wn.nombre,
  wn.es_inicio,
  wn.es_fin,
  wn.pregunta,
  wn.campo,
  wn.tipo_campo,
  wn.es_opcional,
  wn.siguiente_nodo,
  wn.modo_respuesta,
  wn.acciones,
  wn.orden
FROM wf_new, wf_source
JOIN workflow_nodes wn ON wn.workflow_id = wf_source.id;

-- Verificación: debe mostrar 2 workflows y 12 nodos (6 por trigger)
SELECT
  w.trigger_value,
  w.prioridad,
  COUNT(wn.id) AS nodos
FROM workflows w
JOIN workflow_nodes wn ON wn.workflow_id = w.id
WHERE w.company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
GROUP BY w.trigger_value, w.prioridad
ORDER BY w.prioridad;
