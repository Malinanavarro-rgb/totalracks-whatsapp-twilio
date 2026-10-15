-- TARA Matrix™ — TARA Module Engine, Fase 0-1 (Alina, 2026-10-16, ver
-- TARA_MODULE_ENGINE_PLAN_V1.md)
-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 0: catálogo universal de módulos. Reutiliza los mismos identificadores
-- de texto de modules/permisos.js::MODULOS_PERMISOS (crm, cotizaciones, etc.)
-- — NO modifica ese archivo ni ese arreglo. 'agenda' se agrega aquí como
-- identificador nuevo (único módulo real sin equivalente en MODULOS_PERMISOS,
-- ver TARA_MODULE_INVENTORY_V1.md) — vive solo en esta tabla nueva, cero
-- efecto sobre roles_permisos/requirePermiso/modulosVisibles().
--
-- 'reportes' deliberadamente NO se incluye — no existe ninguna funcionalidad
-- real detrás (confirmado en NORT_ENERGY_AUDIT_V2.md), y esta fase registra
-- capacidades reales, no páginas pendientes.
--
-- Reversible: DROP TABLE modulos_empresa; DROP TABLE modulos_catalogo;
-- (en ese orden, por la FK) — ninguna otra tabla referencia estas dos todavía.
-- Idempotente: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING en el seed.
CREATE TABLE IF NOT EXISTS modulos_catalogo (
  codigo text PRIMARY KEY,
  nombre text NOT NULL,
  descripcion text,
  categoria text,
  estado text NOT NULL DEFAULT 'disponible',
  dependencias text[] NOT NULL DEFAULT '{}',
  disponible_comercialmente boolean NOT NULL DEFAULT false,
  version text NOT NULL DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fase 1: configuración real por empresa — puro registro todavía, NINGÚN
-- middleware ni ruta lo consulta en esta fase (requireModuloActivo queda
-- para Fase 2, con su propia autorización). Sin fila para una empresa+módulo
-- = sin opinión registrada todavía (una futura Fase 2 debe tratar esto como
-- "activo", igual que roles_permisos trata "sin matriz configurada").
CREATE TABLE IF NOT EXISTS modulos_empresa (
  company_id uuid NOT NULL REFERENCES companies(id),
  modulo_codigo text NOT NULL REFERENCES modulos_catalogo(codigo),
  activo boolean NOT NULL DEFAULT false,
  activado_en timestamptz,
  activado_por uuid,
  PRIMARY KEY (company_id, modulo_codigo)
);

CREATE INDEX IF NOT EXISTS idx_modulos_empresa_company ON modulos_empresa (company_id);

-- Catálogo inicial — 13 módulos reales (12 de MODULOS_PERMISOS + agenda).
-- 'configuracion' nunca se vende/activa por separado (toda empresa la
-- necesita) — disponible_comercialmente=false a propósito.
INSERT INTO modulos_catalogo (codigo, nombre, descripcion, categoria, dependencias, disponible_comercialmente) VALUES
  ('crm',            'CRM',                  'Clientes, oportunidades y seguimiento comercial.',            'ventas',     '{}',               true),
  ('cotizaciones',   'Cotizaciones',          'Cotizador con líneas, PDF y envío al cliente.',               'ventas',     '{"crm"}',          true),
  ('agenda',         'Agenda',                'Citas, disponibilidad y recordatorios.',                      'ventas',     '{}',               true),
  ('proyectos',      'Proyectos',             'Expediente 360° de cada venta aceptada.',                     'operacion',  '{"cotizaciones"}', true),
  ('cobranza',       'Cobranza',              'Anticipos, abonos y saldo por proyecto.',                     'operacion',  '{"proyectos"}',    true),
  ('instalaciones',  'Instalaciones',         'Checklist, evidencias y equipos instalados.',                 'operacion',  '{"proyectos"}',    true),
  ('inventario',     'Inventario',            'Existencias, movimientos y reservas por sucursal.',           'operacion',  '{}',               true),
  ('compras',        'Compras',               'Proveedores y órdenes de compra.',                            'operacion',  '{"inventario"}',   true),
  ('tramites_cfe',   'Trámites CFE',          'Seguimiento de interconexión ante CFE.',                      'postventa',  '{"proyectos"}',    true),
  ('garantias',      'Garantías',             'Garantías y reclamaciones de equipos instalados.',            'postventa',  '{"instalaciones"}', true),
  ('mantenimiento',  'Mantenimiento',         'Mantenimientos programados y su historial.',                  'postventa',  '{"proyectos"}',    true),
  ('tickets',        'Tickets',               'Soporte y seguimiento de incidencias.',                       'postventa',  '{}',               true),
  ('configuracion',  'Configuración',         'Configuración general de la empresa.',                        'plataforma', '{}',               false)
ON CONFLICT (codigo) DO NOTHING;
