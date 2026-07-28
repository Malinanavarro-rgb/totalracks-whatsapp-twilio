-- TARA-OS — Asistente Oficial de la plataforma (ADR-012).
--
-- El número principal de TARA-OS deja de ser solo un bot de ventas y pasa
-- a ser el asistente oficial de la plataforma: soporte, facturación,
-- configuración, para clientes REALES de TARA-OS (empresas que pagan por
-- usar la plataforma), no solo prospectos.
--
-- Esta migración agrega la infraestructura mínima real que hacía falta
-- (confirmado por investigación de código antes de escribir esto — ver
-- ADR-012): teléfono en usuarios (para saber quién escribe), tabla de
-- tickets de soporte (no existía en absoluto), y una columna de
-- capacidades por-empresa en personalities (hoy hardcodeada globalmente
-- en orchestrator.js — ver comentario "CAPACIDADES_FASE2... FASE 4 hará
-- esto dinámico desde empresa_config", que esta migración cumple).
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. Teléfono en usuarios — bridge para resolver "quién escribe" ──────────
-- Nullable: la inmensa mayoría de usuarios (dueños de empresas cliente) no
-- necesitan esto hoy — solo se llena para quienes vayan a usar el número
-- de soporte de TARA-OS. UNIQUE parcial (solo cuando no es null) para que
-- dos usuarios no compartan el mismo teléfono de contacto de soporte.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_telefono_unico
  ON usuarios (telefono) WHERE telefono IS NOT NULL;

-- ── 2. tickets_soporte — no existía ninguna tabla de soporte/incidencias ────
-- organization_id (no company_id): el ticket es del CONTRATO con TARA-OS
-- (Constitución Art. 9), no de una company operativa específica — una
-- organización con 2+ companies ve todos sus tickets juntos.

CREATE TABLE IF NOT EXISTS tickets_soporte (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  usuario_id      uuid REFERENCES usuarios(id), -- quién lo reportó, null si no se pudo identificar
  asunto          text NOT NULL,
  descripcion     text,
  estado          text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_proceso', 'resuelto', 'cerrado')),
  prioridad       text NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
  canal           text NOT NULL DEFAULT 'whatsapp', -- 'whatsapp' | 'panel' | 'email'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resuelto_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tickets_soporte_organization ON tickets_soporte(organization_id);
CREATE INDEX IF NOT EXISTS idx_tickets_soporte_estado ON tickets_soporte(organization_id, estado);

ALTER TABLE tickets_soporte DISABLE ROW LEVEL SECURITY;

-- ── 3. personalities.capacidades — completa el TODO ya anotado en el Core ──
-- Nullable/vacío por defecto: ninguna empresa existente cambia de
-- comportamiento (orchestrator.js sigue usando CAPACIDADES_FASE2 cuando
-- esta columna es null o []). Solo TARA-OS la usa por ahora, para poder
-- proponer 'crear_ticket_soporte' además de 'crear_oportunidad'.

ALTER TABLE personalities ADD COLUMN IF NOT EXISTS capacidades jsonb;

-- Verificación
SELECT 'usuarios.telefono' AS cambio, count(*) FROM usuarios WHERE telefono IS NOT NULL
UNION ALL
SELECT 'tickets_soporte (filas)', count(*) FROM tickets_soporte
UNION ALL
SELECT 'personalities.capacidades (no nulas)', count(*) FROM personalities WHERE capacidades IS NOT NULL;
