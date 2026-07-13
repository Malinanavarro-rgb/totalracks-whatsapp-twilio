-- TARA Matrix™ — Pivote a producto, Fase 4.3: contexto de CRM en Conversaciones
-- Antes, la pantalla de Conversaciones era una vista aislada de mensajes —
-- sin score de interés ni etapa de oportunidad del cliente. Se extiende la
-- vista conversaciones_resumen (migración 040) con esos dos datos, resueltos
-- en la misma consulta (sin agregar queries por cliente).
--
-- CREATE OR REPLACE VIEW es aditivo — no rompe a listarConversaciones(),
-- que solo pedía un subconjunto de columnas.
--
-- Ejecutar en Supabase SQL Editor

CREATE OR REPLACE VIEW conversaciones_resumen
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.company_id,
  c.nombre,
  c.telefono,
  c.atendido_por,
  c.asesor_id,
  c.estado,
  c.score_interes,
  op.estado AS oportunidad_estado,
  u.texto      AS ultimo_mensaje_texto,
  u.created_at AS ultimo_mensaje_created_at
FROM clientes c
LEFT JOIN LATERAL (
  SELECT texto, created_at FROM (
    SELECT COALESCE(respuesta_tara, mensaje_cliente) AS texto, created_at
    FROM conversaciones
    WHERE cliente_id = c.id
    UNION ALL
    SELECT contenido AS texto, created_at
    FROM mensajes_humanos
    WHERE cliente_id = c.id
  ) todos
  ORDER BY created_at DESC
  LIMIT 1
) u ON true
LEFT JOIN LATERAL (
  SELECT estado
  FROM oportunidades
  WHERE cliente_id = c.id
  ORDER BY created_at DESC
  LIMIT 1
) op ON true;

-- Verificación
SELECT count(*) AS total_filas FROM conversaciones_resumen;
