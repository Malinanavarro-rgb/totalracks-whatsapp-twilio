-- TARA Matrix™ — atribucion_leads.business_context nullable (Alina, 2026-08-15)
--
-- Bug real encontrado en verificación (caso 7, prueba obligatoria de
-- trazabilidad): una conversación que cae al nivel 5 (fallback_default) no
-- tiene un giro/vertical específico que atribuirle — es, por definición,
-- "orgánico, sin campaña" (lead_source ya lo refleja). Forzar NOT NULL
-- hacía fallar el INSERT justo en el caso que la regla de trazabilidad de
-- la sesión pide cubrir: un teléfono con historial de atribución que vuelve
-- a escribir sin ninguna señal nueva. Aditivo, no destructivo — ninguna fila
-- existente se pierde.
--
-- Ejecutar en Supabase SQL Editor, después de 099_atribucion_leads.sql.

ALTER TABLE atribucion_leads ALTER COLUMN business_context DROP NOT NULL;
