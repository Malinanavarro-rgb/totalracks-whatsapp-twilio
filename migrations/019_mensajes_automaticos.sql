-- TARA Matrix™ — ANEXO A (TA.7) / ANEXO C adelantado (TC.3)
-- Migration 019: tabla mensajes_automaticos
-- Separación de mensajes operativos (plantilla siempre confiable) vs.
-- conversacionales (IA normal, no viven aquí). Ver Anexo, sección 4.2.1.
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS mensajes_automaticos (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  uuid        NOT NULL REFERENCES companies(id),
  tipo        text        NOT NULL,
  -- valores: confirmacion_cita | recordatorio_cita | cancelacion_cita |
  --          reprogramacion_cita | confirmacion_pago | confirmacion_pedido
  categoria   text        NOT NULL DEFAULT 'operativo',
  -- 'operativo' | 'conversacional' (los conversacionales no usan esta tabla hoy)
  plantilla   text        NOT NULL,
  -- variables soportadas: {{nombre}}, {{asesor}}, {{fecha}}, {{hora}}
  permite_ia  boolean     NOT NULL DEFAULT true,
  -- si false, nunca se intenta personalizar con IA
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_automaticos_company_tipo
  ON mensajes_automaticos (company_id, tipo, activo);

ALTER TABLE mensajes_automaticos DISABLE ROW LEVEL SECURITY;

-- Semilla: plantilla de recordatorio de cita para Total Racks (piloto).
-- Sin esta fila, TA.7 no tiene qué enviar en producción.
INSERT INTO mensajes_automaticos (company_id, tipo, categoria, plantilla, permite_ia)
VALUES (
  '8b5fb3b8-68be-446d-a925-78bc868ca8e4',
  'recordatorio_cita',
  'operativo',
  'Hola {{nombre}}, te recordamos tu cita con {{asesor}} el {{fecha}} a las {{hora}}. Si necesitas reagendar, avísanos por este medio.',
  true
);

-- Verificación
SELECT tipo, categoria, permite_ia, activo FROM mensajes_automaticos;
