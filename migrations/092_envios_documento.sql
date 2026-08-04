-- TARA-OS — Fase 2 Ingeniería y Cotización: tracking de envío de documentos
-- por WhatsApp (servicio genérico, ver modules/envio-documentos.js).
--
-- Restricción explícita de Alina (2026-08-04): registrar proveedor
-- utilizado, message_id, destinatario, archivo y versión de cotización,
-- fecha de envío, estado inicial, y error del proveedor cuando exista.
-- `cotizacion_id`/`cotizacion_version` son nullable — este servicio es
-- genérico (no exclusivo de cotizaciones), aunque en Fase 2/3 solo se usa
-- para el PDF de una cotización.

CREATE TABLE IF NOT EXISTS envios_documento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  cliente_id            bigint NOT NULL REFERENCES clientes(id),
  cotizacion_id         bigint REFERENCES cotizaciones(id),
  cotizacion_version     integer, -- snapshot de qué versión se envió (calculos_ingenieria.version), no se recalcula después
  proveedor             text NOT NULL CHECK (proveedor IN ('twilio', 'meta')),
  destinatario          text NOT NULL,
  storage_bucket        text NOT NULL,
  storage_path          text NOT NULL,
  filename              text,
  message_id            text, -- SID de Twilio o wamid de Meta — null mientras estado='enviando'
  estado                text NOT NULL DEFAULT 'enviando' CHECK (estado IN ('enviando', 'enviado', 'fallido')),
  error_proveedor       text,
  enviado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_envios_documento_company ON envios_documento(company_id);
CREATE INDEX IF NOT EXISTS idx_envios_documento_cotizacion ON envios_documento(cotizacion_id);

ALTER TABLE envios_documento DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
