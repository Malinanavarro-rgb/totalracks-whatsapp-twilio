-- TARA Matrix™ — FASE 5 (Plataforma SaaS), Fase 5: CRM
-- Migration 029: tabla seguimientos.
--
-- Seguimientos manuales tipo checklist ("llamar hoy", "cotizar mañana"),
-- sin notificaciones automáticas (eso ya existe por separado en
-- mensajes_automaticos/recordatorios, un sistema distinto que no se toca).
-- Aditiva — no modifica `clientes`/`conversaciones`/`oportunidades` (congeladas).
--
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS seguimientos (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        bigint      NOT NULL REFERENCES clientes(id),
  company_id        uuid        NOT NULL REFERENCES companies(id),
  usuario_id        uuid        REFERENCES usuarios(id),
  texto             text        NOT NULL,
  fecha_programada  date,
  prioridad         text        NOT NULL DEFAULT 'media' CHECK (prioridad IN ('alta', 'media', 'baja')),
  completado        boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seguimientos_cliente
  ON seguimientos (cliente_id, completado);

CREATE INDEX IF NOT EXISTS idx_seguimientos_company
  ON seguimientos (company_id);

-- Verificación
SELECT count(*) AS total_seguimientos FROM seguimientos;
