-- TARA Matrix™ — ANEXO A (TA.9)
-- Migration 020: asesor + workflow/nodo de prueba, para validar de punta a
-- punta que una conversación real puede disparar agendar_cita.
--
-- Seguridad: el workflow queda activo=false — WorkflowEngine.evaluar() SOLO
-- encuentra workflows con activo=true (modules/workflow-engine.js:43-57), así
-- que este workflow NUNCA se activa automáticamente para un cliente real. Se
-- usa insertando manualmente una fila en workflow_sessions que apunta
-- directo al nodo (paso aparte, fuera de esta migración, con el cliente_id
-- real de la prueba).
--
-- Ejecutar en Supabase SQL Editor

-- 1. Asesor de prueba — calendario_id = 'primary' usa el calendario
--    principal de la cuenta de Google ya conectada para Total Racks.
INSERT INTO asesores (company_id, nombre, calendario_id, activo)
VALUES (
  '8b5fb3b8-68be-446d-a925-78bc868ca8e4',
  'Asesor de Prueba TA.9',
  'primary',
  true
);

-- 2. Workflow de prueba — inerte (activo=false, prioridad mínima).
INSERT INTO workflows (id, company_id, nombre, descripcion, trigger, trigger_value, prioridad, activo)
VALUES (
  'a9000000-0000-0000-0000-000000000001',
  '8b5fb3b8-68be-446d-a925-78bc868ca8e4',
  'TA.9 — Prueba de Agenda (NO USAR EN PRODUCCIÓN)',
  'Workflow inerte solo para validar agendar_cita de punta a punta. activo=false a propósito.',
  'intent',
  'cancelar_flujo', -- valor válido del catálogo cerrado; nunca se evalúa porque activo=false
  999,
  false
);

-- 3. Nodo único: es_inicio y es_fin al mismo tiempo — se completa en un
--    solo turno. acciones dispara agendar_cita para "mañana 10:00-10:30am"
--    (calculado al momento de correr esta migración), sin asesorId — para
--    ejercitar también la asignación automática de SchedulingEngine.
INSERT INTO workflow_nodes (
  workflow_id, nombre, es_inicio, es_fin, pregunta, campo, es_opcional,
  siguiente_nodo, modo_respuesta, acciones
)
VALUES (
  'a9000000-0000-0000-0000-000000000001',
  'confirmar_prueba_agenda',
  true,
  true,
  'Confirma para agendar tu cita de prueba (TA.9).',
  NULL,
  true,
  NULL,
  'replace_ai',
  jsonb_build_array(
    jsonb_build_object(
      'tipo', 'agendar_cita',
      'parametros', jsonb_build_object(
        'inicio', to_char((now() AT TIME ZONE 'UTC')::date + interval '1 day' + interval '10 hour', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
        'fin',    to_char((now() AT TIME ZONE 'UTC')::date + interval '1 day' + interval '10 hour 30 minute', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"')
      )
    )
  )
);

-- Verificación
SELECT
  w.nombre AS workflow, w.activo AS workflow_activo,
  n.nombre AS nodo, n.acciones
FROM workflows w
JOIN workflow_nodes n ON n.workflow_id = w.id
WHERE w.id = 'a9000000-0000-0000-0000-000000000001';
