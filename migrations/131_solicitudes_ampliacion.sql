-- TARA Module Engine — Fase 3.3/3.4 (Alina, 2026-10-17, autorizada tras
-- Fase 3.1/3.2 — ver TARA_MODULE_ENGINE_FASE3_PROPUESTA_V1.md sección 2.3).
--
-- Tabla nueva, aditiva: solicitudes de ampliación de capacidad (módulo no
-- incluido en el plan vigente, u otro tipo de ampliación) que el Super
-- Admin revisa manualmente desde Panel Maestro — mismo criterio que
-- crearSuscripcionManual() (sin gateway de pago conectado, nunca cobra ni
-- factura automáticamente).
--
-- modulo_codigo es NULL cuando la solicitud no es de un módulo específico
-- (ej. "quiero más sucursales") — cuando es NULL, revisarSolicitud() solo
-- cambia el estado de la solicitud, nunca toca modulos_empresa.

CREATE TABLE IF NOT EXISTS solicitudes_ampliacion (
  id              bigserial PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES companies(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  modulo_codigo   text REFERENCES modulos_catalogo(codigo),
  notas           text,
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por  uuid NOT NULL REFERENCES usuarios(id),
  revisada_por    uuid REFERENCES usuarios(id),
  revisada_en     timestamptz,
  notas_revision  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_ampliacion_company ON solicitudes_ampliacion (company_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_ampliacion_estado ON solicitudes_ampliacion (estado);

-- Auditoría de Super Admin: 2 acciones nuevas (aprobar/rechazar) — mismo
-- patrón de las migraciones 072/084/130, catálogo completo vigente + las
-- 2 nuevas (verificado contra la definición real del CHECK antes de
-- escribir esto, para no repetir el error de la migración 130 original).
ALTER TABLE plataforma_audit_log DROP CONSTRAINT IF EXISTS plataforma_audit_log_accion_check;
ALTER TABLE plataforma_audit_log ADD CONSTRAINT plataforma_audit_log_accion_check CHECK (accion IN (
  'suspender_empresa', 'reactivar_empresa', 'cambiar_plan', 'crear_organizacion',
  'impersonar_inicio', 'impersonar_fin', 'reset_password', 'extender_prueba',
  'regalar_meses', 'bloquear_cuenta', 'desbloquear_cuenta',
  'actualizar_metodo_pago', 'registrar_pago',
  'cancelar_suscripcion', 'aplicar_descuento',
  'demo_activar', 'demo_finalizar',
  'crear_plan', 'editar_plan',
  'aprobar_solicitud_ampliacion', 'rechazar_solicitud_ampliacion'
));

-- Verificación
SELECT count(*) AS tabla_creada FROM solicitudes_ampliacion;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'plataforma_audit_log_accion_check';

INSERT INTO schema_migrations (archivo) VALUES ('131') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- ALTER TABLE plataforma_audit_log DROP CONSTRAINT IF EXISTS plataforma_audit_log_accion_check;
-- ALTER TABLE plataforma_audit_log ADD CONSTRAINT plataforma_audit_log_accion_check CHECK (accion IN (
--   'suspender_empresa', 'reactivar_empresa', 'cambiar_plan', 'crear_organizacion',
--   'impersonar_inicio', 'impersonar_fin', 'reset_password', 'extender_prueba',
--   'regalar_meses', 'bloquear_cuenta', 'desbloquear_cuenta',
--   'actualizar_metodo_pago', 'registrar_pago',
--   'cancelar_suscripcion', 'aplicar_descuento',
--   'demo_activar', 'demo_finalizar',
--   'crear_plan', 'editar_plan'
-- ));
-- DROP TABLE IF EXISTS solicitudes_ampliacion;
