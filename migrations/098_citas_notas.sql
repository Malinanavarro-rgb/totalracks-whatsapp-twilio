-- TARA Matrix™ — citas.notas (Alina, 2026-08-11 — demo LUMÉ Hair Studio)
--
-- Aditivo, nullable, cero cambio de comportamiento para empresas existentes.
-- Requerido para el panel de detalle de cita (notas relevantes de la
-- clienta/servicio) — hoy `citas` no tenía ningún campo de texto libre.
--
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE citas ADD COLUMN IF NOT EXISTS notas text;
