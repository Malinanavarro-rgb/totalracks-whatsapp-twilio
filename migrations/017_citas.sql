-- TARA Matrix™ — ANEXO A (Motor de Agenda)
-- Migration 017: tabla citas
-- Registro operativo de agenda — equivalente a workflow_sessions pero para citas.
-- Incluye el índice único parcial anti-doble-reserva (Anexo A, sección 2.4):
-- la prevención de doble reserva no puede depender solo de que SchedulingEngine
-- consulte antes de escribir — dos mensajes casi simultáneos deben fallar en la
-- base de datos, no solo en la lógica de aplicación.
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS citas (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id         uuid        NOT NULL REFERENCES companies(id),
  cliente_id         bigint      NOT NULL REFERENCES clientes(id),
  asesor_id          uuid        NOT NULL REFERENCES asesores(id),
  calendar_event_id  text,
  -- ID del evento en el proveedor externo
  inicio             timestamptz NOT NULL,
  fin                timestamptz NOT NULL,
  estado             text        NOT NULL DEFAULT 'agendada',
  -- valores: agendada | confirmada | reagendada | cancelada | completada | no_show
  origen_workflow_id uuid        REFERENCES workflows(id),
  -- nullable: cita puede originarse fuera de un workflow
  recordatorio_enviado boolean   NOT NULL DEFAULT false,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_citas_company
  ON citas (company_id, estado);

CREATE INDEX IF NOT EXISTS idx_citas_cliente
  ON citas (cliente_id);

-- Evita doble reserva a nivel de base de datos, no solo de aplicación.
CREATE UNIQUE INDEX IF NOT EXISTS idx_citas_sin_doble_reserva
  ON citas (asesor_id, inicio)
  WHERE estado IN ('agendada', 'confirmada', 'reagendada');

ALTER TABLE citas DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'citas creada' AS resultado, COUNT(*) AS filas FROM citas;
