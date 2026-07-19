-- TARA — Módulo de Billing: historial de pagos/facturas.
--
-- Estas son las facturas que TARA le cobra a la empresa por su suscripción
-- — NO es facturación fiscal (CFDI) de cada empresa hacia SUS clientes
-- finales (ADR-006 ya marcó ese escenario como diseño aparte).
--
-- `numero_factura` es el folio INTERNO de TARA (no el ID del proveedor).
-- `factura_xml_url` queda NULL hasta que se implemente CFDI — el campo ya
-- existe para no requerir otra migración cuando llegue ese momento.

CREATE TABLE pagos (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id),
  suscripcion_id            uuid REFERENCES suscripciones(id),
  proveedor                 text NOT NULL CHECK (proveedor IN ('manual', 'stripe', 'mercadopago', 'openpay')),
  proveedor_invoice_id      text UNIQUE,
  proveedor_transaccion_id  text,
  numero_factura            text,
  subtotal_centavos         integer NOT NULL,
  iva_centavos              integer NOT NULL DEFAULT 0,
  total_centavos            integer NOT NULL,
  moneda                    text NOT NULL DEFAULT 'MXN',
  estado                    text NOT NULL CHECK (estado IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  fecha_emision             timestamptz,
  fecha_pago                timestamptz,
  factura_pdf_url           text,
  factura_xml_url           text,
  descripcion               text,
  raw_evento                jsonb,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pagos_organization ON pagos(organization_id);

-- Verificación
SELECT count(*) AS pagos_registrados FROM pagos;

INSERT INTO schema_migrations (archivo) VALUES ('067') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS pagos;
