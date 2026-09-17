-- TARA-OS — Panel de Usuario: Cotizaciones (Alina, 2026-08-10).
--
-- Único cambio de schema necesario para exponer el flujo de cotizaciones en
-- el panel: vincular una cotización al hilo (Inbox Inteligente, migración
-- 076) donde se originó — "conversación relacionada" del punto 4/1 de la
-- especificación. Nullable a propósito: una cotización puede no tener
-- conversación (creada manualmente desde el panel en el futuro, o —como ya
-- se confirmó en la auditoría— datos de ejemplo generados por script).
--
-- `folio` y `oportunidad_id` YA EXISTEN desde la migración 088 — no
-- requieren cambio de schema, solo el código que los llene (ver
-- modules/cotizaciones.js).
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS hilo_id uuid REFERENCES hilos(id);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_hilo ON cotizaciones(hilo_id);

-- Folio consecutivo por empresa, ATÓMICO — el comentario original de la
-- migración 088 ya pedía esto ("contador atómico, nunca MAX(folio)+1") pero
-- nunca se implementó (companies.siguiente_folio_cotizacion existe desde
-- entonces sin que nada lo lea ni lo incremente — confirmado: la cotización
-- de ejemplo que existía tenía su folio escrito a mano en un script, no
-- generado por el flujo real). Un solo UPDATE...RETURNING a nivel de
-- Postgres es atómico bajo concurrencia sin necesitar SELECT FOR UPDATE
-- explícito ni reintentos desde la aplicación.
CREATE OR REPLACE FUNCTION incrementar_folio_cotizacion(p_company_id uuid)
RETURNS integer
LANGUAGE sql
AS $$
  UPDATE companies
  SET siguiente_folio_cotizacion = siguiente_folio_cotizacion + 1
  WHERE id = p_company_id
  RETURNING siguiente_folio_cotizacion - 1;
$$;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT column_name FROM information_schema.columns WHERE table_name = 'cotizaciones' AND column_name = 'hilo_id';
