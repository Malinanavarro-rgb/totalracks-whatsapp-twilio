-- TARA Matrix™ — ANEXO C adelantado (TC.2), requerido por ANEXO B
-- Migration 022: tabla servicios
-- Catálogo de servicios por empresa (ej. "Manicure clásico", 30 min).
-- Sin `asesores_habilitados` en esta primera vuelta — no hay todavía un
-- caso de uso que lo requiera (P2: no diseñar para requisitos hipotéticos).
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS servicios (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id        uuid        NOT NULL REFERENCES companies(id),
  nombre            text        NOT NULL,
  duracion_minutos  integer     NOT NULL DEFAULT 30,
  precio            numeric,
  activo            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_servicios_company_activo
  ON servicios (company_id, activo);

ALTER TABLE servicios DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'servicios creada' AS resultado, COUNT(*) AS filas FROM servicios;
