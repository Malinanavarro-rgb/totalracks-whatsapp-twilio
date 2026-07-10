-- TARA Matrix™ — FASE 5 (Plataforma SaaS), Fase 6: Configuración de empresa
-- Migration 032: campos de negocio en personalities + horario_atencion_bot.
--
-- 1) personalities: mensaje_bienvenida y firma se aplican en la capa de
--    plataforma (server.js, antes/después de invocar al Orchestrator) — cero
--    cambios al Core. longitud_respuesta/uso_emojis/nivel_iniciativa SÍ
--    afectan el comportamiento real de TARA vía una extensión aditiva de
--    Orchestrator._mapearPersonalidad() (documentado en ADR-005 como cambio
--    explícitamente dirigido, no iniciativa propia). Los parámetros técnicos
--    del motor (modelo, temperatura, max_tokens, skills, reglas,
--    campos_requeridos, max_turnos_memoria, kb_max_secciones) NO se tocan ni
--    se exponen en UI — siguen siendo de administración exclusiva de TARA.
--
-- 2) horario_atencion_bot: horario en que TARA responde por WhatsApp,
--    granular por día de la semana. Concepto DISTINTO de horarios_laborales
--    (que es para disponibilidad de citas, Anexo A) — una empresa puede
--    querer que el bot responda 24/7 aunque solo agende citas de 9 a 5, o
--    viceversa. Ausencia de fila para un día = TARA no responde ese día
--    (mismo patrón que horarios_laborales, sin columna "activo" separada).
--
-- Ejecutar en Supabase SQL Editor

ALTER TABLE personalities
  ADD COLUMN IF NOT EXISTS mensaje_bienvenida text,
  ADD COLUMN IF NOT EXISTS firma text,
  ADD COLUMN IF NOT EXISTS longitud_respuesta text NOT NULL DEFAULT 'normales'
    CHECK (longitud_respuesta IN ('cortas', 'normales', 'detalladas')),
  ADD COLUMN IF NOT EXISTS uso_emojis text NOT NULL DEFAULT 'moderado'
    CHECK (uso_emojis IN ('nunca', 'moderado', 'frecuente')),
  ADD COLUMN IF NOT EXISTS nivel_iniciativa text NOT NULL DEFAULT 'sugerir_productos'
    CHECK (nivel_iniciativa IN ('solo_responder', 'sugerir_productos', 'cerrar_ventas'));

CREATE TABLE IF NOT EXISTS horario_atencion_bot (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  dia_semana   integer NOT NULL, -- 0=domingo … 6=sábado
  hora_inicio  time NOT NULL,
  hora_fin     time NOT NULL,
  zona_horaria text NOT NULL DEFAULT 'America/Monterrey',
  UNIQUE (company_id, dia_semana)
);

CREATE INDEX IF NOT EXISTS idx_horario_atencion_bot_company
  ON horario_atencion_bot (company_id, dia_semana);

-- Verificación
SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'personalities'
    AND column_name IN ('mensaje_bienvenida', 'firma', 'longitud_respuesta', 'uso_emojis', 'nivel_iniciativa');

SELECT count(*) AS total_horarios_bot FROM horario_atencion_bot;
