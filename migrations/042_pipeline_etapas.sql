-- TARA Matrix™ — Pivote a producto, Fase 2.2: catálogo de etapas de pipeline
-- Hasta hoy el frontend (CrmClienteDetalle.jsx) usaba un arreglo ESTADOS
-- hardcodeado (mismo para cliente.estado y oportunidades.estado, mezclando
-- dos conceptos). Esta tabla reemplaza el catálogo de oportunidades.estado
-- por uno configurable por empresa desde Configuración.
--
-- Se siembra con las 6 etapas que ya existían hardcodeadas, una fila por
-- empresa activa, para que ninguna empresa existente pierda sus etapas
-- actuales al correr esta migración.
--
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS pipeline_etapas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  nombre     text NOT NULL,
  orden      integer NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_etapas_company ON pipeline_etapas (company_id);

ALTER TABLE pipeline_etapas DISABLE ROW LEVEL SECURITY;
-- Misma justificación que servicios/horarios_laborales — escritura y lectura
-- vía sesión autenticada del panel, nunca desde el navegador con anon key sin sesión.

INSERT INTO pipeline_etapas (company_id, nombre, orden)
SELECT c.id, etapa.nombre, etapa.orden
FROM companies c
CROSS JOIN (VALUES
  ('Nuevo', 0), ('Calificacion', 1), ('Negociacion', 2), ('Calificado', 3), ('Ganado', 4), ('Perdido', 5)
) AS etapa(nombre, orden)
WHERE NOT EXISTS (SELECT 1 FROM pipeline_etapas pe WHERE pe.company_id = c.id);

-- Verificación
SELECT company_id, count(*) AS total_etapas FROM pipeline_etapas GROUP BY company_id;
