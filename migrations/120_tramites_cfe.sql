-- Subfase 2E — Trámites CFE (Alina, 2026-09-28, ver NORT_ENERGY_PORTAL_PLAN.md).
-- ─────────────────────────────────────────────────────────────────────────────
-- VERTICAL solar puro (CFE/medidor bidireccional/interconexión no existen
-- fuera de energía solar en México, ver plan sección 5) — pero el
-- MECANISMO (estado libre + timestamp de última actualización + alerta por
-- umbral configurable) es el mismo patrón ya usado en instalaciones/
-- ordenes_compra, nunca reinventado.
--
-- Explícitamente SIN integración directa con CFE — es seguimiento manual,
-- tal como se pidió. Los documentos del trámite (identificación,
-- comprobante de domicilio, contrato de interconexión, dictamen técnico)
-- reutilizan `documentos_cliente` con categoria='tramite_cfe' — NINGUNA
-- columna nueva ahí: documentos_cliente ya se relaciona por `cliente_id`
-- (resuelto desde el proyecto), evitando exactamente la deformación de la
-- tabla con FKs nullable de la que se advirtió explícitamente.
--
-- 10 estados libres (transición libre, no rígida — mismo criterio que
-- instalaciones.estado): pendiente → documentos_en_revision → ingresado_cfe
-- → en_revision_cfe → visita_tecnica_programada → visita_tecnica_realizada
-- → contrato_firmado → medidor_solicitado → medidor_instalado →
-- interconexion_completada. El orden es la SECUENCIA TÍPICA, nunca
-- forzada — un usuario puede saltar o retroceder según lo que realmente
-- pase con CFE.

CREATE TABLE IF NOT EXISTS tramites_cfe (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES companies(id),
  proyecto_id            uuid        NOT NULL REFERENCES proyectos(id),
  estado                 text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                             'pendiente', 'documentos_en_revision', 'ingresado_cfe', 'en_revision_cfe',
                             'visita_tecnica_programada', 'visita_tecnica_realizada', 'contrato_firmado',
                             'medidor_solicitado', 'medidor_instalado', 'interconexion_completada'
                           )),
  fecha_inicio           date,
  fecha_ingreso          date,       -- cuando se ingresó formalmente la solicitud a CFE
  ultima_actualizacion   timestamptz NOT NULL DEFAULT now(), -- se actualiza en CADA cambio (estado o cualquier campo) — es la base del badge de alerta
  responsable_id         uuid        REFERENCES usuarios(id),
  folio_cfe              text,
  medidor_bidireccional  boolean     NOT NULL DEFAULT false,
  notas                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tramites_cfe_proyecto ON tramites_cfe(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_tramites_cfe_company ON tramites_cfe(company_id, ultima_actualizacion DESC);

ALTER TABLE tramites_cfe DISABLE ROW LEVEL SECURITY;

-- Umbral de alerta configurable por empresa (mismo patrón que
-- prefijo_proyecto/prefijo_orden_compra: columna nullable, código aplica
-- un default razonable si la empresa no lo configuró — nunca un número
-- fijo enterrado en el motor).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS umbral_dias_alerta_cfe integer;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS tramites_cfe FROM tramites_cfe;
SELECT umbral_dias_alerta_cfe FROM companies LIMIT 0;
