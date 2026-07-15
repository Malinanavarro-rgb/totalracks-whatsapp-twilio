-- TARA — Motor de Agenda Universal (Fase 1)
-- Dos tablas nuevas, aditivas, sin afectar ninguna empresa existente:
--   agenda_config  — configuración de industria por empresa (terminología,
--                    umbrales de reglas), versionada (schema_version) para
--                    poder migrar el shape más adelante sin tocar filas viejas.
--   agenda_eventos — auditoría de cada recomendación de TARA: qué detectó,
--                    qué sugirió, qué hizo la usuaria y con qué resultado.
--
-- Solo Sugar Salon recibe una fila en agenda_config en esta migración —
-- Tienda Soccer y Total Racks siguen con la Agenda clásica sin cambios
-- (Agenda.jsx renderiza la vista clásica cuando GET /api/agenda/config
-- devuelve null).
--
-- Ejecutar en Supabase SQL Editor, luego:
--   NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS agenda_config (
  company_id     uuid PRIMARY KEY REFERENCES companies(id),
  schema_version integer NOT NULL DEFAULT 1,
  config         jsonb NOT NULL,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
ALTER TABLE agenda_config DISABLE ROW LEVEL SECURITY; -- mismo criterio que servicios/pipeline_etapas

CREATE TABLE IF NOT EXISTS agenda_eventos (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies(id),
  tipo_regla    text NOT NULL, -- retraso | saturacion | tiempo_muerto | riesgo_tarde | hueco_insertable | no_show_candidato
  cita_id       uuid REFERENCES citas(id),
  asesor_id     uuid REFERENCES asesores(id),
  detectado     jsonb NOT NULL,
  sugerencia    text NOT NULL,
  estado        text NOT NULL DEFAULT 'pendiente', -- pendiente | aceptada | descartada
  accion_tomada jsonb,
  resultado     text,
  created_at    timestamptz DEFAULT now(),
  resuelto_en   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_company_estado
  ON agenda_eventos (company_id, estado, created_at DESC);
ALTER TABLE agenda_eventos DISABLE ROW LEVEL SECURITY;

-- Etiqueta de las 6 clientas demo de Sugar Salon (migración 053) para poder
-- limpiarlas con un solo DELETE antes de operar en serio, sin tocar clientas
-- reales que ya lleguen por WhatsApp (el Sandbox de Twilio ya apunta aquí).
UPDATE clientes SET fuente = 'Demo'
WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e'
  AND telefono IN ('+5218112345701','+5218112345702','+5218112345703','+5218112345704','+5218112345705','+5218112345706');

-- Config real de Sugar Salon (única empresa con experiencia de Agenda universal por ahora)
INSERT INTO agenda_config (company_id, schema_version, config) VALUES (
  '5a867538-13cb-427a-8c49-d23716391f4e', 1,
  '{
    "terminologia": {
      "recurso":  {"singular": "Técnica", "plural": "Técnicas"},
      "bloque":   {"singular": "Cita",    "plural": "Citas"},
      "contacto": {"singular": "Clienta", "plural": "Clientas"}
    },
    "umbrales": {
      "citas_seguidas_saturacion": 4,
      "minutos_tiempo_muerto": 90,
      "margen_retraso_minutos": 5,
      "minutos_riesgo_anticipacion": 30,
      "hueco_insertable_min": 30,
      "hueco_insertable_max": 60,
      "no_show_minutos": 15
    },
    "reglas_prioritarias": ["retraso", "riesgo_tarde", "saturacion", "tiempo_muerto", "hueco_insertable", "no_show_candidato"]
  }'::jsonb
) ON CONFLICT (company_id) DO NOTHING;

-- Verificación
SELECT company_id, schema_version FROM agenda_config;
SELECT tipo_regla, estado FROM agenda_eventos LIMIT 5;
SELECT id, nombre, telefono, fuente FROM clientes WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' ORDER BY id;

-- ── ROLLBACK (comentado — ejecutar manualmente si hay que revertir) ─────────
-- DROP TABLE IF EXISTS agenda_eventos;
-- DROP TABLE IF EXISTS agenda_config;
-- UPDATE clientes SET fuente = 'WhatsApp' WHERE company_id = '5a867538-13cb-427a-8c49-d23716391f4e' AND fuente = 'Demo';
