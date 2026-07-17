-- TARA — Fase 2: citas.servicio_id + citas.precio_cobrado
-- Ya diseñado y autorizado desde la Fase 1 del Motor de Agenda Universal.
-- Aditivo y nullable — las citas históricas quedan con ambos en NULL, sin
-- romper nada. Habilita: ingreso real del día, ticket promedio, ingreso
-- por hora, y que las tarjetas de cita muestren precio real.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE citas ADD COLUMN IF NOT EXISTS servicio_id    uuid REFERENCES servicios(id);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS precio_cobrado numeric;

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'citas' AND column_name IN ('servicio_id', 'precio_cobrado');

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- ALTER TABLE citas DROP COLUMN IF EXISTS servicio_id;
-- ALTER TABLE citas DROP COLUMN IF EXISTS precio_cobrado;
