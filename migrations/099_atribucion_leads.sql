-- TARA Matrix™ — Enrutamiento por atribución de leads (Alina, 2026-08-14)
--
-- Permite que UN MISMO número de WhatsApp atienda dos contextos de negocio
-- (ej. TARA-OS informativo vs. Nort Energy / venta de paneles solares),
-- decidiendo el company_id de cada conversación por metadata verificable de
-- campaña — nunca solo por palabras del mensaje. Ver docs de la sesión
-- (aprobación de arquitectura, 2026-08-14): capa de plataforma, no toca
-- ChannelRouter/Orchestrator/WorkflowEngine/adapters congelados.
--
-- Ejecutar en Supabase SQL Editor.

-- ── campanas_landing ─────────────────────────────────────────────────────────
-- Registro de tokens válidos que una landing page externa (Google Ads,
-- landing orgánica) puede incrustar en el texto pre-llenado de un enlace
-- wa.me. Un token que NO esté aquí (inventado, copiado, manipulado) nunca
-- se trata como señal de campaña — cae al siguiente nivel de la jerarquía.

CREATE TABLE IF NOT EXISTS campanas_landing (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token            text NOT NULL UNIQUE,
  company_id       uuid NOT NULL REFERENCES companies(id),
  business_context text NOT NULL,
  campaign_name    text,
  fuente           text,
  activo           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campanas_landing DISABLE ROW LEVEL SECURITY;
-- Solo se lee/escribe desde el backend (modules/lead-atribucion.js), nunca
-- desde el navegador — mismo criterio que plantillas_industria.

-- ── atribucion_leads ─────────────────────────────────────────────────────────
-- Log de eventos de clasificación (append-only). Deliberadamente SIN
-- unicidad en `telefono` — la misma persona puede aparecer en distintas
-- campañas, contactar más de una empresa, y tener más de una conversación a
-- lo largo del tiempo. `hilo_id`/`cliente_id` se completan best-effort una
-- vez que existen (la decisión de contexto ocurre ANTES de que el hilo se
-- cree). Solo se inserta una fila cuando hay una decisión NUEVA — la
-- reutilización de contexto ya persistido (nivel 1 de la jerarquía) no
-- genera fila nueva, así la tabla no se satura y "no reclasificar
-- constantemente" queda garantizado por diseño.

CREATE TABLE IF NOT EXISTS atribucion_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono          text NOT NULL,
  company_id        uuid REFERENCES companies(id),
  hilo_id           uuid REFERENCES hilos(id),
  cliente_id        integer REFERENCES clientes(id),
  business_context  text NOT NULL,
  lead_source       text NOT NULL,
  resuelto_por      text NOT NULL
    CHECK (resuelto_por IN ('contexto_persistido', 'referral_meta', 'token_campana', 'contenido_explicito', 'fallback_default')),
  campaign_id       text,
  campaign_name     text,
  source_url        text,
  source_type       text,
  ctwa_clid         text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  gclid             text,
  fbclid            text,
  token_campana     text,
  referral_metadata jsonb,
  mensaje_texto     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atribucion_leads_telefono   ON atribucion_leads (telefono);
CREATE INDEX IF NOT EXISTS idx_atribucion_leads_hilo       ON atribucion_leads (hilo_id);
CREATE INDEX IF NOT EXISTS idx_atribucion_leads_company    ON atribucion_leads (company_id);
CREATE INDEX IF NOT EXISTS idx_atribucion_leads_created_at ON atribucion_leads (created_at);

ALTER TABLE atribucion_leads DISABLE ROW LEVEL SECURITY;
-- Solo se lee/escribe desde el backend — mismo criterio que decision_logs.
