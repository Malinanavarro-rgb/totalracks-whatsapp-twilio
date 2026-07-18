-- TARA — FASE 8.1: tracking de migraciones (Auditoría 2026-07, hallazgo #4).
--
-- Hasta hoy, las 61 migraciones anteriores se aplicaron a mano vía
-- copy-paste en el SQL Editor de Supabase, sin ningún registro de cuáles ya
-- corrieron (esto ya causó un incidente real: la migración 021 se aplicó
-- duplicada). A partir de FASE 8 (Plataforma Comercial — dinero real,
-- Stripe, tablas interdependientes) es el momento de empezar a registrar
-- qué se aplicó y cuándo — antes de la primera migración que toca dinero,
-- no después.
--
-- Esto NO es un runner automático (no hay una conexión Postgres directa
-- configurada, solo REST vía Supabase — ver .env) — sigue siendo copy-paste
-- manual en el SQL Editor, pero cada archivo nuevo (063+) termina con un
-- INSERT en esta tabla, así que "¿ya corrí esto?" deja de ser una pregunta
-- de memoria.

CREATE TABLE IF NOT EXISTS schema_migrations (
  archivo     text PRIMARY KEY,
  aplicada_en timestamptz NOT NULL DEFAULT now()
);

-- Backfill: registrar las migraciones ya aplicadas y que SÍ existen como
-- archivo en migrations/ (fecha real desconocida — se registran con NOW()
-- como fecha de bootstrap). Los números 033 y 035-038 nunca se crearon como
-- archivo (035-037 iban a ser las políticas RLS de migrations/034_rls_helpers.sql
-- — se dejaron a medio camino y nunca se escribieron) — no se inventan
-- registros para archivos que no existen.
INSERT INTO schema_migrations (archivo) VALUES
  ('001'), ('002'), ('003'), ('004'), ('005'), ('006'), ('007'), ('008'), ('009'), ('010'),
  ('011'), ('012'), ('013'), ('014'), ('015'), ('016'), ('017'), ('018'), ('019'), ('020'),
  ('021'), ('022'), ('023'), ('024'), ('025'), ('026'), ('027'), ('028'), ('029'), ('030'),
  ('031'), ('032'), ('034'), ('039'), ('040'),
  ('041'), ('042'), ('043'), ('044'), ('045'), ('046'), ('047'), ('048'), ('049'), ('050'),
  ('051'), ('052'), ('053'), ('054'), ('055'), ('056'), ('057'), ('058'), ('059'), ('060'),
  ('061')
ON CONFLICT (archivo) DO NOTHING;

INSERT INTO schema_migrations (archivo) VALUES ('062') ON CONFLICT (archivo) DO NOTHING;

-- Verificación
SELECT count(*) AS migraciones_registradas FROM schema_migrations;
