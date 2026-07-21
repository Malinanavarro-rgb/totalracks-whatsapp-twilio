-- TARA — Modo Operador: memoria institucional (tareas, proyectos, bitácora de
-- decisiones, documentos). Ver docs/plan "TARA como Sistema Operativo
-- Empresarial (Modo Operador)".
--
-- Todas cuelgan de company_id (igual que el resto del sistema hoy) — cuando
-- se necesite consultar "a nivel Organización" se resuelve con un JOIN a
-- companies.organization_id, mismo patrón que ya usa plataforma-analitica.js.
-- No se duplica organization_id en cada tabla nueva.
--
-- `bitacora_decisiones` es un concepto de negocio distinto de `decision_logs`
-- (que es telemetría técnica de llamadas a IA — costo/tokens/latencia, migración
-- 001). No confundir ni fusionar.
--
-- `documentos` empieza como notas de texto/markdown, no archivos reales —
-- decisión explícita para no construir un sistema de storage antes de saber
-- si el resto del diseño funciona.
--
-- Mismo criterio de seguridad que asesores/pipeline_etapas/servicios: RLS
-- deshabilitado, escritura y lectura vía sesión autenticada del panel
-- (req.usuario.company_id), nunca desde el navegador con anon key sin sesión.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS proyectos (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id),
  nombre              text        NOT NULL,
  descripcion         text,
  estado              text        NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pausado', 'completado', 'cancelado')),
  riesgo              text        NOT NULL DEFAULT 'bajo'   CHECK (riesgo IN ('bajo', 'medio', 'alto')),
  fecha_inicio        date,
  fecha_fin_estimada  date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proyectos_company        ON proyectos (company_id, estado);
CREATE INDEX IF NOT EXISTS idx_proyectos_company_riesgo  ON proyectos (company_id, riesgo);

ALTER TABLE proyectos DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tareas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES companies(id),
  titulo          text        NOT NULL,
  descripcion     text,
  estado          text        NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'en_progreso', 'completada', 'cancelada')),
  responsable_id  uuid        REFERENCES usuarios(id),
  fecha_limite    date,
  -- Relacionada opcionalmente a un cliente, oportunidad y/o proyecto — todas
  -- opcionales porque una tarea puede ser puramente interna.
  cliente_id      bigint      REFERENCES clientes(id),
  oportunidad_id  bigint      REFERENCES oportunidades(id),
  proyecto_id     uuid        REFERENCES proyectos(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  completada_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tareas_company          ON tareas (company_id, estado);
CREATE INDEX IF NOT EXISTS idx_tareas_company_limite    ON tareas (company_id, fecha_limite);
CREATE INDEX IF NOT EXISTS idx_tareas_proyecto          ON tareas (proyecto_id);

ALTER TABLE tareas DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bitacora_decisiones (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES companies(id),
  texto         text        NOT NULL,
  contexto      text,
  -- ej. "Reunión semanal de ventas", "Renegociación con proveedor X" — libre,
  -- no una FK, para no forzar una taxonomía de "tipos de contexto" prematura.
  autor_id      uuid        REFERENCES usuarios(id),
  cliente_id    bigint      REFERENCES clientes(id),
  proyecto_id   uuid        REFERENCES proyectos(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bitacora_decisiones_company ON bitacora_decisiones (company_id, created_at DESC);

ALTER TABLE bitacora_decisiones DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documentos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES companies(id),
  titulo       text        NOT NULL,
  contenido    text        NOT NULL,
  -- Texto/markdown plano en v1 — sin archivos/OCR todavía (ver plan).
  categoria    text,
  autor_id     uuid        REFERENCES usuarios(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_company ON documentos (company_id, categoria);

ALTER TABLE documentos DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'proyectos'          AS tabla, COUNT(*) FROM proyectos
UNION ALL SELECT 'tareas',              COUNT(*) FROM tareas
UNION ALL SELECT 'bitacora_decisiones', COUNT(*) FROM bitacora_decisiones
UNION ALL SELECT 'documentos',          COUNT(*) FROM documentos;
