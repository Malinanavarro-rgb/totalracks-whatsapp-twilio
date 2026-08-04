-- TARA-OS — Ingeniería y Cotización, Fase 1: modelo de datos completo.
--
-- Módulo ERP de cotizaciones profesionales, empezando por paneles solares,
-- diseñado para generalizarse a otras industrias cambiando solo
-- configuración (ver docs/decisions, ADR pendiente de esta fase). Ningún
-- componente del Core congelado (ADR-005) se toca.
--
-- Precisiones técnicas exigidas por Alina (2026-08-04) sobre el motor de
-- ingeniería solar: HSP estructurado con fuente/ubicación/fecha, PR
-- configurable y registrado por cálculo, ficha técnica real de
-- panel/inversor para la selección (no solo ratio DC/AC), 3 potencias
-- separadas (requerida/instalada/AC inversor), corridas de cálculo
-- inmutables y versionadas, dos estados de aprobación humana distintos, y
-- alertas de bloqueo. Este modelo de datos existe para soportar
-- exactamente eso — ver modules/motores-ingenieria/paneles-solares.js.
--
-- ── AISLAMIENTO MULTIEMPRESA (obligatorio, revisado explícitamente) ────────
-- `productos`, `cotizaciones`, `cotizacion_lineas`, `calculos_ingenieria`:
-- SIEMPRE llevan `company_id NOT NULL` — nunca catálogo compartido entre
-- empresas. `cotizacion_lineas`/`calculos_ingenieria` lo llevan
-- DENORMALIZADO (además de colgar de `cotizacion_id`) a propósito: así el
-- aislamiento no depende de que ninguna consulta futura recuerde hacer el
-- JOIN correcto.
-- `irradiacion_regional`: SIN company_id, deliberado — es un dato físico
-- de geografía (HSP de una ubicación), no un dato de negocio; el mismo
-- valor es correcto para cualquier empresa que cotice en esa ubicación.
-- `parametros_ingenieria`: `company_id` NULLABLE por diseño — NULL es el
-- default GLOBAL versionado (PR, factor CO2); una empresa puede tener su
-- propia fila que sobre-escribe el default sin tocarlo. Índice único
-- (`idx_parametros_unico`) impide dos defaults globales o dos overrides
-- de la misma empresa para la misma clave.
--
-- RLS: como el resto del sistema hoy (ADR-013, sección de riesgos, ya
-- documentado como el riesgo de fondo más grande del proyecto), NINGUNA
-- tabla de TARA-OS tiene Row Level Security activo — el aislamiento se
-- hace en la capa de aplicación (todo query filtra explícitamente por
-- `company_id`, nunca se confía en RLS). Esta migración sigue esa MISMA
-- convención por consistencia con el resto del proyecto — no se activa
-- RLS solo para estas tablas, eso daría una falsa sensación de seguridad
-- diferente a la que tiene el resto del sistema. Ver ADR-013 para el plan
-- de fondo de resolver esto a nivel de todo TARA-OS, no tabla por tabla.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. productos — catálogo técnico versionado (físico, no agendable) ───────
-- Paralelo a `servicios` (que sigue siendo para servicios agendables) — no
-- se toca esa tabla. `specs` es jsonb porque la ficha técnica real depende
-- del `tipo` (un panel necesita potencia_wp/voc/vmp/isc/imp; un inversor
-- necesita potencia_ac_nominal_kw/rango_mppt/etc.) — mismo criterio de
-- "config, no columnas fijas" que ya usa todo el Motor Universal.

CREATE TABLE IF NOT EXISTS productos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  tipo                    text NOT NULL, -- 'panel_solar' | 'inversor' | 'bateria' | 'estructura' | 'cableado' | 'proteccion' | 'accesorio' | 'otro' — texto libre, sin ENUM (mismo criterio que pipeline_etapas.nombre)
  marca                   text,
  modelo                  text,
  sku                     text,
  descripcion             text,
  imagen_url              text,
  ficha_tecnica_url       text,   -- PDF/datasheet original del fabricante
  garantia_meses          integer,
  precio                  numeric(12,2),
  unidad                  text NOT NULL DEFAULT 'pieza',
  specs                   jsonb NOT NULL DEFAULT '{}', -- ficha técnica real, forma depende de `tipo`
  ficha_tecnica_completa  boolean NOT NULL DEFAULT false, -- se calcula, no se declara a mano (ver modules/productos-catalogo.js)
  activo                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_productos_company ON productos(company_id);
