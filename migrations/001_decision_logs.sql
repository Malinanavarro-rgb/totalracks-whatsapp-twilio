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
-- NOTA DE SEGURIDAD — Por qué NO usamos RLS aquí
--
-- decision_logs es una tabla de escritura exclusiva del backend (server-side).
-- El SUPABASE_ANON_KEY vive en el servidor de Render, NUNCA en el navegador.
--
-- Si activamos RLS con policy de service_role, el AuditLogger (que usa la
-- anon key de clients.js) fallaría silenciosamente en todos los inserts —
-- el AuditLogger tiene fire-and-forget y no lanza excepciones, así que la
-- tabla quedaría vacía en producción sin ninguna advertencia visible.
--
-- Para hardening adicional en producción con múltiples tenants:
--   1. Crear un cliente Supabase separado con SUPABASE_SERVICE_ROLE_KEY
--   2. Inyectarlo en AuditLogger en lugar del cliente anon
--   3. Entonces sí activar RLS con policy de service_role
--
-- Por ahora: la seguridad la da el hecho de que la anon_key está en el
-- servidor (variable de entorno en Render), nunca expuesta al cliente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — Ejecutar después de aplicar la migración:
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'decision_logs'
-- ORDER BY ordinal_position;
--
-- Resultado esperado: 11 columnas (id, company_id, created_at, tipo,
-- canal, identificador, payload, latencia_ms, costo_usd, tokens_total,
-- error, session_id)
