-- TARA-OS — Business Memory Core (BMC), Fase 2: ciclo de vida completo.
-- memoria_empresarial sigue vacía en producción (0 filas, confirmado antes
-- de correr esta migración) — cambios de esquema sin riesgo de migrar datos.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. Estados: propuesto → confirmado | rechazado | obsoleto ────────────────
-- Renombra 'propuesta'/'rechazada' (Fase 1, nunca usados en producción) y
-- agrega 'obsoleto' (algo que fue cierto y dejó de serlo).

ALTER TABLE memoria_empresarial DROP CONSTRAINT IF EXISTS memoria_empresarial_estado_check;
ALTER TABLE memoria_empresarial ALTER COLUMN estado SET DEFAULT 'propuesto';
ALTER TABLE memoria_empresarial ADD CONSTRAINT memoria_empresarial_estado_check
  CHECK (estado IN ('propuesto', 'confirmado', 'rechazado', 'obsoleto'));

-- ── 2. origen: 'manual' → 'modo_operador' (evita confusión: la tool la
-- ejecuta el motor de IA de Modo Operador, aunque haya una persona detrás;
-- quién autorizó se guarda aparte en propuesto_por/resuelto_por) ────────────

ALTER TABLE memoria_empresarial DROP CONSTRAINT IF EXISTS memoria_empresarial_origen_check;
ALTER TABLE memoria_empresarial ADD CONSTRAINT memoria_empresarial_origen_check
  CHECK (origen IN ('inbox_analisis', 'modo_operador', 'business_intelligence'));

-- ── 3. Trazabilidad completa: quién resolvió (confirma/rechaza/marca
-- obsoleto), cuándo, y por qué si fue rechazo ────────────────────────────────
-- Nota: confirmado_por/confirmado_at de la migración 077 nunca llegaron a
-- crearse en producción (columnas ausentes, confirmado por auditoría directa
-- antes de esta migración) — se agregan directo con su nombre final en vez
-- de intentar un RENAME sobre algo que no existe.

ALTER TABLE memoria_empresarial ADD COLUMN IF NOT EXISTS resuelto_por uuid REFERENCES usuarios(id);
ALTER TABLE memoria_empresarial ADD COLUMN IF NOT EXISTS resuelto_at timestamptz;
ALTER TABLE memoria_empresarial ADD COLUMN IF NOT EXISTS razon_rechazo text;

-- ── 4. Confianza <60 nunca se propone — invariante también a nivel de base
-- de datos, no solo en código (doble barrera) ────────────────────────────────

ALTER TABLE memoria_empresarial DROP CONSTRAINT IF EXISTS memoria_empresarial_confianza_check;
ALTER TABLE memoria_empresarial ALTER COLUMN confianza DROP DEFAULT;
ALTER TABLE memoria_empresarial ADD CONSTRAINT memoria_empresarial_confianza_check
  CHECK (confianza BETWEEN 60 AND 100);

-- ── 5. Evidencia obligatoria: nunca un aprendizaje sin explicar en qué se
-- basa — también a nivel de base de datos (doble barrera) ───────────────────

ALTER TABLE memoria_empresarial ALTER COLUMN evidencia DROP DEFAULT;
ALTER TABLE memoria_empresarial ALTER COLUMN evidencia SET NOT NULL;
ALTER TABLE memoria_empresarial ADD CONSTRAINT memoria_empresarial_evidencia_no_vacia
  CHECK (evidencia ? 'resumen' AND length(trim(evidencia->>'resumen')) > 0);

-- Verificación
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'memoria_empresarial'
ORDER BY ordinal_position;
