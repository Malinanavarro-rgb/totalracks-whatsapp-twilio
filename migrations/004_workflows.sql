-- TARA Matrix™ — FASE 4A
-- Migration 004: tabla workflows
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS workflows (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id    uuid        NOT NULL REFERENCES companies(id),
  playbook_id   uuid,                          -- nullable, reservado para FASE 5
  nombre        text        NOT NULL,
  descripcion   text,
  trigger       text        NOT NULL DEFAULT 'intent',
  -- valores: 'intent' | 'keyword' | 'always'
  trigger_value text        NOT NULL,
  -- intent  → valor del catálogo de intenciones ('interes_compra', etc.)
  -- keyword → texto exacto a detectar en el mensaje
  prioridad     integer     NOT NULL DEFAULT 10,
  -- menor número = mayor prioridad (para resolver conflictos entre workflows)
  activo        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_company_activo
  ON workflows (company_id, activo);

CREATE INDEX IF NOT EXISTS idx_workflows_trigger
  ON workflows (company_id, trigger, trigger_value, activo);

ALTER TABLE workflows DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'workflows creada' AS resultado, COUNT(*) AS filas FROM workflows;
