-- ROLLBACK de referencia para 088_ingenieria_cotizacion_fase1.sql
--
-- NO forma parte de la secuencia normal de migraciones — no se ejecuta
-- automáticamente ni tiene número de secuencia. Es un script de reversión
-- guardado para tenerlo listo si hace falta deshacer la Fase 1 completa
-- (mismo criterio que 087_rollback_demo_session_participants.sql: revertir
-- código con `git revert` y el schema con una migración de reversión
-- explícita, nunca con reset/drop improvisado).
--
-- Seguro de ejecutar en cualquier momento DESPUÉS de aplicar 088, con una
-- condición: si ya se generó una cotización real con folio y se envió al
-- cliente, ese folio y sus líneas se pierden (no hay a dónde moverlos,
-- porque son datos nuevos que 088 hizo posibles). Antes de correr esto en
-- producción, confirmar con `SELECT count(*) FROM cotizaciones WHERE folio
-- IS NOT NULL` que no hay nada que se perdería.
--
-- Orden: siempre de lo más nuevo/dependiente a lo más viejo/independiente
-- (inverso al orden de creación en 088), para no violar ninguna FK.

BEGIN;

-- 8. Deshacer columnas de plantillas_industria
ALTER TABLE plantillas_industria DROP COLUMN IF EXISTS cotizacion_campos_seed;
ALTER TABLE plantillas_industria DROP COLUMN IF EXISTS catalogo_productos_seed;

-- 7. Deshacer extensiones a tablas existentes
ALTER TABLE clientes DROP COLUMN IF EXISTS direccion;
ALTER TABLE clientes DROP COLUMN IF EXISTS codigo_postal;
ALTER TABLE clientes DROP COLUMN IF EXISTS entidad;
ALTER TABLE clientes DROP COLUMN IF EXISTS lat;
ALTER TABLE clientes DROP COLUMN IF EXISTS lng;

ALTER TABLE seguimientos DROP COLUMN IF EXISTS cotizacion_id;

ALTER TABLE proyectos DROP COLUMN IF EXISTS oportunidad_id;
ALTER TABLE proyectos DROP COLUMN IF EXISTS cotizacion_id;

-- 6. cotizacion_lineas — tabla nueva, se elimina completa
DROP TABLE IF EXISTS cotizacion_lineas;

-- 5. cotizaciones — deshacer columnas agregadas a la tabla huérfana
--    (la tabla en sí NO se borra: existía antes de 088 y setup-db.js sigue
--    esperando que exista con su forma original)
ALTER TABLE companies DROP COLUMN IF EXISTS siguiente_folio_cotizacion;

DROP INDEX IF EXISTS idx_cotizaciones_folio;
DROP INDEX IF EXISTS idx_cotizaciones_company;
DROP INDEX IF EXISTS idx_cotizaciones_cliente;

ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_estado_check;
ALTER TABLE cotizaciones ALTER COLUMN estado DROP DEFAULT;

ALTER TABLE cotizaciones DROP COLUMN IF EXISTS company_id;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS folio;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS version;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS cotizacion_padre_id;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS ejecutivo_id;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS info_tecnica;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS calculo_ingenieria_id;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS subtotal;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS iva;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS total;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS anticipo_pct;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS condiciones_comerciales;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS vigencia_dias;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS pdf_url;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS vista_en;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS aceptada_en;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS rechazada_en;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS enviada_por;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS predimensionamiento_revisado_por;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS predimensionamiento_revisado_en;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS ingenieria_validada_para_cotizar_por;
ALTER TABLE cotizaciones DROP COLUMN IF EXISTS ingenieria_validada_para_cotizar_en;

-- 4. calculos_ingenieria — tabla nueva, se elimina completa
DROP TABLE IF EXISTS calculos_ingenieria;

-- 3. parametros_ingenieria — tabla nueva, se elimina completa (con sus seeds)
DROP TABLE IF EXISTS parametros_ingenieria;

-- 2. irradiacion_regional — tabla nueva, se elimina completa
DROP TABLE IF EXISTS irradiacion_regional;

-- 1. productos — tabla nueva, se elimina completa
DROP TABLE IF EXISTS productos;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verificación post-rollback: debe devolver 0 filas.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('productos', 'irradiacion_regional', 'parametros_ingenieria', 'calculos_ingenieria', 'cotizacion_lineas');
