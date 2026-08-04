-- TARA-OS — Fase 2 Ingeniería y Cotización: separar "cotizar directo" de
-- "agendar visita técnica" en dos workflows con triggers distintos.
--
-- Decisión de Alina (2026-08-04): la mayoría de los clientes solo dicen
-- "quiero cotizar paneles" / "¿cuánto me cuesta?" / "mándame una propuesta"
-- — eso debe ir DIRECTO al flujo de ingeniería y cotización, sin frase
-- especial. Pedir una visita técnica explícita ("que vaya un técnico",
-- "un levantamiento", "una inspección") sigue siendo su propio flujo, el
-- que ya existía (11 nodos, migración 085).
--
-- Ajuste de triggers:
--   solicitud_cotizacion    → AHORA apunta al flujo nuevo de cotización directa
--   solicitud_visita_tecnica (NUEVO) → el workflow de 11 nodos que ya existía
--
-- El workflow de 11 nodos NO se elimina ni se reescribe — solo cambia su
-- trigger_value (UPDATE, aditivo y reversible: ver bloque de rollback al
-- final de este archivo, comentado).
--
-- Aplica solo a "Empresa Demo Paneles Solares" (slug vive-solar-mty), la
-- única empresa con esta industria activa hoy. La generalización a nivel de
-- plantilla (plantillas_industria.workflow_seed, para que las próximas
-- empresas de esta industria hereden ambos workflows automáticamente)
-- queda documentada como pendiente — no se hace en esta migración para no
-- ampliar el alcance de una corrección puntual sobre datos reales.

-- ── 1. El workflow de 11 nodos existente pasa a solicitud_visita_tecnica ───

UPDATE workflows
SET trigger_value = 'solicitud_visita_tecnica'
WHERE company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty')
  AND trigger_value = 'solicitud_cotizacion'
  AND nombre = 'Calificación completa y agenda de visita técnica solar';

-- ── 2. Workflow nuevo: cotización directa (motor de ingeniería) ────────────
-- 7 nodos, cada campo capturado corresponde 1:1 a un campo de infoTecnica
-- que espera modules/motores-ingenieria/paneles-solares.js. No se pregunta
-- temperaturaMinSitio (se resuelve automático por región) ni inversionNeta
-- (no existe hasta que el asesor arma la lista de materiales). Nodo final
-- dispara la acción ejecutar_motor_ingenieria (registrada en la zona de
-- wiring de orchestrator.js — ver ADR-005, excepción documentada).

-- Idempotente (corregido tras un re-run real, 2026-08-04 — mismo defecto que
-- se había corregido en 088 para parametros_ingenieria): sin el WHERE NOT
-- EXISTS, correr este script dos veces crea un segundo workflow duplicado
-- con el mismo nombre/trigger_value, y el INSERT de nodos de abajo (que
-- matchea por nombre+trigger_value, no por un id específico) intenta
-- volver a escribir sobre el workflow original, chocando con la
-- restricción única workflow_nodes_workflow_id_nombre_key.
INSERT INTO workflows (company_id, nombre, descripcion, trigger, trigger_value, prioridad, activo)
SELECT
  c.id,
  'Cotización directa — ingeniería solar',
  'Captura técnica progresiva para predimensionar el sistema y correr el motor de ingeniería solar sin pasar por una visita técnica previa.',
  'intent',
  'solicitud_cotizacion',
  10,
  true
FROM companies c
WHERE c.slug = 'vive-solar-mty'
  AND NOT EXISTS (
    SELECT 1 FROM workflows w
    WHERE w.company_id = c.id AND w.nombre = 'Cotización directa — ingeniería solar'
  );

