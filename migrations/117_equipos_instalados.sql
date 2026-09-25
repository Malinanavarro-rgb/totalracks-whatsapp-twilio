-- Subfase 2D — Evidencias / equipos instalados (Alina, 2026-09-25).
-- ─────────────────────────────────────────────────────────────────────────────
-- CORE genérico (ver NORT_ENERGY_PORTAL_PLAN.md sección 5): número de serie +
-- garantía + marca/modelo es universal, aplica igual a un panel solar que a
-- un rack industrial o un aire acondicionado. Nace de una `instalación`
-- (2C) — es la jerarquía real del negocio, no un registro suelto.
--
-- `documento_evidencia_id` reutiliza `documentos_cliente` (ya extendida con
-- instalacion_id/fase abajo) — NUNCA una tabla de archivos aparte, tercera
-- vez que se usa este patrón de storage.
--
-- Es lo que un cliente final verá como "mis paneles/productos" en su
-- portal — por eso `proyecto_id` es NOT NULL y tiene su propio índice: la
-- consulta real será siempre "equipos de MI proyecto", nunca un listado
-- global.

ALTER TABLE documentos_cliente ADD COLUMN IF NOT EXISTS instalacion_id uuid REFERENCES instalaciones(id);
ALTER TABLE documentos_cliente ADD COLUMN IF NOT EXISTS fase text CHECK (fase IN ('antes', 'durante', 'despues'));

CREATE INDEX IF NOT EXISTS idx_documentos_cliente_instalacion ON documentos_cliente(instalacion_id) WHERE instalacion_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipos_instalados (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES companies(id),
  proyecto_id           uuid        NOT NULL REFERENCES proyectos(id),
  instalacion_id        uuid        NOT NULL REFERENCES instalaciones(id),
  -- Texto libre sin ENUM, mismo criterio que el resto del repo: 'panel' |
  -- 'inversor' | 'microinversor' | 'estructura' | 'bateria' | 'otro' —
  -- documentado aquí, nunca un CHECK que obligue a tocar la DB para agregar uno.
  tipo_equipo           text        NOT NULL,
  marca                 text,
  modelo                text,
  numero_serie          text,
  -- Texto libre a propósito: paneles se miden en Wp, inversores en kW —
  -- unidades distintas, nunca forzadas a una sola columna numérica.
  potencia_capacidad    text,
  proveedor             text,
  fecha_instalacion     date,
  -- Prefijado desde productos.garantia_meses si el equipo se ligó a un
  -- producto del catálogo (ver modules/equipos-instalados.js) — SIEMPRE
  -- editable después, nunca un valor inventado si el catálogo no lo trae.
  garantia_meses        integer,
  producto_id           uuid        REFERENCES productos(id), -- opcional: de qué producto del catálogo salió, si aplica
  documento_evidencia_id uuid       REFERENCES documentos_cliente(id),
  notas                 text,
  registrado_por        uuid        REFERENCES usuarios(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipos_instalados_proyecto ON equipos_instalados(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_equipos_instalados_instalacion ON equipos_instalados(instalacion_id);

ALTER TABLE equipos_instalados DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT instalacion_id, fase FROM documentos_cliente LIMIT 0;
SELECT COUNT(*) AS equipos_instalados FROM equipos_instalados;
