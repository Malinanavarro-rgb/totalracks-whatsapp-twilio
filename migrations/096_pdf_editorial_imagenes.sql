-- TARA-OS — PDF comercial, arquitectura de imagen en 3 niveles (Alina,
-- 2026-08-04): Premium (foto propia de la empresa) → Profesional (foto de
-- stock configurada por industria) → Editorial (sin foto — tratamiento
-- tipográfico/geométrico, nunca ícono ni dibujo infantil). La plantilla
-- HTML nunca depende de que exista una imagen específica: cada bloque
-- resuelve su fuente en cascada (ver modules/cotizacion-pdf.js::
-- resolverImagenBloque) y cae a Nivel 3 si no hay nada configurado.
--
-- Ninguna empresa tiene fotos propias todavía, y no se configuró ningún
-- banco de stock — hoy el PDF se ve enteramente en Nivel 3 (editorial).
-- Estas columnas quedan listas para cuando Alina (o cualquier empresa)
-- suba fotos reales, sin tocar el diseño.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS imagen_hero_url text; -- Nivel 1: foto de portada de la empresa (instalación real, oficina, equipo)

ALTER TABLE paquetes_solares ADD COLUMN IF NOT EXISTS imagen_panel_url text;        -- Nivel 1: foto real del panel de este paquete
ALTER TABLE paquetes_solares ADD COLUMN IF NOT EXISTS imagen_inversor_url text;     -- Nivel 1: foto real del inversor/microinversor
ALTER TABLE paquetes_solares ADD COLUMN IF NOT EXISTS imagen_instalacion_url text;  -- Nivel 1: foto de un proyecto terminado con este paquete

-- Nivel 2: banco de imágenes de stock (con licencia ya resuelta por quien
-- lo configure) por industria — usado SOLO si la empresa no tiene las
-- suyas propias. Mismo patrón que cotizacion_pdf_config: dato, no código.
ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS imagenes_stock_default jsonb;

-- ── cotizacion_pdf_config, segunda iteración (Alina, 2026-08-04) ───────────
-- Filosofía de "propuesta comercial premium": beneficio primero, dato
-- técnico como pie de nota chico (nunca "710W" como titular — "Mayor
-- producción con menos espacio" como titular, "Panel de alta eficiencia"
-- como detalle). Se quitan los iconos/emoji del config anterior — el PDF
-- ya no usa ninguno, solo tipografía y geometría.

UPDATE plantillas_industria
SET cotizacion_pdf_config = '{
  "hero": {
    "titulo": "Tu nuevo sistema solar",
    "subtitulo": "Diseñado para tu hogar, pensado para tu tranquilidad."
  },
  "porQueEsteSistema": {
    "texto": "Analizamos tu consumo real y diseñamos un sistema a la medida de tu necesidad — ni de más, ni de menos."
  },
  "beneficios": [
    {"titulo": "Mayor producción con menos espacio", "detalleTecnico": "Paneles de alta eficiencia"},
    {"titulo": "Menos pago a CFE, desde el primer mes", "detalleTecnico": null},
    {"titulo": "Monitorea tu producción desde tu celular", "detalleTecnico": null},
    {"titulo": "Tu sistema puede crecer si tu consumo crece", "detalleTecnico": "Diseño escalable"},
    {"titulo": "Respaldado por garantía de fábrica", "detalleTecnico": null},
    {"titulo": "Incrementa el valor de tu propiedad", "detalleTecnico": null}
  ],
  "confianza": [
    {"titulo": "Compatible con CFE", "detalle": "Trámite de interconexión incluido"},
    {"titulo": "Monitoreo remoto", "detalle": "Producción visible en tiempo real desde tu celular"},
    {"titulo": "Tecnología certificada", "detalle": "Componentes de marcas reconocidas internacionalmente"}
  ]
}'::jsonb
WHERE slug = 'paneles_solares';

NOTIFY pgrst, 'reload schema';

-- Verificación
SELECT column_name FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'imagen_hero_url';
SELECT column_name FROM information_schema.columns WHERE table_name = 'paquetes_solares' AND column_name LIKE 'imagen_%';
SELECT column_name FROM information_schema.columns WHERE table_name = 'plantillas_industria' AND column_name = 'imagenes_stock_default';
SELECT slug, cotizacion_pdf_config FROM plantillas_industria WHERE slug = 'paneles_solares';
