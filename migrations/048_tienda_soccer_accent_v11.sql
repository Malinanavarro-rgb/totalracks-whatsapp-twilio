-- TARA — Brand Guidelines V1.0 (aprobado): accent oficial de Tienda Soccer,
-- ligeramente desaturado a pedido ("el verde sigue estando un poco fuerte,
-- bájale un poco — no tanto, solamente un poco"). Reemplaza el valor
-- sembrado en la migración 046 (#0F9D76).
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

UPDATE companies
SET color_acento = '#249982'
WHERE id = '3463e797-9a4f-4782-8936-6c2fb18c437e';

-- Verificación
SELECT nombre, color_acento FROM companies WHERE id = '3463e797-9a4f-4782-8936-6c2fb18c437e';
