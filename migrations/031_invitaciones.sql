-- TARA Matrix™ — FASE 5 (Plataforma SaaS), Fase 6: Configuración de empresa
-- Migration 031: tabla invitaciones.
--
-- Alta de usuarios sin depender de crear cuentas manualmente en el
-- Dashboard de Supabase. El flujo completo (invitar → aceptar → crear
-- contraseña → vinculación automática) se implementa con auth.signUp()
-- (funciona con la anon key, sin necesidad de service_role). El único
-- hueco real: no hay proveedor de correo integrado todavía — el link de
-- invitación se muestra en pantalla para compartir manualmente. Cuando se
-- integre un proveedor de correo, solo cambia el método de envío, no el
-- flujo de aceptación (mismo token, misma tabla, mismo endpoint).
--
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS invitaciones (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES companies(id),
  nombre      text        NOT NULL,
  email       text        NOT NULL,
  rol         text        NOT NULL DEFAULT 'asesor',
  token       text        NOT NULL UNIQUE,
  estado      text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'expirada')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitaciones_company
  ON invitaciones (company_id, estado);

CREATE INDEX IF NOT EXISTS idx_invitaciones_token
  ON invitaciones (token);

-- Verificación
SELECT count(*) AS total_invitaciones FROM invitaciones;
