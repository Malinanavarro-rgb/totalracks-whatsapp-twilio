-- TARA Matrix™ — FASE 4A / Bugs producción
-- Bug #2: Eliminar "visita técnica gratuita" del knowledge_base Total Racks
-- Bug #3: Reforzar regla de una sola pregunta por turno (más imperativa)

-- ── Bug #2: KB — remover "gratuita" del contexto de visita técnica ────────────
-- Verificación previa: ver qué registros tienen el texto problemático
SELECT id, categoria, LEFT(contenido, 200) AS preview
FROM knowledge_base
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
  AND contenido ~* 'visita.*técnica.*gratuita';

-- Actualización: reemplaza "visita técnica gratuita" → "visita técnica"
UPDATE knowledge_base
SET contenido = REGEXP_REPLACE(
  contenido,
  'visita(s)? técnica(s)? gratuita(s)?',
  'visita técnica',
  'gi'
)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
  AND contenido ~* 'visita.*técnica.*gratuita';

-- ── Bug #3: Reglas — reemplazar regla débil por versión imperativa ─────────────
-- Sustituye cualquier regla que mencione "pregunta(s)" por la versión más clara.
-- Si no hay ninguna, agrega la nueva al final del arreglo.
UPDATE personalities
SET reglas = ARRAY(
  SELECT CASE
    WHEN r ILIKE '%pregunta%' OR r ILIKE '%preguntas%'
    THEN 'OBLIGATORIO: Haz UNA SOLA pregunta por mensaje. Nunca hagas dos o más preguntas en la misma respuesta. Si necesitas varios datos, prioriza el más importante y espera la respuesta antes de pedir el siguiente.'
    ELSE r
  END
  FROM unnest(reglas) AS r
)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';

-- Si no había ninguna regla con "pregunta" (no se actualizó nada), agregar:
-- (Ejecutar solo si el UPDATE anterior afectó 0 filas)
/*
UPDATE personalities
SET reglas = array_cat(
  COALESCE(reglas, ARRAY[]::text[]),
  ARRAY['OBLIGATORIO: Haz UNA SOLA pregunta por mensaje. Nunca hagas dos o más preguntas en la misma respuesta. Si necesitas varios datos, prioriza el más importante y espera la respuesta antes de pedir el siguiente.']
)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';
*/

-- ── Verificación final ────────────────────────────────────────────────────────
SELECT id, categoria, LEFT(contenido, 120) AS kb_preview
FROM knowledge_base
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
ORDER BY categoria;

SELECT reglas
FROM personalities
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';
