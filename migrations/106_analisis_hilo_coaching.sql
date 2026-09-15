-- Centro de Conocimiento — Fase 2: Sales Coach
-- ─────────────────────────────────────────────────────────────────────────────
-- Extiende analisis_hilo (Inbox Inteligente, migración 076) con los campos de
-- coaching que pide la Fase 2: qué hizo bien/mal el asesor y una respuesta
-- lista para enviar. Aditivo — no reemplaza ninguna columna existente.

ALTER TABLE analisis_hilo ADD COLUMN IF NOT EXISTS aciertos_asesor jsonb NOT NULL DEFAULT '[]';
ALTER TABLE analisis_hilo ADD COLUMN IF NOT EXISTS errores_asesor jsonb NOT NULL DEFAULT '[]';
ALTER TABLE analisis_hilo ADD COLUMN IF NOT EXISTS respuesta_recomendada text;

-- Verificación
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'analisis_hilo'
ORDER BY ordinal_position;
