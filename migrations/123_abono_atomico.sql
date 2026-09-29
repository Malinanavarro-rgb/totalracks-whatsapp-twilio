-- P1.1 — Corrección de race condition en cobranza (Alina, 2026-09-28,
-- ver NORT_ENERGY_AUDIT_V1.md sección 13/16/17).
-- ─────────────────────────────────────────────────────────────────────────────
-- Hallazgo real de la auditoría: modules/cobranza.js::registrarAbono hacía
-- lectura del saldo (SELECT) y luego el INSERT en dos pasos separados, sin
-- ningún lock — dos abonos concurrentes sobre el MISMO pagos_cliente_id
-- podían ambos leer el mismo saldo pendiente, ambos pasar la validación, y
-- ambos insertarse, permitiendo sobrepago real.
--
-- Corrección: misma familia de solución que registrar_movimiento_inventario()
-- (migración 116) — una función PL/pgSQL que hace SELECT...FOR UPDATE sobre
-- la fila de `pagos_cliente` (nunca sobre los abonos, que es lo que se va a
-- insertar) para que dos llamadas concurrentes con el MISMO pagos_cliente_id
-- se serialicen de verdad: la segunda espera a que la primera termine su
-- transacción, y entonces recalcula el saldo con el abono de la primera ya
-- contado. No es una transacción "manual" desde Node (dos queries seguidas
-- desde el cliente JS nunca pueden ser atómicas entre sí) — es una función
-- de una sola llamada RPC, atómica por construcción de Postgres.

CREATE OR REPLACE FUNCTION registrar_abono_cliente(
  p_company_id uuid, p_pagos_cliente_id uuid, p_monto numeric, p_forma_pago text,
  p_referencia text, p_fecha date, p_comprobante_documento_id uuid, p_notas text, p_registrado_por uuid
) RETURNS TABLE(abono_id uuid, total_pagado numeric, saldo numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_vendido numeric;
  v_total_pagado_previo numeric;
  v_saldo_previo numeric;
  v_abono_id uuid;
BEGIN
  -- Lock real de la fila madre — cualquier otra llamada concurrente con el
  -- MISMO p_pagos_cliente_id se bloquea aquí hasta que esta transacción
  -- termine (commit o rollback), momento en el que vuelve a leer el saldo
  -- YA actualizado. Esto es lo que impide el sobrepago bajo concurrencia.
  SELECT total_vendido INTO v_total_vendido
    FROM pagos_cliente
    WHERE id = p_pagos_cliente_id AND company_id = p_company_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de cobranza no encontrado';
  END IF;

  -- Recalculado DENTRO de la misma transacción/lock — nunca el valor leído
  -- antes de tomar el lock, que podría ya estar obsoleto.
  SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado_previo
    FROM pagos_cliente_abonos
    WHERE pagos_cliente_id = p_pagos_cliente_id AND company_id = p_company_id;

  v_saldo_previo := v_total_vendido - v_total_pagado_previo;

  IF p_monto > v_saldo_previo + 0.01 THEN -- tolerancia de centavo por redondeo, igual que antes
    RAISE EXCEPTION 'El abono (%) excede el saldo pendiente (%)', p_monto, v_saldo_previo;
  END IF;

  INSERT INTO pagos_cliente_abonos (company_id, pagos_cliente_id, monto, forma_pago, referencia, fecha, comprobante_documento_id, notas, registrado_por)
  VALUES (p_company_id, p_pagos_cliente_id, p_monto, p_forma_pago, p_referencia, COALESCE(p_fecha, CURRENT_DATE), p_comprobante_documento_id, p_notas, p_registrado_por)
  RETURNING id INTO v_abono_id;

  RETURN QUERY SELECT v_abono_id, v_total_pagado_previo + p_monto, v_saldo_previo - p_monto;
END;
$$;

NOTIFY pgrst, 'reload schema';
