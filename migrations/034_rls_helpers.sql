-- TARA Matrix™ — Corrección controlada: RLS multiempresa (Etapa "plomería")
-- Migration 034: funciones reutilizables para las políticas RLS de las
-- migraciones siguientes (035, 036, 037). Esta migración NO activa RLS en
-- ninguna tabla todavía — solo crea las funciones que las políticas usarán.
--
-- SECURITY DEFINER: evita recursión al consultar usuarios_empresas desde
-- dentro de una política de otra tabla (la función corre con los privilegios
-- de quien la definió, no reevalúa el RLS del llamador).
--
-- Ejecutar en Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.usuario_pertenece_a_empresa(empresa uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios_empresas
    WHERE usuario_id = auth.uid() AND company_id = empresa AND activo = true
  );
$$;

CREATE OR REPLACE FUNCTION public.usuario_rol_en_empresa(empresa uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT rol FROM usuarios_empresas
  WHERE usuario_id = auth.uid() AND company_id = empresa AND activo = true
  LIMIT 1;
$$;

-- Verificación (debe devolver los dos nombres de función)
SELECT routine_name FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND routine_name IN ('usuario_pertenece_a_empresa', 'usuario_rol_en_empresa');
