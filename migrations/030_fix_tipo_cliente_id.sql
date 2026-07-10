-- TARA Matrix™ — FASE 5 (Plataforma SaaS)
-- Migration 030: corrige el tipo de mensajes_humanos.cliente_id.
--
-- ADR-006 (Ficha 360°) formaliza que todo cliente_id debe ser bigint,
-- igual que clientes.id y el resto de las tablas hijas (citas,
-- conversaciones, oportunidades, seguimientos). mensajes_humanos (migración
-- 027) se creó como integer — Postgres permite la FK cruzada sin error, no
-- es un bug, pero se corrige por consistencia. Tabla vacía (0 filas
-- confirmadas) — sin riesgo de conversión de datos.
--
-- Ejecutar en Supabase SQL Editor

ALTER TABLE mensajes_humanos
  ALTER COLUMN cliente_id TYPE bigint;

-- Verificación
SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'mensajes_humanos' AND column_name = 'cliente_id';
