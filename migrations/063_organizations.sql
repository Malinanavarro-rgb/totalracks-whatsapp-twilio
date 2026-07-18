-- TARA — FASE 8.1: organizations (Panel Maestro / Plataforma Comercial).
--
-- La Constitución (docs/constitution/v3-constitution.md, Art. 9/16) define
-- Organization como el sujeto del contrato/billing, con una o más Companies
-- debajo. Nunca se implementó (Art. 18 lo esperaba desde FASE 3) — hoy todo
-- cuelga directo de company_id. Esta migración crea la versión MÍNIMA
-- permitida explícitamente por el Art. 9 ("Una Organization puede ser una
-- empresa pequeña... la jerarquía existe aunque no se use en su profundidad
-- completa"): una tabla nueva + una FK, sin tocar ninguna tabla del Core
-- congelado ni migrar nada de company_id.
--
-- companies.estado sigue siendo el flag OPERATIVO que ya es (gatea tráfico
-- real de WhatsApp, ver modules/config.js) — el estado COMERCIAL vive en
-- organizations.estado/suscripciones.estado (migración 065). Nunca se
-- reutiliza el mismo campo para ambas cosas.

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  estado      text NOT NULL DEFAULT 'activa', -- 'activa' | 'suspendida' | 'cancelada' — escrito SOLO por sincronizarEstadoOperativo() (modules/plataforma-billing.js)
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES usuarios(id) -- null para las organizations backfilleadas de empresas ya existentes
);

ALTER TABLE companies ADD COLUMN organization_id uuid REFERENCES organizations(id);

-- Backfill: una organization nueva por cada company existente (1:1 — hoy
-- ninguna empresa comparte contrato con otra; el modelo ya soporta que en
-- el futuro una organization tenga 2+ companies sin otra migración).
DO $$
DECLARE
  fila companies%ROWTYPE;
  nueva_org_id uuid;
BEGIN
  FOR fila IN SELECT * FROM companies WHERE organization_id IS NULL LOOP
    INSERT INTO organizations (nombre) VALUES (fila.nombre) RETURNING id INTO nueva_org_id;
    UPDATE companies SET organization_id = nueva_org_id WHERE id = fila.id;
  END LOOP;
END $$;

ALTER TABLE companies ALTER COLUMN organization_id SET NOT NULL;

-- Verificación: cada company debe tener exactamente una organization propia.
SELECT c.id, c.nombre, c.organization_id, o.nombre AS organization_nombre
  FROM companies c JOIN organizations o ON o.id = c.organization_id
  ORDER BY c.created_at;

INSERT INTO schema_migrations (archivo) VALUES ('063') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- ALTER TABLE companies DROP COLUMN IF EXISTS organization_id;
-- DROP TABLE IF EXISTS organizations;
