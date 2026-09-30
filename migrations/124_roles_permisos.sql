-- Roles departamentales (Alina, 2026-09-29, ver NORT_ENERGY_AUDIT_V1.md
-- sección 9 — matriz diseñada ahí, implementada aquí bajo autorización
-- explícita separada).
-- ─────────────────────────────────────────────────────────────────────────────
-- Motor Universal: la matriz es DATO por empresa, no código — cualquier
-- empresa puede definir sus propios roles/alcances sin tocar el backend,
-- mismo criterio que plantillas_industria/dashboard_kpis_seed.
--
-- Diseño de dos niveles, nunca uno solo:
--   1. `esGerencial(rol)` (owner/administrador/supervisor, modules/permisos.js,
--      SIN CAMBIOS) sigue siendo un bypass total — dirección/gerencia
--      siempre ven y pueden todo, exactamente como hoy. Nunca se filtra por
--      esta tabla.
--   2. Para cualquier OTRO rol, la ausencia de una fila en `roles_permisos`
--      para (company_id, rol, modulo) se resuelve así:
--        - Si la EMPRESA no tiene NINGUNA fila configurada todavía →
--          comportamiento IDÉNTICO al de hoy (requireAuth solo, acceso
--          total) — cero regresión para empresas que nunca configuren esto.
--        - Si la empresa YA configuró AL MENOS una fila (opt-in real) →
--          la ausencia de la fila específica es DENEGAR — un hueco en la
--          matriz nunca se interpreta como "todo permitido".
--
-- `alcance` es informativo para quien construye la consulta (mismo
-- criterio que companies.nav_labels: el backend YA tenía ejemplos de este
-- patrón antes de esta migración, ej. listarClientes() con
-- "asesor ve los suyos + el pool sin asignar") — no hay una forma genérica
-- de aplicar "propios"/"asignados" sin conocer el recurso, así que cada
-- función de negocio que la usa decide cómo filtrar.

CREATE TABLE IF NOT EXISTS roles_permisos (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES companies(id),
  -- Texto libre sin ENUM (mismo criterio que tipo_propiedad/productos.tipo):
  -- cualquier empresa puede nombrar sus roles como quiera. Los 7 valores
  -- reales de Nort Energy (sembrados abajo): ventas, ingenieria,
  -- administracion, instalaciones, almacen, cfe, postventa.
  rol        text        NOT NULL,
  -- Mismo criterio: 'crm', 'cotizaciones', 'proyectos', 'cobranza',
  -- 'instalaciones', 'inventario', 'compras', 'tramites_cfe', 'garantias',
  -- 'mantenimiento', 'tickets', 'configuracion' — documentados en
  -- modules/permisos.js::MODULOS, nunca un ENUM que exija migración para
  -- agregar un módulo nuevo.
  modulo     text        NOT NULL,
  ver        boolean     NOT NULL DEFAULT false,
  crear      boolean     NOT NULL DEFAULT false,
  editar     boolean     NOT NULL DEFAULT false,
  eliminar   boolean     NOT NULL DEFAULT false,
  aprobar    boolean     NOT NULL DEFAULT false,
  -- Ninguna función de exportar (CSV/Excel) existe todavía en TARA —
  -- columna presente para cuando exista, inerte hoy (nada la consulta).
  exportar   boolean     NOT NULL DEFAULT false,
  alcance    text        NOT NULL DEFAULT 'propios' CHECK (alcance IN ('todos', 'sucursal', 'propios', 'asignados')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_permisos_unico ON roles_permisos(company_id, rol, modulo);
CREATE INDEX IF NOT EXISTS idx_roles_permisos_company_rol ON roles_permisos(company_id, rol);

ALTER TABLE roles_permisos DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS roles_permisos FROM roles_permisos;
