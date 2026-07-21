-- TARA — Portal de Cliente: wizard corto de onboarding post-registro.
-- Aditivo: empresas ya existentes quedan con onboarding_completado=true
-- (ya pasaron por su propio "primer contacto" manual con Alina; no tiene
-- sentido mostrarles el wizard). Solo las registradas por autoservicio a
-- partir de ahora nacen en false.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_completado boolean NOT NULL DEFAULT true;

ALTER TABLE companies ALTER COLUMN onboarding_completado SET DEFAULT false;
-- El DEFAULT queda en false para inserts futuros (registro público);
-- las filas ya existentes conservan el valor true que les puso el primer ALTER.

-- Verificación
SELECT COUNT(*) AS total, onboarding_completado FROM companies GROUP BY onboarding_completado;
