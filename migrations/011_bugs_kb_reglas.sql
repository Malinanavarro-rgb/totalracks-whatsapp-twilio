-- TARA Matrix™ — FASE 4A / Bugs producción
-- Bug #2: Eliminar "visita técnica gratuita" del knowledge_base Total Racks
-- Bug #3: Reforzar regla de una sola pregunta por turno (más imperativa)

-- ── Bug #2: KB — remover "gratuita" del contexto de visita técnica ────────────
UPDATE knowledge_base
SET contenido = REGEXP_REPLACE(
  contenido,
  'visita(s)? técnica(s)? gratuita(s)?',
  'visita técnica',
  'gi'
)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
  AND contenido ~* 'visita.*técnica.*gratuita';

-- ── Bug #3: Reglas (jsonb) — reemplazar regla débil por versión imperativa ────
UPDATE personalities
SET reglas = (
  SELECT jsonb_agg(
    CASE
      WHEN r ILIKE '%pregunta%' OR r ILIKE '%preguntas%'
      THEN 'OBLIGATORIO: Haz UNA SOLA pregunta por mensaje. Nunca hagas dos o más preguntas en la misma respuesta. Si necesitas varios datos, prioriza el más importante y espera la respuesta antes de pedir el siguiente.'
      ELSE r
    END
  )
  FROM jsonb_array_elements_text(reglas) AS r
)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';

-- ── Verificación final ────────────────────────────────────────────────────────
SELECT id, categoria, LEFT(contenido, 120) AS kb_preview
FROM knowledge_base
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4'
ORDER BY categoria;

SELECT value AS regla
FROM personalities, jsonb_array_elements_text(reglas)
WHERE company_id = '8b5fb3b8-68be-446d-a925-78bc868ca8e4';
