-- TARA Matrix™ — Motor de plantillas por industria (auto-configuración de
-- empresas nuevas). Ver docs de la sesión / plan aprobado.
--
-- El catálogo de industrias vive como DATOS en esta tabla, no como lógica
-- por-industria en JS — agregar la industria #3, #4, ... #200 más adelante
-- es un INSERT nuevo aquí, cero cambios de código.
--
-- Cada plantilla trae todo lo necesario para que
-- modules/plantillas-industria.js::aplicarPlantilla() configure una empresa
-- nueva de punta a punta: personalidad, knowledge base inicial, servicios
-- (si aplica agenda), catálogo de pipeline, y workflow con sus nodos.
-- trigger_value usa siempre el catálogo fijo de intenciones ya existente
-- (modules/prompt-builder.js) — no se inventan intenciones nuevas.
--
-- Ejecutar en Supabase SQL Editor. IMPORTANTE: correr después
--   NOTIFY pgrst, 'reload schema';
-- (lección de esta sesión — sin esto, el panel puede no "ver" la tabla
-- nueva de inmediato aunque el INSERT haya funcionado).

CREATE TABLE IF NOT EXISTS plantillas_industria (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  nombre_visible       text NOT NULL,
  palabras_clave       text[] NOT NULL,
  requiere_agenda      boolean NOT NULL DEFAULT false,
  personalidad         jsonb NOT NULL,
  knowledge_base_seed  jsonb NOT NULL DEFAULT '[]',
  servicios_seed       jsonb NOT NULL DEFAULT '[]',
  pipeline_etapas_seed jsonb NOT NULL DEFAULT '[]',
  workflow_seed        jsonb NOT NULL,
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE plantillas_industria DISABLE ROW LEVEL SECURITY;
-- Misma justificación que servicios/pipeline_etapas/workflows — solo se lee
-- desde el backend (scripts/crear-empresa.js), nunca desde el navegador.

-- ── Plantilla 1: Salón de belleza / uñas ──────────────────────────────────────

INSERT INTO plantillas_industria (
  slug, nombre_visible, palabras_clave, requiere_agenda,
  personalidad, knowledge_base_seed, servicios_seed, pipeline_etapas_seed, workflow_seed
)
VALUES (
  'salon_belleza',
  'Salón de belleza / uñas',
  ARRAY['uñas', 'unas', 'salón', 'salon', 'manicure', 'pedicure', 'gelish', 'acrílico', 'acrilico', 'esmaltado', 'belleza'],
  true,
  '{
    "nombre_asistente": "Sofía",
    "cargo": "Recepcionista virtual",
    "tono": "cálido y amigable",
    "objetivo": "Agendar servicios de manicure, pedicure y tratamientos de uñas para las clientas.",
    "idioma": "es",
    "zona_horaria": "America/Monterrey",
    "modelo": "gpt-4o-mini",
    "temperatura": 0.7,
    "max_tokens": 500,
    "campos_requeridos": ["servicio_elegido"],
    "reglas": ["Si la clienta agenda un servicio, sugiere amablemente un servicio complementario (ej. ofrece pedicure si pidió manicure, o viceversa)."],
    "mensaje_bienvenida": "¡Hola! Soy Sofía, tu asistente virtual. Puedo ayudarte a agendar tu cita de manicure, pedicure o cualquier tratamiento de uñas. ¿En qué te ayudo hoy?",
    "firma": "",
    "mensaje_fuera_horario": "Gracias por tu mensaje. En este momento estamos fuera de horario de atención — te responderemos en cuanto sea posible.",
    "mensaje_error_tecnico": "Error técnico. Intenta de nuevo."
  }'::jsonb,
  '[{"categoria": "SERVICIOS", "contenido": "Manicure clásico ($150, 30 min), Manicure en gel ($250, 45 min), Pedicure spa ($350, 60 min), Uñas acrílicas ($450, 90 min)."}]'::jsonb,
  '[
    {"nombre": "Manicure clásico", "duracion_minutos": 30, "precio": 150},
    {"nombre": "Manicure en gel",  "duracion_minutos": 45, "precio": 250},
    {"nombre": "Pedicure spa",     "duracion_minutos": 60, "precio": 350},
    {"nombre": "Uñas acrílicas",   "duracion_minutos": 90, "precio": 450}
  ]'::jsonb,
  '[
    {"nombre": "Nuevo", "orden": 0},
    {"nombre": "Cita agendada", "orden": 1},
    {"nombre": "Atendido", "orden": 2},
    {"nombre": "Recurrente", "orden": 3},
    {"nombre": "Perdido", "orden": 4}
  ]'::jsonb,
  '{
    "nombre": "Agendar servicio de salón",
    "descripcion": "Flujo transaccional corto: servicio → fecha/hora → confirmación.",
    "trigger_value": "solicitud_cotizacion",
    "nodos": [
      {"nombre": "pedir_servicio", "es_inicio": true, "es_fin": false, "pregunta": "¿Qué servicio te gustaría agendar? (manicure clásico, manicure en gel, pedicure spa, uñas acrílicas...)", "campo": "servicio_elegido", "es_opcional": false, "siguiente_nodo": "pedir_fecha_hora", "modo_respuesta": "prepend_ai", "acciones": [], "orden": 1},
      {"nombre": "pedir_fecha_hora", "es_inicio": false, "es_fin": true, "pregunta": "¿Qué día y hora te gustaría tu cita?", "campo": "fecha_hora_preferida", "es_opcional": false, "siguiente_nodo": null, "modo_respuesta": "replace_ai", "acciones": [{"tipo": "agendar_cita_con_horario_solicitado", "parametros": {}}], "orden": 2}
    ]
  }'::jsonb
);

