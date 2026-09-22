-- Financiamiento configurable (auditoría 2026-09-16, Parte B punto 12 —
-- Alina, 2026-09-22): "no existe ningún campo ni lógica" — confirmado,
-- primera vez que se construye. Tabla de planes por empresa, SIN ningún
-- plan sembrado por default — a diferencia del límite de descuento
-- (migración 109, un umbral interno razonable), una tasa de interés o un
-- número de parcialidades es un término financiero real que el cliente
-- verá en su cotización; inventar uno rompería el principio de "nunca
-- alucinar" de todo este proyecto. Queda vacía hasta que la empresa
-- capture sus planes reales (contado/MSI/crédito) desde Configuración.

CREATE TABLE IF NOT EXISTS planes_financiamiento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  nombre                text NOT NULL,                     -- ej. "12 meses sin intereses", "Crédito a 24 meses"
  -- 'contado' (sin parcialidades), 'msi' (meses sin intereses, tasa 0
  -- implícita), 'credito' (con tasa) — texto libre sin ENUM, mismo criterio
  -- que productos.tipo/paquetes_solares.tipo_inversor.
  tipo                  text NOT NULL CHECK (tipo IN ('contado', 'msi', 'credito')),
  numero_parcialidades  integer CHECK (numero_parcialidades IS NULL OR numero_parcialidades > 0), -- NULL para 'contado'
  tasa_interes_anual_pct numeric(6,3),                      -- NULL/0 para 'contado'/'msi' — % anual, ej. 24.0
  anticipo_pct_minimo   numeric(5,2),                       -- NULL = sin anticipo mínimo específico de este plan
  activo                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planes_financiamiento_company ON planes_financiamiento(company_id) WHERE activo = true;

ALTER TABLE planes_financiamiento DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT COUNT(*) AS planes_financiamiento FROM planes_financiamiento;