INSERT INTO workflow_nodes (workflow_id, nombre, es_inicio, es_fin, pregunta, campo, tipo_campo, es_opcional, siguiente_nodo, acciones, modo_respuesta, orden)
SELECT w.id, v.nombre, v.es_inicio, v.es_fin, v.pregunta, v.campo, v.tipo_campo, v.es_opcional, v.siguiente_nodo, v.acciones::jsonb, v.modo_respuesta, v.orden
FROM workflows w
CROSS JOIN (VALUES
  ('preguntar_ubicacion',       true,  false, '¿En qué ciudad o municipio está la instalación?', 'ubicacion',              'text',   false, 'preguntar_consumo_kwh',     '[]',                                                              'prepend_ai', 1),
  ('preguntar_consumo_kwh',     false, false, '¿Cuántos kWh consumes en promedio al mes? Si no lo sabes exacto, dime el monto de tu recibo y lo puedo aproximar.', 'consumo_mensual_kwh', 'number', false, 'preguntar_importe_recibo',  '[]',                                                              'replace_ai', 2),
  ('preguntar_importe_recibo',  false, false, '¿Cuál es el importe promedio de tu recibo de CFE?', 'importe_promedio_recibo', 'number', false, 'preguntar_cobertura',      '[]',                                                              'replace_ai', 3),
  ('preguntar_cobertura',       false, false, '¿Qué porcentaje de tu consumo te gustaría cubrir con paneles solares? Si no estás seguro, puedo proponerte 90%.', 'pct_cobertura_deseado', 'number', false, 'preguntar_tipo_alimentacion', '[]',                                                          'replace_ai', 4),
  ('preguntar_tipo_alimentacion', false, false, '¿Tu instalación eléctrica es monofásica, bifásica o trifásica? Si no lo sabes, dime si es casa (normalmente monofásica) o negocio/industria (normalmente trifásica).', 'tipo_alimentacion', 'text', false, 'preguntar_voltaje', '[]',                                          'replace_ai', 5),
  ('preguntar_voltaje',         false, false, '¿Qué voltaje tienes en tu instalación? (220V es lo más común en casas)', 'voltaje_sitio', 'number', false, 'preguntar_area',        '[]',                                                              'replace_ai', 6),
  ('preguntar_area',            false, true,  'Por último, ¿cuánta área tienes disponible para los paneles (azotea o terreno), en metros cuadrados aproximados?', 'area_disponible_m2', 'number', false, NULL, '[{"tipo": "ejecutar_motor_ingenieria", "parametros": {}}]', 'replace_ai', 7)
) AS v(nombre, es_inicio, es_fin, pregunta, campo, tipo_campo, es_opcional, siguiente_nodo, acciones, modo_respuesta, orden)
WHERE w.company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty')
  AND w.trigger_value = 'solicitud_cotizacion'
  AND w.nombre = 'Cotización directa — ingeniería solar'
  AND NOT EXISTS (
    SELECT 1 FROM workflow_nodes wn WHERE wn.workflow_id = w.id AND wn.nombre = v.nombre
  );

-- Verificación
SELECT nombre, trigger_value, prioridad, activo FROM workflows
WHERE company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty') ORDER BY trigger_value;

SELECT nombre, campo, orden FROM workflow_nodes
WHERE workflow_id = (SELECT id FROM workflows WHERE company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty') AND trigger_value = 'solicitud_cotizacion')
ORDER BY orden;

-- ── ROLLBACK (referencia, no se ejecuta aquí) ───────────────────────────────
-- DELETE FROM workflow_nodes WHERE workflow_id = (SELECT id FROM workflows WHERE company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty') AND trigger_value = 'solicitud_cotizacion' AND nombre = 'Cotización directa — ingeniería solar');
-- DELETE FROM workflows WHERE company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty') AND trigger_value = 'solicitud_cotizacion' AND nombre = 'Cotización directa — ingeniería solar';
-- UPDATE workflows SET trigger_value = 'solicitud_cotizacion' WHERE company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty') AND trigger_value = 'solicitud_visita_tecnica' AND nombre = 'Calificación completa y agenda de visita técnica solar';
