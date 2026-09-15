-- TARA Matrix™ — oportunidades: campos estructurados de calificación
-- (Alina, 2026-09-15 — auditoría del workflow real de ventas solares de
-- Nort Energy)
--
-- Aditivo, todas nullable, cero cambio de comportamiento para cualquier
-- empresa que no los use (Total Racks, salones de belleza, etc. siguen
-- exactamente igual — mismo criterio ya usado con oportunidades.tipo_rack,
-- que tampoco es universal y ya convive con las demás industrias).
--
-- Hoy estos datos solo viven en workflow_sessions.captured_fields (JSONB)
-- y se pierden de vista en cuanto la sesión se marca 'completado' — nadie
-- vuelve a consultarla desde el CRM. Estas columnas dejan el progreso de
-- calificación visible en la oportunidad en vivo, no solo al final.
--
-- Nombres alineados a los `campo` que YA usan workflow_nodes de paneles
-- solares (ciudad, colonia, tipo_propiedad, importe_promedio_recibo,
-- tipo_alimentacion, voltaje_sitio, pct_cobertura_deseado) para que
-- sincronizar captured_fields → oportunidades sea una copia directa de
-- claves, sin mapeo adicional.
--
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS fuente_lead text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS tipo_propiedad text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS ciudad text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS colonia text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS direccion text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS propiedad_propia boolean;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS recibo_cfe_recibido boolean NOT NULL DEFAULT false;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS consumo_mensual_kwh numeric;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS importe_promedio_recibo numeric;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS tarifa_cfe text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS tipo_alimentacion text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS voltaje_sitio text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS pct_cobertura_deseado numeric;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS paneles_estimados integer;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS kwp_estimado numeric;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS fecha_visita date;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS hora_visita text;
-- pending_time | confirmed | needs_reschedule | cancelled | completed — sin
-- CHECK constraint (mismo criterio ya usado en usuarios_empresas.rol: texto
-- libre documentado, no enforced en DB).
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS estado_visita text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS resumen_conversacion text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS campos_faltantes jsonb;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS siguiente_accion text;
