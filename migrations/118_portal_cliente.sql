-- Portal del cliente — acceso sin contraseña por código de un solo uso
-- (Alina, 2026-09-25). Primer canal: correo (Resend). WhatsApp se agrega
-- después, cuando exista una plantilla aprobada por Meta para mensajes
-- fuera de la ventana de 24h — mismo mecanismo, otro `canal`.
--
-- Los clientes NO son `usuarios` de TARA (no tienen membresía en
-- usuarios_empresas) — por eso esto es un sistema de sesión totalmente
-- aparte, nunca mezclado con tara_session/tara_company.

CREATE TABLE IF NOT EXISTS portal_codigos_acceso (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES companies(id),
  cliente_id   bigint      NOT NULL REFERENCES clientes(id),
  -- sha256(company_id:cliente_id:código) — nunca el código en claro, ni
  -- siquiera en esta tabla interna.
  codigo_hash  text        NOT NULL,
  canal        text        NOT NULL CHECK (canal IN ('correo', 'whatsapp')),
  -- correo o teléfono al que se envió — auditoría, nunca el código.
  destino      text        NOT NULL,
  intentos     integer     NOT NULL DEFAULT 0,
  usado_en     timestamptz,
  expira_en    timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_codigos_cliente ON portal_codigos_acceso(company_id, cliente_id, created_at DESC);

ALTER TABLE portal_codigos_acceso DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_sesiones (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES companies(id),
  cliente_id   bigint      NOT NULL REFERENCES clientes(id),
  token        text        NOT NULL UNIQUE,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  expira_en    timestamptz NOT NULL,
  cerrado_en   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_portal_sesiones_token ON portal_sesiones(token);

ALTER TABLE portal_sesiones DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS portal_codigos_acceso FROM portal_codigos_acceso;
SELECT COUNT(*) AS portal_sesiones FROM portal_sesiones;
