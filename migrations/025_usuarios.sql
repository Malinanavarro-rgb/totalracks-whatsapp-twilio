-- TARA Matrix™ — FASE 5 (Plataforma SaaS), Fase 1: Auth + Roles
-- Migration 025: usuarios + relación muchos-a-muchos con empresas.
--
-- Un usuario puede pertenecer a varias empresas, con un rol distinto en
-- cada una (ej. Owner en Total Racks, Asesor en el Salón). El id de
-- `usuarios` es el mismo id que Supabase Auth asigna en auth.users —
-- no se duplica la identidad, solo se le agrega el perfil de negocio.
--
-- Roles válidos: owner | administrador | supervisor | asesor
-- (ver docs/roadmap — matriz de permisos de la Plataforma SaaS)
--
-- Ejecutar en Supabase SQL Editor, DESPUÉS de crear el primer usuario en
-- Authentication → Users (ver instrucciones aparte para el primer login).

CREATE TABLE IF NOT EXISTS usuarios (
  id         uuid        PRIMARY KEY, -- = auth.users.id, no gen_random_uuid()
  email      text        NOT NULL UNIQUE,
  nombre     text,
  activo     boolean     NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios_empresas (
  usuario_id uuid        NOT NULL REFERENCES usuarios(id),
  company_id uuid        NOT NULL REFERENCES companies(id),
  rol        text        NOT NULL DEFAULT 'asesor',
  -- valores: owner | administrador | supervisor | asesor
  activo     boolean     NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (usuario_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_usuario
  ON usuarios_empresas (usuario_id, activo);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_company
  ON usuarios_empresas (company_id, activo);

ALTER TABLE usuarios          DISABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios_empresas DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 'usuarios + usuarios_empresas creadas' AS resultado;
