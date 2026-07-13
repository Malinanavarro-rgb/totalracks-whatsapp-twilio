-- TARA Matrix™ — Meta WhatsApp Cloud API como canal principal (Twilio fallback)
-- Migration 039: channel_endpoints.proveedor + tabla meta_whatsapp_credentials.
--
-- Modelo Meta "Tech Provider" (el mismo que usa Embedded Signup): una sola
-- Meta App de TARA (app_id/app_secret/verify_token a nivel plataforma, en
-- variables de entorno — META_APP_ID/META_APP_SECRET/META_VERIFY_TOKEN), y
-- cada empresa conecta su propio WABA/número/token a esa misma app. Por eso
-- estos 4 campos NO están en esta tabla — solo lo que es genuinamente propio
-- de cada empresa.
--
-- Aditivo, cero impacto en empresas ya conectadas por Twilio (default
-- 'twilio' en channel_endpoints.proveedor).
--
-- Ejecutar en Supabase SQL Editor

ALTER TABLE channel_endpoints
  ADD COLUMN IF NOT EXISTS proveedor text NOT NULL DEFAULT 'twilio'; -- 'twilio' | 'meta'
  -- Para filas de Meta, `endpoint` = phone_number_id (la clave de routing que
  -- Meta manda en cada payload de webhook) — no el número humano legible.

CREATE TABLE IF NOT EXISTS meta_whatsapp_credentials (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    uuid        NOT NULL REFERENCES companies(id),
  whatsapp_business_account_id  text        NOT NULL,
  phone_number_id               text        NOT NULL,
  meta_business_id              text,       -- opcional
  credenciales                  jsonb       NOT NULL, -- { access_token } cifrado vía modules/crypto-util.js (AES-256-GCM)
  estado                        text        NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'activo', 'error', 'desconectado')),
  activo                        boolean     NOT NULL DEFAULT true,
  created_at                    timestamptz DEFAULT now(),
  updated_at                    timestamptz DEFAULT now(),
  UNIQUE (company_id),
  UNIQUE (phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_credentials_company
  ON meta_whatsapp_credentials (company_id);

ALTER TABLE meta_whatsapp_credentials DISABLE ROW LEVEL SECURITY;
-- Misma justificación que calendar_credentials/decision_logs: escritura y
-- lectura exclusiva server-side, la anon key nunca se expone al navegador.

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'channel_endpoints' AND column_name = 'proveedor';

SELECT count(*) AS total_meta_credentials FROM meta_whatsapp_credentials;
