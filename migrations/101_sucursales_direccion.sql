-- TARA Matrix™ — sucursales.direccion (Alina, 2026-08-28)
--
-- Aditivo, nullable, cero cambio de comportamiento para sucursales
-- existentes. `sucursales` hoy solo guarda `nombre` — no hay dónde
-- conservar la dirección completa de un local físico (ej. "Local Comercial
-- CD VICTORIA", Nort Energy).
--
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS direccion text;
