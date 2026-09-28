-- Subfase 2H — Garantías (Alina, 2026-09-28, ver NORT_ENERGY_PORTAL_PLAN.md).
-- ─────────────────────────────────────────────────────────────────────────────
-- CORE genérico (garantía + marca/modelo es universal, aplica igual a un
-- panel solar que a un rack industrial). Nace SIEMPRE de un
-- `equipo_instalado` real (2D) — nunca de texto suelto: el asesor jamás
-- vuelve a capturar marca/modelo/serie/fecha de instalación, se
-- SNAPSHOTEAN de equipos_instalados al crear la garantía (mismo principio
-- que proyectos.config_vendida/instalaciones.checklist) — cambios futuros
-- al equipo no alteran retroactivamente una garantía ya creada.
--
-- Idempotente vía índice único + 23505 (mismo patrón que pagos_cliente,
-- 2B): crear la garantía de un equipo que ya tiene una devuelve la
-- existente, nunca duplica.

CREATE TABLE IF NOT EXISTS garantias (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id),
  equipo_instalado_id uuid        NOT NULL REFERENCES equipos_instalados(id),
  fecha_inicio        date,       -- snapshot de equipos_instalados.fecha_instalacion (editable después si se corrige)
  meses_garantia      integer,    -- snapshot de equipos_instalados.garantia_meses
  proveedor           text,       -- snapshot de equipos_instalados.proveedor
  notas               text,
  registrado_por      uuid        REFERENCES usuarios(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_garantias_equipo_unico ON garantias(equipo_instalado_id);
CREATE INDEX IF NOT EXISTS idx_garantias_company ON garantias(company_id);

ALTER TABLE garantias DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS garantia_reclamaciones (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES companies(id),
  garantia_id    uuid        NOT NULL REFERENCES garantias(id),
  estado         text        NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'en_revision', 'aprobada', 'rechazada', 'resuelta')),
  descripcion    text        NOT NULL,
  registrado_por uuid        REFERENCES usuarios(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garantia_reclamaciones_garantia ON garantia_reclamaciones(garantia_id, created_at DESC);

ALTER TABLE garantia_reclamaciones DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Línea de tiempo de UNA reclamación — tabla dedicada (no un jsonb
-- "historial" ni bitacora_decisiones): bitacora_decisiones es el log
-- general de la empresa/proyecto (ya usado por 2A/2C/2E/2G) y mezclaría
-- eventos de instalación/CFE/compras con los de esta reclamación
-- específica; un jsonb perdería estructura/orden real. Mismo espíritu de
-- ledger append-only que inventario_movimientos, aplicado aquí a un solo
-- registro en vez de a un saldo.
CREATE TABLE IF NOT EXISTS garantia_reclamacion_eventos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES companies(id),
  reclamacion_id  uuid        NOT NULL REFERENCES garantia_reclamaciones(id),
  -- Texto libre documentado, sin ENUM: 'creada' | 'cambio_estado' | 'comentario'.
  tipo            text        NOT NULL,
  texto           text        NOT NULL,
  autor_id        uuid        REFERENCES usuarios(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garantia_reclamacion_eventos_reclamacion ON garantia_reclamacion_eventos(reclamacion_id, created_at ASC);

ALTER TABLE garantia_reclamacion_eventos DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS garantias FROM garantias;
SELECT COUNT(*) AS garantia_reclamaciones FROM garantia_reclamaciones;
SELECT COUNT(*) AS garantia_reclamacion_eventos FROM garantia_reclamacion_eventos;
