-- TARA — Portal del Cliente: nuevas acciones auditables.
--
-- plataforma_audit_log.accion es un catálogo cerrado (CHECK) — se agregan
-- 'cancelar_suscripcion' y 'aplicar_descuento' para las 2 acciones nuevas
-- de Panel Maestro. Recrear el CHECK (Postgres no permite ALTER CHECK
-- directo) sin tocar ninguna fila existente.

ALTER TABLE plataforma_audit_log DROP CONSTRAINT IF EXISTS plataforma_audit_log_accion_check;

ALTER TABLE plataforma_audit_log ADD CONSTRAINT plataforma_audit_log_accion_check CHECK (accion IN (
  'suspender_empresa', 'reactivar_empresa', 'cambiar_plan', 'crear_organizacion',
  'impersonar_inicio', 'impersonar_fin', 'reset_password', 'extender_prueba',
  'regalar_meses', 'bloquear_cuenta', 'desbloquear_cuenta',
  'actualizar_metodo_pago', 'registrar_pago',
  'cancelar_suscripcion', 'aplicar_descuento'
));

-- Verificación
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'plataforma_audit_log_accion_check';

INSERT INTO schema_migrations (archivo) VALUES ('072') ON CONFLICT (archivo) DO NOTHING;
