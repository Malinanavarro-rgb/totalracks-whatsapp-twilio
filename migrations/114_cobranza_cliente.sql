-- Subfase 2B — Cobranza del cliente (Alina, 2026-09-22/23).
-- ─────────────────────────────────────────────────────────────────────────────
-- `pagos_cliente` — NUNCA la tabla `pagos` existente, que es exclusivamente
-- la facturación de TARA a la organización por su suscripción SaaS. Nombre
-- deliberadamente distinto para que nadie los confunda en el futuro.
--
-- Control OPERATIVO de cobranza, no contabilidad: un total vendido (snapshot
-- del proyecto), un anticipo requerido (opcional — hoy NINGUNA cotización
-- real de Nort Energy tiene `anticipo_pct` capturado, confirmado por
-- consulta directa; queda null hasta que alguien lo confirme, nunca se
-- inventa un % por default) y una bitácora de abonos 1:N. El estado se
-- DERIVA de los abonos, nunca se guarda a mano (mismo criterio que
-- cotizacion_lineas.subtotal/iva/total).

CREATE TABLE IF NOT EXISTS pagos_cliente (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES companies(id),
  proyecto_id             uuid        NOT NULL REFERENCES proyectos(id),
  cotizacion_id           bigint      REFERENCES cotizaciones(id), -- copiado de proyectos.cotizacion_id al crear, para consultar sin JOIN
  cliente_id              bigint      REFERENCES clientes(id),     -- copiado de proyectos.cliente_id, ídem
  total_vendido           numeric(12,2) NOT NULL,                  -- snapshot al crear (proyecto.config_vendida) — inmutable
  anticipo_requerido_pct  numeric(5,2),                            -- copiado de cotizaciones.anticipo_pct si existía; NULL si no se había capturado
  anticipo_requerido_monto numeric(12,2),                          -- calculado una vez al crear (pct × total_vendido); editable después vía actualizarAnticipoRequerido()
  fecha_limite_pago       date,                                    -- opcional — sin esto, el estado "vencido" nunca se activa (honesto, no inventa un plazo)
  notas                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Un solo registro de cobranza por proyecto — igual que el índice único de
-- proyectos por cotización en la migración 113, la garantía de "no
-- duplicar" vive en Postgres, no en una verificación de aplicación.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_cliente_proyecto_unico ON pagos_cliente(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente_cliente ON pagos_cliente(cliente_id) WHERE cliente_id IS NOT NULL;

ALTER TABLE pagos_cliente DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos_cliente_abonos (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES companies(id),
  pagos_cliente_id        uuid        NOT NULL REFERENCES pagos_cliente(id),
  monto                   numeric(12,2) NOT NULL CHECK (monto > 0),
  forma_pago              text,       -- 'efectivo' | 'transferencia' | 'tarjeta' | 'cheque' | 'otro' — texto libre, sin ENUM (mismo criterio que tipo_propiedad)
  referencia              text,
  fecha                   date        NOT NULL DEFAULT CURRENT_DATE,
  comprobante_documento_id uuid       REFERENCES documentos_cliente(id), -- reutiliza el expediente documental (categoría 'comprobante_pago', ya existe) — NUNCA un campo de archivo aparte
  notas                   text,
  registrado_por          uuid        REFERENCES usuarios(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagos_cliente_abonos_pagos_cliente ON pagos_cliente_abonos(pagos_cliente_id);

ALTER TABLE pagos_cliente_abonos DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS pagos_cliente FROM pagos_cliente;
SELECT COUNT(*) AS pagos_cliente_abonos FROM pagos_cliente_abonos;