-- ── Plantilla 2: Uniformes deportivos personalizados ──────────────────────────

INSERT INTO plantillas_industria (
  slug, nombre_visible, palabras_clave, requiere_agenda,
  personalidad, knowledge_base_seed, servicios_seed, pipeline_etapas_seed, workflow_seed
)
VALUES (
  'uniformes_deportivos',
  'Uniformes deportivos personalizados',
  ARRAY['uniforme', 'uniformes', 'soccer', 'deportivo', 'deportivos', 'equipo deportivo', 'jersey', 'futbol', 'fútbol', 'basquetbol', 'béisbol', 'beisbol', 'voleibol', 'handball', 'ciclismo', 'cancha'],
  false,
  '{
    "nombre_asistente": "Diego",
    "cargo": "Asesor comercial virtual",
    "tono": "profesional y cercano",
    "objetivo": "Cotizar uniformes deportivos personalizados para equipos.",
    "idioma": "es",
    "zona_horaria": "America/Monterrey",
    "modelo": "gpt-4o-mini",
    "temperatura": 0.7,
    "max_tokens": 500,
    "campos_requeridos": ["deporte", "cantidad"],
    "reglas": ["Si el cliente no menciona personalización de nombres/números, pregúntalo explícitamente antes de cerrar la cotización."],
    "mensaje_bienvenida": "¡Hola! Soy Diego, tu asesor de uniformes deportivos personalizados. Cuéntame qué necesitas para tu equipo y te ayudo a cotizar.",
    "firma": "",
    "mensaje_fuera_horario": "Gracias por tu mensaje. En este momento estamos fuera de horario de atención — te responderemos en cuanto sea posible.",
    "mensaje_error_tecnico": "Error técnico. Intenta de nuevo."
  }'::jsonb,
  '[{"categoria": "PRODUCTOS", "contenido": "Fabricamos uniformes deportivos personalizados para fútbol, basquetbol, béisbol, voleibol, handball y ciclismo, con personalización de nombres y números. Ubicados en Monterrey, NL."}]'::jsonb,
  '[]'::jsonb,
  '[
    {"nombre": "Nuevo", "orden": 0},
    {"nombre": "Cotizando", "orden": 1},
    {"nombre": "Cotización enviada", "orden": 2},
    {"nombre": "Negociación", "orden": 3},
    {"nombre": "Ganado", "orden": 4},
    {"nombre": "Perdido", "orden": 5}
  ]'::jsonb,
  '{
    "nombre": "Cotización de uniformes deportivos",
    "descripcion": "Descubrimiento comercial: deporte, equipo, cantidad, tallas, colores, tela, personalización, fecha, presupuesto.",
    "trigger_value": "solicitud_cotizacion",
    "nodos": [
      {"nombre": "preguntar_deporte", "es_inicio": true, "es_fin": false, "pregunta": "¿Para qué deporte necesitas los uniformes? (fútbol, basquetbol, béisbol, voleibol, handball, ciclismo...)", "campo": "deporte", "es_opcional": false, "siguiente_nodo": "preguntar_equipo", "modo_respuesta": "prepend_ai", "acciones": [], "orden": 1},
      {"nombre": "preguntar_equipo", "es_inicio": false, "es_fin": false, "pregunta": "¿Cuál es el nombre de tu equipo?", "campo": "nombre_equipo", "es_opcional": true, "siguiente_nodo": "preguntar_cantidad", "modo_respuesta": "replace_ai", "acciones": [], "orden": 2},
      {"nombre": "preguntar_cantidad", "es_inicio": false, "es_fin": false, "pregunta": "¿Cuántos uniformes necesitas?", "campo": "cantidad", "es_opcional": false, "siguiente_nodo": "preguntar_tallas", "modo_respuesta": "replace_ai", "acciones": [], "orden": 3},
      {"nombre": "preguntar_tallas", "es_inicio": false, "es_fin": false, "pregunta": "¿Qué tallas necesitas? (puedes darme un rango o el detalle por jugador)", "campo": "tallas", "es_opcional": false, "siguiente_nodo": "preguntar_colores", "modo_respuesta": "replace_ai", "acciones": [], "orden": 4},
      {"nombre": "preguntar_colores", "es_inicio": false, "es_fin": false, "pregunta": "¿Qué colores quieres para el uniforme?", "campo": "colores", "es_opcional": false, "siguiente_nodo": "preguntar_tela", "modo_respuesta": "replace_ai", "acciones": [], "orden": 5},
      {"nombre": "preguntar_tela", "es_inicio": false, "es_fin": false, "pregunta": "¿Tienes preferencia de tipo de tela?", "campo": "tipo_tela", "es_opcional": true, "siguiente_nodo": "preguntar_personalizacion", "modo_respuesta": "replace_ai", "acciones": [], "orden": 6},
      {"nombre": "preguntar_personalizacion", "es_inicio": false, "es_fin": false, "pregunta": "¿Quieres nombres y números personalizados en cada uniforme?", "campo": "personalizacion", "es_opcional": true, "siguiente_nodo": "preguntar_fecha", "modo_respuesta": "replace_ai", "acciones": [], "orden": 7},
      {"nombre": "preguntar_fecha", "es_inicio": false, "es_fin": false, "pregunta": "¿Para qué fecha los necesitas?", "campo": "fecha_entrega", "es_opcional": false, "siguiente_nodo": "preguntar_presupuesto", "modo_respuesta": "replace_ai", "acciones": [], "orden": 8},
      {"nombre": "preguntar_presupuesto", "es_inicio": false, "es_fin": true, "pregunta": "¿Tienes un presupuesto aproximado en mente?", "campo": "presupuesto", "es_opcional": true, "siguiente_nodo": null, "modo_respuesta": "replace_ai", "acciones": [{"tipo": "crear_oportunidad", "parametros": {}}], "orden": 9}
    ]
  }'::jsonb
);

-- Verificación
SELECT slug, nombre_visible, requiere_agenda, jsonb_array_length(workflow_seed->'nodos') AS num_nodos
FROM plantillas_industria;
