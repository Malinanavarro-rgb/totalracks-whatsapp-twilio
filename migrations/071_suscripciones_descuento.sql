-- TARA — Portal del Cliente: descuentos.
--
-- Guardado ahora, aplicado en el cálculo del monto cuando exista
-- facturación real de un proveedor conectado — modules/billing-engine/
-- pagos.js::registrarPago() es el único lugar que necesitaría leer este
-- campo después. Sin proveedor conectado todavía, este campo solo queda
-- disponible para que el Super Admin lo asigne desde el Panel Maestro.

ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS descuento_pct integer NOT NULL DEFAULT 0 CHECK (descuento_pct BETWEEN 0 AND 100);

-- Verificación
SELECT column_name, data_type, column_default FROM information_schema.columns
  WHERE table_name = 'suscripciones' AND column_name = 'descuento_pct';

INSERT INTO schema_migrations (archivo) VALUES ('071') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- ALTER TABLE suscripciones DROP COLUMN IF EXISTS descuento_pct;
