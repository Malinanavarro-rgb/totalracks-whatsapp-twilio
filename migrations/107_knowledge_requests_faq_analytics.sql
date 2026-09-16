-- Centro de Conocimiento — Fase 5: aprendizaje del equipo + analítica de FAQ
-- ─────────────────────────────────────────────────────────────────────────────
-- knowledge_requests: cuando un empleado no encuentra respuesta a algo en
-- Modo Operador / Centro de Conocimiento, puede reportarlo aquí para que
-- gerencia lo revise y, si corresponde, lo convierta en una entrada real de
-- solar_faq o productos. Aditivo, cero cambio de comportamiento existente.
--
-- solar_faq.times_asked: contador simple, incrementado en el único
-- chokepoint real donde una entrada de FAQ ya se considera "usada" —
-- modules/faq-solar.js::buscarFaqRelevante() — el mismo punto que alimenta
-- tanto al motor conversacional de clientes como a la tool de Modo Operador.
-- Resuelve la pregunta abierta de la auditoría ("cómo detectar de forma
-- confiable que se preguntó esto"): en vez de inferirlo, se cuenta en el
-- momento exacto en que la entrada ya fue recuperada y usada.

ALTER TABLE solar_faq ADD COLUMN IF NOT EXISTS times_asked integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS knowledge_requests (
  id               bigserial   PRIMARY KEY,
  company_id       uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  question         text        NOT NULL,
  category         text,
  employee_id      uuid        REFERENCES usuarios(id),
  -- pendiente | respondida | rechazada — texto libre sin ENUM (mismo
  -- criterio ya usado en usuarios_empresas.rol / oportunidades.estado_visita).
  answer_status    text        NOT NULL DEFAULT 'pendiente',
  source_needed    text,
  respuesta_validada text,
  validado_por     uuid        REFERENCES usuarios(id),
  validado_en      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_requests DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_knowledge_requests_company_estado ON knowledge_requests(company_id, answer_status);

-- Verificación
SELECT 'solar_faq.times_asked' AS cambio, column_default FROM information_schema.columns WHERE table_name = 'solar_faq' AND column_name = 'times_asked'
UNION ALL
SELECT 'knowledge_requests', COUNT(*)::text FROM knowledge_requests;
