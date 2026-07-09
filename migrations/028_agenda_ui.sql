-- TARA Matrix™ — FASE 5 (Plataforma SaaS), Fase 4: Agenda propia de TARA
-- Migration 028: asesores.usuario_id + clientes.notas.
--
-- 1) asesores.usuario_id: vincula un asesor de agenda (ej. "Ana") con un
--    usuario del panel (login). Es la base multiusuario del SaaS, no una
--    mejora futura: permite que un rol Asesor vea/gestione solo su propia
--    agenda. Nullable — una empresa puede tener asesores sin login propio
--    (ej. un solo Owner agenda por todos). Aditivo, no toca `citas` ni el
--    write path de SchedulingEngine.
--
-- 2) clientes.notas: campo libre para alta manual de clientes desde Agenda
--    (clientes que llegan a sucursal/llamada, sin turno previo de WhatsApp).
--    Aditivo sobre `clientes` (congelada) — no se toca crm.js.
--
-- Ejecutar en Supabase SQL Editor

ALTER TABLE asesores
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);

CREATE INDEX IF NOT EXISTS idx_asesores_usuario
  ON asesores (usuario_id);

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS notas text;

-- Verificación
SELECT 'asesores.usuario_id' AS columna, COUNT(*) AS asesores_vinculados
  FROM asesores WHERE usuario_id IS NOT NULL;
