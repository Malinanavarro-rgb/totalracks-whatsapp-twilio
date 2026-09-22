-- Datos técnicos del inmueble (auditoría 2026-09-16, Parte A — Alina,
-- 2026-09-22): "Datos técnicos del inmueble estructurados (tipo de techo,
-- orientación, sombras, área, centro de carga)" — confirmado que no existe,
-- el workflow de WhatsApp solo captura ubicación/consumo/alimentación.
--
-- Igual que la migración 103 (campos de calificación), viven en
-- `oportunidades` — es donde ya vive el resto del levantamiento técnico
-- (fecha_visita, estado_visita, paneles_estimados...), normalmente se
-- capturan en la visita técnica, no por WhatsApp. Aditivo, todas nullable,
-- cero cambio de comportamiento para empresas de otro giro.
--
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS tipo_techo                text;    -- 'concreto' | 'lámina' | 'teja' | 'losa' — texto libre, sin ENUM (mismo criterio que tipo_propiedad)
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS orientacion_techo         text;    -- 'norte' | 'sur' | 'este' | 'oeste' | 'plano' — texto libre
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS inclinacion_techo_grados  numeric;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS sombras_presentes         boolean;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS sombras_descripcion       text;    -- ej. "árbol al sur, 3pm-5pm" — libre, nunca inferido
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS area_techo_m2             numeric; -- área REAL medida en visita — distinta de infoTecnica.areaDisponibleM2 (el estimado que el cliente da por WhatsApp)
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS ubicacion_centro_carga    text;    -- ej. "fachada exterior, lado izquierdo"
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS capacidad_centro_carga_a  numeric; -- amperaje del centro de carga existente

-- Quién levantó estos datos y cuándo — mismo criterio de trazabilidad que
-- ingenieria_validada_para_cotizar_por/en: nunca implícito. Se escriben
-- juntos desde crm-ui.js::actualizarDatosInmueble(), no vía el whitelist
-- genérico de actualizarOportunidad (que un cliente del API no debe poder
-- falsificar).
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS datos_inmueble_capturado_por uuid REFERENCES usuarios(id);
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS datos_inmueble_capturado_en  timestamptz;

-- Verificación
SELECT tipo_techo, orientacion_techo, inclinacion_techo_grados, sombras_presentes, sombras_descripcion,
       area_techo_m2, ubicacion_centro_carga, capacidad_centro_carga_a, datos_inmueble_capturado_por, datos_inmueble_capturado_en
FROM oportunidades LIMIT 0;
