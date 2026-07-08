-- TARA Matrix™ — ANEXO A (Motor de Agenda)
-- Migration 018: índice único en calendar_credentials
-- Necesario para hacer upsert seguro cuando una empresa conecta/reconecta su
-- cuenta de Google — sin esto, cada reconexión crearía una fila duplicada
-- en vez de actualizar la existente.
-- Ejecutar en Supabase SQL Editor (después de 014_calendar_credentials.sql)

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_credentials_company_proveedor
  ON calendar_credentials (company_id, proveedor);

-- Verificación
SELECT 'idx_calendar_credentials_company_proveedor creado' AS resultado;
