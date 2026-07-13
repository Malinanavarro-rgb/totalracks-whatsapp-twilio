-- TARA Matrix™ — Pivote a producto, Fase 1.3: mensajes fijos → configurables
-- Hasta hoy "fuera de horario" y "error técnico" eran strings idénticos
-- hardcodeados en server.js para todas las empresas. Se mueven a
-- `personalities` (mismo patrón que mensaje_bienvenida/firma, ya existentes)
-- para que cada empresa pueda personalizarlos desde Configuración → Personalidad.
--
-- Los defaults abajo son el texto exacto que ya usaba el código, para que
-- ninguna empresa existente note un cambio de comportamiento al correr esta
-- migración.
--
-- Ejecutar en Supabase SQL Editor

ALTER TABLE personalities
  ADD COLUMN IF NOT EXISTS mensaje_fuera_horario text NOT NULL
    DEFAULT 'Gracias por tu mensaje. En este momento estamos fuera de horario de atención — te responderemos en cuanto sea posible.',
  ADD COLUMN IF NOT EXISTS mensaje_error_tecnico text NOT NULL
    DEFAULT 'Error técnico. Intenta de nuevo.';

-- Verificación
SELECT column_name, data_type, column_default FROM information_schema.columns
  WHERE table_name = 'personalities' AND column_name IN ('mensaje_fuera_horario', 'mensaje_error_tecnico');
