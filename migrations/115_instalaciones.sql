-- Subfase 2C — Instalaciones (Alina, 2026-09-23).
-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo real, CORE genérico (aplica a instalar cualquier producto físico,
-- no solo paneles solares) — lo específico de cada industria vive en
-- `detalle_tecnico` (jsonb) y en el CONTENIDO del checklist (datos, nunca
-- código). Ver NORT_ENERGY_PORTAL_PLAN.md sección 5.
--
-- Deliberadamente SIN índice único por proyecto: una instalación es un
-- evento/trabajo, no un ledger — un proyecto puede necesitar reprogramar o
-- una segunda visita/fase sin que eso implique borrar historial (Alina,
-- "no quiero procesos rígidos imposibles de modificar después").
--
-- El checklist se SNAPSHOTEA desde `checklists_config` al crear la
-- instalación — cambios futuros al catálogo de checklist de la empresa
-- nunca alteran una instalación ya en curso (mismo criterio que
-- proyectos.config_vendida).

CREATE TABLE IF NOT EXISTS checklists_config (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES companies(id),
  -- 'instalacion' hoy; 'mantenimiento' se suma en la subfase 2I sin tocar
  -- esta tabla — mismo campo, otro valor.
  tipo         text        NOT NULL,
  -- [{ "clave": "confirmar_direccion", "etiqueta": "Confirmar dirección" }, ...]
  -- orden = orden del arreglo. Vacío por default — cada empresa carga el
  -- suyo (nunca un checklist de industria hardcodeado en el motor).
  items        jsonb       NOT NULL DEFAULT '[]',
  activo       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_config_unico ON checklists_config(company_id, tipo);

ALTER TABLE checklists_config DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instalaciones (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES companies(id),
  proyecto_id       uuid        NOT NULL REFERENCES proyectos(id),
  sucursal_id       uuid        REFERENCES sucursales(id),
  responsable_id    uuid        REFERENCES usuarios(id),
  fecha_programada  date,
  hora_programada   text,       -- texto libre ('09:00', 'mañana') — mismo criterio que oportunidades.hora_visita
  cuadrilla         text[]      NOT NULL DEFAULT '{}',
  estado            text        NOT NULL DEFAULT 'por_programar' CHECK (estado IN (
    'por_programar', 'programada', 'preparando_material', 'lista_para_instalacion', 'en_camino',
    'instalando', 'pruebas', 'terminada', 'pendiente_documentacion', 'entregada'
  )),
  -- Snapshot del checklist al crear (ver comentario de checklists_config) —
  -- [{ "clave", "etiqueta", "completado": bool, "completado_por": uuid|null, "completado_en": timestamptz|null }].
  checklist         jsonb       NOT NULL DEFAULT '[]',
  -- { "numero_paneles", "potencia_kwp", "inversor": {...} } copiado de
  -- proyectos.config_vendida al crear + campos que el motor NUNCA calculó
  -- (estructura, microinversores) — null hasta que alguien los capture a
  -- mano, nunca inventados aquí tampoco.
  detalle_tecnico   jsonb,
  observaciones     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instalaciones_proyecto ON instalaciones(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_instalaciones_company_estado ON instalaciones(company_id, estado);
CREATE INDEX IF NOT EXISTS idx_instalaciones_responsable ON instalaciones(responsable_id) WHERE responsable_id IS NOT NULL;

ALTER TABLE instalaciones DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS checklists_config FROM checklists_config;
SELECT COUNT(*) AS instalaciones FROM instalaciones;
