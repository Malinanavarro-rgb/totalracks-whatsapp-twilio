-- TARA-OS — Knowledge Consolidation Engine (KCE), Fase 3A: solo bajo demanda.
--
-- Principio rector (Alina): el KCE NUNCA escribe en memoria_empresarial en
-- esta fase — ni siquiera un refuerzo se aplica automáticamente. Todo lo que
-- el motor encuentra se guarda como una alerta/propuesta en kce_alertas,
-- pendiente de que un humano (vía Modo Operador) la apruebe explícitamente.
-- No existe ejecución programada — se agrega en Fase 3B, después de validar
-- varias corridas manuales.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. kce_ejecuciones ────────────────────────────────────────────────────────
-- El reporte auditable de cada corrida — "Resumen Ejecutivo de Consolidación".

CREATE TABLE IF NOT EXISTS kce_ejecuciones (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL REFERENCES companies(id),
  iniciado_at              timestamptz NOT NULL,
  finalizado_at            timestamptz NOT NULL,
  duracion_ms              integer     NOT NULL,
  aprendizajes_analizados  integer     NOT NULL DEFAULT 0,
  refuerzos_sugeridos      integer     NOT NULL DEFAULT 0,
  alertas_duplicado        integer     NOT NULL DEFAULT 0,
  alertas_contradiccion    integer     NOT NULL DEFAULT 0,
  alertas_obsolescencia    integer     NOT NULL DEFAULT 0,
  cambios_aplicados        integer     NOT NULL DEFAULT 0, -- siempre 0 en Fase 3A: el KCE nunca aplica nada solo
  confianza_global         integer     CHECK (confianza_global BETWEEN 0 AND 100),
  ejecutado_por            uuid        REFERENCES usuarios(id), -- operador que solicitó la corrida — nunca se auto-ejecuta
  reporte                  jsonb       NOT NULL DEFAULT '{}',
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kce_ejecuciones_company ON kce_ejecuciones (company_id, created_at DESC);

ALTER TABLE kce_ejecuciones DISABLE ROW LEVEL SECURITY;

-- ── 2. kce_alertas ────────────────────────────────────────────────────────────
-- Toda propuesta del KCE vive aquí — refuerzo incluido. Nada de esto modifica
-- memoria_empresarial hasta que un humano ejecuta la acción correspondiente.

CREATE TABLE IF NOT EXISTS kce_alertas (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES companies(id),
  tipo                  text        NOT NULL CHECK (tipo IN ('refuerzo_sugerido', 'posible_duplicado', 'contradiccion', 'posible_obsoleto')),
  aprendizaje_id_a      uuid        NOT NULL REFERENCES memoria_empresarial(id),
  aprendizaje_id_b      uuid        REFERENCES memoria_empresarial(id), -- solo posible_duplicado/contradiccion
  confianza_propuesta   integer     NOT NULL CHECK (confianza_propuesta BETWEEN 0 AND 100), -- qué tan seguro está el KCE de ESTA alerta
  incremento_sugerido   integer,    -- solo refuerzo_sugerido: cuánto subiría la confianza si se aprueba
  similitud_pct         integer     CHECK (similitud_pct BETWEEN 0 AND 100), -- solo posible_duplicado/contradiccion
  justificacion         text        NOT NULL, -- Principio 3: nunca una alerta sin evidencia explícita
  estado                text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aplicada', 'descartada')),
  accion_tomada         text,
  revisada_por          uuid        REFERENCES usuarios(id),
  revisada_at           timestamptz,
  ejecucion_id          uuid        NOT NULL REFERENCES kce_ejecuciones(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kce_alertas_company_estado ON kce_alertas (company_id, estado);
CREATE INDEX IF NOT EXISTS idx_kce_alertas_ejecucion       ON kce_alertas (ejecucion_id);

ALTER TABLE kce_alertas DISABLE ROW LEVEL SECURITY;

-- ── 3. Knowledge Maturity Score — columnas en resumen_ejecutivo_negocio ──────
-- Fórmula determinística (no de IA) — ver modules/kce.js::calcularKnowledgeScore.

ALTER TABLE resumen_ejecutivo_negocio ADD COLUMN IF NOT EXISTS knowledge_score integer CHECK (knowledge_score BETWEEN 0 AND 100);
ALTER TABLE resumen_ejecutivo_negocio ADD COLUMN IF NOT EXISTS knowledge_score_desglose jsonb;

-- Verificación
SELECT 'kce_ejecuciones' AS tabla, COUNT(*) FROM kce_ejecuciones
UNION ALL SELECT 'kce_alertas', COUNT(*) FROM kce_alertas;
