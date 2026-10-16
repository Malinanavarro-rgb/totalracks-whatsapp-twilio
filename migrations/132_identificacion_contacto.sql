-- TARA — Identificación obligatoria de contacto (Alina, 2026-10-16,
-- autorizada tras TARA_IDENTIFICACION_CONTACTO_DIAGNOSTICO_V1.md).
--
-- Aditiva, mismo patrón que la migración 126 (clasificacion-cliente.js):
-- clientes.nombre ya existe (no se toca el esquema ahí) — solo se agrega
-- el campo que faltaba, "motivo de consulta", con su propia columna de
-- fuente para no sobreescribir nunca un valor de mayor confianza con uno
-- de menor confianza (manual > cliente > ia_inferido).

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS motivo_consulta text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS motivo_consulta_fuente text CHECK (motivo_consulta_fuente IN ('cliente', 'ia_inferido', 'manual'));
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS motivo_consulta_actualizado_en timestamptz;

-- Verificación
SELECT count(*) AS clientes_totales, count(motivo_consulta) AS con_motivo_ya_capturado FROM clientes;

INSERT INTO schema_migrations (archivo) VALUES ('132') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- ALTER TABLE clientes DROP COLUMN IF EXISTS motivo_consulta_actualizado_en;
-- ALTER TABLE clientes DROP COLUMN IF EXISTS motivo_consulta_fuente;
-- ALTER TABLE clientes DROP COLUMN IF EXISTS motivo_consulta;
