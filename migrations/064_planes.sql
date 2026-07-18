-- TARA — FASE 8.1: catálogo de planes de suscripción.
--
-- `limites` en jsonb es el gancho que resuelve el hallazgo #5 de la
-- Auditoría 2026-07 ("rate limit de OpenAI compartido entre todas las
-- empresas, sin enforcement por plan") — el dato para aplicarlo
-- (decision_logs.costo_usd/tokens_total) ya existe, solo faltaba el techo
-- por plan. El enforcement en sí no es parte de esta entrega.
--
-- Seed: 3 planes PLACEHOLDER (nombres/precios de ejemplo, editables desde
-- el Panel Maestro en 8.2) — confirmado explícitamente con la dueña que
-- todavía no tiene precios finales definidos. `stripe_price_id` queda NULL
-- hasta que exista una cuenta de Stripe real conectada (8.3).

CREATE TABLE planes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave             text UNIQUE NOT NULL,        -- estable, nunca cambia una vez usado por una suscripción real
  nombre            text NOT NULL,               -- display, sí puede cambiar
  precio_centavos   integer NOT NULL,            -- dinero como entero, nunca float
  moneda            text NOT NULL DEFAULT 'MXN',
  periodo           text NOT NULL DEFAULT 'mensual', -- 'mensual' | 'anual'
  stripe_price_id   text,
  limites           jsonb NOT NULL DEFAULT '{}', -- {max_companies, max_usuarios, max_conversaciones_mes, max_tokens_mes}
  activo            boolean NOT NULL DEFAULT true, -- retirar de venta sin romper suscripciones ya creadas
  orden             integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO planes (clave, nombre, precio_centavos, periodo, limites, orden) VALUES
  ('starter',  'Starter (placeholder)',  99900,  'mensual', '{"max_companies":1,"max_usuarios":3,"max_conversaciones_mes":500,"max_tokens_mes":null}', 1),
  ('pro',      'Pro (placeholder)',      249900, 'mensual', '{"max_companies":1,"max_usuarios":10,"max_conversaciones_mes":2000,"max_tokens_mes":null}', 2),
  ('business', 'Business (placeholder)', 499900, 'mensual', '{"max_companies":3,"max_usuarios":30,"max_conversaciones_mes":null,"max_tokens_mes":null}', 3);

-- Verificación
SELECT clave, nombre, precio_centavos, moneda, limites FROM planes ORDER BY orden;

INSERT INTO schema_migrations (archivo) VALUES ('064') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS planes;
