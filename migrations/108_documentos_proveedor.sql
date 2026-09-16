-- Centro de Conocimiento / Especialista Solar — Fase 6 (Ingesta de documentos)
-- ─────────────────────────────────────────────────────────────────────────────
-- documentos_proveedor: PDF/imagen de ficha técnica real subida por el
-- equipo — TARA propone un borrador de specs vía IA (modules/documentos-
-- proveedor.js, mismo patrón anti-alucinación que recibo-cfe.js), pero
-- NUNCA se auto-publica: queda en datos_extraidos hasta que un humano lo
-- confirme y, si aplica, lo enlace a un producto real. Archivo real vive en
-- Storage (bucket privado 'documentos-proveedor'), archivo_url guarda solo
-- el path — mismo criterio que inbox-adjuntos.js/cotizacion-pdf.js.

CREATE TABLE IF NOT EXISTS documentos_proveedor (
  id               bigserial   PRIMARY KEY,
  company_id       uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proveedor        text,
  -- ficha_tecnica | lista_precios | catalogo | garantia — texto libre sin
  -- ENUM, mismo criterio que oportunidades.estado_visita.
  tipo_documento   text        NOT NULL DEFAULT 'ficha_tecnica',
  archivo_url      text        NOT NULL,
  nombre_archivo   text,
  producto_id      bigint      REFERENCES productos(id),
  datos_extraidos  jsonb,
  procesado_en     timestamptz,
  confirmado_por   uuid        REFERENCES usuarios(id),
  confirmado_en    timestamptz,
  subido_por       uuid        REFERENCES usuarios(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE documentos_proveedor DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_documentos_proveedor_company ON documentos_proveedor(company_id);

-- Verificación
SELECT COUNT(*) AS documentos_proveedor FROM documentos_proveedor;
