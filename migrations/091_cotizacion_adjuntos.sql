-- TARA-OS — Fase 2 Ingeniería y Cotización: asociar adjuntos (recibo CFE)
-- sin duplicar el archivo.
--
-- Restricción explícita de Alina (2026-08-04): el recibo de CFE ya se
-- descarga y sube a Storage por la tubería existente de inbox-adjuntos.js
-- (mensajes.adjunto_url) — esta tabla NUNCA vuelve a subir el archivo, solo
-- lo REFERENCIA por `adjunto_id` (el id del mensaje que ya lo tiene). Ver
-- modules/cotizacion-adjuntos.js — no existe ninguna función de "subir" ahí,
-- solo "asociar".
--
-- `cotizacion_id` es nullable a propósito: el recibo puede llegar ANTES de
-- que exista la cotización (la sesión de workflow sigue activa, la
-- cotización se crea hasta el nodo final) — se re-ata cuando la cotización
-- se crea (ver modules/cotizacion-adjuntos.js::reatarAdjuntosASesion).
--
-- Excepción documentada a ADR-008 (freeze de adjuntos): server.js
-- ::procesarMensajeEntrante está nombrado en la tabla congelada de ese ADR.
-- El cambio aplicado ahí es puramente aditivo (un INSERT nuevo después del
-- flujo ya existente, sin tocar el orden descargar→subir→transcribir/
-- describir→sustituir contenido que ADR-008 congela) — documentado también
-- en la tabla de excepciones de ese ADR, no en silencio.

CREATE TABLE IF NOT EXISTS cotizacion_adjuntos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  adjunto_id           uuid NOT NULL REFERENCES mensajes(id), -- el mensaje que YA subió el archivo — nunca se re-sube
  workflow_session_id  uuid REFERENCES workflow_sessions(id),
  cotizacion_id        bigint REFERENCES cotizaciones(id), -- nullable: puede llegar antes de que exista la cotización
  cliente_id           bigint NOT NULL REFERENCES clientes(id),
  tipo_documento       text NOT NULL DEFAULT 'recibo_cfe',
  asociado_en          timestamptz NOT NULL DEFAULT now()
);

-- Un mensaje-adjunto solo se asocia una vez — reintentos del webhook (Meta/
-- Twilio reenvían si no reciben 200 a tiempo) nunca duplican la fila.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cotizacion_adjuntos_unico ON cotizacion_adjuntos(adjunto_id);
CREATE INDEX IF NOT EXISTS idx_cotizacion_adjuntos_sesion ON cotizacion_adjuntos(workflow_session_id);
CREATE INDEX IF NOT EXISTS idx_cotizacion_adjuntos_cotizacion ON cotizacion_adjuntos(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_cotizacion_adjuntos_company ON cotizacion_adjuntos(company_id);

ALTER TABLE cotizacion_adjuntos DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
