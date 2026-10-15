-- TARA Module Engine — Fase 3.1: auditoría de administración de planes (Alina, 2026-10-17).
--
-- plataforma_audit_log.accion es un catálogo cerrado (CHECK) — se agregan
-- 'crear_plan' y 'editar_plan' para las 2 acciones nuevas de Planes.jsx
-- (Super Admin → Planes y módulos). Mismo patrón que las migraciones 072/084
-- (DROP + ADD CONSTRAINT, Postgres no permite ALTER CHECK directo) —
-- aditiva, no toca ninguna fila existente.
--
-- CORRECCIÓN 2026-10-17: la primera versión de este archivo solo copió el
-- catálogo de la migración 072 y omitió 'demo_activar'/'demo_finalizar'
-- (agregados después, en la migración 084) — como ya existen filas reales
-- con esos valores (Modo Demo), reconstruir el CHECK sin ellos lo violaba.
-- Esta versión incluye el catálogo completo y vigente.

ALTER TABLE plataforma_audit_log DROP CONSTRAINT IF EXISTS plataforma_audit_log_accion_check;

ALTER TABLE plataforma_audit_log ADD CONSTRAINT plataforma_audit_log_accion_check CHECK (accion IN (
  'suspender_empresa', 'reactivar_empresa', 'cambiar_plan', 'crear_organizacion',
  'impersonar_inicio', 'impersonar_fin', 'reset_password', 'extender_prueba',
  'regalar_meses', 'bloquear_cuenta', 'desbloquear_cuenta',
  'actualizar_metodo_pago', 'registrar_pago',
  'cancelar_suscripcion', 'aplicar_descuento',
  'demo_activar', 'demo_finalizar',
  'crear_plan', 'editar_plan'
));

-- Verificación
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'plataforma_audit_log_accion_check';

INSERT INTO schema_migrations (archivo) VALUES ('130') ON CONFLICT (archivo) DO NOTHING;
