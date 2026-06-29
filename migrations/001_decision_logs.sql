-- ─────────────────────────────────────────────────────────────────────────────
-- TARA Matrix™ — Migración 001
-- Tabla: decision_logs
-- Módulo: AuditLogger (M3)
--
-- Ejecutar en: Supabase → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS decision_logs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id    uuid NOT NULL,
  created_at    timestamptz DEFAULT now(),
  tipo          text NOT NULL,
  canal         text,
  identificador text,
  payload       jsonb NOT NULL DEFAULT '{}',
  latencia_ms   integer,
  costo_usd     numeric(10,6),
  tokens_total  integer,
  error         text,
  session_id    uuid
);

-- Índice principal: consultas por empresa + tiempo (dashboard, reportes)
CREATE INDEX IF NOT EXISTS idx_decision_logs_company_time
  ON decision_logs (company_id, created_at DESC);

-- Índice secundario: filtrar por tipo de evento
CREATE INDEX IF NOT EXISTS idx_decision_logs_company_tipo
  ON decision_logs (company_id, tipo);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS)
-- Activar si se usa la anon key desde el frontend.
-- Si solo el backend escribe (service role key), RLS no es estrictamente
-- necesario pero se recomienda como defensa en profundidad.
-- ─────────────────────────────────────────────────────────────────────────────

-- Habilitar RLS
ALTER TABLE decision_logs ENABLE ROW LEVEL SECURITY;

-- Política: solo el backend (service_role) puede leer y escribir
-- La anon key NO tiene acceso a esta tabla.
CREATE POLICY "Backend solo" ON decision_logs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- Ejecuta esto para confirmar que la tabla se creó correctamente:
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'decision_logs'
-- ORDER BY ordinal_position;
