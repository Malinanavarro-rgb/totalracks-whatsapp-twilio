-- TARA Matrix™ — ANEXO A (Motor de Agenda)
-- Migration 016: tabla horarios_laborales
-- asesor_id NULL = aplica a todos los asesores de la empresa.
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS horarios_laborales (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id   uuid        NOT NULL REFERENCES companies(id),
  asesor_id    uuid        REFERENCES asesores(id),
  dia_semana   integer     NOT NULL,
  -- 0=domingo … 6=sábado
  hora_inicio  time        NOT NULL,
  hora_fin     time        NOT NULL,
  zona_horaria text        NOT NULL DEFAULT 'America/Monterrey'
);

CREATE INDEX IF NOT EXISTS idx_horarios_laborales_company
  ON horarios_laborales (company_id, asesor_id, dia_semana);

ALTER TABLE horarios_laborales DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'horarios_laborales creada' AS resultado, COUNT(*) AS filas FROM horarios_laborales;
