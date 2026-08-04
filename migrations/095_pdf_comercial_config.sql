-- TARA-OS — PDF comercial de cotización (Alina, 2026-08-04): rediseño
-- completo de filosofía — de documento administrativo a documento de venta
-- que genera confianza. Misma arquitectura técnica (HTML → Puppeteer →
-- PDF → WhatsApp), contenido completamente distinto.
--
-- Reusable entre industrias: el copy específico de cada giro (título/
-- subtítulo de portada, lista de beneficios, iconos por componente) vive
-- en `plantillas_industria.cotizacion_pdf_config` — mismo patrón que
-- workflow_seed/dashboard_kpis_seed. El RESUMEN EJECUTIVO (paneles,
-- potencia, ahorro, CO2, ROI...) no es config — sale de una función nueva
-- por motor (resumenEjecutivoParaPdf en cada modules/motores-ingenieria/*),
-- mismo criterio que ya separa "mecanismo genérico" de "contenido
-- específico por industria" en todo el resto del sistema.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS correo_contacto text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sitio_web text;

-- "Forma de pago" (efectivo/transferencia/financiamiento...) — Alina la
-- pidió como campo separado de condiciones_comerciales (texto libre) y de
-- anticipo_pct (ya existe, Fase 1).
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS forma_pago text;

ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS cotizacion_pdf_config jsonb;

-- Config inicial de paneles_solares — hero, beneficios e iconos de
-- componentes. Los valores de garantías del catálogo (paquetes_solares.
-- garantias) siguen vacíos a propósito (Alina no dio números reales) —
-- el PDF muestra "Consulta con tu asesor" mientras tanto, nunca inventa
-- años de garantía.

UPDATE plantillas_industria
SET cotizacion_pdf_config = '{
  "hero": {
    "titulo": "Propuesta de Sistema Fotovoltaico",
    "subtitulo": "Solución diseñada para reducir su consumo eléctrico y maximizar el ahorro."
  },
  "beneficios": [
    {"icono": "💸", "texto": "Reduce el pago de tu recibo de CFE"},
    {"icono": "🌍", "texto": "Energía limpia y renovable"},
    {"icono": "🏠", "texto": "Incrementa el valor de tu propiedad"},
    {"icono": "📱", "texto": "Monitoreo desde tu celular"},
    {"icono": "🛡️", "texto": "Garantías de fábrica"},
    {"icono": "📈", "texto": "Sistema escalable"}
  ],
  "componentesIconos": {
    "monitoreo": "📡",
    "estructura de aluminio": "🔩",
    "instalación": "🔧",
    "material eléctrico": "🔌",
    "trámite ante cfe": "📋"
  }
}'::jsonb
WHERE slug = 'paneles_solares';

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT column_name FROM information_schema.columns WHERE table_name = 'companies' AND column_name IN ('correo_contacto', 'sitio_web');
SELECT slug, cotizacion_pdf_config IS NOT NULL AS tiene_config FROM plantillas_industria WHERE slug = 'paneles_solares';
