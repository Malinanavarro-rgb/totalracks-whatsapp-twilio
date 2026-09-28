-- Subfase 2G — Compras y proveedores (Alina, 2026-09-25, ver
-- NORT_ENERGY_PORTAL_PLAN.md). CORE genérico — reutiliza `productos` (ya
-- usado por el cotizador) para qué se compra, y `inventario_movimientos`
-- (2F, migración 116) como ÚNICO mecanismo para sumar existencia — recibir
-- una orden nunca "suma stock" por su cuenta, siempre pasa por
-- registrar_movimiento_inventario() vía modules/inventario.js.
--
-- `orden_compra_items.costo_unitario` vive en el ítem de la orden, NUNCA en
-- `productos` — el costo real es el de esa compra específica en ese
-- momento (un mismo producto puede costar distinto en compras distintas),
-- mismo criterio de snapshot ya usado en `proyectos.config_vendida`.

CREATE TABLE IF NOT EXISTS proveedores (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES companies(id),
  nombre            text        NOT NULL,
  contacto_nombre   text,
  contacto_telefono text,
  contacto_email    text,
  notas             text,
  activo            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proveedores_company ON proveedores(company_id);

ALTER TABLE proveedores DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- `sucursal_id` NOT NULL — mismo criterio que inventario_saldos (2F): una
-- compra siempre llega a un lugar físico. `recibida_en` es el guardián de
-- idempotencia de "recibir" (distinto de `fecha_recibida`, que es la fecha
-- de negocio) — un UPDATE...WHERE recibida_en IS NULL...RETURNING actúa
-- como mutex real, mismo espíritu que los contadores de folio atómicos.
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES companies(id),
  proveedor_id     uuid        NOT NULL REFERENCES proveedores(id),
  sucursal_id      uuid        NOT NULL REFERENCES sucursales(id),
  proyecto_id      uuid        REFERENCES proyectos(id), -- opcional — "cuando aplique" (compra ligada a un proyecto de venta específico)
  numero_orden     text        NOT NULL,
  -- Vocabulario libre, transición libre (no rígida) — igual que
  -- instalaciones.estado. 'recibida' SOLO se alcanza a través de
  -- recibirOrdenCompra() (genera los movimientos de inventario reales) —
  -- actualizarEstadoOrdenCompra() la rechaza explícitamente para no dejar
  -- una orden que "dice recibida" sin haber tocado inventario.
  estado           text        NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada', 'confirmada', 'recibida', 'cancelada')),
  fecha_solicitada date,
  fecha_esperada   date,
  fecha_recibida   date,
  recibida_en      timestamptz,
  notas            text,
  creado_por       uuid        REFERENCES usuarios(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ordenes_compra_numero_unico ON ordenes_compra(company_id, numero_orden);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_company ON ordenes_compra(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proyecto ON ordenes_compra(proyecto_id) WHERE proyecto_id IS NOT NULL;

ALTER TABLE ordenes_compra DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_compra_items (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id          uuid          NOT NULL REFERENCES ordenes_compra(id),
  producto_id       uuid          NOT NULL REFERENCES productos(id),
  cantidad          numeric(12,3) NOT NULL CHECK (cantidad > 0),
  costo_unitario    numeric(12,2),
  cantidad_recibida numeric(12,3) NOT NULL DEFAULT 0,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_items_orden ON orden_compra_items(orden_id);

ALTER TABLE orden_compra_items DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Folio de orden de compra — MISMO mecanismo ya probado que
-- incrementar_folio_proyecto/incrementar_folio_cotizacion: contador atómico
-- por empresa vía UPDATE...RETURNING. Contador propio (independiente de
-- COT-/el prefijo de proyecto). `prefijo_orden_compra` configurable por
-- empresa (mismo patrón que prefijo_proyecto/nav_labels) — nunca "OC-NE"
-- hardcodeado en código. Default 'OC' si la empresa no lo configuró.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS siguiente_folio_orden_compra integer NOT NULL DEFAULT 1;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS prefijo_orden_compra text;

CREATE OR REPLACE FUNCTION incrementar_folio_orden_compra(p_company_id uuid)
RETURNS integer
LANGUAGE sql
AS $$
  UPDATE companies
  SET siguiente_folio_orden_compra = siguiente_folio_orden_compra + 1
  WHERE id = p_company_id
  RETURNING siguiente_folio_orden_compra - 1;
$$;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS proveedores FROM proveedores;
SELECT COUNT(*) AS ordenes_compra FROM ordenes_compra;
SELECT COUNT(*) AS orden_compra_items FROM orden_compra_items;
SELECT siguiente_folio_orden_compra, prefijo_orden_compra FROM companies LIMIT 0;
