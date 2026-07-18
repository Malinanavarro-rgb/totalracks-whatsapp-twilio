-- TARA — FASE 8.1: suscripciones (estado comercial de una organization).
--
-- estado es un espejo textual de Stripe (trialing|active|past_due|canceled|
-- unpaid|incomplete|incomplete_expired|paused) — nunca se inventa un estado
-- propio que Stripe no tenga. Sin Stripe conectado todavía (confirmado con
-- la dueña), las suscripciones que se creen manualmente desde el Panel
-- Maestro usan 'active' con stripe_customer_id/stripe_subscription_id NULL.
--
-- No hay UNIQUE(organization_id): si una organización cancela y vuelve a
-- suscribirse después con un stripe_subscription_id nuevo, es una fila
-- nueva legítima. La vigente siempre se resuelve por
-- ORDER BY created_at DESC LIMIT 1 (ver modules/plataforma-billing.js).

CREATE TABLE suscripciones (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES organizations(id),
  plan_id                       uuid NOT NULL REFERENCES planes(id),
  estado                        text NOT NULL DEFAULT 'active',
  stripe_customer_id            text,
  stripe_subscription_id        text UNIQUE,
  fecha_inicio                  timestamptz NOT NULL DEFAULT now(),
  fecha_prueba_fin              timestamptz,
  fecha_periodo_actual_inicio   timestamptz,
  fecha_periodo_actual_fin      timestamptz, -- "próximo pago"
  cancelar_al_fin_periodo       boolean NOT NULL DEFAULT false,
  fecha_cancelacion             timestamptz,
  metodo_pago_resumen           jsonb, -- {brand, last4, exp_month, exp_year} — nunca el PAN completo
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
