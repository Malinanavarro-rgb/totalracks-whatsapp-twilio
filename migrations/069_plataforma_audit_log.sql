-- TARA — FASE 8.1: plataforma_audit_log.
--
-- Aplicación del Artículo 8/Principio P8 de la Constitución ("Todo lo que
-- pasa, se registra") a acciones de Super Admin — mismo principio que
-- `decision_logs` ya aplica a decisiones del AI, ahora para un actor nuevo
-- (el operador de plataforma, no el asistente conversacional).
--
-- `accion` es un catálogo cerrado, no texto libre — para que el Panel
-- Maestro pueda filtrar/agrupar sin normalizar texto después.

CREATE TABLE plataforma_audit_log (
  id                    bigserial PRIMARY KEY,
  admin_id              uuid NOT NULL REFERENCES usuarios(id),
  accion                text NOT NULL CHECK (accion IN (
    'suspender_empresa', 'reactivar_empresa', 'cambiar_plan', 'crear_organizacion',
    'impersonar_inicio', 'impersonar_fin', 'reset_password', 'extender_prueba',
    'regalar_meses', 'bloquear_cuenta', 'desbloquear_cuenta'
  )),
  organization_id       uuid REFERENCES organizations(id),
  company_id            uuid REFERENCES companies(id),
  usuario_afectado_id   uuid REFERENCES usuarios(id),
  detalle               jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_admin ON plataforma_audit_log(admin_id);
CREATE INDEX idx_audit_org   ON plataforma_audit_log(organization_id);

-- Verificación
SELECT count(*) AS eventos_registrados FROM plataforma_audit_log;

INSERT INTO schema_migrations (archivo) VALUES ('069') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS plataforma_audit_log;
