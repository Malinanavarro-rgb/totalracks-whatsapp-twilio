-- TARA Matrix™ — ANEXO A (Motor de Agenda)
-- Migration 014: tabla calendar_credentials
-- Credenciales de calendario por empresa. Genérica por proveedor (google | outlook).
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS calendar_credentials (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id    uuid        NOT NULL REFERENCES companies(id),
  proveedor     text        NOT NULL,
  -- valores: 'google' | 'outlook' (futuro)
  credenciales  jsonb       NOT NULL,
  -- tokens OAuth cifrados a nivel de aplicación (AES-256-GCM, ver Anexo A 2.8)
  calendario_id text,
  -- ID del calendario externo por defecto
  activo        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_credentials_company
  ON calendar_credentials (company_id, proveedor, activo);

ALTER TABLE calendar_credentials DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'calendar_credentials creada' AS resultado, COUNT(*) AS filas FROM calendar_credentials;
