-- TARA — FASE 8.1: plataforma_impersonaciones ("entrar como administrador
-- a cualquier empresa para soporte").
--
-- No reusa usuarios_empresas: forzar una fila de membresía ahí ensuciaría
-- la lista real de usuarios de esa empresa (aparecería el Super Admin como
-- "miembro" de Total Racks) y no sería auditable como acto distinto de una
-- membresía real. En su lugar, un token de vida corta que
-- resolverSesionImpersonada() valida ANTES del flujo normal de requireAuth
-- (modules/auth-middleware.js) — ver modules/plataforma-impersonacion.js.
--
-- expira_en: 2 horas por defecto, para que una sesión de soporte olvidada
-- no quede viva indefinidamente.

CREATE TABLE plataforma_impersonaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       uuid NOT NULL REFERENCES usuarios(id),
  company_id     uuid NOT NULL REFERENCES companies(id),
  token          text UNIQUE NOT NULL,
  motivo         text,
  iniciado_en    timestamptz NOT NULL DEFAULT now(),
  expira_en      timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  finalizado_en  timestamptz
);
CREATE INDEX idx_impersonaciones_token ON plataforma_impersonaciones(token);

-- Verificación
SELECT count(*) AS impersonaciones_registradas FROM plataforma_impersonaciones;

INSERT INTO schema_migrations (archivo) VALUES ('068') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS plataforma_impersonaciones;
