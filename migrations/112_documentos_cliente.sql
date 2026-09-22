-- Documentos del cliente clasificados (auditoría 2026-09-16, Parte A —
-- Alina, 2026-09-22): "solo hay adjuntos crudos de chat, sin clasificar,
-- atados al hilo, no al cliente" — confirmado. Dos formas de llegar aquí:
--   1. Subida manual desde el expediente (archivo nuevo).
--   2. Clasificar un adjunto que el cliente YA mandó por WhatsApp (mensajes.
--      adjunto_url) — se referencia el archivo existente, NUNCA se
--      duplica: bucket+path apuntan al bucket original (inbox-adjuntos) en
--      vez de copiar el binario.
--
-- Por eso `bucket`/`path` van sueltos (no un solo "url") — el mismo
-- documento puede vivir en 'documentos-cliente' (subida manual) o en
-- 'inbox-adjuntos' (referenciado desde el chat).

CREATE TABLE IF NOT EXISTS documentos_cliente (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES companies(id),
  cliente_id     bigint      NOT NULL REFERENCES clientes(id),
  -- Texto libre sin ENUM, mismo criterio que el resto del repo (tipo_propiedad,
  -- tipo_documento de documentos_proveedor...) — valores esperados documentados
  -- en modules/documentos-cliente.js: foto_techo | foto_medidor |
  -- foto_centro_carga | identificacion | contrato | comprobante_pago |
  -- recibo_cfe | otro.
  categoria      text        NOT NULL,
  bucket         text        NOT NULL,
  path           text        NOT NULL,
  nombre_archivo text,
  -- 'subida_manual' | 'mensaje_inbox' — de dónde salió el archivo.
  origen         text        NOT NULL CHECK (origen IN ('subida_manual', 'mensaje_inbox')),
  mensaje_id     uuid        REFERENCES mensajes(id), -- solo si origen = 'mensaje_inbox'
  subido_por     uuid        REFERENCES usuarios(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_cliente_cliente ON documentos_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_documentos_cliente_mensaje ON documentos_cliente(mensaje_id) WHERE mensaje_id IS NOT NULL;

ALTER TABLE documentos_cliente DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT COUNT(*) AS documentos_cliente FROM documentos_cliente;
