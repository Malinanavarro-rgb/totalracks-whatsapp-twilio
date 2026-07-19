-- TARA — Módulo de Billing: métodos de pago.
--
-- Preparada para múltiples proveedores desde el día uno (Stripe, Mercado
-- Pago, OpenPay) aunque hoy no haya ninguno conectado. `token` es SIEMPRE
-- el identificador que el proveedor asigna al método de pago — nunca el
-- número de tarjeta ni ningún otro dato sensible (PCI).
--
-- Una organización puede tener más de una fila histórica (tarjeta
-- reemplazada); la vigente es la más reciente con estado='activo' — mismo
-- criterio de "vigente = más reciente" que suscripciones.

CREATE TABLE metodos_pago (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  proveedor         text NOT NULL CHECK (proveedor IN ('stripe', 'mercadopago', 'openpay')),
  token             text NOT NULL,
  ultimos4          text,
  marca             text, -- 'Visa' | 'Mastercard' | 'AMEX' | ...
  fecha_expiracion  text, -- 'MM/YY'
  estado            text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'reemplazado', 'expirado')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_metodos_pago_organization ON metodos_pago(organization_id);

-- Verificación
SELECT count(*) AS metodos_registrados FROM metodos_pago;

INSERT INTO schema_migrations (archivo) VALUES ('066') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS metodos_pago;
