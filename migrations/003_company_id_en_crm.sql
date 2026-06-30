-- ─────────────────────────────────────────────────────────────────────────────
-- TARA Matrix™ — Migración 003
-- Aislamiento de datos CRM por empresa
-- Fase: FASE 3 — Multiempresa Real
--
-- Agrega company_id a clientes, conversaciones y oportunidades.
-- Hace backfill de todas las filas existentes → Total Racks.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── clientes ──────────────────────────────────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

UPDATE clientes
SET company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_company_telefono
  ON clientes (company_id, telefono);

-- ── conversaciones ────────────────────────────────────────────────────────────
ALTER TABLE conversaciones
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

UPDATE conversaciones
SET company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversaciones_company_time
  ON conversaciones (company_id, created_at DESC);

-- ── oportunidades ─────────────────────────────────────────────────────────────
ALTER TABLE oportunidades
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

UPDATE oportunidades
SET company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_oportunidades_company_estado
  ON oportunidades (company_id, estado);
