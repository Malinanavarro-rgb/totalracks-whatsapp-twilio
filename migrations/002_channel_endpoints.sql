-- ─────────────────────────────────────────────────────────────────────────────
-- TARA Matrix™ — Migración 002
-- Tabla: channel_endpoints
-- Fase: FASE 3 — Multiempresa Real
--
-- Propósito: mapear cada número/dirección de canal (Twilio, Instagram, email)
-- a la empresa que lo posee. Es la base del routing dinámico multi-tenant.
--
-- Ejecutar en: Supabase → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_endpoints (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  uuid        NOT NULL REFERENCES companies(id),
  endpoint    text        NOT NULL,               -- ej: "whatsapp:+521XXXXXXXXXX"
  canal       text        NOT NULL DEFAULT 'whatsapp',
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),

  UNIQUE (endpoint)
);

-- Índice principal: usado en cada webhook entrante (hot path)
CREATE INDEX IF NOT EXISTS idx_channel_endpoints_lookup
  ON channel_endpoints (endpoint, activo);

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA DE SEGURIDAD — Sin RLS
--
-- channel_endpoints es de escritura/lectura exclusivamente server-side.
-- La anon key vive en Render (variable de entorno), nunca en el navegador.
-- Misma razón que decision_logs (ver migrations/001_decision_logs.sql).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE channel_endpoints DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — Ejecutar después de aplicar la migración:
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'channel_endpoints'
-- ORDER BY ordinal_position;
--
-- Resultado esperado: 6 columnas
--   id          | uuid    | NO
--   company_id  | uuid    | NO
--   endpoint    | text    | NO
--   canal       | text    | NO
--   activo      | boolean | NO
--   created_at  | timestamp with time zone | YES
--
-- SELECT indexname FROM pg_indexes WHERE tablename = 'channel_endpoints';
-- Resultado esperado:
--   channel_endpoints_pkey
--   channel_endpoints_endpoint_key
--   idx_channel_endpoints_lookup
-- ─────────────────────────────────────────────────────────────────────────────
