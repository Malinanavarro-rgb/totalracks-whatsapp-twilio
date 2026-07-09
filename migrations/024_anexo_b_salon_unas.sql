-- TARA Matrix™ — ANEXO B (TB.1 + TB.2)
-- Migration 024: semilla completa de la empresa sintética "Salón de Uñas
-- Ejemplo" — validación interna/sintética (TB.0, ya confirmada: sin
-- cliente real todavía). Prueba de arquitectura: un giro estructuralmente
-- distinto a Total Racks (transaccional/agenda, sin ciclo de cotización
-- largo), reusando WorkflowEngine/SchedulingEngine sin tocar el Kernel.
--
-- company_id fijo para poder referenciarlo en las tablas siguientes:
--   b5a10000-0000-0000-0000-000000000001
--
-- Sin calendar_credentials para esta empresa → schedulingEngineParaEmpresa()
-- cae automáticamente en MockCalendarProvider (ya construido en TA.6/TA.9) —
-- no hace falta conectar una cuenta real de Google para validar el flujo.
--
-- Ejecutar en Supabase SQL Editor. Si algún INSERT falla por una columna
-- NOT NULL que no se anticipó aquí (companies/personalities no tienen
-- migración propia en este repo), se ajusta en vivo.

-- 1. Empresa
INSERT INTO companies (id, nombre, descripcion, slug, estado)
VALUES (
  'b5a10000-0000-0000-0000-000000000001',
  'Salón de Uñas Ejemplo',
  'Salón de manicure y pedicure — empresa sintética para validar Anexo B.',
  'salon-unas-ejemplo',
  'activo'
);

-- 2. Personalidad
INSERT INTO personalities (
  company_id, nombre_asistente, cargo, tono, objetivo, idioma, zona_horaria,
  modelo, temperatura, max_tokens, skills, campos_requeridos, reglas,
  max_turnos_memoria, kb_max_secciones
)
VALUES (
  'b5a10000-0000-0000-0000-000000000001',
  'Sofía',
  'Recepcionista virtual',
  'cálido y amigable',
  'Agendar servicios de manicure y pedicure para las clientas.',
  'es',
  'America/Monterrey',
  'gpt-4o-mini',
  0.7,
  500,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  6,
  2
);

-- 3. Knowledge base — contexto para que la IA describa los servicios
INSERT INTO knowledge_base (company_id, categoria, contenido)
VALUES (
  'b5a10000-0000-0000-0000-000000000001',
  'SERVICIOS',
  'Manicure clásico ($150, 30 min), Manicure en gel ($250, 45 min), Pedicure spa ($350, 60 min).'
);

-- 4. Servicios (TC.2)
INSERT INTO servicios (company_id, nombre, duracion_minutos, precio, activo)
VALUES
  ('b5a10000-0000-0000-0000-000000000001', 'Manicure clásico', 30, 150, true),
  ('b5a10000-0000-0000-0000-000000000001', 'Manicure en gel',  45, 250, true),
  ('b5a10000-0000-0000-0000-000000000001', 'Pedicure spa',     60, 350, true);

-- 5. Asesoras (manicuristas). calendario_id NULL — sin Google conectado,
--    SchedulingEngine usa MockCalendarProvider automáticamente.
INSERT INTO asesores (company_id, nombre, calendario_id, activo)
VALUES
  ('b5a10000-0000-0000-0000-000000000001', 'Ana',   NULL, true),
  ('b5a10000-0000-0000-0000-000000000001', 'Betty', NULL, true);

-- 6. Horarios laborales — todos los días, 09:00-19:00 America/Monterrey,
--    para ambas asesoras.
INSERT INTO horarios_laborales (company_id, asesor_id, dia_semana, hora_inicio, hora_fin, zona_horaria)
SELECT 'b5a10000-0000-0000-0000-000000000001', a.id, dia, '09:00:00', '19:00:00', 'America/Monterrey'
FROM asesores a, generate_series(0, 6) AS dia
WHERE a.company_id = 'b5a10000-0000-0000-0000-000000000001';

-- 7. Workflow — activo=true (a diferencia de TA.9, este SÍ debe dispararse
--    solo, es el punto de la prueba). Reusa la intención 'solicitud_cotizacion'
--    del catálogo cerrado — permitido por el propio Anexo B, no hay colisión
--    con Total Racks porque evaluar() filtra por company_id primero.
INSERT INTO workflows (id, company_id, nombre, descripcion, trigger, trigger_value, prioridad, activo)
VALUES (
  'b5a10000-0000-0000-0000-000000000002',
  'b5a10000-0000-0000-0000-000000000001',
  'Agendar servicio de salón',
  'Anexo B — segundo giro. Flujo transaccional corto: servicio → asesora → hora.',
  'intent',
  'solicitud_cotizacion',
  1,
  true
);

-- 8. Nodos — 3, no 4 (ver plan): el nodo final pregunta la hora Y agenda en
--    el mismo turno (es_fin + campo a la vez), sin necesitar un cuarto nodo
--    para "mostrar horarios" por separado.
INSERT INTO workflow_nodes (workflow_id, nombre, es_inicio, es_fin, pregunta, campo, es_opcional, siguiente_nodo, modo_respuesta, acciones, orden)
VALUES (
  'b5a10000-0000-0000-0000-000000000002', 'pedir_servicio', true, false,
  '¿Qué servicio te gustaría agendar?', 'servicio_elegido', false,
  'pedir_asesora', 'prepend_ai', '[]', 1
);

INSERT INTO workflow_nodes (workflow_id, nombre, es_inicio, es_fin, pregunta, campo, es_opcional, siguiente_nodo, modo_respuesta, acciones, orden)
VALUES (
  'b5a10000-0000-0000-0000-000000000002', 'pedir_asesora', false, false,
  '¿Con alguna manicurista en particular (Ana o Betty), o sin preferencia?', 'asesora_preferida', true,
  'pedir_hora_y_agendar', 'replace_ai', '[]', 2
);

INSERT INTO workflow_nodes (workflow_id, nombre, es_inicio, es_fin, pregunta, campo, es_opcional, siguiente_nodo, modo_respuesta, acciones, orden)
VALUES (
  'b5a10000-0000-0000-0000-000000000002', 'pedir_hora_y_agendar', false, true,
  '¿A qué hora te gustaría tu cita mañana?', 'hora_preferida', false,
  NULL, 'replace_ai',
  jsonb_build_array(jsonb_build_object('tipo', 'agendar_cita_con_horario_solicitado', 'parametros', jsonb_build_object())),
  3
);

-- Verificación
SELECT w.nombre AS workflow, w.activo, n.nombre AS nodo, n.orden, n.campo, n.es_fin
FROM workflows w JOIN workflow_nodes n ON n.workflow_id = w.id
WHERE w.company_id = 'b5a10000-0000-0000-0000-000000000001'
ORDER BY n.orden;
