-- TARA — FASE 8.1: plataforma_admins (rol de Super Admin, separado de
-- usuarios_empresas).
--
-- Misma identidad de Supabase Auth que el login normal — no es un sistema
-- de auth paralelo. Un usuario puede ser, con el mismo email/password,
-- tanto owner de una company real como Super Admin: son dos superficies de
-- autorización distintas (ver modules/admin-auth.js), nunca dos cuentas.
--
-- `rol` deja lugar a un futuro 'soporte' (solo lectura + impersonar, sin
-- poder cambiar planes/cobros) sin necesitar otra migración.
--
-- Seed: la cuenta real de la dueña (admin@uprise.com.mx / "Gabriel" en
-- `usuarios`) como primer y único Super Admin.

CREATE TABLE plataforma_admins (
  id          uuid PRIMARY KEY REFERENCES usuarios(id),
  rol         text NOT NULL DEFAULT 'super_admin',
  activo      boolean NOT NULL DEFAULT true,
  creado_por  uuid REFERENCES usuarios(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plataforma_admins (id, rol)
SELECT id, 'super_admin' FROM usuarios WHERE email = 'admin@uprise.com.mx'
ON CONFLICT (id) DO NOTHING;

-- Verificación
SELECT pa.id, u.email, u.nombre, pa.rol, pa.activo FROM plataforma_admins pa
  JOIN usuarios u ON u.id = pa.id;

INSERT INTO schema_migrations (archivo) VALUES ('067') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS plataforma_admins;
