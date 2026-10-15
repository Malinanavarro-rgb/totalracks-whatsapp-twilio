-- TARA Matrix™ — TARA Module Engine, Fase 2: modo observación (Alina,
-- 2026-10-17, ver TARA_MODULE_ENGINE_FASE2_PROPUESTA_V1.md).
-- ─────────────────────────────────────────────────────────────────────────────
-- requireModuloActivo() corre en MODO OBSERVACIÓN exclusivamente en esta
-- fase: nunca bloquea (siempre llama next()), solo registra qué habría
-- pasado si el bloqueo estuviera activo. Esta tabla es ese registro —
-- permite presentar resultados reales antes de pedir autorización para el
-- bloqueo efectivo (instrucción explícita: "no actives el bloqueo hasta
-- presentar los resultados").
--
-- Aditiva, idempotente, reversible: DROP TABLE modulo_enforcement_observaciones;
CREATE TABLE IF NOT EXISTS modulo_enforcement_observaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  modulo_codigo text NOT NULL REFERENCES modulos_catalogo(codigo),
  ruta text NOT NULL,
  metodo text NOT NULL,
  rol text,
  estado_modulo_encontrado text,     -- 'activo' | 'integrado' | 'inactivo' | 'sin_fila_configurada'
  hubiera_bloqueado boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modulo_enforcement_obs_company ON modulo_enforcement_observaciones (company_id, created_at);
