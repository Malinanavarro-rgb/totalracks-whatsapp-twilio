-- TARA Matrix™ — FASE 4A
-- Seed: Workflow "Descubrimiento Comercial" — Total Racks
-- Ejecutar en Supabase SQL Editor

-- Nota sobre teléfono:
--   WhatsApp provee el número del canal; no se solicita al cliente.
--   Para empresas en canales que no proporcionen teléfono, agregar un nodo
--   adicional: campo='telefono', tipo_campo='phone', es_opcional=false,
--   orden=2, insertar entre 'nombre_contacto' y 'empresa'.

-- Nota sobre trigger_value:
--   Este workflow activa con intención 'solicitud_cotizacion'.
--   Para activar también con 'interes_compra', insertar un segundo
--   row en workflows con el mismo nombre y trigger_value='interes_compra'.

WITH wf AS (
  INSERT INTO workflows (
    company_id,
    nombre,
    descripcion,
    trigger,
    trigger_value,
    prioridad
  )
  VALUES (
    '8b5fb3b8-68be-446d-a925-78bc868ca8e4', -- Total Racks
    'Descubrimiento Comercial',
    'Captura datos clave de un prospecto interesado en cotización.',
    'intent',
    'solicitud_cotizacion',
    1
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
  wf.id,
  n.nombre,
  n.es_inicio,
  n.es_fin,
  n.pregunta,
  n.campo,
  n.tipo_campo,
  n.es_opcional,
  n.siguiente_nodo,
  n.modo_respuesta,
  n.acciones::jsonb,
  n.orden
FROM wf,
(VALUES
  (
    'nombre_contacto',
    true,
    false,
    '¿Cuál es tu nombre?',
    'nombre_contacto',
    'text',
    false,
    'empresa',
    'prepend_ai',
    '[]',
    1
  ),
  (
    'empresa',
    false,
    false,
    '¿A qué empresa o proyecto perteneces?',
    'empresa',
    'text',
    false,
    'tipo_proyecto',
    'replace_ai',
    '[]',
    2
  ),
  (
    'tipo_proyecto',
    false,
    false,
    '¿Qué tipo de proyecto o necesidad tienes en mente?',
    'tipo_proyecto',
    'text',
    false,
    'volumen_estimado',
    'replace_ai',
    '[]',
    3
  ),
  (
    'volumen_estimado',
    false,
    false,
    '¿Cuánto andamio necesitas aproximadamente? (metros cuadrados, pisos o piezas)',
    'volumen_estimado',
    'text',
    false,
    'plazo',
    'replace_ai',
    '[]',
    4
  ),
  (
    'plazo',
    false,
    false,
    '¿En qué plazo lo necesitas o qué tan urgente es?',
    'plazo',
    'text',
    false,
    'presupuesto',
    'replace_ai',
    '[]',
    5
  ),
  (
    'presupuesto',
    false,
    true,
    '¿Tienes un presupuesto aproximado en mente? (puedes omitir si lo prefieres)',
    'presupuesto',
    'text',
    true,
    null::text,
    'replace_ai',
    '[]',
    6
  )
) AS n(
  nombre, es_inicio, es_fin, pregunta, campo,
  tipo_campo, es_opcional, siguiente_nodo, modo_respuesta, acciones, orden
);

-- Verificación
SELECT
  wn.orden,
  wn.nombre,
  wn.es_inicio,
  wn.es_fin,
  wn.es_opcional,
  wn.modo_respuesta,
  LEFT(wn.pregunta, 55) AS pregunta_preview
FROM workflow_nodes wn
JOIN workflows w ON w.id = wn.workflow_id
JOIN companies c ON c.id = w.company_id
WHERE w.company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
ORDER BY wn.orden;
