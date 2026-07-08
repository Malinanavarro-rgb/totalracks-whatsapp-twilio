-- TARA Matrix™ — ANEXO A (Motor de Agenda)
-- Migration 015: tabla asesores
-- Asesores/recursos que pueden recibir citas.
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS asesores (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id     uuid        NOT NULL REFERENCES companies(id),
  nombre         text        NOT NULL,
  email          text,
  calendario_id  text,
  -- calendario externo específico del asesor (opcional)
  activo         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asesores_company_activo
  ON asesores (company_id, activo);

ALTER TABLE asesores DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'asesores creada' AS resultado, COUNT(*) AS filas FROM asesores;
