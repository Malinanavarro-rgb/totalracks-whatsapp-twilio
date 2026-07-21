-- TARA-OS v0.4 — Inbox Inteligente: modelo de datos completo.
-- Ver docs/plan "TARA-OS v0.4: Inbox Inteligente" para el razonamiento
-- completo. Todo aditivo — ninguna tabla congelada por ADR-005
-- (conversaciones, y por extensión modules/crm.js) se modifica aquí.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. clientes_identidades ──────────────────────────────────────────────────
-- clientes.telefono es UNIQUE NOT NULL hoy — asume que todo cliente se
-- identifica por teléfono. Facebook/Instagram usan PSID/IGSID, Correo un
-- email, Web Chat un token de sesión. Esta tabla desacopla "quién es el
-- cliente" de "por dónde escribió" sin tocar clientes.telefono para el
-- camino de WhatsApp (modules/crm.js::obtenerOCrearCliente, congelado,
-- sigue igual).

ALTER TABLE clientes ALTER COLUMN telefono DROP NOT NULL;
-- Aditivo y seguro: ninguna fila existente pierde su teléfono, solo deja de
-- ser obligatorio para clientes nuevos que lleguen por un canal sin teléfono.

CREATE TABLE IF NOT EXISTS clientes_identidades (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    bigint      NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  canal         text        NOT NULL,
  identificador text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canal, identificador)
);

CREATE INDEX IF NOT EXISTS idx_clientes_identidades_cliente ON clientes_identidades (cliente_id);

ALTER TABLE clientes_identidades DISABLE ROW LEVEL SECURITY;

-- ── 2. sucursales ─────────────────────────────────────────────────────────────
-- Nivel nuevo DENTRO de una empresa (una empresa con varias ubicaciones
-- físicas) — no existía en absoluto. Todo nullable en las tablas que la
-- referencian: una empresa sin sucursales sigue funcionando idéntico.

CREATE TABLE IF NOT EXISTS sucursales (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES companies(id),
  nombre     text        NOT NULL,
  activo     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sucursales_company ON sucursales (company_id, activo);

ALTER TABLE sucursales DISABLE ROW LEVEL SECURITY;

ALTER TABLE channel_endpoints ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES sucursales(id);
ALTER TABLE usuarios_empresas ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES sucursales(id);

-- ── 3. hilos ──────────────────────────────────────────────────────────────────
-- La pieza central que hoy no existe: agrupa mensajes en una conversación
-- real, con ciclo de vida (estado/prioridad/etiquetas/asignación) — nada de
-- esto existe hoy a nivel conversación (solo "estado" de lead en clientes,
-- que es un concepto de CRM distinto y se mantiene sin tocar).

CREATE TABLE IF NOT EXISTS hilos (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES companies(id),
  cliente_id             bigint      NOT NULL REFERENCES clientes(id),
  canal                  text        NOT NULL,
  proveedor              text        NOT NULL,
  sucursal_id            uuid        REFERENCES sucursales(id),
  estado                 text        NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada', 'seguimiento')),
  prioridad              text        NOT NULL DEFAULT 'normal'  CHECK (prioridad IN ('baja', 'normal', 'alta', 'urgente')),
  etiquetas              text[]      NOT NULL DEFAULT '{}',
  asesor_id              uuid        REFERENCES usuarios(id),
  ultimo_mensaje_preview text,
  ultimo_mensaje_at      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hilos_company_estado    ON hilos (company_id, estado, ultimo_mensaje_at DESC);
CREATE INDEX IF NOT EXISTS idx_hilos_company_prioridad  ON hilos (company_id, prioridad);
CREATE INDEX IF NOT EXISTS idx_hilos_cliente            ON hilos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_hilos_asesor             ON hilos (asesor_id);

ALTER TABLE hilos DISABLE ROW LEVEL SECURITY;

-- ── 4. mensajes ───────────────────────────────────────────────────────────────
-- Fuente de verdad del Inbox hacia adelante — con soporte real de adjuntos
-- (hoy no existe en ningún lado: Meta descarta silenciosamente todo lo que
-- no es texto/botón, Twilio ni siquiera captura las MediaUrl que manda).
-- La capa de plataforma escribe aquí ADEMÁS de lo que el Core ya escribe en
-- `conversaciones` (congelada) — escritura doble deliberada, ver plan.

CREATE TABLE IF NOT EXISTS mensajes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hilo_id        uuid        NOT NULL REFERENCES hilos(id) ON DELETE CASCADE,
  company_id     uuid        NOT NULL REFERENCES companies(id),
  direccion      text        NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  remitente_tipo text        NOT NULL CHECK (remitente_tipo IN ('cliente', 'ia', 'humano')),
  tipo_contenido text        NOT NULL DEFAULT 'texto' CHECK (tipo_contenido IN ('texto', 'imagen', 'audio', 'video', 'documento', 'ubicacion')),
  contenido      text,
  adjunto_url    text,
  adjunto_mime   text,
  reacciones     jsonb       NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_hilo ON mensajes (hilo_id, created_at);

ALTER TABLE mensajes DISABLE ROW LEVEL SECURITY;

-- ── 5. analisis_hilo ──────────────────────────────────────────────────────────
-- Lo que alimenta el Panel Inteligente. Upsert por hilo — siempre 1 fila con
-- el análisis más reciente, nunca crece sin límite.

CREATE TABLE IF NOT EXISTS analisis_hilo (
  hilo_id             uuid        PRIMARY KEY REFERENCES hilos(id) ON DELETE CASCADE,
  resumen             text,
  intencion           text,
  sentimiento         text,
  probabilidad_compra integer     CHECK (probabilidad_compra BETWEEN 0 AND 100),
  urgencia            text        CHECK (urgencia IN ('baja', 'media', 'alta')),
  riesgos             jsonb       NOT NULL DEFAULT '[]',
  recomendaciones     jsonb       NOT NULL DEFAULT '[]',
  proxima_accion      text,
  tareas_sugeridas     jsonb       NOT NULL DEFAULT '[]',
  generado_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analisis_hilo DISABLE ROW LEVEL SECURITY;

-- ── 6. documentos ↔ hilo/cliente (Modo Operador, v0.7) ───────────────────────
-- Hoy `documentos` no se relaciona con ninguna conversación — se agrega
-- para "documentos relacionados" del Panel Inteligente.

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS hilo_id uuid REFERENCES hilos(id);
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS cliente_id bigint REFERENCES clientes(id);

CREATE INDEX IF NOT EXISTS idx_documentos_hilo ON documentos (hilo_id);
CREATE INDEX IF NOT EXISTS idx_documentos_cliente ON documentos (cliente_id);

-- Verificación
SELECT 'clientes_identidades' AS tabla, COUNT(*) FROM clientes_identidades
UNION ALL SELECT 'sucursales',    COUNT(*) FROM sucursales
UNION ALL SELECT 'hilos',        COUNT(*) FROM hilos
UNION ALL SELECT 'mensajes',     COUNT(*) FROM mensajes
UNION ALL SELECT 'analisis_hilo', COUNT(*) FROM analisis_hilo;
