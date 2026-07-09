-- TARA Matrix™ — FASE 5 (Plataforma SaaS), Fase 3: Conversaciones en tiempo real
-- Migration 027: mensajes_humanos + corrección de FK clientes.asesor_id.
--
-- 1) Corrección: migración 026 apuntó clientes.asesor_id → asesores(id)
--    (la entidad de agenda, ej. "Ana" del salón). Para Fase 3, ese campo
--    debe representar qué USUARIO DEL PANEL (usuarios.id) tomó la
--    conversación — un concepto distinto. Sin datos escritos todavía
--    (todos en default), se corrige la FK sin riesgo de pérdida de datos.
--
-- 2) mensajes_humanos: tabla nueva, aditiva. No modifica `conversaciones`
--    (congelada) ni su write path (crm.js). El historial combinado se
--    arma en la API leyendo ambas tablas.
--
-- Ejecutar en Supabase SQL Editor

-- ── 1) Corregir FK de clientes.asesor_id ──────────────────────────────────────

DO $$
DECLARE
  nombre_constraint text;
BEGIN
  SELECT tc.constraint_name INTO nombre_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.table_name = 'clientes' AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'asesor_id' AND ccu.table_name = 'asesores';

  IF nombre_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE clientes DROP CONSTRAINT %I', nombre_constraint);
  END IF;
END $$;

ALTER TABLE clientes
  ADD CONSTRAINT clientes_asesor_id_usuarios_fkey
  FOREIGN KEY (asesor_id) REFERENCES usuarios(id);

-- ── 2) mensajes_humanos ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mensajes_humanos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  integer NOT NULL REFERENCES clientes(id),
  company_id  uuid NOT NULL REFERENCES companies(id),
  asesor_id   uuid REFERENCES usuarios(id),  -- null si direccion='entrante'
  direccion   text NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  contenido   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensajes_humanos_cliente
  ON mensajes_humanos (cliente_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mensajes_humanos_company
  ON mensajes_humanos (company_id);

-- Verificación
SELECT count(*) AS total_mensajes_humanos FROM mensajes_humanos;
