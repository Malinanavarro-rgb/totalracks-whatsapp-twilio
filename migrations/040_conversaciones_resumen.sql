-- TARA Matrix™ — Corrección del N+1 en el listado de Conversaciones
-- (Auditoría de arquitectura 2026-07, hallazgo #2 — Impacto ALTO).
--
-- Antes: listarConversaciones() traía N clientes y luego, por cada uno,
-- 2 queries adicionales (conversaciones + mensajes_humanos) para resolver
-- su "último mensaje" — 1 + 2N queries por carga de pantalla.
--
-- Ahora: una sola vista que resuelve el último mensaje de cada cliente con
-- un LEFT JOIN LATERAL (equivalente a DISTINCT ON, pero más claro con la
-- UNION de dos tablas de origen) — 1 sola query, sin importar cuántos
-- clientes tenga la empresa.
--
-- security_invoker = true: la vista corre con los privilegios de quien la
-- consulta (hoy: la sesión con anon key + JWT), no con los del dueño de la
-- vista — necesario para que, cuando se active RLS sobre clientes/
-- conversaciones/mensajes_humanos (ver auditoría, hallazgo #1, diferido),
-- la vista respete esas políticas automáticamente en vez de saltárselas.
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
) u ON true;

-- Verificación
SELECT count(*) AS total_filas FROM conversaciones_resumen;
