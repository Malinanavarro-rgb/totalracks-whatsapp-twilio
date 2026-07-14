-- TARA — Fase Premium V1.1: catálogo demo real de Tienda Soccer
-- El motor de plantillas (migración 044) no siembra `servicios` para
-- uniformes_deportivos (requiere_agenda=false) — por eso Catálogo aparecía
-- vacío. Se agregan los 6 productos reales del giro (mismo criterio que el
-- resto de datos demo: nombres/precios realistas, no "Producto 1").
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

INSERT INTO servicios (company_id, nombre, duracion_minutos, precio, activo)
SELECT '3463e797-9a4f-4782-8936-6c2fb18c437e', v.nombre, 30, v.precio, true
FROM (VALUES
  ('Uniforme de fútbol — Local', 1850),
  ('Uniforme de básquetbol',     1350),
  ('Uniforme de ciclismo',       3000),
  ('Uniforme de béisbol',        1650),
  ('Uniforme de voleibol',       1240),
  ('Uniforme de handball',       1180)
) AS v(nombre, precio)
WHERE NOT EXISTS (
  SELECT 1 FROM servicios s
  WHERE s.company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e' AND s.nombre = v.nombre
);

-- Verificación
SELECT nombre, precio, activo FROM servicios WHERE company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e' ORDER BY nombre;
