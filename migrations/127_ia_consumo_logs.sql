-- TARA Matrix™ — Medición real de consumo de IA (Alina, 2026-10-16,
-- Fase 1 de TARA AI Engine, ver TARA_AI_ENGINE_ARCHITECTURE_V1.md sección 11)
-- ─────────────────────────────────────────────────────────────────────────────
-- Única fuente de verdad del costo real de IA por empresa/operación — hoy
-- AIProvider.calcularCosto() existe pero nunca se invoca ni se guarda en
-- ningún lado (confirmado antes de escribir esta migración). Cubre las 2
-- superficies de IA reales: el motor conversacional (Orchestrator) y Modo
-- Operador (cada iteración de tool-calling es una llamada real distinta).
--
-- Nunca contenido de conversación ni credenciales — solo metadata de costo.
-- costo_estimado_usd NULL + costo_pendiente_estimacion=true cuando el
-- proveedor no devolvió tokens suficientes para calcular — nunca se inventa
-- un importe.
CREATE TABLE IF NOT EXISTS ia_consumo_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),       -- NULL en llamadas de alcance 'plataforma' (Panel Maestro)
  organization_id uuid REFERENCES organizations(id),
  proveedor text NOT NULL,                        -- 'openai' | 'anthropic' | 'mock' | etc.
  modelo text NOT NULL,
  operacion text NOT NULL,                        -- 'conversacion' | 'modo_operador' | 'modo_operador_respuesta_cliente'
  tokens_entrada int,
  tokens_salida int,
  costo_estimado_usd numeric(10,6),
  costo_pendiente_estimacion boolean NOT NULL DEFAULT false,
  resultado text NOT NULL,                        -- 'exito' | 'fallback' | 'error'
  latencia_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ia_consumo_logs_company_fecha ON ia_consumo_logs (company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ia_consumo_logs_organization_fecha ON ia_consumo_logs (organization_id, created_at);
