-- TARA — Fase Demo · Tienda Soccer
-- Identidad visual por empresa (color_acento, nav_labels) + bandera de
-- industria (industria_slug, ya consumida por dashboard.js para enrutar al
-- dashboard de uniformes_deportivos) + datos demo reales para que las
-- recomendaciones de TARA se calculen de verdad (no son texto fijo — ver
-- modules/dashboard.js::_obtenerRecomendacionesUniformesDeportivos).
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

-- 1. Columnas nuevas en companies ---------------------------------------

ALTER TABLE companies ADD COLUMN IF NOT EXISTS color_acento   text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS industria_slug text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS nav_labels     jsonb;

UPDATE companies
SET color_acento   = '#0F9D76',
    industria_slug = 'uniformes_deportivos',
    nav_labels      = '{"crm": "Ventas", "catalogo": "Catálogo"}'::jsonb
WHERE id = '3463e797-9a4f-4782-8936-6c2fb18c437e';

-- 2. Proceso comercial (pipeline_etapas) — 10 etapas exactas -------------
-- Reemplaza las 6 etapas genéricas sembradas por la migración 042 para
-- esta empresa únicamente; no afecta a Total Racks ni al Salón de Belleza.

DELETE FROM pipeline_etapas WHERE company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e';

INSERT INTO pipeline_etapas (company_id, nombre, orden)
SELECT '3463e797-9a4f-4782-8936-6c2fb18c437e', etapa.nombre, etapa.orden
FROM (VALUES
  ('Solicitud nueva', 0),
  ('Información pendiente', 1),
  ('Cotización en preparación', 2),
  ('Cotización enviada', 3),
  ('Seguimiento', 4),
  ('Pedido confirmado', 5),
  ('En producción', 6),
  ('Listo para entrega', 7),
  ('Entregado', 8),
  ('No concretado', 9)
) AS etapa(nombre, orden);

-- 3. Clientes demo realistas ----------------------------------------------
-- "No usar 'Cliente Demo'" — nombres de equipos/instituciones deportivas
-- reales de Monterrey, consistentes con el giro de Tienda Soccer.

INSERT INTO clientes (company_id, nombre, telefono, ciudad, fuente, estado, score_interes)
SELECT '3463e797-9a4f-4782-8936-6c2fb18c437e', v.nombre, v.telefono, 'Monterrey', 'WhatsApp', v.estado, v.score_interes
FROM (VALUES
  ('Rayados FC',               '+528112345601', 'Negociacion',  80),
  ('Liga Municipal Monterrey', '+528112345602', 'Nuevo',        60),
  ('Prepa Tec',                '+528112345603', 'Calificacion', 70),
  ('Colegio Oxford',           '+528112345604', 'Calificado',   75),
  ('Academia Tigres',          '+528112345605', 'Calificado',   85),
  ('Club Cumbres',             '+528112345606', 'Negociacion',  78),
  ('Deportivo Anáhuac',        '+528112345607', 'Ganado',       90),
  ('Club Atlético Garza',      '+528112345608', 'Ganado',       88)
) AS v(nombre, telefono, estado, score_interes)
WHERE NOT EXISTS (
  SELECT 1 FROM clientes c
  WHERE c.telefono = v.telefono AND c.company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e'
);

-- 4. Oportunidades demo — timestamps reales para que las recomendaciones
--    se calculen honestamente (updated_at de "Cotización enviada" con más
--    de 48h para disparar la alerta de seguimiento).

INSERT INTO oportunidades (company_id, cliente_id, estado, descripcion, presupuesto_estimado, presupuesto_confirmado, probabilidad, created_at, updated_at)
SELECT '3463e797-9a4f-4782-8936-6c2fb18c437e', c.id, v.estado, v.descripcion, v.presupuesto_estimado, v.presupuesto_confirmado, v.probabilidad,
       now() - (v.hace_dias || ' days')::interval,
       now() - (v.hace_dias || ' days')::interval
FROM clientes c
JOIN (VALUES
  -- Dos cotizaciones estancadas 48h+ (Rayados FC, Colegio Oxford) para que
  -- TARA recomiende dar seguimiento — mismo patrón pedido en la reunión.
  ('Rayados FC',               'Cotización enviada',         'Uniforme de local y visita, 28 jugadores',    62000, NULL,   60, 3),
  ('Colegio Oxford',           'Cotización enviada',         'Uniformes de fútbol para categoría infantil', 27000, NULL,   55, 4),
  ('Prepa Tec',                'Cotización en preparación',  'Uniforme de básquetbol, equipo varonil',      38000, NULL,   50, 1),
  ('Liga Municipal Monterrey', 'Listo para entrega',          'Uniformes para 8 equipos de la liga',        41000, NULL,   85, 0),
  ('Academia Tigres',          'Solicitud nueva',             'Uniforme de voleibol, rama femenil',          NULL,  NULL,   20, 0),
  ('Club Cumbres',             'En producción',                'Uniforme de ciclismo personalizado, 15 piezas', 45000, NULL, 70, 5),
  ('Deportivo Anáhuac',        'Entregado',                    'Uniforme de béisbol, equipo completo',       45000, 45000, 99, 10),
  ('Club Atlético Garza',      'Entregado',                    'Uniforme de handball, rama varonil',          32500, 32500, 99, 8)
) AS v(nombre, estado, descripcion, presupuesto_estimado, presupuesto_confirmado, probabilidad, hace_dias)
  ON c.nombre = v.nombre AND c.company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e'
WHERE NOT EXISTS (
  SELECT 1 FROM oportunidades o
  WHERE o.cliente_id = c.id AND o.company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e' AND o.estado = v.estado
);

-- Verificación
SELECT nombre, color_acento, industria_slug, nav_labels FROM companies WHERE id = '3463e797-9a4f-4782-8936-6c2fb18c437e';
SELECT nombre, orden FROM pipeline_etapas WHERE company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e' ORDER BY orden;
SELECT c.nombre, o.estado, o.presupuesto_confirmado, o.updated_at
  FROM oportunidades o JOIN clientes c ON c.id = o.cliente_id
  WHERE o.company_id = '3463e797-9a4f-4782-8936-6c2fb18c437e'
  ORDER BY o.updated_at;
