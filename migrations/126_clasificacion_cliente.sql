-- TARA Matrix™ — Persistencia de clasificación de conversación (Alina,
-- 2026-10-14, Nort Energy — punto 8 del plan de corrección)
-- ─────────────────────────────────────────────────────────────────────────────
-- Reutiliza el catálogo ya existente en modules/clasificacion-contexto.js —
-- la IA ya clasifica cada turno con estos 8 valores, hoy solo se loguea en
-- decision_logs y se descarta. Esto lo persiste en el cliente.
--
-- tipo_contacto_fuente distingue si la clasificación la puso la IA o un
-- empleado — una reclasificación manual ('manual') nunca se vuelve a pisar
-- con una clasificación automática ('ia') posterior (ver modules/clasificacion-cliente.js).
--
-- Nullable, sin default: los 69 clientes existentes de Nort Energy quedan
-- en NULL (sin clasificar) — cero reclasificación masiva. Se van llenando
-- orgánicamente conforme cada cliente vuelve a escribir, o cuando un
-- empleado los clasifica manualmente desde el CRM.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_contacto text
  CHECK (tipo_contacto IN (
    'prospecto', 'cliente_existente', 'proveedor', 'conversacion_personal',
    'numero_equivocado', 'spam', 'informacion_administrativa', 'contexto_insuficiente'
  ));
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_contacto_fuente text CHECK (tipo_contacto_fuente IN ('ia', 'manual'));
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_contacto_actualizado_en timestamptz;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_contacto_actualizado_por uuid;
