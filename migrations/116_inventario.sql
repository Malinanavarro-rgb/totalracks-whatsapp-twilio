-- Subfase 2F — Inventario (Alina, 2026-09-23/25).
-- ─────────────────────────────────────────────────────────────────────────────
-- CORE genérico (aplica a cualquier producto físico) — reutiliza `productos`
-- como catálogo (ya usado por el cotizador), NUNCA una tabla de producto
-- paralela. Diseño híbrido, aprobado explícitamente por Alina ("Existencia
-- debe derivarse correctamente de movimientos O mantenerse de manera
-- transaccional segura... implementa la fórmula de acuerdo con el modelo
-- que diseñaste"):
--
--   `inventario_movimientos` — el LEDGER: append-only, nunca se edita ni se
--   borra, cada modificación de inventario deja un movimiento con
--   usuario/fecha/tipo/referencia/observaciones (un ajuste además exige
--   `motivo`, nunca "corregir en silencio").
--
--   `inventario_saldos` — una fila por (empresa, producto, sucursal) con
--   `existencia_fisica`/`reservado` cacheados, actualizada ATÓMICAMENTE por
--   la función `registrar_movimiento_inventario()` (UPDATE con lock de fila
--   real vía SELECT...FOR UPDATE, mismo espíritu que incrementar_folio_*)
--   — así dos movimientos concurrentes del MISMO producto+sucursal se
--   serializan de verdad, nunca leen un saldo obsoleto. `disponible` se
--   calcula, nunca se guarda: existencia_fisica - reservado.
--
-- `sucursal_id` es NOT NULL aquí (a diferencia del resto del sistema, que
-- lo deja nullable) — el inventario siempre vive en un lugar; una empresa
-- sin sucursales reales configuradas necesita al menos una fila en
-- `sucursales` antes de poder usar este módulo (simplifica el diseño,
-- evita la gimnasia de índices únicos NULL-safe para este caso).

CREATE TABLE IF NOT EXISTS inventario_saldos (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES companies(id),
  producto_id       uuid        NOT NULL REFERENCES productos(id),
  sucursal_id       uuid        NOT NULL REFERENCES sucursales(id),
  existencia_fisica numeric(12,3) NOT NULL DEFAULT 0,
  reservado         numeric(12,3) NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventario_saldos_unico ON inventario_saldos(company_id, producto_id, sucursal_id);

ALTER TABLE inventario_saldos DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES companies(id),
  producto_id    uuid        NOT NULL REFERENCES productos(id),
  sucursal_id    uuid        NOT NULL REFERENCES sucursales(id),
  tipo           text        NOT NULL CHECK (tipo IN ('entrada', 'salida', 'reserva', 'liberacion', 'ajuste', 'devolucion')),
  -- Positiva para entrada/salida/reserva/liberacion/devolucion (el tipo ya
  -- define la dirección); puede ser negativa SOLO para 'ajuste' (una
  -- corrección real puede ir en cualquier sentido) — validado en
  -- modules/inventario.js, no en un CHECK (el signo depende del tipo).
  cantidad       numeric(12,3) NOT NULL CHECK (cantidad <> 0),
  proyecto_id    uuid        REFERENCES proyectos(id), -- opcional — "cuando aplique"
  usuario_id     uuid        REFERENCES usuarios(id),
  referencia     text,
  motivo         text,       -- obligatorio para 'ajuste' (validado en código), opcional para el resto
  observaciones  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_producto_sucursal ON inventario_movimientos(company_id, producto_id, sucursal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventario_movimientos_proyecto ON inventario_movimientos(proyecto_id) WHERE proyecto_id IS NOT NULL;

ALTER TABLE inventario_movimientos DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Registra un movimiento y actualiza el saldo ATÓMICAMENTE. Rechaza
-- (RAISE EXCEPTION, la transacción completa se revierte — no se inserta
-- movimiento ni se toca el saldo) si:
--   - una salida/ajuste-negativo dejaría existencia_fisica < 0
--   - una reserva dejaría disponible (existencia - reservado) < 0
--   - una liberacion dejaría reservado < 0
-- "Evitar stock negativo salvo que exista una decisión explícita futura
-- para permitirlo" (Alina) — hoy no existe esa decisión, así que se
-- rechaza siempre.
CREATE OR REPLACE FUNCTION registrar_movimiento_inventario(
  p_company_id uuid, p_producto_id uuid, p_sucursal_id uuid, p_tipo text, p_cantidad numeric,
  p_proyecto_id uuid, p_usuario_id uuid, p_referencia text, p_motivo text, p_observaciones text
) RETURNS TABLE(movimiento_id uuid, existencia_fisica numeric, reservado numeric, disponible numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  v_delta_existencia numeric := 0;
  v_delta_reservado  numeric := 0;
  v_saldo RECORD;
  v_movimiento_id uuid;
BEGIN
  IF p_tipo IN ('entrada', 'devolucion') THEN v_delta_existencia := p_cantidad;
  ELSIF p_tipo = 'salida' THEN v_delta_existencia := -p_cantidad;
  ELSIF p_tipo = 'ajuste' THEN v_delta_existencia := p_cantidad;
  ELSIF p_tipo = 'reserva' THEN v_delta_reservado := p_cantidad;
  ELSIF p_tipo = 'liberacion' THEN v_delta_reservado := -p_cantidad;
  ELSE
    RAISE EXCEPTION 'Tipo de movimiento no reconocido: %', p_tipo;
  END IF;

  INSERT INTO inventario_saldos (company_id, producto_id, sucursal_id, existencia_fisica, reservado)
  VALUES (p_company_id, p_producto_id, p_sucursal_id, 0, 0)
  ON CONFLICT (company_id, producto_id, sucursal_id) DO NOTHING;

  SELECT * INTO v_saldo FROM inventario_saldos
    WHERE company_id = p_company_id AND producto_id = p_producto_id AND sucursal_id = p_sucursal_id
    FOR UPDATE;

  IF v_saldo.existencia_fisica + v_delta_existencia < 0 THEN
    RAISE EXCEPTION 'Existencia insuficiente (física actual: %, movimiento: %)', v_saldo.existencia_fisica, p_cantidad;
  END IF;
  IF (v_saldo.existencia_fisica + v_delta_existencia) - (v_saldo.reservado + v_delta_reservado) < 0 THEN
    RAISE EXCEPTION 'Disponible insuficiente para reservar (disponible actual: %, se pidió: %)', v_saldo.existencia_fisica - v_saldo.reservado, p_cantidad;
  END IF;
  IF v_saldo.reservado + v_delta_reservado < 0 THEN
    RAISE EXCEPTION 'No hay esa cantidad reservada para liberar (reservado actual: %)', v_saldo.reservado;
  END IF;

  -- Columnas calificadas con el nombre de tabla a propósito: RETURNS TABLE(...)
  -- declara `existencia_fisica`/`reservado` también como variables de salida
  -- en todo el cuerpo de la función — sin calificar, Postgres no puede
  -- distinguir la columna de inventario_saldos de la variable de retorno
  -- (bug real encontrado en la validación en vivo, corregido aquí).
  UPDATE inventario_saldos
    SET existencia_fisica = inventario_saldos.existencia_fisica + v_delta_existencia,
        reservado = inventario_saldos.reservado + v_delta_reservado,
        updated_at = now()
    WHERE company_id = p_company_id AND producto_id = p_producto_id AND sucursal_id = p_sucursal_id;

  INSERT INTO inventario_movimientos (company_id, producto_id, sucursal_id, tipo, cantidad, proyecto_id, usuario_id, referencia, motivo, observaciones)
  VALUES (p_company_id, p_producto_id, p_sucursal_id, p_tipo, p_cantidad, p_proyecto_id, p_usuario_id, p_referencia, p_motivo, p_observaciones)
  RETURNING id INTO v_movimiento_id;

  RETURN QUERY
    SELECT v_movimiento_id, v_saldo.existencia_fisica + v_delta_existencia, v_saldo.reservado + v_delta_reservado,
           (v_saldo.existencia_fisica + v_delta_existencia) - (v_saldo.reservado + v_delta_reservado);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS inventario_saldos FROM inventario_saldos;
SELECT COUNT(*) AS inventario_movimientos FROM inventario_movimientos;
