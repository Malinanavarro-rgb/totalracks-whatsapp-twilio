-- TARA-OS — Ingeniería y Cotización: catálogo configurable de paquetes
-- comerciales de paneles solares (Alina, 2026-08-04).
--
-- El cliente ya tiene una tabla de precios estándar — el precio comercial
-- NO se calcula sumando automáticamente cada componente de la lista de
-- materiales (eso es lo que hacía aplicarCalculoALineas en Fase 3; queda
-- pendiente de ajustar esa lógica en el siguiente paso, una vez aprobada
-- la estructura de este catálogo). El motor sigue calculando la cantidad
-- TÉCNICA de paneles; el paquete comercial (con su precio de contado fijo)
-- se selecciona aparte, por cantidad de paneles, inmediato superior.
--
-- Deliberadamente específico de paneles_solares (no genérico entre
-- industrias) — los campos (potencia_panel_wp, tipo_inversor, kWp) son
-- vocabulario de esta industria, mismo criterio que ya se usó para
-- modules/motores-ingenieria/paneles-solares.js: forzar una tabla genérica
-- aquí sería una generalización falsa, no pedida.
--
-- company_id NOT NULL: cada empresa define sus propios paquetes/precios —
-- nunca un catálogo compartido entre empresas (mismo criterio que
-- `productos`, Fase 1).

CREATE TABLE IF NOT EXISTS paquetes_solares (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  nombre                  text NOT NULL,
  cantidad_paneles        integer NOT NULL CHECK (cantidad_paneles > 0),
  potencia_panel_wp       numeric(8,2),                  -- potencia individual del panel, W
  potencia_total_kwp      numeric(8,3),                  -- potencia total instalada del paquete, kWp — guardada explícita (no siempre es cantidad×potencia/1000 si el paquete mezcla equipos)
  marca_panel             text,
  modelo_panel            text,
  tipo_inversor           text,                          -- 'microinversor' | 'inversor_central' | 'inversor_string' — texto libre, sin ENUM (mismo criterio que productos.tipo)
  cantidad_inversores     integer,
  marca_inversor          text,
  modelo_inversor         text,
  entradas_por_inversor   integer,                       -- ej. microinversor de 4 entradas — nullable, no todos los inversores tienen este dato
  componentes_incluidos   jsonb NOT NULL DEFAULT '[]',    -- ej. ["monitoreo", "estructura de aluminio", "instalación", "material eléctrico", "trámite ante CFE"]
  garantias               jsonb NOT NULL DEFAULT '{}',    -- estructura libre {panel_anios, inversor_anios, instalacion_anios, ...} — se llena cuando el cliente confirme los valores reales
  precio_contado          numeric(12,2) NOT NULL,
  vigencia_desde          date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_hasta          date,                          -- NULL = vigente indefinidamente hasta que se desactive
  activo                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paquetes_solares_company ON paquetes_solares(company_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_solares_cantidad ON paquetes_solares(company_id, cantidad_paneles) WHERE activo = true;

ALTER TABLE paquetes_solares DISABLE ROW LEVEL SECURITY;

-- ── Catálogo inicial (Empresa Demo Paneles Solares, vive-solar-mty) ────────
-- Solo el paquete de 12 paneles trae ficha técnica completa (la referencia
-- real que dio Alina). Los otros 4 tienen SOLO nombre/cantidad/precio —
-- nunca se inventa marca/modelo/inversor/componentes/garantías para ellos;
-- quedan explícitamente incompletos hasta que el cliente confirme sus
-- equipos reales (no se asume que todos los paquetes usan el mismo equipo).

INSERT INTO paquetes_solares (company_id, nombre, cantidad_paneles, precio_contado)
SELECT c.id, v.nombre, v.cantidad_paneles, v.precio_contado
FROM companies c
CROSS JOIN (VALUES
  ('Paquete 4 paneles',  4,  34000),
  ('Paquete 6 paneles',  6,  54000),
  ('Paquete 8 paneles',  8,  64000),
  ('Paquete 10 paneles', 10, 84000)
) AS v(nombre, cantidad_paneles, precio_contado)
WHERE c.slug = 'vive-solar-mty'
  AND NOT EXISTS (
    SELECT 1 FROM paquetes_solares p WHERE p.company_id = c.id AND p.cantidad_paneles = v.cantidad_paneles
  );

INSERT INTO paquetes_solares (
  company_id, nombre, cantidad_paneles, potencia_panel_wp, potencia_total_kwp,
  marca_panel, modelo_panel, tipo_inversor, cantidad_inversores, marca_inversor, modelo_inversor, entradas_por_inversor,
  componentes_incluidos, precio_contado
)
SELECT
  c.id, 'Paquete 12 paneles', 12, 710, 8.52,
  'OSDA', NULL, 'microinversor', 3, 'Hoymiles', 'HMS-2250', 4,
  '["monitoreo", "estructura de aluminio", "instalación", "material eléctrico", "trámite ante CFE"]'::jsonb,
  94000
FROM companies c
WHERE c.slug = 'vive-solar-mty'
  AND NOT EXISTS (
    SELECT 1 FROM paquetes_solares p WHERE p.company_id = c.id AND p.cantidad_paneles = 12
  );

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT nombre, cantidad_paneles, precio_contado, marca_panel, tipo_inversor, cantidad_inversores, activo
FROM paquetes_solares
WHERE company_id = (SELECT id FROM companies WHERE slug = 'vive-solar-mty')
ORDER BY cantidad_paneles;
