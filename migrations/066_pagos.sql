-- TARA — FASE 8.1: pagos (historial de facturas que TARA le cobra a la
-- empresa por su suscripción).
--
-- Importante — esto NO es facturación fiscal (CFDI) de cada empresa hacia
-- SUS clientes finales. ADR-006 ya marcó ese escenario como diseño aparte
-- ("probablemente requiera cumplimiento fiscal... merece diseño propio").
-- Esta tabla es exclusivamente el lado de TARA-cobra-a-la-empresa.

CREATE TABLE pagos (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id),
  suscripcion_id            uuid REFERENCES suscripciones(id),
  stripe_invoice_id         text UNIQUE,
  stripe_payment_intent_id  text,
  monto_centavos            integer NOT NULL,
  moneda                    text NOT NULL DEFAULT 'MXN',
  estado                    text NOT NULL, -- espejo Stripe: draft|open|paid|void|uncollectible
  fecha_emision             timestamptz,
  fecha_pago                timestamptz,
  factura_pdf_url           text, -- hosted_invoice_url/invoice_pdf de Stripe
  descripcion               text,
  raw_evento                jsonb, -- snapshot completo del evento de Stripe, para auditar sin re-llamar a su API
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pagos_organization ON pagos(organization_id);

-- Verificación
SELECT count(*) AS pagos_registrados FROM pagos;

INSERT INTO schema_migrations (archivo) VALUES ('066') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS pagos;
