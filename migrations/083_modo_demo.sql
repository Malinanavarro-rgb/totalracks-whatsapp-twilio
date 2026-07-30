-- TARA-OS — Modo Demo en Tiempo Real.
--
-- Alina pidió que el número oficial de TARA-OS pueda, durante una ventana de
-- tiempo programada y solo para un teléfono autorizado, responder como si
-- fuera una empresa demo de un giro específico (ej. "Empresa Demo Paneles
-- Solares", migración 082) — sin dejar de atender normalmente a todo el
-- resto del tráfico. Ver docs/arquitectura del Modo Demo (plan aprobado
-- 2026-07-30) para el diseño completo.
--
-- `sesiones_demo` sigue exactamente el molde de `plataforma_impersonaciones`
-- (migración 069, "entrar como admin a cualquier empresa para soporte"):
-- ventana de tiempo con iniciado_en/expira_en/finalizado_en, resuelta por la
-- capa de plataforma (modules/plataforma-demo.js) ANTES de invocar al
-- Orchestrator — cero cambios al Core congelado (ADR-005).
--
-- El índice único parcial evita que dos sesiones demo apunten al mismo
-- teléfono al mismo tiempo (ambigüedad real: ¿a qué empresa demo respondería
-- TARA?) — solo se aplica a sesiones vigentes (finalizado_en IS NULL AND
-- expira_en > now()), así que un teléfono puede reusarse en sesiones
-- futuras sin conflicto.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS sesiones_demo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),  -- la empresa demo pre-armada (ej. Empresa Demo Paneles Solares)
  admin_id          uuid NOT NULL REFERENCES usuarios(id),   -- super-admin que la activó
  authorized_phone  text NOT NULL,                            -- número del prospecto, formato E.164
  iniciado_en       timestamptz NOT NULL DEFAULT now(),
  expira_en         timestamptz NOT NULL,
  finalizado_en     timestamptz,
  resumen           jsonb,                                    -- se llena al finalizar (ver generarResumenSesion)
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sesiones_demo_phone ON sesiones_demo(authorized_phone);
CREATE INDEX IF NOT EXISTS idx_sesiones_demo_company ON sesiones_demo(company_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_demo_phone_activa
  ON sesiones_demo(authorized_phone)
  WHERE finalizado_en IS NULL;

ALTER TABLE sesiones_demo DISABLE ROW LEVEL SECURITY;

-- `companies.es_demo` — marca qué empresas son demo pre-armadas (nunca
-- clientes reales), para que el selector de "Activar demo en tiempo real"
-- del Panel Maestro solo las liste, y para excluirlas de cualquier métrica
-- agregada de negocio real a futuro (analítica, facturación). Default
-- false: ninguna empresa existente cambia de comportamiento.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS es_demo boolean NOT NULL DEFAULT false;

-- Marca la empresa demo de paneles solares ya construida (migración 082,
-- scripts/crear-empresa-demo-paneles-solares.js) como empresa demo.
UPDATE companies SET es_demo = true WHERE slug = 'vive-solar-mty';

-- Verificación
SELECT id, nombre, es_demo FROM companies WHERE es_demo = true;
SELECT count(*) AS sesiones_demo_registradas FROM sesiones_demo;
