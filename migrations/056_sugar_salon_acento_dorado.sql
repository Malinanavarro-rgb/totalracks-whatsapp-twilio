-- TARA — Sugar Salon: acento dorado en vez del rosa genérico de industria
-- El rosa (#E85D8C) era el default de la industria "salón de belleza" en
-- Brand Guidelines V1.0 — Sugar Salon tiene marca propia (negro/dorado, ver
-- migración 055) y la dueña confirmó que el acento del panel debe
-- combinar con su logo real, no con el default genérico.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

UPDATE companies
SET color_acento = '#C9973D'
WHERE id = '5a867538-13cb-427a-8c49-d23716391f4e';

-- Verificación
SELECT nombre, color_acento FROM companies WHERE id = '5a867538-13cb-427a-8c49-d23716391f4e';
