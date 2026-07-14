-- TARA — Fix: skills se guardó como el string '[]' en vez de un arreglo real
-- modules/plantillas-industria.js::aplicarPlantilla() insertaba
-- `skills: '[]'` (el texto de dos caracteres) en vez de `[]` (arreglo
-- vacío real) — SkillsTab.jsx hace `skills.map(...)`, que revienta contra
-- un string. Afecta a toda empresa creada por el motor de plantillas
-- (Tienda Soccer y Salón de Belleza Demo). Ya corregido en el código;
-- esta migración arregla el dato ya sembrado.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

UPDATE personalities
SET skills = '[]'::jsonb
WHERE company_id IN ('3463e797-9a4f-4782-8936-6c2fb18c437e', '5a867538-13cb-427a-8c49-d23716391f4e')
  AND jsonb_typeof(skills) = 'string';

-- Verificación
SELECT company_id, skills, jsonb_typeof(skills) AS tipo FROM personalities
  WHERE company_id IN ('3463e797-9a4f-4782-8936-6c2fb18c437e', '5a867538-13cb-427a-8c49-d23716391f4e');
