-- TARA-OS — Motor Universal para Empresas de Servicios: extiende
-- plantillas_industria para que agregar una industria nueva sea 100% datos,
-- incluyendo lo que hoy vive hardcodeado en modules/dashboard.js (2
-- funciones por-industria) y el bug real de modules/cotizador.js (manda
-- "uniformes" a CUALQUIER empresa con presupuesto sin confirmar, sin
-- verificar industria_slug).
--
-- Ejecutar en Supabase SQL Editor, luego: NOTIFY pgrst, 'reload schema';

-- ── 1. Jerarquía Industria → Subindustria ────────────────────────────────────
-- Nivel puramente organizativo para el selector de 2 pasos — la
-- configuración real sigue viviendo en la fila de plantillas_industria
-- (= subindustria). Si algún día una industria_padre necesita config propia
-- compartida, se separa entonces a una tabla — no antes.

ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS industria_padre text;

-- ── 2. dashboard_kpis_seed — reemplaza obtenerMetricasUniformesDeportivos()/
-- obtenerMetricasSalonBelleza() (modules/dashboard.js) por un motor genérico
-- con registro de tipos (mismo patrón que ActionRunner: un Map de tipos con
-- nombre, nunca un "if industria"). Cada tipo es una función escrita una
-- sola vez y reusada por cualquier industria con distintos parámetros.

ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS dashboard_kpis_seed jsonb NOT NULL DEFAULT '{"kpis": [], "recomendaciones": []}';

-- ── 3. cotizacion_config — arregla el bug real: hoy modules/cotizador.js +
-- server.js envían un mensaje con la palabra "uniformes" a CUALQUIER
-- empresa que complete un workflow con presupuesto sin confirmar, sin
-- comprobar industria. Con esta columna, el bloque de cotización automática
-- solo corre si la industria la define explícitamente — nula por defecto
-- (ninguna industria nueva hereda el bug).

ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS cotizacion_config jsonb;

-- ── 4. ui_config — conecta la intención que ya existía a medias en
-- companies.nav_labels (migración 046, nunca leída por ningún componente)
-- con los 4 archivos de frontend que hoy bifurcan por industria_slug
-- (Shell.jsx, Operaciones.jsx, Catalogo.jsx, Crm.jsx).

ALTER TABLE plantillas_industria ADD COLUMN IF NOT EXISTS ui_config jsonb NOT NULL DEFAULT '{}';

-- ── 5. Backfill de las 2 industrias existentes ───────────────────────────────
-- Reproduce EXACTAMENTE el comportamiento actual de
-- obtenerMetricasSalonBelleza()/obtenerMetricasUniformesDeportivos()
-- (modules/dashboard.js) como datos — es la prueba de que el motor genérico
-- (modules/dashboard-engine.js) funciona antes de borrar el código viejo.

UPDATE plantillas_industria SET
  industria_padre = 'belleza',
  dashboard_kpis_seed = '{
    "kpis": [
      {"tipo": "conteo_citas_rango", "etiqueta": "Citas de hoy", "params": {"rango": "hoy", "estados": ["agendada", "confirmada"]}},
      {"tipo": "conteo_citas_sin_confirmar", "etiqueta": "Confirmaciones pendientes", "params": {"horas_ventana": 48}},
      {"tipo": "conteo_clientes_nuevos", "etiqueta": "Clientas nuevas (semana)", "params": {"dias": 7}},
      {"tipo": "conteo_citas_por_estado_desde", "etiqueta": "Citas completadas este mes", "params": {"estado": "completada", "desde": "mes"}},
      {"tipo": "conteo_citas_por_estado_desde", "etiqueta": "Citas canceladas este mes", "params": {"estado": "cancelada", "desde": "mes"}}
    ],
    "recomendaciones": [
      {"tipo": "cita_sin_confirmar_ventana", "params": {"horas": 48, "severidad": "critica"}},
      {"tipo": "cliente_sin_visita", "params": {"dias": 45, "severidad": "media"}}
    ]
  }'::jsonb,
  ui_config = '{
    "modulos": [
      {"ruta": "/operaciones",    "etiqueta": "Inicio",         "icono": "inicio",         "habilitado": true},
      {"ruta": "/conversaciones", "etiqueta": "Conversaciones", "icono": "conversaciones", "habilitado": true},
      {"ruta": "/inbox",          "etiqueta": "Inbox",          "icono": "inbox",          "habilitado": true},
      {"ruta": "/agenda",         "etiqueta": "Agenda",         "icono": "agenda",         "habilitado": true},
      {"ruta": "/crm",            "etiqueta": "Clientas",       "icono": "clientes",       "habilitado": true},
      {"ruta": "/catalogo",       "etiqueta": "Catálogo",       "icono": "catalogo",       "habilitado": true},
      {"ruta": "/panel-accion",   "etiqueta": "Panel de Acción", "icono": "panelAccion",   "habilitado": true, "soloGerencial": true},
      {"ruta": "/configuracion",  "etiqueta": "Configuración",  "icono": "configuracion",  "habilitado": true}
    ],
    "dashboard": {
      "layout": "recomendaciones",
      "preguntasSugeridas": [
        "¿Qué citas debo confirmar?",
        "¿Cuántas citas tengo hoy?",
        "¿Cuántas clientas nuevas llevo esta semana?",
        "¿Qué clientas no visitan hace tiempo?"
      ]
    },
    "catalogo": {
      "tituloSeccion": "¿Qué vendo?",
      "campoVariante": "duracion",
      "iconos": [
        ["pedicure", "🦶"], ["manicure", "💅"], ["ac[rí]lic", "💅"],
        ["gel", "💅"], ["spa|masaje", "💆"], ["ceja|pesta", "👁️"]
      ],
      "iconoDefault": "✨"
    },
    "crm": {
      "titulo": "Clientas",
      "layout": "citas",
      "columnas": ["Cliente", "Próxima cita", "Última visita", "Acción", "Estado"],
      "mostrarLinkPipeline": false
    }
  }'::jsonb
