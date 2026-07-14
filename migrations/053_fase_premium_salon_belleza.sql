-- TARA — Fase Premium · Salón de Belleza
-- Registro de auditoría de los cambios aplicados directamente en Supabase
-- durante esta fase (identidad, infraestructura de agenda, regla de
-- precios) + datos demo realistas para que las recomendaciones de TARA se
-- calculen de verdad (ver modules/dashboard.js::_obtenerRecomendacionesSalonBelleza).
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

-- 1. Identidad visual + bandera de industria -----------------------------
-- (companies.industria_slug/color_acento ya existen desde la migración 046)

UPDATE companies
SET industria_slug = 'salon_belleza',
    color_acento   = '#E85D8C'
WHERE id = '5a867538-13cb-427a-8c49-d23716391f4e';

-- 2. Infraestructura de agenda: sin esto, Agenda estaba 100% rota --------
-- (SchedulingEngine._obtenerHorario() siempre regresaba null: cero
-- asesores, cero horarios_laborales para esta empresa).

INSERT INTO asesores (company_id, nombre, activo)
SELECT '5a867538-13cb-427a-8c49-d23716391f4e', 'Ana Martínez', true
WHERE NOT EXISTS (
  SELECT 1 FROM asesores
  WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' AND nombre = 'Ana Martínez'
);

INSERT INTO horarios_laborales (company_id, asesor_id, dia_semana, hora_inicio, hora_fin, zona_horaria)
SELECT '5a867538-13cb-427a-8c49-d23716391f4e', NULL, v.dia, '09:00', '19:00', 'America/Monterrey'
FROM (VALUES (1), (2), (3), (4), (5), (6)) AS v(dia)
WHERE NOT EXISTS (
  SELECT 1 FROM horarios_laborales
  WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' AND asesor_id IS NULL AND dia_semana = v.dia
);
-- Domingo (0) queda sin configurar a propósito — el salón cierra ese día.

-- 3. Regla de personalidad: precios solo si la clienta pregunta ----------
-- Instrucción explícita: "solo debemos de mandar los costos de la cita...
-- en dado caso que el cliente nos pregunte" — nunca de forma proactiva.

UPDATE personalities
SET reglas = '[
  "Si la clienta agenda un servicio, sugiere amablemente un servicio complementario (ej. ofrece pedicure si pidió manicure, o viceversa).",
  "No menciones precios de forma proactiva. Comparte el costo de un servicio únicamente si la clienta pregunta directamente por el precio."
]'::jsonb
WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e';

-- 4. Clientas demo realistas ----------------------------------------------

INSERT INTO clientes (company_id, nombre, telefono, ciudad, fuente, estado, score_interes)
SELECT '5a867538-13cb-427a-8c49-d23716391f4e', v.nombre, v.telefono, 'Monterrey', 'WhatsApp', v.estado, v.score_interes
FROM (VALUES
  ('Karla Torres',      '+5218112345701', 'Cita agendada', 75),
  ('Valeria Cruz',      '+5218112345702', 'Cita agendada', 80),
  ('Fernanda López',    '+5218112345703', 'Recurrente',    85),
  ('Daniela Ramírez',   '+5218112345704', 'Atendido',      60),
  ('Sofía Hernández',   '+5218112345705', 'Nuevo',         35),
  ('Renata Flores',     '+5218112345706', 'Perdido',       20)
) AS v(nombre, telefono, estado, score_interes)
WHERE NOT EXISTS (
  SELECT 1 FROM clientes c
  WHERE c.telefono = v.telefono AND c.company_id = '5a867538-13cb-427a-8c49-d23716391f4e'
);

-- 5. Citas demo — timestamps reales para disparar ambas reglas de
--    recomendación honestamente (confirmar en <48h, retoque a 45+ días).

INSERT INTO citas (company_id, cliente_id, asesor_id, inicio, fin, estado)
SELECT '5a867538-13cb-427a-8c49-d23716391f4e', c.id,
       (SELECT id FROM asesores WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' AND nombre = 'Ana Martínez'),
       v.inicio, v.inicio + (v.duracion_min || ' minutes')::interval, v.estado
FROM clientes c
JOIN (VALUES
  -- Karla: cita mañana sin confirmar → dispara "Confirma la cita de Karla".
  ('Karla Torres',    now() + interval '1 day',   45, 'agendada'),
  -- Valeria: cita en 2 días, ya confirmada → no dispara nada (contraste).
  ('Valeria Cruz',    now() + interval '2 days',  60, 'confirmada'),
  -- Fernanda: visitó hace 20 días, sin cita futura → dentro del umbral, sin recordatorio.
  ('Fernanda López',  now() - interval '20 days', 30, 'completada'),
  -- Daniela: visitó hace 50 días, sin cita futura → dispara recordatorio de retoque.
  ('Daniela Ramírez', now() - interval '50 days', 90, 'completada'),
  -- Renata: visitó hace 90 días, sin cita futura → también dispara recordatorio (riesgo de fuga).
  ('Renata Flores',   now() - interval '90 days', 30, 'completada')
) AS v(nombre, inicio, duracion_min, estado)
  ON c.nombre = v.nombre AND c.company_id = '5a867538-13cb-427a-8c49-d23716391f4e'
WHERE NOT EXISTS (
  SELECT 1 FROM citas ci
  WHERE ci.cliente_id = c.id AND ci.company_id = '5a867538-13cb-427a-8c49-d23716391f4e' AND ci.estado = v.estado
);
-- Sofía queda deliberadamente sin cita: clienta nueva que apenas escribió.

-- Verificación
SELECT nombre, industria_slug, color_acento FROM companies WHERE id = '5a867538-13cb-427a-8c49-d23716391f4e';
SELECT nombre, activo FROM asesores WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e';
SELECT dia_semana, hora_inicio, hora_fin FROM horarios_laborales WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' ORDER BY dia_semana;
SELECT reglas FROM personalities WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e';
SELECT c.nombre, c.estado, ci.inicio, ci.estado AS estado_cita
  FROM clientes c LEFT JOIN citas ci ON ci.cliente_id = c.id
  WHERE c.company_id = '5a867538-13cb-427a-8c49-d23716391f4e'
  ORDER BY c.nombre;
