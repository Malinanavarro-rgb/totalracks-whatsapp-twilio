-- TARA-OS — Demo Live View: una sesión demo pasa de "un teléfono" a
-- "múltiples participantes autorizados", cada uno una conversación
-- completamente independiente (residencial, negocio, soporte...), todas
-- visibles en el mismo tablero público.
--
-- El aislamiento entre participantes NO es código nuevo: ya lo garantiza
-- el sistema multi-tenant existente (clientes.telefono único por
-- company_id) — dos participantes de la misma empresa demo son, para el
-- resto del sistema, exactamente lo mismo que dos clientes reales
-- distintos de cualquier empresa. Lo único nuevo es "quién tiene permiso
-- de activar esta empresa demo ahora mismo", que pasa de vivir en
-- sesiones_demo.authorized_phone (1 por sesión) a esta tabla (N por
-- sesión).
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. demo_session_participants ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS demo_session_participants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id          uuid NOT NULL REFERENCES sesiones_demo(id),
  phone            text NOT NULL,                    -- normalizado (normalizarTelefonoMX)
  display_name     text,                              -- nombre del escenario en el tablero (ej. "Cliente residencial")
  cliente_id       bigint,                            -- FK clientes(id); null hasta el primer mensaje real
  scenario         text,                              -- libre, ej. "Residencial — ahorro"
  status           text NOT NULL DEFAULT 'autorizado' CHECK (status IN ('autorizado', 'activo', 'pausado', 'bloqueado', 'finalizado')),
  joined_at        timestamptz,                       -- se llena en el primer mensaje real
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  disabled_at      timestamptz,
  UNIQUE (demo_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_demo_participants_demo ON demo_session_participants(demo_id);
CREATE INDEX IF NOT EXISTS idx_demo_participants_phone ON demo_session_participants(phone);

-- Un mismo teléfono no puede estar autorizado en dos sesiones demo
-- distintas a la vez (en cualquier empresa) — mismo criterio que el
-- índice que hoy vive en sesiones_demo, un nivel más abajo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_participants_phone_activo
  ON demo_session_participants(phone)
  WHERE status IN ('autorizado', 'activo', 'pausado') AND disabled_at IS NULL;

ALTER TABLE demo_session_participants DISABLE ROW LEVEL SECURITY;

-- ── 2. sesiones_demo — token público + límite de participantes ──────────────

ALTER TABLE sesiones_demo ADD COLUMN IF NOT EXISTS public_token text;
ALTER TABLE sesiones_demo ADD COLUMN IF NOT EXISTS max_participantes integer;

-- Backfill de sesiones ya existentes (si las hay) con un token nuevo.
UPDATE sesiones_demo SET public_token = encode(gen_random_bytes(24), 'hex') WHERE public_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_demo_public_token ON sesiones_demo(public_token);

-- ── 3. Migrar authorized_phone (1 por sesión) → demo_session_participants ──
-- Preserva el historial de sesiones ya corridas antes de retirar la columna.

INSERT INTO demo_session_participants (demo_id, phone, status, joined_at, created_at, disabled_at)
SELECT id, authorized_phone,
       CASE WHEN finalizado_en IS NOT NULL THEN 'finalizado' ELSE 'activo' END,
       iniciado_en, created_at, finalizado_en
FROM sesiones_demo
WHERE authorized_phone IS NOT NULL
ON CONFLICT (demo_id, phone) DO NOTHING;

DROP INDEX IF EXISTS idx_sesiones_demo_phone_activa;
DROP INDEX IF EXISTS idx_sesiones_demo_phone;
ALTER TABLE sesiones_demo DROP COLUMN IF EXISTS authorized_phone;

-- Verificación
SELECT count(*) AS participantes_migrados FROM demo_session_participants;
SELECT id, public_token IS NOT NULL AS tiene_token, max_participantes FROM sesiones_demo;
