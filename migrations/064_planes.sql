-- TARA — Módulo de Billing: catálogo real de planes THERA.
--
-- `es_autoservicio=false` (solo Enterprise) le indica al frontend que NO
-- debe ofrecer un flujo de compra normal — solo el botón "Solicitar
-- demostración". La suscripción Enterprise la crea un Super Admin a mano
-- (proveedor='manual') después de la conversación comercial.
--
-- `dias_prueba` (solo Launch, 30 días): junto con `perks`/`limites` iguales
-- a los de Professional ("acceso completo a Professional"), define el
-- comportamiento de la prueba gratuita. Al vencer, scripts/expirar-pruebas.js
-- pasa la suscripción a estado='expired' — el frontend, al verlo, solicita
-- la contratación de un plan (no es responsabilidad del backend decidir
-- CÓMO se lo pide al cliente).
--
-- `limites`/`perks` en jsonb: el Panel Maestro puede editar precios/features
-- sin tocar código (Constitución P2, "configuración sobre código").

CREATE TABLE planes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave             text UNIQUE NOT NULL,        -- 'launch'|'professional'|'unlimited'|'enterprise'
  nombre            text NOT NULL,
  precio_centavos   integer,                     -- NULL para enterprise (precio personalizado)
  moneda            text NOT NULL DEFAULT 'MXN',
  periodo           text NOT NULL DEFAULT 'mensual',
  es_autoservicio   boolean NOT NULL DEFAULT true,
  dias_prueba       integer,
  perks             jsonb NOT NULL DEFAULT '[]',
  limites           jsonb NOT NULL DEFAULT '{}',
  stripe_price_id   text,
  activo            boolean NOT NULL DEFAULT true,
  orden             integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO planes (clave, nombre, precio_centavos, es_autoservicio, dias_prueba, perks, limites, orden) VALUES
  ('launch', 'THERA Launch', 0, true, 30,
   '["Acceso completo a Professional", "Sin tarjeta de crédito"]'::jsonb,
   '{"max_sucursales": 2, "max_usuarios": null, "api": false, "webhooks": false}'::jsonb,
   1),
  ('professional', 'THERA Professional', 299000, true, null,
   '["1-2 sucursales", "Usuarios ilimitados", "Agenda inteligente", "CRM", "IA THERA",
     "WhatsApp Business", "Dashboard", "Reportes", "Automatizaciones", "Google Calendar",
     "Portal administrativo"]'::jsonb,
   '{"max_sucursales": 2, "max_usuarios": null, "api": false, "webhooks": false}'::jsonb,
   2),
  ('unlimited', 'THERA Unlimited', 449000, true, null,
   '["Todo Professional", "Sucursales ilimitadas", "Dashboard corporativo",
     "Comparativo entre sucursales", "Roles avanzados", "API", "Webhooks",
     "Automatizaciones ilimitadas", "Mayor capacidad de IA", "Reportes ejecutivos",
     "Soporte prioritario"]'::jsonb,
   '{"max_sucursales": null, "max_usuarios": null, "api": true, "webhooks": true}'::jsonb,
   3),
  ('enterprise', 'THERA Enterprise', null, false, null,
   '["Integraciones personalizadas", "ERP", "Desarrollo a medida", "IA personalizada",
     "Implementación", "Capacitación", "SLA", "Soporte dedicado"]'::jsonb,
   '{"max_sucursales": null, "max_usuarios": null, "api": true, "webhooks": true}'::jsonb,
   4);

-- Verificación
SELECT clave, nombre, precio_centavos, es_autoservicio, dias_prueba FROM planes ORDER BY orden;

INSERT INTO schema_migrations (archivo) VALUES ('064') ON CONFLICT (archivo) DO NOTHING;

-- ── ROLLBACK (comentado) ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS planes;
