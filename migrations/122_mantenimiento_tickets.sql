-- Subfase 2I — Mantenimiento / Postventa (Alina, 2026-09-28, ver
-- NORT_ENERGY_PORTAL_PLAN.md). Última pieza del bloque operativo — es la
-- subfase con MÁS reutilización de todo el bloque: checklist configurable
-- (mismo mecanismo de checklists_config que instalaciones, 2C, con
-- tipo='mantenimiento'), agenda/SchedulingEngine (mismo motor que ya usa
-- el resto de TARA, cero motor de recordatorios nuevo), asesores como el
-- "técnico" que se agenda (mismo concepto genérico, nunca una tabla
-- "tecnicos" paralela).

CREATE TABLE IF NOT EXISTS mantenimientos (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id),
  proyecto_id          uuid        NOT NULL REFERENCES proyectos(id),
  -- Texto libre sin ENUM, mismo criterio que el resto del repo: 'preventivo'
  -- | 'correctivo' | 'revision_anual' | 'otro' — documentado aquí, nunca
  -- un CHECK que obligue a tocar la DB para agregar uno.
  tipo                 text        NOT NULL,
  fecha_programada     date,
  fecha_realizada      date,
  -- Reutiliza `asesores` — es el mismo concepto de "persona que se agenda"
  -- que ya usa toda la Agenda TARA, un técnico no es distinto a un asesor
  -- desde la perspectiva del SchedulingEngine.
  tecnico_id           uuid        REFERENCES asesores(id),
  -- Snapshot al crear (mismo principio que instalaciones.checklist) desde
  -- checklists_config con tipo='mantenimiento' — nunca inventado, vacío
  -- hasta que la empresa configure su propio checklist.
  checklist            jsonb       NOT NULL DEFAULT '[]',
  -- Forma libre a propósito: las mediciones dependen del tipo de
  -- mantenimiento (voltajes, amperajes, producción del inversor...).
  mediciones           jsonb,
  proximo_mantenimiento date,
  -- La cita real creada por "programar siguiente" (nullable — un
  -- mantenimiento puede existir sin tener todavía una cita agendada).
  cita_id              uuid        REFERENCES citas(id),
  notas                text,
  registrado_por       uuid        REFERENCES usuarios(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mantenimientos_proyecto ON mantenimientos(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_mantenimientos_company ON mantenimientos(company_id, fecha_programada);

ALTER TABLE mantenimientos DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Postventa general — no todo lo que un cliente reporta es una garantía
-- (2H) o un mantenimiento: un ticket es la vía genérica para CUALQUIER
-- pendiente de postventa (duda de facturación, queja, solicitud general).
CREATE TABLE IF NOT EXISTS tickets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id),
  cliente_id          bigint      NOT NULL REFERENCES clientes(id),
  proyecto_id         uuid        REFERENCES proyectos(id),
  equipo_instalado_id uuid        REFERENCES equipos_instalados(id), -- opcional, para ligar a un equipo específico cuando aplique
  asunto              text        NOT NULL,
  -- Texto libre sin ENUM: 'tecnico' | 'facturacion' | 'garantia' | 'general'.
  categoria           text        NOT NULL,
  prioridad           text        NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
  -- Transición libre (no rígida) — mismo criterio que instalaciones.estado.
  estado              text        NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_proceso', 'esperando_cliente', 'resuelto', 'cerrado')),
  responsable_id      uuid        REFERENCES usuarios(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_company ON tickets(company_id, estado);
CREATE INDEX IF NOT EXISTS idx_tickets_cliente ON tickets(cliente_id);

ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Línea de tiempo de UN ticket — misma forma exacta que
-- garantia_reclamacion_eventos (2H): tabla dedicada, no bitacora_decisiones
-- (mezclaría con eventos de otros módulos) ni un jsonb (perdería orden).
CREATE TABLE IF NOT EXISTS ticket_eventos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES companies(id),
  ticket_id   uuid        NOT NULL REFERENCES tickets(id),
  -- Texto libre documentado: 'creado' | 'cambio_estado' | 'comentario'.
  tipo        text        NOT NULL,
  texto       text        NOT NULL,
  autor_id    uuid        REFERENCES usuarios(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_eventos_ticket ON ticket_eventos(ticket_id, created_at ASC);

ALTER TABLE ticket_eventos DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT COUNT(*) AS mantenimientos FROM mantenimientos;
SELECT COUNT(*) AS tickets FROM tickets;
SELECT COUNT(*) AS ticket_eventos FROM ticket_eventos;
