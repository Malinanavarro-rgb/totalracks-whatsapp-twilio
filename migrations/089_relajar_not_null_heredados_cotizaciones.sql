-- TARA-OS — Corrección post-088: relajar NOT NULL heredados en `cotizaciones`.
--
-- Hallazgo real al validar 088 contra la base de datos (Alina, 2026-08-04,
-- checklist punto 7): `descripcion` y `precio_total` eran NOT NULL desde el
-- diseño original de setup-db.js (2024), donde una cotización se creaba ya
-- con ambos datos en una sola llamada. El nuevo flujo (088) crea la
-- cotización vacía en estado 'borrador' y la va llenando — info_tecnica,
-- luego cotizacion_lineas, y `total` se calcula al final — exigir estas dos
-- columnas desde la creación bloquea ese flujo.
--
-- Seguro: `cotizaciones` tiene 0 filas (confirmado antes de escribir esto),
-- así que relajar el NOT NULL no puede violar ninguna fila existente.
-- No se borra la columna ni se cambia su tipo — solo deja de ser obligatoria
-- en el momento de creación.

ALTER TABLE cotizaciones ALTER COLUMN descripcion DROP NOT NULL;
ALTER TABLE cotizaciones ALTER COLUMN precio_total DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Verificación: is_nullable debe decir 'YES' para ambas.
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'cotizaciones' AND column_name IN ('descripcion', 'precio_total');
