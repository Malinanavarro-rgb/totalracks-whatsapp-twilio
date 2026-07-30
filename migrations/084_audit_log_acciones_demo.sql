-- TARA-OS — agrega 'demo_activar'/'demo_finalizar' al CHECK de
-- plataforma_audit_log.accion.
--
-- Encontrado durante la validación en vivo del Modo Demo (ADR-013,
-- 2026-07-30): modules/plataforma-demo.js ya llama a
-- plataforma-audit.registrarEvento() con estos dos valores (mismo patrón
-- que impersonar_inicio/impersonar_fin), pero el CHECK constraint
-- (migración 072) no los incluía — registrarEvento() es fire-and-forget
-- (nunca lanza, ver modules/plataforma-audit.js), así que crearSesionDemo()/
-- finalizarSesionDemo() seguían funcionando, pero CADA sesión demo activada
-- o finalizada quedaba SIN registro en la auditoría de plataforma — un
-- vacío real de trazabilidad, no solo cosmético.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

ALTER TABLE plataforma_audit_log DROP CONSTRAINT IF EXISTS plataforma_audit_log_accion_check;

ALTER TABLE plataforma_audit_log ADD CONSTRAINT plataforma_audit_log_accion_check CHECK (accion IN (
  'suspender_empresa', 'reactivar_empresa', 'cambiar_plan', 'crear_organizacion',
  'impersonar_inicio', 'impersonar_fin', 'reset_password', 'extender_prueba',
  'regalar_meses', 'bloquear_cuenta', 'desbloquear_cuenta',
  'actualizar_metodo_pago', 'registrar_pago',
  'cancelar_suscripcion', 'aplicar_descuento',
  'demo_activar', 'demo_finalizar'
));

-- Verificación
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'plataforma_audit_log_accion_check';
