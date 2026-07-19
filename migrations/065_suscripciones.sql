-- TARA — Módulo de Billing: suscripciones.
--
-- `estado` es el vocabulario CANÓNICO de negocio, no un espejo de Stripe —
-- ver modules/billing-engine/estados.js::mapearEstadoProveedor(). Esto es
-- lo que permite cambiar de proveedor de pagos sin tocar lógica de negocio:
-- ningún módulo de plataforma conoce el vocabulario propio de Stripe/
-- Mercado Pago/OpenPay, solo el canónico.
--
-- `proveedor='manual'` (default): suscripciones que administra un Super
-- Admin a mano, sin ningún gateway de pago real detrás (ej. Enterprise,
-- promociones, o mientras no exista cuenta conectada). `proveedor_customer_id`/
-- `proveedor_suscripcion_id` quedan NULL en ese caso.
--
-- No hay UNIQUE(organization_id): si una organización cancela y vuelve a
-- suscribirse después, es una fila nueva legítima. La vigente siempre se
-- resuelve por ORDER BY created_at DESC LIMIT 1.

CREATE TABLE suscripciones (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES organizations(id),
  plan_id                       uuid NOT NULL REFERENCES planes(id),
  estado                        text NOT NULL CHECK (estado IN (
    'trial', 'active', 'past_due', 'suspended', 'cancelled', 'expired'
  )),
  proveedor                     text NOT NULL DEFAULT 'manual' CHECK (proveedor IN ('manual', 'stripe', 'mercadopago', 'openpay')),
  proveedor_customer_id         text,
  proveedor_suscripcion_id      text UNIQUE,
  fecha_inicio                  timestamptz NOT NULL DEFAULT now(),
  fecha_prueba_fin              timestamptz,
  fecha_periodo_actual_inicio   timestamptz,
  fecha_periodo_actual_fin      timestamptz, -- "próximo cobro"
  cancelar_al_fin_periodo       boolean NOT NULL DEFAULT false,
  fecha_cancelacion             timestamptz,
  meses_regalo                  integer NOT NULL DEFAULT 0,
  notas_promocion               text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_suscripciones_organization ON suscripciones(organization_id);

-- Verificación
SELECT count(*) AS suscripciones_creadas FROM suscripciones;

INSERT INTO schema_migrations (archivo) VALUES ('065') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS suscripciones;
