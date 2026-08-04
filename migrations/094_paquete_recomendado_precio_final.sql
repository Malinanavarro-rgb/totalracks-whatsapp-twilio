-- TARA-OS — Ingeniería y Cotización: separar resultado técnico / paquete
-- comercial recomendado / precio final autorizado (Alina, 2026-08-04).
--
-- calculos_ingenieria (resultado TÉCNICO del motor) no se toca — sigue
-- siendo inmutable y versionado, sin ninguna noción de precio comercial.
-- Estas columnas nuevas viven en `cotizaciones` porque son, por diseño,
-- una capa distinta:
--   paquete_recomendado_id / precio_paquete_recomendado → lo que el
--     SISTEMA sugirió automáticamente (paquete inmediato superior a la
--     cantidad técnica de paneles). precio_paquete_recomendado es una
--     COPIA del precio del paquete al momento de recomendarlo — si el
--     precio del paquete cambia después, esta cotización no se altera
--     retroactivamente (mismo criterio de snapshot que
--     calculos_ingenieria.parametros_usados, Fase 1).
--   precio_final_autorizado(_por/_en) → la decisión HUMANA del asesor,
--     que puede aceptar el precio recomendado tal cual o ajustarlo. Nunca
--     se llena sola — siempre requiere un usuario y una fecha.

ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS paquete_recomendado_id uuid REFERENCES paquetes_solares(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS precio_paquete_recomendado numeric(12,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS precio_final_autorizado numeric(12,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS precio_final_autorizado_por uuid REFERENCES usuarios(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS precio_final_autorizado_en timestamptz;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'cotizaciones' AND column_name IN (
  'paquete_recomendado_id', 'precio_paquete_recomendado', 'precio_final_autorizado', 'precio_final_autorizado_por', 'precio_final_autorizado_en'
);