WHERE slug = 'salon_belleza';

UPDATE plantillas_industria SET
  industria_padre = 'servicios_comerciales',
  dashboard_kpis_seed = '{
    "kpis": [
      {"tipo": "conteo_oportunidades_por_estado", "etiqueta": "Solicitudes nuevas", "params": {"estado": "Solicitud nueva"}},
      {"tipo": "conteo_oportunidades_por_estado", "etiqueta": "Cotizaciones enviadas", "params": {"estado": "Cotización enviada"}},
      {"tipo": "conteo_oportunidades_por_estado", "etiqueta": "Pedidos en producción", "params": {"estado": "En producción"}},
      {"tipo": "conteo_oportunidades_por_estado", "etiqueta": "Entregas", "params": {"estado": "Listo para entrega"}},
      {"tipo": "suma_oportunidades_mes", "etiqueta": "Ventas este mes", "params": {"estado": "Entregado", "campo": "presupuesto_confirmado", "formato": "moneda"}}
    ],
    "recomendaciones": [
      {"tipo": "texto_urgente_workflow", "params": {"campo": "fecha_entrega", "severidad": "critica"}},
      {"tipo": "oportunidad_estancada", "params": {"estado": "Cotización enviada", "horas": 48, "severidad": "critica", "mensaje": "{cliente} lleva más de 48 horas sin seguimiento.", "detalle": "Cotización enviada sin respuesta.", "accion": "Dar seguimiento ahora"}},
      {"tipo": "oportunidad_en_estado", "params": {"estado": "Cotización en preparación", "severidad": "media", "mensaje": "Confirma tallas de {cliente} antes de enviarlo a producción.", "detalle": "Cotización en preparación.", "accion": "Ver detalle"}},
      {"tipo": "oportunidad_en_estado", "params": {"estado": "Listo para entrega", "severidad": "info", "mensaje": "El pedido de {cliente} está listo para entrega.", "detalle": "Listo para entrega.", "accion": "Ver pedido"}}
    ],
    "panel_ventas": true
  }'::jsonb,
  cotizacion_config = '{"unidad": "uniformes", "campo_cantidad": "cantidad"}'::jsonb,
  ui_config = '{
    "modulos": [
      {"ruta": "/operaciones",    "etiqueta": "Inicio",         "icono": "inicio",         "habilitado": true},
      {"ruta": "/conversaciones", "etiqueta": "Conversaciones", "icono": "conversaciones", "habilitado": true},
      {"ruta": "/inbox",          "etiqueta": "Inbox",          "icono": "inbox",          "habilitado": true},
      {"ruta": "/crm/pipeline",   "etiqueta": "Ventas",         "icono": "ventas",         "habilitado": true},
      {"ruta": "/crm",            "etiqueta": "Clientes",       "icono": "clientes",       "habilitado": true},
      {"ruta": "/catalogo",       "etiqueta": "Catálogo",       "icono": "catalogo",       "habilitado": true},
      {"ruta": "/panel-accion",   "etiqueta": "Panel de Acción", "icono": "panelAccion",   "habilitado": true, "soloGerencial": true},
      {"ruta": "/configuracion",  "etiqueta": "Configuración",  "icono": "configuracion",  "habilitado": true}
    ],
    "dashboard": {
      "layout": "ventas",
      "preguntasSugeridas": [
        "¿Qué clientes necesitan seguimiento?",
        "¿Cuántas cotizaciones llevo esta semana?",
        "¿Qué pedidos debo entregar hoy?",
        "¿Qué clientes llevan más de 48 horas sin responder?"
      ]
    },
    "catalogo": {
      "tituloSeccion": "¿Qué vendo?",
      "campoVariante": "tallas",
      "tallas": ["S", "M", "L", "XL"],
      "iconos": [
        ["f[uú]tbol", "⚽"], ["b[aá]squet", "🏀"], ["ciclis", "🚴"],
        ["b[eé]isbol", "⚾"], ["voleibol", "🏐"], ["handball", "🤾"]
      ],
      "iconoDefault": "👕"
    },
    "crm": {
      "titulo": "Clientes",
      "layout": "cotizacion",
      "columnas": ["Cliente", "Última actividad", "Monto", "Próxima acción", "Estado"],
      "mostrarLinkPipeline": true
    }
  }'::jsonb
WHERE slug = 'uniformes_deportivos';

-- Verificación
SELECT slug, industria_padre, dashboard_kpis_seed, cotizacion_config, ui_config
FROM plantillas_industria;
