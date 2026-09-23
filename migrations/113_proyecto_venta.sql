-- Subfase 2A — Proyecto solar / venta (Alina, 2026-09-22).
-- ─────────────────────────────────────────────────────────────────────────────
-- Extiende `proyectos` (Modo Operador, migración 074 + 088) para que sirva
-- también como expediente post-venta — NO se crea una tabla `ventas`
-- paralela (decisión aprobada, ver NORT_ENERGY_PORTAL_PLAN.md sección 4).
--
-- `tipo` distingue la NATURALEZA del registro dentro de la tabla genérica,
-- nunca la industria ni la empresa — eso ya lo dan `company_id` (dueño) y
-- `companies.industria_slug` (giro de negocio, Motor Universal). Meter
-- 'solar'/'rack' aquí duplicaría industria_slug y reintroduciría una rama
-- por industria en una tabla CORE, justo lo que la arquitectura evita en
-- todos lados (ver plan, sección 5). Dos valores, ambos genéricos:
--   'interno'  = proyecto de gestión de Modo Operador (comportamiento actual,
--                default para la única fila que ya existe hoy — Total Racks,
--                "Apertura segunda sucursal", claramente interno).
--   'venta'    = nace de una cotización aceptada, necesita cumplimiento
--                post-venta — el tipo que usa este bloque, sea cual sea la
--                industria de la empresa.
-- Confirmado antes de escribir esto: la ÚNICA función que lee `proyectos`
-- hoy es operador-tools.js::proyectosEnRiesgo(), que filtra por
-- estado='activo' AND riesgo IN ('medio','alto') — nunca por tipo. Agregar
-- la columna con DEFAULT 'interno' no cambia en nada su comportamiento; los
-- proyectos de venta simplemente no aparecerán ahí salvo que alguien les
-- ponga riesgo medio/alto explícitamente, lo cual sería correcto (un
-- proyecto de venta atorado también merece salir en "en riesgo").

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'interno' CHECK (tipo IN ('interno', 'venta'));

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS cliente_id            bigint REFERENCES clientes(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS sucursal_id           uuid   REFERENCES sucursales(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS asesor_id             uuid   REFERENCES asesores(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS ubicacion_instalacion text;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS numero_proyecto       text;
-- Snapshot INMUTABLE de lo vendido al momento de aceptar — paneles/inversor/
-- kWp/precio/folio de cotización copiados aquí una sola vez; cambios futuros
-- al catálogo, precios o paquetes NUNCA alteran un proyecto ya creado.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS config_vendida        jsonb;

CREATE INDEX IF NOT EXISTS idx_proyectos_cliente ON proyectos(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proyectos_tipo     ON proyectos(company_id, tipo);

-- Único número de proyecto por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proyectos_numero_unico
  ON proyectos(company_id, numero_proyecto) WHERE numero_proyecto IS NOT NULL;

-- LA garantía real de idempotencia (punto 9 de la aprobación: "evitar crear
-- dos proyectos si el endpoint se ejecuta dos veces", "si la arquitectura
-- permite hacerlo de forma transaccional, utilizar transacción"): un índice
-- único a nivel Postgres, no una verificación de aplicación que puede perder
-- una carrera bajo doble-clic/retry simultáneo. Un segundo intento de crear
-- un proyecto 'venta' para la misma cotización choca aquí — el código
-- atrapa el 23505 (mismo patrón ya usado en cotizacion-adjuntos.js) y
-- devuelve el proyecto que ya existe, nunca crea uno nuevo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proyectos_cotizacion_venta_unico
  ON proyectos(cotizacion_id) WHERE tipo = 'venta' AND cotizacion_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Aceptación de cotización — transición de negocio real, no un UPDATE suelto.
-- `aceptada_en` ya existe desde la migración 088 pero JAMÁS se escribe en
-- ningún lugar del código (confirmado); falta `aceptada_por` — mismo patrón
-- ya usado en enviada_por/predimensionamiento_revisado_por/
-- ingenieria_validada_para_cotizar_por/precio_final_autorizado_por/
-- descuento_autorizado_por: toda decisión humana se registra con quién y
-- cuándo, nunca implícita.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS aceptada_por uuid REFERENCES usuarios(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Folio de proyecto — MISMO mecanismo ya probado que generarFolio()
-- (migración 097): contador atómico por empresa vía UPDATE...RETURNING (sin
-- SELECT FOR UPDATE ni reintentos de aplicación, atómico bajo concurrencia
-- por las garantías de Postgres). Contador PROPIO (no comparte
-- siguiente_folio_cotizacion — son dos numeraciones independientes, COT- y
-- el prefijo de proyecto). `prefijo_proyecto` es configurable por empresa
-- (mismo patrón que nav_labels/color_acento) — nunca "NE" hardcodeado en
-- código, porque esta tabla la puede usar cualquier empresa. Default 'PRY'
-- si la empresa no lo configuró; Nort Energy se configura aparte con un
-- script (scripts/nort-energy-prefijo-proyecto.js), igual que ya se hizo
-- con nav_labels.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS siguiente_folio_proyecto integer NOT NULL DEFAULT 1;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS prefijo_proyecto text;

CREATE OR REPLACE FUNCTION incrementar_folio_proyecto(p_company_id uuid)
RETURNS integer
LANGUAGE sql
AS $$
  UPDATE companies
  SET siguiente_folio_proyecto = siguiente_folio_proyecto + 1
  WHERE id = p_company_id
  RETURNING siguiente_folio_proyecto - 1;
$$;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT tipo, cliente_id, sucursal_id, asesor_id, ubicacion_instalacion, numero_proyecto, config_vendida FROM proyectos LIMIT 0;
SELECT aceptada_por FROM cotizaciones LIMIT 0;
SELECT siguiente_folio_proyecto, prefijo_proyecto FROM companies LIMIT 0;
-- Confirmar que la única fila existente de proyectos quedó en 'interno' (no se pierde ni se reclasifica sola):
SELECT id, nombre, tipo FROM proyectos;
