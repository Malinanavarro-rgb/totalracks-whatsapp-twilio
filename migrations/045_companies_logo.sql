-- TARA Matrix™ — Selector de empresa activa (multi-empresa por usuario)
-- Agrega el campo para el logotipo de cada empresa. Sin subida de archivo
-- todavía (Supabase Storage aún no se usa en este proyecto) — mientras
-- logo_url sea null, el panel muestra un avatar con iniciales y color
-- estable derivado del nombre.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url text;

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'companies' AND column_name = 'logo_url';
