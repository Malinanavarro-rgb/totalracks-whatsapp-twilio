-- TARA — Fase Premium V1.1: logo propio por cliente
-- "que el ícono del cliente traiga el logo del cliente para que se sienta
-- que es de él" — mismo patrón ya usado en companies.logo_url (migración
-- 045): campo nullable, sin subida de archivo todavía (Supabase Storage
-- aún no se usa en este proyecto). Sin logo, el panel muestra un avatar
-- con iniciales.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS logo_url text;

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'clientes' AND column_name = 'logo_url';