CREATE INDEX IF NOT EXISTS idx_productos_tipo ON productos(company_id, tipo);
ALTER TABLE productos DISABLE ROW LEVEL SECURITY;

-- ── 2. irradiacion_regional — HSP estructurado, nunca un número mágico ──────
-- Dato físico/geográfico público (no por empresa) — mismo HSP sirve para
-- cualquier empresa que cotice en esa ubicación. Guarda fuente y fecha
-- explícitas porque un predimensionamiento sin saber de dónde salió el HSP
-- no es auditable.

CREATE TABLE IF NOT EXISTS irradiacion_regional (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_ubicacion    text NOT NULL,
  lat                 numeric(9,6),
  lng                 numeric(9,6),
  hsp_promedio_anual  numeric(5,2) NOT NULL,
  hsp_mensual         jsonb, -- {"enero": 4.8, "febrero": 5.1, ...} — nullable, cuando no hay distribución mensual real
  fuente              text NOT NULL, -- ej. "NREL NSRDB", "SENER Atlas Solar"
  fecha_fuente        date,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_irradiacion_ubicacion ON irradiacion_regional(nombre_ubicacion);
ALTER TABLE irradiacion_regional DISABLE ROW LEVEL SECURITY;

-- ── 3. parametros_ingenieria — PR, factor CO2, ratio DC/AC: configurables, ──
-- versionados y con fuente citada. company_id NULL = default global;
-- una empresa puede sobre-escribir su propio valor sin tocar el default.

CREATE TABLE IF NOT EXISTS parametros_ingenieria (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid REFERENCES companies(id), -- NULL = default global
  industria_slug    text NOT NULL,
  clave             text NOT NULL, -- 'performance_ratio' | 'factor_emision_co2' | 'ratio_dc_ac_objetivo' | 'factor_separacion_filas'
  valor             numeric NOT NULL,
  unidad            text,
  organismo_fuente  text,
  anio_fuente       integer,
  documento_fuente  text,
  vigente_desde     date NOT NULL DEFAULT CURRENT_DATE,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Índice único real (antes solo había un índice no-único con un
-- ON CONFLICT DO NOTHING sin constraint que lo respaldara — en Postgres
-- eso FALLA en vez de ser idempotente, no "no hace nada"). COALESCE
-- normaliza company_id NULL a un uuid fijo dentro del índice, porque
-- Postgres no considera iguales dos NULL para efectos de unicidad.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parametros_unico
  ON parametros_ingenieria (industria_slug, clave, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE parametros_ingenieria DISABLE ROW LEVEL SECURITY;

-- Defaults globales versionados con fuente real (Alina, 2026-08-04) — PR y
-- factor de CO2 son REGISTROS INICIALES aquí, nunca constantes en el
-- motor (modules/motores-ingenieria/paneles-solares.js jamás hardcodea
-- 0.77 ni 0.444 — siempre los recibe como parámetro). Cada cálculo guarda
-- una copia de este valor en calculos_ingenieria.parametros_usados, así
-- que cambiar este registro después nunca altera una corrida histórica.
INSERT INTO parametros_ingenieria (company_id, industria_slug, clave, valor, unidad, organismo_fuente, anio_fuente, documento_fuente, vigente_desde)
SELECT NULL, 'paneles_solares', 'performance_ratio', 0.77, 'ratio', 'Estándar de la industria fotovoltaica', 2024, 'IEC 61724 — valor típico de referencia', CURRENT_DATE
WHERE NOT EXISTS (SELECT 1 FROM parametros_ingenieria WHERE company_id IS NULL AND industria_slug = 'paneles_solares' AND clave = 'performance_ratio');

INSERT INTO parametros_ingenieria (company_id, industria_slug, clave, valor, unidad, organismo_fuente, anio_fuente, documento_fuente, vigente_desde)
SELECT NULL, 'paneles_solares', 'factor_emision_co2', 0.444, 'kgCO2e/kWh', 'SENER/CENACE — Sistema Eléctrico Nacional', 2025, 'Factor de emisión del SEN 2025: 0.444 tCO2e/MWh', CURRENT_DATE
WHERE NOT EXISTS (SELECT 1 FROM parametros_ingenieria WHERE company_id IS NULL AND industria_slug = 'paneles_solares' AND clave = 'factor_emision_co2');

INSERT INTO parametros_ingenieria (company_id, industria_slug, clave, valor, unidad, organismo_fuente, anio_fuente, documento_fuente, vigente_desde)
SELECT NULL, 'paneles_solares', 'ratio_dc_ac_objetivo', 1.2, 'ratio', 'NREL', 2024, 'Relación nominal DC/AC de referencia (rango típico 1.1–1.3)', CURRENT_DATE
WHERE NOT EXISTS (SELECT 1 FROM parametros_ingenieria WHERE company_id IS NULL AND industria_slug = 'paneles_solares' AND clave = 'ratio_dc_ac_objetivo');

INSERT INTO parametros_ingenieria (company_id, industria_slug, clave, valor, unidad, organismo_fuente, anio_fuente, documento_fuente, vigente_desde)
SELECT NULL, 'paneles_solares', 'factor_separacion_filas', 1.4, 'ratio', 'Referencia de diseño — separación entre filas para evitar auto-sombreado', 2024, NULL, CURRENT_DATE
WHERE NOT EXISTS (SELECT 1 FROM parametros_ingenieria WHERE company_id IS NULL AND industria_slug = 'paneles_solares' AND clave = 'factor_separacion_filas');

-- ── 4. calculos_ingenieria — cada corrida es inmutable y versionada ─────────
-- Nunca se hace UPDATE de resultados — un recálculo inserta una fila nueva
-- con version+1. Guarda snapshot completo de entradas/parámetros/catálogo
-- usados, para que el cálculo histórico nunca cambie aunque el catálogo o
-- los parámetros globales cambien después.

CREATE TABLE IF NOT EXISTS calculos_ingenieria (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id), -- denormalizado a propósito: aislamiento explícito sin depender de un JOIN a cotizaciones
  cotizacion_id       bigint REFERENCES cotizaciones(id),
  version             integer NOT NULL DEFAULT 1,
  motor               text NOT NULL, -- 'paneles_solares'
  motor_version       text NOT NULL, -- semver del motor, ej. '1.0.0'
  datos_entrada       jsonb NOT NULL,  -- snapshot de info_tecnica al momento del cálculo
  parametros_usados   jsonb NOT NULL, -- {performance_ratio: {valor, fuente, anio, documento}, ...}
  catalogo_usado      jsonb NOT NULL, -- snapshot de specs de los productos elegidos (panel/inversor), no solo su id
  resultados          jsonb NOT NULL, -- los 13 resultados, incluidas las 3 potencias separadas
  alertas             jsonb NOT NULL DEFAULT '[]', -- [{tipo, severidad: 'bloqueo'|'advertencia', mensaje}]
  estado_calculo      text NOT NULL CHECK (estado_calculo IN ('completo', 'incompleto_faltan_datos', 'bloqueado')),
  ajustes_manuales    jsonb, -- qué tocó el asesor después del cálculo automático
  ajustado_por        uuid REFERENCES usuarios(id),
  calculado_en        timestamptz NOT NULL DEFAULT now(),
  calculado_por       uuid REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_calculos_cotizacion ON calculos_ingenieria(cotizacion_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_calculos_company ON calculos_ingenieria(company_id);
ALTER TABLE calculos_ingenieria DISABLE ROW LEVEL SECURITY;

-- ── 5. cotizaciones — rediseño de la tabla huérfana ya existente ───────────
-- setup-db.js ya creaba `cotizaciones` (numero_cotizacion, oportunidad_id,
-- cliente_id, precio_total, estado...) pero SIN company_id y sin uso en
-- ningún módulo — confirmado en producción con 0 filas. Se reusa el
-- nombre vía ALTER (no se crea una tabla paralela): cero riesgo, nadie la
-- usa hoy.

ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS folio text;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS cotizacion_padre_id bigint REFERENCES cotizaciones(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS ejecutivo_id uuid REFERENCES usuarios(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS info_tecnica jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS calculo_ingenieria_id uuid REFERENCES calculos_ingenieria(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS subtotal numeric(12,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS iva numeric(12,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS total numeric(12,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS anticipo_pct numeric(5,2);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS condiciones_comerciales text;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS vigencia_dias integer DEFAULT 15;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS vista_en timestamptz;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS aceptada_en timestamptz;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS rechazada_en timestamptz;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS enviada_por text; -- 'whatsapp' (correo queda para una fase futura separada)

-- Dos estados de aprobación humana DISTINTOS (Alina, punto 13): revisar el
-- cálculo automático no es lo mismo que validar la ingeniería para cotizar.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS predimensionamiento_revisado_por uuid REFERENCES usuarios(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS predimensionamiento_revisado_en timestamptz;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS ingenieria_validada_para_cotizar_por uuid REFERENCES usuarios(id);
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS ingenieria_validada_para_cotizar_en timestamptz;

ALTER TABLE cotizaciones ALTER COLUMN estado SET DEFAULT 'borrador';
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_estado_check;
ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_estado_check
  CHECK (estado IN ('borrador', 'enviada', 'vista', 'aceptada', 'rechazada', 'vencida'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_cotizaciones_folio ON cotizaciones(folio) WHERE folio IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cotizaciones_company ON cotizaciones(company_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente ON cotizaciones(cliente_id);
ALTER TABLE cotizaciones DISABLE ROW LEVEL SECURITY;

-- Folio consecutivo por empresa — contador atómico, nunca MAX(folio)+1
-- (condición de carrera real bajo concurrencia). Ver
-- modules/cotizaciones.js::generarFolio(), que hace el UPDATE...RETURNING.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS siguiente_folio_cotizacion integer NOT NULL DEFAULT 1;

-- ── 6. cotizacion_lineas — líneas de la cotización, origen explícito ───────
-- Punto 11: separar qué se calculó automático, qué se sugirió, y qué
-- agregó el asesor a mano — nunca se asume cableado/estructura/mano de
-- obra definitiva sin conocer las condiciones reales del sitio.

CREATE TABLE IF NOT EXISTS cotizacion_lineas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id), -- denormalizado a propósito: aislamiento explícito sin depender de un JOIN a cotizaciones
  cotizacion_id            bigint NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  producto_id              uuid REFERENCES productos(id),
  servicio_id              uuid REFERENCES servicios(id),
  concepto_libre           text, -- para mano de obra/transporte/permisos/otros sin catálogo
  descripcion              text NOT NULL,
  cantidad                 numeric(10,2) NOT NULL DEFAULT 1,
  precio_unitario          numeric(12,2) NOT NULL DEFAULT 0,
  descuento_pct            numeric(5,2) NOT NULL DEFAULT 0,
  subtotal                 numeric(12,2) NOT NULL DEFAULT 0,
  origen                   text NOT NULL DEFAULT 'manual' CHECK (origen IN ('calculado_automatico', 'sugerido', 'manual')),
  pendiente_levantamiento  boolean NOT NULL DEFAULT false, -- cantidad depende de medir el sitio (cableado, canalización)
  orden                    integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cotizacion_lineas_cotizacion ON cotizacion_lineas(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_cotizacion_lineas_company ON cotizacion_lineas(company_id);
ALTER TABLE cotizacion_lineas DISABLE ROW LEVEL SECURITY;

-- ── 7. Extensiones aditivas a tablas ya existentes ──────────────────────────

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS oportunidad_id bigint REFERENCES oportunidades(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS cotizacion_id bigint REFERENCES cotizaciones(id);

ALTER TABLE seguimientos ADD COLUMN IF NOT EXISTS cotizacion_id bigint REFERENCES cotizaciones(id);

-- clientes.estado YA significa etapa de pipeline ('Nuevo'/'Calificado'...)
-- — se usa `entidad` para la entidad federativa, nunca `estado`, para
-- evitar la colisión de nombre.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_postal text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS entidad text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS lat numeric(9,6);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS lng numeric(9,6);

-- ── 8. plantillas_industria — Motor Universal para este módulo ─────────────

ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS cotizacion_campos_seed jsonb;
ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS catalogo_productos_seed jsonb;

-- Verificación
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('productos', 'irradiacion_regional', 'parametros_ingenieria', 'calculos_ingenieria', 'cotizacion_lineas');
SELECT clave, valor, organismo_fuente, anio_fuente FROM parametros_ingenieria WHERE industria_slug = 'paneles_solares';
