-- TARA Matrix™ — ANEXO B
-- Migration 023: actualiza el nodo de prueba de TA.9 al nuevo nombre del
-- handler (ta9_agendar_con_horario → agendar_cita_con_horario_solicitado,
-- graduado a lógica de producción). Sin esto, el workflow de prueba de TA.9
-- quedaría apuntando a un tipo de acción que ya no existe en el código.
-- Ejecutar en Supabase SQL Editor

UPDATE workflow_nodes
SET acciones = jsonb_build_array(
  jsonb_build_object('tipo', 'agendar_cita_con_horario_solicitado', 'parametros', jsonb_build_object())
)
WHERE workflow_id = 'a9000000-0000-0000-0000-000000000001'
  AND nombre = 'intentar_agendar_ta9';

-- Verificación
SELECT nombre, acciones FROM workflow_nodes
WHERE workflow_id = 'a9000000-0000-0000-0000-000000000001' AND nombre = 'intentar_agendar_ta9';
