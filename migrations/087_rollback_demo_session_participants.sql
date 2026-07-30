-- TARA-OS — Rollback de la migración 086 (Demo Live View multi-participante).
--
-- Alina probó el Demo Live View, la pantalla se veía en negro/rota, y pidió
-- regresar al Modo Demo de un solo teléfono tal como estaba antes (commit
-- de código ya revertido con `git revert`). Esta migración regresa el
-- esquema de sesiones_demo a esa misma forma, para que el código revertido
-- (que espera sesiones_demo.authorized_phone) vuelva a funcionar.
--
-- Todos los datos afectados son de pruebas (números de prueba propios y de
-- Alina) — ninguna empresa real ni cliente real se ve afectado. Para cada
-- sesión con más de un participante, se conserva el primero (por
-- created_at) como authorized_phone — suficiente para datos de prueba.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

ALTER TABLE sesiones_demo ADD COLUMN IF NOT EXISTS authorized_phone text;

UPDATE sesiones_demo s SET authorized_phone = primero.phone
FROM (
  SELECT DISTINCT ON (demo_id) demo_id, phone
  FROM demo_session_participants
  ORDER BY demo_id, created_at ASC
) AS primero
WHERE s.id = primero.demo_id AND s.authorized_phone IS NULL;

DROP INDEX IF EXISTS idx_sesiones_demo_public_token;
DROP TABLE IF EXISTS demo_session_participants;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_demo_phone_activa
  ON sesiones_demo(authorized_phone)
  WHERE finalizado_en IS NULL;

ALTER TABLE sesiones_demo DROP COLUMN IF EXISTS public_token;
ALTER TABLE sesiones_demo DROP COLUMN IF EXISTS max_participantes;

-- Verificación
SELECT id, authorized_phone, finalizado_en FROM sesiones_demo ORDER BY created_at DESC LIMIT 10;
