-- TARA — ⌘K con confirmación: agenda_comandos
-- Patrón "interpretar → confirmar → ejecutar", base para cualquier acción
-- futura de TARA disparada por lenguaje natural. Distinto de agenda_eventos
-- (esa nace de una regla que TARA detecta sola; esta nace de algo que la
-- usuaria escribió en ⌘K) — ambos quedan como historial completo.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS agenda_comandos (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id     uuid NOT NULL REFERENCES companies(id),
  usuario_id     uuid NOT NULL REFERENCES usuarios(id),
  texto_original text NOT NULL,
  intencion      text NOT NULL, -- reagendar_cita | cancelar_cita | confirmar_llegada | marcar_no_show | consulta | no_reconocido
  entidades      jsonb NOT NULL DEFAULT '{}',
  resumen        text NOT NULL,
  estado         text NOT NULL DEFAULT 'pendiente_confirmacion', -- pendiente_confirmacion | confirmado | cancelado | ejecutado | error
  resultado      jsonb,
  created_at     timestamptz DEFAULT now(),
  resuelto_en    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agenda_comandos_company_estado
  ON agenda_comandos (company_id, estado, created_at DESC);
ALTER TABLE agenda_comandos DISABLE ROW LEVEL SECURITY; -- mismo criterio que agenda_eventos

-- Verificación
SELECT company_id, intencion, estado FROM agenda_comandos LIMIT 5;

-- ── ROLLBACK (comentado — ejecutar manualmente si hay que revertir) ─────────
-- DROP TABLE IF EXISTS agenda_comandos;
