-- TARA Matrix™ — FASE 4A
-- Migration 005: tabla workflow_nodes
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id    uuid        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  nombre         text        NOT NULL,   -- slug único dentro del workflow
  es_inicio      boolean     NOT NULL DEFAULT false,
  es_fin         boolean     NOT NULL DEFAULT false,
  pregunta       text,                   -- lo que TARA pregunta al llegar al nodo
  campo          text,                   -- nombre del campo a capturar en captured_fields
  tipo_campo     text        NOT NULL DEFAULT 'text',
  -- valores: 'text' | 'number' | 'phone' | 'email'
  es_opcional    boolean     NOT NULL DEFAULT false,
  validacion     text,                   -- regex simple o null
  siguiente_nodo text,                   -- nombre del nodo siguiente (null si es_fin)
  acciones       jsonb       NOT NULL DEFAULT '[]',
  -- acciones a ejecutar al completar este nodo
  -- ej: [{"tipo": "crear_oportunidad"}]
  orden          integer     NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),

  UNIQUE (workflow_id, nombre)           -- nombre de nodo único por workflow
);

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow
  ON workflow_nodes (workflow_id, orden);

ALTER TABLE workflow_nodes DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'workflow_nodes creada' AS resultado, COUNT(*) AS filas FROM workflow_nodes;
