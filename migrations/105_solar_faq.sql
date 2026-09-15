-- TARA Matrix™ — solar_faq (Alina, 2026-09-15 — TARA experta en preguntas,
-- dudas y objeciones de clientes de energía solar, Nort Energy)
--
-- Base de conocimiento editable de preguntas frecuentes — "no quiero que
-- estas preguntas queden únicamente escritas en el prompt... esto
-- permitirá agregar nuevas dudas sin modificar código" (petición textual).
-- Mismo principio "config sobre código" que ya usa el resto del proyecto
-- (plantillas_industria, parametros_ingenieria, dashboard_kpis_seed).
--
-- Aditivo — tabla nueva, no toca ninguna existente. Aislada por
-- company_id, RLS deshabilitado (mismo criterio que el resto del sistema:
-- aislamiento multiempresa 100% por filtro de company_id en el código de
-- aplicación, nunca por RLS de Postgres).
--
-- Ejecutar en Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS solar_faq (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  category                text NOT NULL, -- FAQ_CFE | FAQ_AHORRO | FAQ_PANELES | FAQ_INVERSORES | FAQ_MICROINVERSORES | FAQ_BATERIAS | FAQ_INSTALACION | FAQ_GARANTIA | FAQ_MANTENIMIENTO | FAQ_SEGURIDAD | FAQ_FINANCIAMIENTO | FAQ_PRODUCCION | FAQ_CLIMA | FAQ_PRECIO | FAQ_RETORNO | FAQ_COMPARACION | FAQ_TRAMITES | FAQ_FALLA | MITO — texto libre, sin ENUM (mismo criterio que productos.tipo/pipeline_etapas.nombre)
  question                text NOT NULL,
  alternative_phrasings    text[] NOT NULL DEFAULT '{}', -- otras formas en que un cliente real pregunta lo mismo, para el matching
  simple_answer           text NOT NULL, -- Capa 1+2 de la respuesta: directa + explicación fácil, lenguaje cotidiano
  technical_answer        text, -- solo si el cliente pide profundizar — puede ser null si no aplica
  sales_followup          text, -- Capa 3: la UNA pregunta que avanza la venta, si aplica — puede ser null
  requires_current_data   boolean NOT NULL DEFAULT false, -- CFE/trámites/tarifas/regulación — nunca presentar como vigente sin verificar
  requires_customer_data  boolean NOT NULL DEFAULT false, -- la respuesta real depende de datos que aún no tenemos del cliente (consumo, techo, etc.)
  source                  text, -- de dónde salió esta respuesta (ej. "Alina, 2026-09-15 — FAQ inicial")
  verified_at             date,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solar_faq_company ON solar_faq(company_id, active);
CREATE INDEX IF NOT EXISTS idx_solar_faq_category ON solar_faq(company_id, category);

ALTER TABLE solar_faq DISABLE ROW LEVEL SECURITY;
