-- TARA — Empresa demo "Bella Studio Salón & Spa" para demos en vivo con
-- prospectos reales (vendedora), giro salón de belleza/spa/uñas.
--
-- Registro de auditoría — todo esto ya se ejecutó en producción vía
-- scripts/crear-empresa.js + scripts/seed-demo-bella-studio.js (mismo
-- criterio que la migración 053). No hay cambios de esquema aquí; es
-- documentación de los datos + de dos bugs reales corregidos de paso.
--
-- company_id:      ce1d7f89-c175-434b-9634-386fc7b59322
-- organization_id: b1780b92-03ef-4b52-af4d-8d06e8083700
--
-- ── Bugs reales corregidos en el camino ─────────────────────────────────────
--
-- 1. plantillas_industria.salon_belleza traía workflow_seed.trigger_value =
--    'solicitud_cotizacion' — el mismo bug ya diagnosticado y corregido para
--    Sugar Salon en la migración 061: la IA clasifica un agendado de salón
--    (precios fijos, sin negociación) como 'interes_compra', nunca como
--    'solicitud_cotizacion'. Cualquier empresa nueva creada desde esta
--    plantilla heredaba un workflow que jamás se activaba. Corregido en la
--    FUENTE (la fila de plantillas_industria), no solo para esta empresa —
--    de aquí en adelante ninguna empresa nueva de este giro hereda el bug.
--
-- 2. personalities.reglas se guardaba como array de strings planos en vez
--    de objetos {texto, etapas} (formato real que espera
--    context-builder.js:250-256). Con strings, `r.texto` es undefined y la
--    regla se descarta en silencio — nunca llegaba al prompt. Afectaba tanto
--    a la plantilla salon_belleza como a la otra empresa demo de salón ya
--    existente (5a867538-13cb-427a-8c49-d23716391f4e), corregida también de
--    paso.
--
-- ── Qué queda seeded ─────────────────────────────────────────────────────
--
-- - personalities: asistente "Sofía", + 4 reglas de negocio en formato
--   correcto — sugerir servicio complementario, no mencionar precios de
--   forma proactiva, upsell de una promoción tras confirmar cita (sin tocar
--   duración/horario agendado), y calidad conversacional (no repetir
--   preguntas, no sonar a IA).
-- - knowledge_base: sección SERVICIOS con precios reales.
-- - servicios: Manicure clásico ($150/30min), Manicure en gel ($250/45min),
--   Pedicure spa ($350/60min), Uñas acrílicas ($450/90min).
-- - pipeline_etapas: Nuevo, Cita agendada, Atendido, Recurrente, Perdido.
-- - workflow "Agendar servicio de salón" (trigger_value corregido a
--   interes_compra) con acción agendar_cita_con_horario_solicitado — el
--   manejo de conflicto/horario alternativo (orchestrator.js) ya funciona
--   automáticamente, cero código nuevo.
-- - asesores: "Ana" (activa).
-- - horarios_laborales: lunes a sábado 09:00–19:00 (domingo cerrado).
-- - clientes: 5 clientas demo (Karla, Valeria, Fernanda, Daniela, Sofía) en
--   distintas etapas del pipeline.
-- - citas: 1 agendada para mañana (sin confirmar, visible en Agenda hoy
--   mismo), 1 confirmada a 2 días, 2 completadas en el historial. Sofía
--   queda sin cita — prospecto nuevo que apenas escribió.
--
-- ── Pendiente (fuera del alcance de este script, requiere acción externa) ──
--
-- - Conectar un número real de WhatsApp Business (Meta) vía
--   scripts/conectar-empresa-meta.js + un INSERT manual en
--   channel_endpoints (endpoint=phone_number_id, proveedor='meta',
--   canal='whatsapp', activo=true) — ver ADR-007. Sin el segundo paso el
--   webhook recibe el mensaje pero no encuentra empresa.
-- - Crear el acceso (usuarios_empresas, rol a definir) de la vendedora a
--   esta empresa.

-- Verificación
SELECT nombre, industria_slug, organization_id FROM companies WHERE id = 'ce1d7f89-c175-434b-9634-386fc7b59322';
SELECT trigger_value FROM workflows WHERE company_id = 'ce1d7f89-c175-434b-9634-386fc7b59322';
SELECT reglas FROM personalities WHERE company_id = 'ce1d7f89-c175-434b-9634-386fc7b59322';
SELECT nombre, activo FROM asesores WHERE company_id = 'ce1d7f89-c175-434b-9634-386fc7b59322';
SELECT c.nombre, c.estado, ci.inicio, ci.estado AS estado_cita
  FROM clientes c LEFT JOIN citas ci ON ci.cliente_id = c.id
  WHERE c.company_id = 'ce1d7f89-c175-434b-9634-386fc7b59322'
  ORDER BY c.nombre;
