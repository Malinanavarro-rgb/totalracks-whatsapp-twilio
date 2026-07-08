-- TARA Matrix™ — ANEXO A (TA.9 v2)
-- Migration 021: reemplaza el nodo único de prueba (020) por dos nodos —
-- uno pregunta la hora, el otro intenta agendar y ofrece alternativas si no
-- hay disponibilidad — y siembra horarios_laborales para el asesor de
-- prueba (sin esto, consultarDisponibilidad() nunca tiene nada que ofrecer).
--
-- Requiere haber corrido 020_ta9_prueba_agenda.sql antes.
-- Ejecutar en Supabase SQL Editor

-- 1. Elimina el nodo único de la prueba anterior.
DELETE FROM workflow_nodes WHERE workflow_id = 'a9000000-0000-0000-0000-000000000001';

-- 2. Nodo 1: pregunta la hora preferida.
INSERT INTO workflow_nodes (
  workflow_id, nombre, es_inicio, es_fin, pregunta, campo, es_opcional,
  siguiente_nodo, modo_respuesta, acciones
)
VALUES (
  'a9000000-0000-0000-0000-000000000001',
  'pedir_horario_ta9',
  true,
  false,
  '¿A qué hora te gustaría tu cita mañana? Respóndeme en formato HH:MM (ej. 10:00).',
  'hora_preferida',
  false,
  'intentar_agendar_ta9',
  'replace_ai',
  '[]'
);

-- 3. Nodo 2: intenta agendar con la hora capturada; sin disponibilidad,
--    Orchestrator ofrece alternativas y reabre la sesión en pedir_horario_ta9.
INSERT INTO workflow_nodes (
  workflow_id, nombre, es_inicio, es_fin, pregunta, campo, es_opcional,
  siguiente_nodo, modo_respuesta, acciones
)
VALUES (
  'a9000000-0000-0000-0000-000000000001',
  'intentar_agendar_ta9',
  false,
  true,
  NULL,
  NULL,
  true,
  NULL,
  'replace_ai',
  jsonb_build_array(jsonb_build_object('tipo', 'ta9_agendar_con_horario', 'parametros', jsonb_build_object()))
);

-- 4. Horarios laborales del asesor de prueba — todos los días, 09:00-18:00
--    America/Monterrey, para que siempre haya disponibilidad que ofrecer
--    sin importar qué día caiga "mañana" cuando se corra esta prueba.
INSERT INTO horarios_laborales (company_id, asesor_id, dia_semana, hora_inicio, hora_fin, zona_horaria)
SELECT
  '8b5fb3b8-68be-446d-a925-78bc868ca8e4',
  a.id,
  dia,
  '09:00:00',
  '18:00:00',
  'America/Monterrey'
FROM asesores a, generate_series(0, 6) AS dia
WHERE a.nombre = 'Asesor de Prueba TA.9';

-- Verificación
SELECT nombre, es_inicio, es_fin, campo, siguiente_nodo, acciones
FROM workflow_nodes
WHERE workflow_id = 'a9000000-0000-0000-0000-000000000001'
ORDER BY es_inicio DESC;
