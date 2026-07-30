-- TARA-OS — Nueva plantilla de industria: paneles_solares.
--
-- Motivación: Alina pidió una empresa de ejemplo de paneles solares para
-- usar en demostraciones de venta de TARA-OS ("Empresas demo pre-armadas
-- por giro"). Se construye como una fila real de plantillas_industria — el
-- mismo mecanismo del Motor Universal que ya usan salon_belleza/
-- uniformes_deportivos (migraciones 044/080) — no como un script aparte ni
-- una improvisación en el momento de la demo. Así queda reusable no solo
-- para demos, sino para cualquier cliente real de paneles solares que se
-- registre después (palabras_clave activa la detección automática en
-- modules/plantillas-industria.js).
--
-- Diseño: giro híbrido, a diferencia de los 2 existentes. Como salón de
-- belleza, requiere_agenda=true (la venta empieza con una visita técnica
-- agendada). Como uniformes deportivos, también define pipeline_etapas_seed
-- (después de la visita, el trato se cotiza y se cierra como una venta de
-- monto alto — sí vale la pena rastrearlo como oportunidad, a diferencia de
-- un corte de cabello). El nodo final del workflow dispara AMBAS acciones
-- (agendar_cita_con_horario_solicitado + crear_oportunidad) — confirmado en
-- modules/orchestrator.js::_ejecutarAcciones que un nodo admite un arreglo
-- de acciones, cada una despachada por su propio handler de ActionRunner.
--
-- cotizacion_config se deja NULL a propósito (no es un descuido): una
-- cotización real de paneles depende de una evaluación técnica en sitio
-- (consumo, espacio, orientación del techo) — no se puede estimar con la
-- fórmula genérica de modules/cotizador.js (cantidad × rango de precio de
-- catálogo), que sí tiene sentido para uniformes pero daría un número falso
-- aquí. Dejar la columna nula apaga la función correctamente para este giro.
--
-- personalidad.reglas usa el formato correcto [{texto, etapas}] desde el
-- inicio — a diferencia de la plantilla uniformes_deportivos (migración 044),
-- que guarda reglas como strings planos. context-builder.js espera objetos
-- con .texto (ver módulos/context-builder.js:250-256); con strings, r.texto
-- es undefined y la regla se descarta en silencio, nunca llega al prompt
-- real (mismo bug que scripts/seed-demo-bella-studio.js tuvo que corregir
-- para salon_belleza). No se corrige aquí la plantilla de uniformes —fuera
-- de alcance de este cambio— pero queda documentado como deuda conocida.
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

INSERT INTO plantillas_industria (
  slug, nombre_visible, palabras_clave, requiere_agenda,
  personalidad, knowledge_base_seed, servicios_seed, pipeline_etapas_seed, workflow_seed,
  industria_padre, dashboard_kpis_seed, cotizacion_config, ui_config
) VALUES (
  'paneles_solares',
  'Paneles Solares',
  ARRAY['panel solar', 'paneles solares', 'energia solar', 'energía solar', 'fotovoltaico', 'fotovoltaica', 'celda solar', 'celdas solares', 'cfe', 'ahorro de luz', 'luz solar'],
  true,
  '{
    "nombre_asistente": "Lucía",
    "cargo": "Asesora de energía solar",
    "tono": "cercano, confiable y con conocimiento técnico explicado en simple",
    "objetivo": "Calificar al prospecto (tipo de propiedad y consumo eléctrico mensual) y agendar una visita técnica gratuita para cotizar su sistema solar.",
    "idioma": "es",
    "zona_horaria": "America/Monterrey",
    "modelo": "gpt-4o-mini",
    "temperatura": 0.7,
    "max_tokens": 500,
    "campos_requeridos": ["tipo_propiedad", "consumo_mensual_cfe"],
    "reglas": [
      {"texto": "Siempre pregunta el monto promedio del recibo de CFE (o el consumo en kWh) antes de hablar de precios — sin ese dato no se puede dimensionar el sistema.", "etapas": []},
      {"texto": "Nunca prometas un porcentaje de ahorro exacto ni un descuento sin que la visita técnica lo confirme — habla de rangos, no de cifras cerradas.", "etapas": []},
      {"texto": "La cotización final siempre depende de la visita técnica gratuita — jamás cierres un precio por chat.", "etapas": []}
    ],
    "mensaje_bienvenida": "¡Hola! Soy Lucía, asesora de energía solar. Cuéntame si buscas paneles para tu casa o tu negocio, y con gusto te oriento.",
    "firma": "",
    "mensaje_fuera_horario": "Gracias por tu mensaje. En este momento estamos fuera de horario de atención — te responderemos en cuanto sea posible.",
    "mensaje_error_tecnico": "Error técnico. Intenta de nuevo."
  }'::jsonb,
  '[
    {"categoria": "BENEFICIOS", "contenido": "Un sistema solar bien dimensionado puede reducir el recibo de CFE hasta en un 90%. El ahorro exacto depende del consumo actual, el espacio disponible en el techo y su orientación — por eso siempre se confirma con una visita técnica."},
    {"categoria": "PROCESO", "contenido": "El proceso inicia con una visita técnica gratuita para evaluar el consumo eléctrico y el espacio disponible. Con esos datos se entrega una cotización formal, y una vez aprobada, la instalación toma entre 1 y 3 días según el tamaño del sistema."},
    {"categoria": "FINANCIAMIENTO", "contenido": "Ofrecemos planes de financiamiento a 12, 24 y 36 meses, además de pago de contado con descuento. El plan de pagos mensual generalmente se compensa con el ahorro en el recibo de CFE."},
    {"categoria": "GARANTIA", "contenido": "Los paneles solares tienen garantía de 25 años de rendimiento y los inversores 10 años. El mantenimiento es mínimo — principalmente limpieza periódica de los paneles."}
  ]'::jsonb,
  '[
    {"nombre": "Visita técnica residencial", "descripcion": "Evaluación gratuita de consumo y espacio disponible para una casa habitación.", "precio": 0, "duracion_minutos": 60},
    {"nombre": "Visita técnica comercial/industrial", "descripcion": "Evaluación gratuita de consumo y espacio disponible para un negocio o planta.", "precio": 0, "duracion_minutos": 90}
  ]'::jsonb,
  '[
    {"nombre": "Nuevo", "orden": 0},
    {"nombre": "Calificado", "orden": 1},
    {"nombre": "Visita agendada", "orden": 2},
    {"nombre": "Cotización enviada", "orden": 3},
    {"nombre": "Cerrado", "orden": 4},
    {"nombre": "Perdido", "orden": 5}
  ]'::jsonb,
  '{
    "nombre": "Calificación y agenda de visita técnica solar",
    "descripcion": "Descubrimiento comercial: tipo de propiedad, consumo eléctrico, y agenda de la visita técnica gratuita.",
    "trigger_value": "solicitud_cotizacion",
    "nodos": [
      {"nombre": "preguntar_tipo_propiedad", "es_inicio": true, "es_fin": false, "pregunta": "¿Los paneles serían para tu casa o para un negocio?", "campo": "tipo_propiedad", "es_opcional": false, "siguiente_nodo": "preguntar_consumo", "modo_respuesta": "prepend_ai", "acciones": [], "orden": 1},
      {"nombre": "preguntar_consumo", "es_inicio": false, "es_fin": false, "pregunta": "¿Cuánto pagas aproximadamente al bimestre en tu recibo de CFE?", "campo": "consumo_mensual_cfe", "es_opcional": false, "siguiente_nodo": "preguntar_ubicacion", "modo_respuesta": "replace_ai", "acciones": [], "orden": 2},
      {"nombre": "preguntar_ubicacion", "es_inicio": false, "es_fin": false, "pregunta": "¿En qué ciudad se encuentra la propiedad?", "campo": "ubicacion", "es_opcional": false, "siguiente_nodo": "preguntar_hora_preferida", "modo_respuesta": "replace_ai", "acciones": [], "orden": 3},
      {"nombre": "preguntar_hora_preferida", "es_inicio": false, "es_fin": true, "pregunta": "¿Qué día y hora te queda bien para la visita técnica gratuita?", "campo": "hora_preferida", "es_opcional": false, "siguiente_nodo": null, "modo_respuesta": "replace_ai", "acciones": [{"tipo": "agendar_cita_con_horario_solicitado", "parametros": {"duracionMinutos": 60}}, {"tipo": "crear_oportunidad", "parametros": {}}], "orden": 4}
    ]
  }'::jsonb,
  'energia_renovable',
  '{
    "kpis": [
      {"tipo": "conteo_citas_rango", "etiqueta": "Visitas técnicas hoy", "params": {"rango": "hoy", "estados": ["agendada", "confirmada"]}},
      {"tipo": "conteo_citas_sin_confirmar", "etiqueta": "Confirmaciones pendientes", "params": {"horas_ventana": 48}},
      {"tipo": "conteo_oportunidades_por_estado", "etiqueta": "Prospectos nuevos", "params": {"estado": "Nuevo"}},
      {"tipo": "conteo_oportunidades_por_estado", "etiqueta": "Cotizaciones enviadas", "params": {"estado": "Cotización enviada"}},
      {"tipo": "suma_oportunidades_mes", "etiqueta": "Ventas cerradas este mes", "params": {"estado": "Cerrado", "campo": "presupuesto_confirmado", "formato": "moneda"}}
    ],
    "recomendaciones": [
      {"tipo": "cita_sin_confirmar_ventana", "params": {"horas": 48, "severidad": "critica"}},
      {"tipo": "oportunidad_estancada", "params": {"estado": "Cotización enviada", "horas": 72, "severidad": "critica", "mensaje": "{cliente} lleva más de 72 horas sin seguimiento tras su cotización.", "detalle": "Cotización enviada sin respuesta.", "accion": "Dar seguimiento ahora"}},
      {"tipo": "oportunidad_en_estado", "params": {"estado": "Visita agendada", "severidad": "info", "mensaje": "Prepara la cotización de {cliente} tras su visita técnica.", "detalle": "Visita técnica agendada.", "accion": "Ver detalle"}}
    ],
    "panel_ventas": true
  }'::jsonb,
  NULL,
  '{
    "modulos": [
      {"ruta": "/operaciones",    "etiqueta": "Inicio",         "icono": "inicio",         "habilitado": true},
      {"ruta": "/conversaciones", "etiqueta": "Conversaciones", "icono": "conversaciones", "habilitado": true},
      {"ruta": "/inbox",          "etiqueta": "Inbox",          "icono": "inbox",          "habilitado": true},
      {"ruta": "/agenda",         "etiqueta": "Agenda",         "icono": "agenda",         "habilitado": true},
      {"ruta": "/crm/pipeline",   "etiqueta": "Ventas",         "icono": "ventas",         "habilitado": true},
      {"ruta": "/crm",            "etiqueta": "Clientes",       "icono": "clientes",       "habilitado": true},
      {"ruta": "/catalogo",       "etiqueta": "Catálogo",       "icono": "catalogo",       "habilitado": true},
      {"ruta": "/panel-accion",   "etiqueta": "Panel de Acción", "icono": "panelAccion",   "habilitado": true, "soloGerencial": true},
      {"ruta": "/configuracion",  "etiqueta": "Configuración",  "icono": "configuracion",  "habilitado": true}
    ],
    "dashboard": {
      "layout": "ventas",
      "preguntasSugeridas": [
        "¿Qué visitas técnicas tengo hoy?",
        "¿Qué cotizaciones llevan más de 72 horas sin respuesta?",
        "¿Cuántos prospectos nuevos tengo esta semana?",
        "¿Qué visitas debo confirmar?"
      ]
    },
    "catalogo": {
      "tituloSeccion": "¿Qué ofrezco?",
      "campoVariante": "duracion",
      "iconos": [
        ["residencial", "🏠"], ["comercial", "🏢"], ["industrial", "🏭"]
      ],
      "iconoDefault": "☀️"
    },
    "crm": {
      "titulo": "Clientes",
      "layout": "cotizacion",
      "columnas": ["Cliente", "Última actividad", "Monto", "Próxima acción", "Estado"],
      "mostrarLinkPipeline": true
    }
  }'::jsonb
);

-- Verificación
SELECT slug, nombre_visible, requiere_agenda, industria_padre, jsonb_array_length(workflow_seed->'nodos') AS num_nodos
FROM plantillas_industria WHERE slug = 'paneles_solares';
