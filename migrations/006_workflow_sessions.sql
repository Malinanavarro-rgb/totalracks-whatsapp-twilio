-- TARA Matrix™ — FASE 4A
-- Migration 006: tabla workflow_sessions
-- Estado operativo de flujos activos. Tabla independiente de conversaciones.
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS workflow_sessions (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      uuid        NOT NULL REFERENCES companies(id),
  cliente_id      bigint      NOT NULL REFERENCES clientes(id),
  conversation_id bigint      REFERENCES conversaciones(id),
  -- nullable: una sesión puede sobrevivir a múltiples conversaciones
  workflow_id     uuid        NOT NULL REFERENCES workflows(id),
  current_node    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'activo',
  -- valores: activo | completado | abandonado | error
  captured_fields jsonb       NOT NULL DEFAULT '{}',
  nodo_abandono   text,                    -- nodo donde se abandonó (métrica)
  total_turnos    integer     NOT NULL DEFAULT 0,
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz,
  updated_at      timestamptz DEFAULT now()
);

-- Solo puede haber una sesión activa por cliente+empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_sessions_activa
  ON workflow_sessions (company_id, cliente_id)
  WHERE status = 'activo';

CREATE INDEX IF NOT EXISTS idx_workflow_sessions_company
  ON workflow_sessions (company_id, status);

CREATE INDEX IF NOT EXISTS idx_workflow_sessions_cliente
  ON workflow_sessions (cliente_id, company_id);

ALTER TABLE workflow_sessions DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'workflow_sessions creada' AS resultado, COUNT(*) AS filas FROM workflow_sessions;
