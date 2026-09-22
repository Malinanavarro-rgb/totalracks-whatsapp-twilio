-- Aprobación de descuentos (auditoría 2026-09-16, sección "Quick wins" /
-- Parte B punto 11 — Alina, 2026-09-22): `cotizaciones.descuento_pct` y
-- `descuento_monto` ya existían desde la migración 102, pero SIN ningún
-- flujo de aprobación — cualquiera podía escribirlos directo, sin registro
-- de quién lo pidió ni de quién lo autorizó. Primera vez que se construye
-- este patrón en todo el repo (confirmado en la auditoría): un descuento
-- por encima de un límite configurable queda pendiente hasta que un
-- gerencial lo autorice explícitamente — ver modules/cotizacion-descuento.js.

ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_motivo             text;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_solicitado_por     uuid REFERENCES usuarios(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_solicitado_en      timestamptz;
-- true si el % (o su equivalente, si se capturó como monto fijo) excede el
-- límite configurado — se recalcula en cada aplicarDescuento(), nunca queda
-- desfasado de lo que realmente se guardó.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS limite_descuento_excedido    boolean NOT NULL DEFAULT false;
-- null mientras esté pendiente. Un gerencial que aplica el descuento se
-- autoriza a sí mismo en el mismo acto (igual que autorizar-precio ya
-- funciona hoy) — solo un asesor sin rol gerencial deja esto pendiente.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_autorizado_por     uuid REFERENCES usuarios(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_autorizado_en     timestamptz;

-- Límite configurable — reutiliza `parametros_ingenieria` (ya soporta
-- override por empresa con fallback a un default global, ver
-- resolverParametro() en modules/cotizaciones.js) con un industria_slug
-- nuevo y genérico ('comercial'), no atado a ningún motor de ingeniería.
-- Default global 10%: ninguna empresa lo había configurado todavía —
-- documentado explícitamente como "default interno", nunca presentado
-- como una cifra de terceros.
INSERT INTO parametros_ingenieria (company_id, industria_slug, clave, valor, unidad, organismo_fuente, anio_fuente, documento_fuente)
VALUES (NULL, 'comercial', 'limite_descuento_sin_autorizacion_pct', 10, '%', 'Nort Energy (default interno, sin fuente externa)', 2026, NULL)
ON CONFLICT (industria_slug, clave, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

-- Verificación
SELECT descuento_motivo, descuento_solicitado_por, descuento_solicitado_en, limite_descuento_excedido, descuento_autorizado_por, descuento_autorizado_en
FROM cotizaciones LIMIT 0;
SELECT valor, unidad FROM parametros_ingenieria WHERE industria_slug = 'comercial' AND clave = 'limite_descuento_sin_autorizacion_pct' AND company_id IS NULL;
