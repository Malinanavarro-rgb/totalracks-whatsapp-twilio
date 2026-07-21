-- TARA-OS — Business Memory Core (BMC): Memory Engine Capa 3, completada.
-- Ver docs/constitution/v3-constitution.md Artículo 13 (Capa 3, prevista
-- desde el 29 de junio, nunca implementada) y el documento de arquitectura
-- del BMC para el razonamiento completo. Todo aditivo — ninguna tabla
-- congelada por ADR-005 se modifica aquí, y orchestrator.js/ContextBuilder
-- NO se tocan en esta entrega (Fase 4, decisión separada).
--
-- Principio rector: toda escritura nace como 'propuesta' — ninguna fila
-- influye ninguna recomendación hasta que un humano la confirma vía Modo
-- Operador (Fase 2). Esta migración no expone ninguna vía de escritura a un
-- LLM en producción; eso llega después.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. memoria_empresarial ────────────────────────────────────────────────────
-- Los aprendizajes crudos, categorizados y evolutivos — la fuente de verdad.

CREATE TABLE IF NOT EXISTS memoria_empresarial (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES companies(id),
  categoria         text        NOT NULL CHECK (categoria IN (
                      'cliente_importante', 'patron_compra', 'temporada', 'riesgo',
                      'habito_operativo', 'rendimiento_empleado', 'error_recurrente',
                      'oportunidad', 'preferencia', 'objetivo', 'aprendizaje_general'
                    )),
  cliente_id        bigint      REFERENCES clientes(id),
  titulo            text        NOT NULL,
  detalle           text        NOT NULL,
  evidencia         jsonb       NOT NULL DEFAULT '{}',
  confianza         integer     NOT NULL DEFAULT 50 CHECK (confianza BETWEEN 0 AND 100),
  estado            text        NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta', 'confirmado', 'rechazada')),
  veces_confirmado  integer     NOT NULL DEFAULT 1,
  vigente_hasta     timestamptz,
  origen            text        NOT NULL CHECK (origen IN ('inbox_analisis', 'operador', 'business_intelligence', 'manual')),
  propuesto_por     uuid        REFERENCES usuarios(id),
  confirmado_por    uuid        REFERENCES usuarios(id),
  confirmado_at     timestamptz,
  activo            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memoria_empresarial_company_categoria ON memoria_empresarial (company_id, categoria, activo);
CREATE INDEX IF NOT EXISTS idx_memoria_empresarial_cliente           ON memoria_empresarial (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memoria_empresarial_company_estado    ON memoria_empresarial (company_id, estado);

ALTER TABLE memoria_empresarial DISABLE ROW LEVEL SECURITY;

-- ── 2. resumen_ejecutivo_negocio ──────────────────────────────────────────────
-- La síntesis viva — 1 fila por empresa, regenerada SOLO a partir de
-- aprendizajes con estado='confirmado'. Una propuesta nunca llega aquí, ni
-- siquiera indirectamente.

CREATE TABLE IF NOT EXISTS resumen_ejecutivo_negocio (
  company_id   uuid        PRIMARY KEY REFERENCES companies(id),
  resumen      text        NOT NULL,
  highlights   jsonb       NOT NULL DEFAULT '[]',
  generado_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE resumen_ejecutivo_negocio DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'memoria_empresarial' AS tabla, COUNT(*) FROM memoria_empresarial
UNION ALL SELECT 'resumen_ejecutivo_negocio', COUNT(*) FROM resumen_ejecutivo_negocio;
