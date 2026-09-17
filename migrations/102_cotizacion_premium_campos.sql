-- TARA-OS — Campos faltantes para el formato de cotización premium de Nort
-- Energy (Alina, 2026-09-14): datos fiscales/CFE del cliente, descuento
-- explícito y sucursal de origen de la cotización. Aditivo, nullable, cero
-- cambio de comportamiento para cotizaciones/clientes ya existentes.
--
-- El resto de lo que pedía el formato (garantías por producto, historial de
-- consumo, ahorro acumulado a 5/10/20 años) NO requiere columnas nuevas:
-- garantías ya vive en productos.specs / paquetes_solares.garantias (jsonb
-- libre, migración 088/093), historial de consumo ya se captura y se
-- snapshotea en calculos_ingenieria.datos_entrada (migración 088), y ahorro
-- acumulado es un cálculo derivado (ver modules/motores-ingenieria/
-- paneles-solares.js::calcularAhorroAcumulado), no un dato persistido.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── clientes — datos fiscales/CFE ───────────────────────────────────────────
-- clientes.estado YA significa etapa de pipeline (migración 088) — se usa
-- `municipio`, nunca `estado`, para evitar la misma colisión de nombre.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS rfc                 text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS numero_servicio_cfe text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tarifa_cfe          text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS colonia             text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS municipio           text;

-- ── cotizaciones — descuento explícito y sucursal de origen ────────────────
-- Hoy el descuento solo vivía implícito dentro de condiciones_comerciales
-- (texto libre) o de cotizacion_lineas.descuento_pct por línea — no había
-- forma de mostrar UN descuento total de cotización sin sumarlo a mano.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_pct    numeric(5,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_monto  numeric(12,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS sucursal_id      uuid REFERENCES sucursales(id);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_sucursal ON cotizaciones(sucursal_id);

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT column_name FROM information_schema.columns
WHERE table_name = 'clientes' AND column_name IN ('rfc', 'numero_servicio_cfe', 'tarifa_cfe', 'colonia', 'municipio');
SELECT column_name FROM information_schema.columns
WHERE table_name = 'cotizaciones' AND column_name IN ('descuento_pct', 'descuento_monto', 'sucursal_id');
