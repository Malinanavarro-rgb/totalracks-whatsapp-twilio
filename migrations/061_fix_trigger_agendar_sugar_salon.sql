-- TARA — Fix: el workflow "Agendar servicio de salón" de Sugar Salon nunca
-- se activaba en conversaciones reales.
--
-- Diagnóstico: el workflow se creó (2026-07-13) copiando el patrón de la
-- empresa sintética original de Anexo B (migración 024), que usó la
-- intención 'solicitud_cotizacion' como disparador. En la práctica, la IA
-- clasifica los mensajes reales de agendado de un salón de belleza (precios
-- fijos, sin negociación) como 'interes_compra' — nunca como
-- 'solicitud_cotizacion'. El trigger nunca hacía match, así que el workflow
-- nunca se activaba y la conversación corría en modo libre, donde TARA no
-- tiene forma de ejecutar un agendado real (solo puede proponer
-- 'crear_oportunidad') — por eso confirmaba una cita en el texto de
-- respuesta sin que existiera ninguna fila real en `citas`.
--
-- Ya aplicado en producción vía script el 2026-07-17 — este archivo es el
-- registro para auditoría/reproducibilidad, mismo criterio que la
-- migración 059.

UPDATE workflows
  SET trigger_value = 'interes_compra'
  WHERE id = 'd85a3fc3-edf5-4130-8af0-be3a2888df8a'
    AND trigger_value = 'solicitud_cotizacion';

-- Verificación
SELECT id, nombre, trigger, trigger_value FROM workflows
  WHERE id = 'd85a3fc3-edf5-4130-8af0-be3a2888df8a';
