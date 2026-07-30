-- TARA-OS — Amplía la plantilla paneles_solares: calificación comercial
-- completa, no solo 4 campos.
--
-- Encontrado en la validación real con Alina (2026-07-30): el workflow
-- original (migración 082) solo tenía 4 nodos (tipo_propiedad, consumo,
-- ubicación, hora) — nunca pedía nombre, ni colonia/dirección, ni pisos,
-- climas, tipo de techo o espacio en azotea, y saltaba directo a agendar
-- sin calificar lo suficiente. Este cambio es puramente de DATOS (la fila
-- de plantillas_industria) — no toca orchestrator.js/workflow-engine.js.
--
-- El nodo final ("preguntar_hora_preferida") sigue sin consultar
-- disponibilidad real antes de preguntar la hora — eso requeriría que un
-- nodo intermedio ejecute una acción y muestre su resultado, algo que
-- ADR-005 marca explícitamente como un cambio que sí tocaría Orchestrator
-- y necesitaría su propio proceso de excepción (no se construye aquí).
-- Se mitiga parcialmente indicando un horario típico en la pregunta.
--
-- Esta migración actualiza SOLO la plantilla (para empresas nuevas que se
-- creen después) — la empresa demo ya existente ("Empresa Demo Paneles
-- Solares") se corrige aparte con
-- scripts/actualizar-plantilla-paneles-solares.js (los nodos de workflow
-- viven en filas de `workflow_nodes`, no en esta tabla).
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

UPDATE plantillas_industria SET
  personalidad = '{
    "nombre_asistente": "Lucía",
    "cargo": "Asesora de energía solar",
    "tono": "cercano, confiable y con conocimiento técnico explicado en simple",
    "objetivo": "Calificar al prospecto por completo (nombre, tipo de propiedad, consumo eléctrico, ubicación, características del inmueble) y agendar una visita técnica gratuita para cotizar su sistema solar.",
    "idioma": "es",
    "zona_horaria": "America/Monterrey",
    "modelo": "gpt-4o-mini",
    "temperatura": 0.7,
    "max_tokens": 500,
    "campos_requeridos": ["nombre", "tipo_propiedad", "consumo_mensual_cfe", "frecuencia_recibo", "ciudad", "colonia", "numero_pisos", "cantidad_aires_acondicionados", "tipo_techo", "espacio_azotea"],
    "reglas": [
      {"texto": "Siempre pregunta el monto promedio del recibo de CFE (o el consumo en kWh) antes de hablar de precios — sin ese dato no se puede dimensionar el sistema.", "etapas": []},
      {"texto": "Nunca prometas un porcentaje de ahorro exacto ni un descuento sin que la visita técnica lo confirme — habla de rangos, no de cifras cerradas.", "etapas": []},
      {"texto": "La cotización final siempre depende de la visita técnica gratuita — jamás cierres un precio por chat.", "etapas": []},
      {"texto": "Si el cliente hace una pregunta directa (por ejemplo sobre el ahorro, el precio o el proceso de instalación), respóndela primero — nunca la ignores para seguir con la siguiente pregunta de calificación.", "etapas": []},
      {"texto": "Si el cliente comparte información valiosa para dimensionar el sistema (pisos, aires acondicionados, tipo de techo), agradécela brevemente antes de continuar.", "etapas": []}
    ],
    "mensaje_bienvenida": "¡Hola! Soy Lucía, asesora de energía solar. Cuéntame si buscas paneles para tu casa o tu negocio, y con gusto te oriento.",
    "firma": "",
    "mensaje_fuera_horario": "Gracias por tu mensaje. En este momento estamos fuera de horario de atención — te responderemos en cuanto sea posible.",
    "mensaje_error_tecnico": "Error técnico. Intenta de nuevo."
  }'::jsonb,
  workflow_seed = '{
    "nombre": "Calificación completa y agenda de visita técnica solar",
    "descripcion": "Descubrimiento comercial completo: nombre, tipo de propiedad, consumo eléctrico, frecuencia del recibo, ciudad, colonia, pisos, aires acondicionados, tipo de techo, espacio en azotea, y agenda de la visita técnica gratuita.",
    "trigger_value": "solicitud_cotizacion",
    "nodos": [
      {"nombre": "preguntar_nombre", "es_inicio": true, "es_fin": false, "pregunta": "¿Con quién tengo el gusto?", "campo": "nombre", "es_opcional": false, "siguiente_nodo": "preguntar_tipo_propiedad", "modo_respuesta": "prepend_ai", "acciones": [], "orden": 1},
      {"nombre": "preguntar_tipo_propiedad", "es_inicio": false, "es_fin": false, "pregunta": "¿Los paneles serían para tu casa o para un negocio?", "campo": "tipo_propiedad", "es_opcional": false, "siguiente_nodo": "preguntar_consumo", "modo_respuesta": "replace_ai", "acciones": [], "orden": 2},
      {"nombre": "preguntar_consumo", "es_inicio": false, "es_fin": false, "pregunta": "¿Cuánto pagas aproximadamente en tu recibo de CFE?", "campo": "consumo_mensual_cfe", "es_opcional": false, "siguiente_nodo": "preguntar_frecuencia_recibo", "modo_respuesta": "replace_ai", "acciones": [], "orden": 3},
      {"nombre": "preguntar_frecuencia_recibo", "es_inicio": false, "es_fin": false, "pregunta": "¿Ese monto es mensual o bimestral?", "campo": "frecuencia_recibo", "es_opcional": false, "siguiente_nodo": "preguntar_ciudad", "modo_respuesta": "replace_ai", "acciones": [], "orden": 4},
      {"nombre": "preguntar_ciudad", "es_inicio": false, "es_fin": false, "pregunta": "¿En qué ciudad se encuentra la propiedad?", "campo": "ciudad", "es_opcional": false, "siguiente_nodo": "preguntar_colonia", "modo_respuesta": "replace_ai", "acciones": [], "orden": 5},
      {"nombre": "preguntar_colonia", "es_inicio": false, "es_fin": false, "pregunta": "¿En qué colonia o zona?", "campo": "colonia", "es_opcional": false, "siguiente_nodo": "preguntar_pisos", "modo_respuesta": "replace_ai", "acciones": [], "orden": 6},
      {"nombre": "preguntar_pisos", "es_inicio": false, "es_fin": false, "pregunta": "¿Cuántos pisos tiene la propiedad?", "campo": "numero_pisos", "es_opcional": false, "siguiente_nodo": "preguntar_climas", "modo_respuesta": "replace_ai", "acciones": [], "orden": 7},
      {"nombre": "preguntar_climas", "es_inicio": false, "es_fin": false, "pregunta": "¿Cuántos aires acondicionados o climas tienen instalados?", "campo": "cantidad_aires_acondicionados", "es_opcional": false, "siguiente_nodo": "preguntar_tipo_techo", "modo_respuesta": "replace_ai", "acciones": [], "orden": 8},
      {"nombre": "preguntar_tipo_techo", "es_inicio": false, "es_fin": false, "pregunta": "¿De qué tipo es el techo — losa, lámina o teja?", "campo": "tipo_techo", "es_opcional": false, "siguiente_nodo": "preguntar_espacio_azotea", "modo_respuesta": "replace_ai", "acciones": [], "orden": 9},
      {"nombre": "preguntar_espacio_azotea", "es_inicio": false, "es_fin": false, "pregunta": "¿Hay espacio libre en la azotea para instalar los paneles?", "campo": "espacio_azotea", "es_opcional": false, "siguiente_nodo": "preguntar_hora_preferida", "modo_respuesta": "replace_ai", "acciones": [], "orden": 10},
      {"nombre": "preguntar_hora_preferida", "es_inicio": false, "es_fin": true, "pregunta": "Para agendar tu visita técnica gratuita: normalmente tenemos disponibilidad de lunes a sábado, de 8am a 6pm. ¿Qué día y hora te queda bien dentro de ese horario?", "campo": "hora_preferida", "es_opcional": false, "siguiente_nodo": null, "modo_respuesta": "replace_ai", "acciones": [{"tipo": "agendar_cita_con_horario_solicitado", "parametros": {"duracionMinutos": 60}}, {"tipo": "crear_oportunidad", "parametros": {}}], "orden": 11}
    ]
  }'::jsonb
WHERE slug = 'paneles_solares';

-- Verificación
SELECT slug, jsonb_array_length(workflow_seed->'nodos') AS num_nodos, personalidad->'campos_requeridos' AS campos_requeridos
FROM plantillas_industria WHERE slug = 'paneles_solares';
