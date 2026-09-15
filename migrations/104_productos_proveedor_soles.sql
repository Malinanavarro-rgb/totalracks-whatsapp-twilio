-- TARA Matrix™ — productos: procedencia de proveedor (SOLES) + separación
-- de precios (Alina, 2026-09-15 — Ficha Maestra de Proveedor, Nort Energy)
--
-- Aditivo, todas nullable, cero cambio de comportamiento para cualquier
-- empresa/producto que no las use — mismo criterio que
-- migrations/103_oportunidades_campos_solares.sql y que el patrón ya
-- probado en parametros_ingenieria (valor + fuente + fecha).
--
-- IMPORTANTE — separación estricta interno/cliente (sección 11 de la ficha
-- de Alina, "el cliente JAMÁS debe recibir el costo del proveedor o margen
-- interno"): costo_proveedor, costo_interno_nort_energy, margen,
-- costo_instalacion y costo_materiales son INTERNOS — ningún módulo que
-- arme una respuesta o cotización para el cliente debe leerlos. Enforced en
-- código (modules/catalogo-tecnico.js), no solo documentado aquí.
--
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS proveedor text;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tecnologia text;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS compatibilidad text;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS estatus_disponibilidad text;

-- Precios — normal (ya existe `precio`) + promocional + desglose de costos.
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_promocional numeric;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'MXN';

-- INTERNOS — nunca customer-facing (ver nota arriba).
ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_proveedor numeric;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_interno_nort_energy numeric;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_instalacion numeric;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_materiales numeric;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS margen numeric;

-- Procedencia del dato — mismo patrón que parametros_ingenieria.
ALTER TABLE productos ADD COLUMN IF NOT EXISTS fuente text;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS fecha_fuente date;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS verificado_en timestamptz;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS actualizado_proveedor_en timestamptz;
