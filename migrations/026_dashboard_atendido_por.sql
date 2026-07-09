-- TARA Matrix™ — FASE 5 (Plataforma SaaS), Fase 2: Centro de Operaciones
-- Migration 026: clientes.atendido_por + asesor_id.
--
-- Cambio puramente aditivo sobre una tabla congelada (ADR-005/ARQUITECTURA-
-- CONGELADA): no se toca ningún write path existente (crm.js/Orchestrator
-- no cambian), solo se agregan 2 columnas nuevas con default seguro. Hoy
-- nada las escribe salvo el default — por eso el dashboard va a mostrar
-- honestamente "100% IA" hasta que Fase 3 (toma humana real) exista.
-- Ya aprobado como parte de las simplificaciones de Fase 2 (plan de
-- Plataforma TARA, sección 8, punto 3).
--
-- Ejecutar en Supabase SQL Editor

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS atendido_por text NOT NULL DEFAULT 'ia',
  -- valores: 'ia' | 'humano'
  ADD COLUMN IF NOT EXISTS asesor_id uuid REFERENCES asesores(id);
  -- quién tomó la conversación (nullable — solo aplica si atendido_por='humano')

CREATE INDEX IF NOT EXISTS idx_clientes_atendido_por
  ON clientes (company_id, atendido_por);

-- Verificación
SELECT atendido_por, COUNT(*) AS total FROM clientes GROUP BY atendido_por;
