-- TARA — Fix crítico: clientes.telefono era único GLOBALMENTE, no por
-- empresa. En un SaaS multi-tenant, el mismo número de teléfono debe poder
-- ser cliente de dos empresas distintas (un mismo celular de prueba usado
-- para Total Racks y Tienda Soccer, o simplemente una persona real que le
-- escribe a dos negocios distintos que usan TARA).
--
-- Sin este fix: en cuanto un teléfono ya registrado en la Empresa A le
-- escribe a la Empresa B, el INSERT de modules/crm.js::obtenerOCrearCliente
-- falla por "duplicate key value violates unique constraint
-- clientes_telefono_key", la función devuelve null, y el webhook responde
-- con el mensaje de error técnico genérico — exactamente lo que pasó hoy
-- probando Tienda Soccer con un teléfono que ya era cliente de Total Racks.
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_telefono_key;
ALTER TABLE clientes ADD CONSTRAINT clientes_telefono_company_key UNIQUE (telefono, company_id);

-- Verificación
SELECT conname FROM pg_constraint WHERE conrelid = 'clientes'::regclass AND contype = 'u';
