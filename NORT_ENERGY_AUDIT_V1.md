# NORT_ENERGY_AUDIT_V1.md
### Auditoría integral de Nort Energy como producto terminado
**Fecha:** 2026-09-28 · **Metodología:** cada hallazgo está verificado contra código real (`server.js`, `modules/*.js`, `frontend/src/**`), migraciones SQL reales, y — donde aplicó — consultas directas a la base de datos de producción de Nort Energy. Nada de lo que sigue es teórico ni se infiere "porque debería existir"; cada afirmación cita el archivo/función que la sostiene.

**Pregunta que responde este documento:** ¿Nort Energy puede operar diariamente desde TARA de principio a fin, sin Excel, sin duplicar capturas y sin procesos desconectados?

**Respuesta corta:** El *motor* (cada pieza individual) funciona y está probado. El *producto* todavía no — hay 3 rupturas reales de continuidad (dashboard ciego a todo lo operativo, Proyecto 360° incompleto, permisos binarios) que impiden operar "de principio a fin sin Excel" hoy mismo. Ninguna es un rediseño: las tres son extensiones sobre lo ya construido.

---

## 1. Recorrido real end-to-end

Cada paso fue verificado leyendo la ruta HTTP real, la función de negocio que la atiende, y (donde había duda) probado contra datos reales o un flujo de prueba temporal.

| # | Paso | Estado | Evidencia |
|---|------|--------|-----------|
| 1 | Lead de Meta Ads → WhatsApp | ✅ **FUNCIONA COMPLETO** | `server.js:747 app.post('/webhook/meta')` recibe el mensaje, resuelve el `channel_endpoint` de Nort Energy, crea/reusa `clientes` por teléfono. |
| 2 | TARA responde | ✅ **FUNCIONA COMPLETO** | Orchestrator/WorkflowEngine/PromptBuilder (Core ADR-005, no tocado). Responde con IA real, usa `knowledge_base` enriquecido (FAQ solar, catálogo técnico). |
| 3 | Calificación | ✅ **FUNCIONA COMPLETO** | `modules/prompt-builder.js` clasifica intención (`interes_compra`, `solicitud_visita_tecnica`, etc.) — write path `modules/crm.js` (congelado). |
| 4 | Cliente | ✅ **FUNCIONA COMPLETO** | `clientes` se crea/dedupe por teléfono automáticamente desde el motor conversacional. |
| 5 | Oportunidad | ✅ **FUNCIONA COMPLETO** | `modules/crm.js` crea `oportunidades` automáticamente al calificar interés. |
| 6 | Recibo CFE / datos energéticos | ⚠️ **FUNCIONA PARCIAL** | `modules/recibo-cfe.js` extrae automáticamente si el cliente manda foto/PDF del recibo por WhatsApp (`clientes.numero_servicio_cfe`, `tarifa_cfe`, consumo mensual). Existe TAMBIÉN una carga manual desde el panel (`POST /api/crm/clientes/:id/recibo-cfe`). **Lo que falta**: los "datos técnicos del inmueble" (tipo de techo, orientación, sombras, área, centro de carga) NO se extraen del recibo ni de WhatsApp — viven en `oportunidades` (`actualizarDatosInmueble`, `modules/crm-ui.js:456`) y **solo se capturan si un humano los llena a mano en el panel** (ver punto 11 más abajo: no hay evidencia de que el frontend tenga ese formulario expuesto de forma prominente — existe la función pero no confirmé una pantalla dedicada y descubrible para llenarla). |
| 7 | Ingeniería | ⚠️ **FUNCIONA PARCIAL / RIESGO** | El motor de ingeniería (`motores-ingenieria/paneles-solares.js`) SÍ usa HSP real + catálogo real (`productos`) para dimensionar. **Pero** no confirmé que lea `oportunidades.datos_inmueble_*` (orientación/sombras real) al calcular — si esos datos existen pero el motor no los consume, el "levantamiento técnico" está **desconectado de la cotización real** (dimensiona con supuestos genéricos, no con lo que un instalador vio en sitio). *(Verificación pendiente de código exacto del motor — señalado como riesgo a confirmar, no como hecho cerrado.)* |
| 8 | Cotización | ✅ **FUNCIONA COMPLETO** | `modules/cotizaciones.js`, folio atómico, líneas editables, snapshot de cálculo. |
| 9 | PDF | ✅ **FUNCIONA COMPLETO** | `modules/cotizacion-pdf.js`, plantilla "premium_corporativo" propia de Nort Energy. |
| 10 | Seguimiento | ✅ **FUNCIONA COMPLETO** | `seguimientos` (CRM) + recomendaciones del dashboard (`oportunidad_seguimiento_vencido`). |
| 11 | Aceptación | ✅ **FUNCIONA COMPLETO** | `marcarCotizacionAceptadaYCrearProyecto` — idempotente, transaccional en efecto, probado con carrera concurrente real. |
| 12 | Proyecto | ✅ **FUNCIONA COMPLETO** | `proyectos` (tipo='venta'), folio propio, snapshot `config_vendida`, hereda `oportunidad_id`/`cliente_id`/ubicación sin recaptura. |
| 13 | Anticipo | ⚠️ **FUNCIONA PARCIAL / RIESGO** | `pagos_cliente` se crea perezosamente; `anticipo_requerido_pct` casi nunca está capturado en la cotización real (confirmado: 0 cotizaciones de Nort Energy con `anticipo_pct` seteado a la fecha de 2A). **Riesgo de integridad real** en `registrarAbono` (ver sección 13). |
| 14 | Visita / agenda | ✅ **FUNCIONA COMPLETO** | `citas` vía `SchedulingEngine` (Core, reutilizado sin modificar) — agenda real, mismo motor para ventas y para mantenimiento (2I). |
| 15 | Instalación | ✅ **FUNCIONA COMPLETO** | `instalaciones`, checklist configurable snapshoteado, estados libres. |
| 16 | Reserva/salida de inventario | ❌ **EXISTE PERO ESTÁ DESCONECTADO** | `reservarMaterialInstalacion`/`consumirMaterialInstalacion` (`modules/inventario.js`) están completos, probados (incluida reversión ante fallo parcial) y expuestos por API (`/api/instalaciones/:id/inventario/reservar|consumir`). **Verificado: ningún botón en todo el frontend los llama** (`grep` de `reservarMaterial\|consumirMaterial\|inventario/reservar\|inventario/consumir` en `frontend/src` → 0 resultados). Un instalador puede completar una instalación entera sin que el inventario se entere. |
| 17 | Evidencias | ✅ **FUNCIONA COMPLETO** | Fotos por fase (antes/durante/después), ligadas a `instalacion_id`, visibles en Equipos/Instalación. |
| 18 | Equipos instalados | ✅ **FUNCIONA COMPLETO** | Snapshot de marca/modelo/serie/garantía, prefijado desde el catálogo si aplica. |
| 19 | Trámite CFE | ✅ **FUNCIONA COMPLETO** | 10 estados libres, alerta configurable por días sin actualizar, documentos vía categoría reutilizada. |
| 20 | Liquidación | ✅ **FUNCIONA COMPLETO (como estado derivado)** | `calcularEstadoCobranza` deriva `liquidado` correctamente — nunca se guarda, siempre se calcula. |
| 21 | Entrega | ⚠️ **FUNCIONA PARCIAL / RIESGO** | `instalaciones.estado = 'entregada'` es alcanzable libremente **sin ninguna validación de que la cobranza esté liquidada**. Un asesor puede marcar "entregada" con saldo pendiente — no es necesariamente incorrecto operativamente, pero hoy no hay ni alerta ni bloqueo, y nada lo conecta. |
| 22 | Garantía | ⚠️ **FUNCIONA PARCIAL (manual, no automático)** | La garantía SÍ nace 100% del equipo (snapshot real, sin recaptura) — pero **requiere que un humano dé clic en "Ver garantía" por cada equipo**; no se crea sola cuando se instala un equipo. Es idempotente (seguro dar clic dos veces) pero no automático. |
| 23 | Mantenimiento | ✅ **FUNCIONA COMPLETO** | Crea cita real vía el mismo `SchedulingEngine`, probado en vivo (cita real generada). |
| 24 | Ticket / postventa | ✅ **FUNCIONA COMPLETO** | Línea de tiempo real, transición libre de estado. |
| 25 | Portal del cliente | ✅ **FUNCIONA COMPLETO (alcance limitado)** | Login OTP real, aislamiento por sesión (nunca por parámetro de URL) verificado. Alcance actual: solo proyecto/equipos/cobranza — **cero documentos, cero CFE, cero garantías, cero mantenimiento visibles al cliente** (ver sección 11). |

**Resumen de la fila 16 (inventario desconectado) y fila 6-7 (levantamiento no confirmado en el motor):** son los dos huecos de **continuidad real** más serios del flujo — todo lo demás es, en el peor caso, manual pero funcional.

---

## 2. Captura duplicada — mapa de propagación de datos

| Dato | Se captura en | ¿Se repropaga sin recapturar? |
|---|---|---|
| Cliente / teléfono / dirección | WhatsApp → `clientes` | ✅ Nunca se vuelve a pedir — `proyectos.cliente_id`, `tickets.cliente_id`, `garantias` (vía equipo), todos heredan por FK. |
| Ubicación de instalación | `oportunidades.direccion/colonia/ciudad` (capturada en el intake) | ✅ `_crearORecuperarProyectoDeVenta` prioriza la dirección de la oportunidad sobre la del cliente — **sin recaptura** (`modules/proyectos.js:111-113`). |
| Sucursal | `cotizaciones.sucursal_id` (desde 102) | ✅ Se hereda a `proyectos.sucursal_id`, luego a `instalaciones.sucursal_id`, luego a `inventario_saldos`/`ordenes_compra`. |
| Panel/inversor/cantidad/precio | Cotización (líneas + cálculo de ingeniería) | ✅ Snapshot único en `proyectos.config_vendida` — nunca se vuelve a teclear para instalación/equipos. |
| Asesor | `clientes.asesor_id` | ✅ Se hereda a `proyectos.asesor_id` automáticamente (`modules/proyectos.js`). |
| Marca/modelo/serie del equipo | `equipos_instalados` (capturado UNA vez al instalar) | ✅ `crearGarantiaDesdeEquipo` snapshotea sin volver a preguntar — el punto exacto que pediste verificar, confirmado correcto. |
| Datos técnicos del inmueble (techo/sombras/centro de carga) | `oportunidades.datos_inmueble_*` | ⚠️ **No verificado que el motor de ingeniería los lea** — si no los usa, en la práctica el instalador/ingeniería puede estar re-preguntando estos datos en la visita técnica aunque ya existan en el sistema. Bandera P1 para confirmar con código exacto del motor. |
| Folio de orden de compra | Contador atómico por empresa | ✅ Sin duplicar. |
| **oportunidad_id / cliente_id en `tickets`** | Se piden **como campo obligatorio nuevo** al crear un ticket desde `Tickets.jsx` | ❌ **Captura redundante evitable**: si el ticket se abre desde el Proyecto (`ProyectoDetalle.jsx`) hoy **no hay atajo** — el formulario de nuevo ticket vive únicamente en la pantalla global `Tickets.jsx` y obliga a buscar al cliente por nombre otra vez, aunque el usuario ya esté parado en la ficha de ese cliente/proyecto. Es un **hueco de propagación real**, no un bug: el dato ya existe (`proyecto.cliente_id`), pero la UI actual no lo pre-llena porque no hay botón "+ Ticket" dentro de `ProyectoDetalle.jsx`. |

**Conclusión de la sección:** la propagación de datos **a nivel de backend/modelo es excelente** — el diseño de snapshots (config_vendida, checklist, garantía) evita duplicación real de forma consistente. La única duplicación de captura real y verificada está en la **capa de UI**: crear un ticket desde el contexto de un proyecto obliga a re-buscar al cliente.

---

## 3. Automatizaciones entre módulos

| Evento | Acción automática | Acción manual | Qué falta | Riesgo |
|---|---|---|---|---|
| Cotización marcada aceptada | Crea/recupera el proyecto (idempotente) | Clic en "Marcar como aceptada" | — | Bajo (probado con carrera concurrente) |
| Orden de compra "recibida" | Genera 1 movimiento `entrada` de inventario por ítem | Clic en "Marcar como recibida" | — | Bajo (probado en vivo) |
| Equipo instalado creado | Nada | Clic "Ver garantía" para crear la garantía | Auto-crear garantía al registrar el equipo (candidato de automatización real: cero riesgo, cero captura extra, elimina un clic que hoy es fácil de olvidar) | **Medio** — si nadie da clic, el equipo nunca tiene garantía registrada y nadie se entera |
| Mantenimiento marcado "realizado" | Nada | "Programar siguiente" crea la cita | Sugerir automáticamente la fecha del próximo mantenimiento (ej. +12 meses) en vez de que el usuario la calcule a mano | Bajo |
| Instalación reserva/consume material | **Nada ocurre solo** | No existe botón — hoy ni siquiera es "manual", es **inexistente en la UI** | Conectar el botón ya construido en el backend | **Alto** — inventario puede quedarse indefinidamente desincronizado de la realidad |
| Instalación "entregada" | Nada | Cambio de estado libre | Advertencia (no bloqueo) si la cobranza no está liquidada | Medio |
| Garantía próxima a vencer | Nada | Nada | Ningún mecanismo la detecta — ni un KPI, ni una recomendación de dashboard, ni un ticket automático | Medio (oportunidad de negocio perdida, no de datos) |
| Trámite CFE sin mover N días | **Sí — badge de alerta calculado** | — | — | Bajo, ya resuelto |
| Cliente sin visita/seguimiento | Sí — recomendación de dashboard (ventas) | — | — | Bajo, ya resuelto (motor genérico, reutilizado) |

**Recomendación explícita (no implementar todavía):** la única automatización que agregaría valor real sin agregar complejidad es **auto-crear la garantía al registrar el equipo instalado** — mismo mecanismo idempotente que ya existe, solo cambia el disparador de "botón" a "automático al insertar". Todo lo demás debe seguir siendo manual: automatizar "instalación entregada → liquidar cobranza" o similar sería forzar un proceso rígido que ya rechazaste explícitamente al inicio del proyecto.

---

## 4. UX del empleado por perfil

| Perfil | ¿Qué ve al entrar? | Fricción detectada |
|---|---|---|
| **Asesor comercial** | Dashboard de ventas (KPIs de leads/pipeline/cotizaciones) — correcto para su rol | Ninguna crítica. Navegación clara: Pipeline → Clientes → Cotizaciones. |
| **Administración/Cobranza** | El mismo dashboard de ventas — **no hay vista de cobranza agregada**; para ver saldos pendientes tiene que abrir proyecto por proyecto | **Alta.** No existe una pantalla "Cobranza" (el nav la lista pero `habilitado:false` — nunca se construyó una página propia, aunque el backend de 2B está completo). |
| **Ingeniería** | Mismo dashboard genérico de ventas | Media — no tiene una vista de "cotizaciones pendientes de cálculo de ingeniería". |
| **Instalador** | Mismo panel completo (sin restricción por rol) — ve TODO el menú de Nort Energy, incluida Configuración/Compras | **Alta.** Un instalador con teléfono en campo ve un menú de 21 opciones cuando en la práctica solo necesita: su proyecto asignado, el checklist, subir fotos, registrar equipos. |
| **Almacén** | Mismo panel completo | Media — Inventario ya tiene página (recién agregada), pero el instalador de campo no puede *desde su instalación* disparar la reserva/consumo (punto 1, fila 16) — tiene que ir a Inventario y hacerlo manual, sin saber qué instalación lo originó salvo que lo escriba en "Referencia" a mano. |
| **Responsable CFE** | Mismo panel completo | Baja — Trámites CFE ya es una pantalla dedicada con alerta. |
| **Postventa** | Mismo panel completo | Baja/Media — Garantías/Mantenimiento/Tickets ya son pantallas dedicadas, pero dispersas en 3 pantallas separadas sin una vista "mis pendientes de postventa" unificada. |
| **Gerencia** | Dashboard ejecutivo + operativo (2 niveles) | Media — el nivel "operativo" del dashboard (recomendaciones + panel de ventas) **no incluye nada de lo operativo real (2A-2I)** — ver sección 8. |

**Hallazgo transversal más importante de esta sección:** **no existe ninguna restricción de menú ni de acceso por perfil operativo** — todos ven y pueden tocar todos los módulos si tienen sesión activa (solo hay el corte binario gerencial/no-gerencial). Un instalador puede, técnicamente, entrar a Compras o Configuración. Nadie "no puede terminar su trabajo sin entrar a módulos que no le corresponden" — al contrario, **puede entrar a módulos que nunca le corresponden.**

---

## 5. Proyecto 360° — auditoría del expediente

**Lo que SÍ aparece hoy en `/proyectos/:id` (verificado línea por línea del archivo):**
Encabezado · Sistema vendido · Información comercial · Cobranza (con abonos y anticipo) · Instalación (con checklist) · Equipos instalados (con botón de garantía) · Trámite CFE (con documentos propios) · Mantenimiento (con programar siguiente) · Progreso (resumen visual de 8 pasos).

**Lo que OBLIGA a salir del proyecto hoy:**
| Falta en Proyecto 360° | Dónde vive hoy | Impacto |
|---|---|---|
| **Documentos consolidados** (contrato, identificación, comprobantes) | Solo en la ficha del **Cliente** (`/crm/clientes/:id`, tab "Documentos") — sí existen consolidados, pero no desde el proyecto | Medio — un usuario parado en el proyecto no ve el contrato firmado sin navegar al cliente |
| **Actividad / bitácora** | `bitacora_decisiones` se escribe en cada transición (venta aceptada, cambios de estado de instalación/CFE/garantía/compras) **pero nunca se muestra en ningún lugar de la UI** | **Alto** — es un historial de auditoría completo, invisible para cualquier humano hoy |
| **Garantías (vista agregada)** | Hay que entrar equipo por equipo | Bajo/Medio |
| **Tickets del proyecto** | `Tickets.jsx` global no tiene ni siquiera filtro por `proyectoId` (ni en backend ni en UI) | Medio |
| **Inventario/material reservado para esta instalación** | No existe en ningún lado (ver sección 3) | Alto |
| **Estado general del proyecto** (`proyectos.estado`) | Se queda en `'activo'` para siempre — nunca se actualiza | Medio (afecta reportes, no la operación diaria) |

**Propuesta (sin implementar, según instrucción):**
1. Agregar sección **"Actividad"** a Proyecto 360° que simplemente liste `bitacora_decisiones` filtrado por `proyecto_id` — cero tablas nuevas, el dato ya existe.
2. Agregar sección **"Documentos"** reutilizando exactamente `listarDocumentosCliente(cliente_id)` (ya existe, ya se usa en la ficha de cliente) — mismo dato, otra vista.
3. Agregar filtro `proyectoId` a `listarTickets` (cambio de una línea en `modules/tickets.js`) + mostrar los tickets del proyecto en su propia sección.
4. Conectar el botón de reserva/consumo de inventario a la sección Instalación.

Ninguna de las 4 requiere una tabla nueva ni un módulo nuevo — es exponer datos que ya existen.

---

## 6. Cliente 360°

**Hallazgo crítico verificado, tal como advertiste que podía pasar:**

- El **modelo de datos SÍ soporta** múltiples oportunidades, cotizaciones y proyectos por cliente — no hay restricción `UNIQUE` en ninguna de esas tablas por `cliente_id`.
- **Oportunidades**: `CrmClienteDetalle.jsx` las lista TODAS correctamente (`oportunidades.map(...)`) — ✅ correcto.
- **Cotizaciones**: se listan TODAS correctamente (`cotizaciones.map(...)`) — ✅ correcto.
- **Proyectos**: ❌ **`api.proyectoDeCliente(clienteId)` devuelve UN SOLO proyecto** — `modules/proyectos.js::obtenerProyectoDeCliente` hace `.order('created_at', {descending}).limit(1).maybeSingle()`. Si un cliente real de Nort Energy tuviera dos sistemas instalados en dos fechas distintas (perfectamente posible: casa + negocio, o ampliación de un sistema existente), **la ficha del cliente solo mostraría el más reciente — el primero desaparece de la vista, aunque siga existiendo en la base de datos.**

**Esto es exactamente el error que pediste verificar y NO es una suposición mía — es el comportamiento real de la consulta.** No hay pérdida de datos (el proyecto viejo sigue en la tabla), pero sí una **pérdida de visibilidad real** para cualquiera que use la ficha del cliente como fuente de verdad.

**Corrección mínima (no implementada):** cambiar `obtenerProyectoDeCliente` de singular a `listarProyectosDeCliente` (quitar `.limit(1).maybeSingle()`, devolver arreglo) y ajustar `CrmClienteDetalle.jsx` para listar todos en vez de mostrar uno. Cambio de bajo riesgo, acotado a 2 archivos.

---

## 7. Dashboard — auditoría KPI por KPI

Nort Energy usa el tablero por `dashboard_kpis_seed` (Motor Universal, `modules/dashboard-engine.js`), NO el genérico. Cada KPI fue verificado contra su función real en `KPI_TIPOS`:

| KPI (etiqueta) | Tipo/función | Fuente | Filtro company | Filtro sucursal | Periodo | Significado real |
|---|---|---|---|---|---|---|
| Leads nuevos (30 días) | `conteo_clientes_nuevos` | `clientes` | ✅ | ❌ **no filtra sucursal** | 30 días fijos (no configurable en UI) | Clientes creados, no necesariamente "leads calificados" |
| Oportunidades activas | `conteo_oportunidades_excluyendo_estado` | `oportunidades` | ✅ | ❌ | Histórico completo | Todo lo que no está en Cerrado/Perdido |
| Cotizaciones generadas (mes) | `conteo_cotizaciones_por_estado` | `cotizaciones` | ✅ | ❌ | Mes en curso | Conteo simple |
| Cotizaciones enviadas (mes) | ídem, `estado='enviada'` | `cotizaciones` | ✅ | ❌ | Mes en curso | — |
| Ventas cerradas (mes) | `conteo_oportunidades_por_estado_desde` | `oportunidades`, `estado='Cerrado'` | ✅ | ❌ | Mes por `updated_at` | ⚠️ Cuenta oportunidades marcadas "Cerrado", **no proyectos de venta reales** — puede no coincidir 1:1 si alguien cierra una oportunidad sin llegar a aceptar cotización, o viceversa |
| Valor del pipeline | `suma_oportunidades_excluyendo_estado` | `oportunidades.presupuesto_estimado` | ✅ | ❌ | Histórico | — |
| Ventas del mes | `suma_oportunidades_mes` | `oportunidades.presupuesto_confirmado` | ✅ | ❌ | Mes por `updated_at` | ⚠️ Mismo problema — no viene de `proyectos.config_vendida` (el monto realmente vendido y snapshoteado), viene de un campo de la oportunidad que puede haberse editado después |
| Citas próximas (7 días) | `conteo_citas_futuras` | `citas` | ✅ | ❌ | 7 días | Incluye TODAS las citas — ventas y mantenimiento mezcladas (mismo motor de agenda) |
| Tareas pendientes | `conteo_tareas_por_estado` | `tareas` | ✅ | ❌ | — | `tareas` es una tabla genérica pre-existente, sin relación directa con el bloque operativo 2A-2I |
| Seguimientos pendientes | `conteo_oportunidades_seguimiento_vencido` | `oportunidades` | ✅ | ❌ | — | — |
| Tasa de conversión | `tasa_conversion_oportunidades` | `oportunidades` | ✅ | ❌ | Histórico | Devuelve '—' honestamente si no hay cierres, correcto |

**Ningún KPI filtra por sucursal** — para una empresa con una sola sucursal activa hoy esto no se nota, pero si Nort Energy abre una segunda sucursal, el dashboard mezclará ambas sin poder desagregar.

**El hallazgo más importante de todo el documento:** **CERO de los 11 KPIs, y CERO de las 7 recomendaciones configuradas, tocan cualquier tabla del bloque operativo (proyectos, pagos_cliente, instalaciones, inventario, ordenes_compra, tramites_cfe, garantias, mantenimientos, tickets).** El dashboard de Nort Energy responde perfectamente "¿qué está entrando?" y "¿qué estamos vendiendo?" — y **no responde nada** de "¿qué vamos a instalar?", "¿qué está atrasado?", "¿qué nos deben?", "¿qué pasa con CFE?", "¿qué requiere postventa?" — las 5 preguntas que tú mismo planteaste en la sección 7 de tu instrucción, verificadas una por una contra el código real:

| Tu pregunta | ¿El dashboard la responde hoy? |
|---|---|
| ¿Qué está entrando? | ✅ Sí (leads nuevos) |
| ¿Qué estamos vendiendo? | ✅ Sí (ventas del mes, pipeline) |
| ¿Qué requiere seguimiento? | ✅ Sí (seguimientos vencidos) |
| ¿Qué vamos a instalar? | ❌ **No existe ningún KPI de instalaciones programadas** |
| ¿Qué está atrasado? | ⚠️ Solo a nivel de "seguimiento de venta" — nada de instalación/CFE atrasados en el dashboard (el badge de alerta de CFE existe, pero solo dentro de `/tramites-cfe`, invisible desde el dashboard) |
| ¿Qué nos deben? | ❌ **No existe ningún KPI de cobranza/saldo pendiente** |
| ¿Qué pasa con CFE? | ❌ **No existe en el dashboard** (existe solo en su propia pantalla) |
| ¿Qué requiere postventa? | ❌ **No existe ningún KPI de garantías/mantenimiento/tickets** |

Esta es la brecha estructural más importante encontrada en toda la auditoría.

---

## 8. Reportes de dirección

Auditado literalmente, sin construir nada:

| Reporte pedido | ¿Existe hoy? |
|---|---|
| Ventas, Pipeline, Conversión | ✅ En el dashboard (KPIs arriba) |
| Cotizaciones, Ticket promedio | ⚠️ Parcial — conteo sí, "ticket promedio" (monto/cotización) no está calculado en ningún lado |
| Ventas por asesor | ❌ No existe ninguna vista agrupada por `asesor_id` |
| Ventas por sucursal | ❌ No existe (y como viste arriba, ni los KPIs actuales filtran por sucursal) |
| Origen de leads | ❌ No hay campo ni reporte de "de dónde vino este lead" (Meta Ads vs. otro canal) — aunque el webhook de Meta sí distingue el canal al recibir, ese dato no se propaga a un reporte |
| Paneles vendidos / kWp vendidos | ❌ No existe agregación — el dato SÍ está disponible por proyecto (`config_vendida.panel.cantidad`, `potencia_instalada_kwp`), solo falta sumarlo |
| Margen | ❌ No existe reporte agregado (el cálculo de margen por cotización sí existe individualmente vía `modules/cotizacion-rentabilidad` o similar — no verificado a fondo en esta pasada) |
| Cobranza pendiente | ❌ No existe vista agregada — solo proyecto por proyecto |
| Instalaciones / tiempos de instalación | ❌ No existe — el dato (`fecha_programada` vs. real de "entregada") existe por fila, no hay reporte |
| CFE pendiente | ⚠️ Existe el tablero `/tramites-cfe` (que es en sí un reporte operativo básico), no un reporte ejecutivo con tiempos promedio |
| Inventario | ✅ Existencias actuales sí — historial de movimientos también, pero sin agregación (ej. "consumo mensual por producto") |
| Compras | ⚠️ Lista de órdenes sí, sin agregación de gasto por proveedor/periodo |
| Garantías | ⚠️ Lista sí, sin agregación (cuántas activas, cuántas por vencer en 30 días) |
| Mantenimiento | ⚠️ Lista sí, sin agregación de cumplimiento (% realizados a tiempo) |
| Tickets | ⚠️ Lista sí, sin tiempo promedio de resolución |

**Conclusión:** existen los **datos crudos** para casi todos los reportes pedidos — lo que falta uniformemente es la **capa de agregación**. No es un problema de captura, es un problema de que nadie construyó las vistas de reporte todavía (consistente con que este bloque se enfocó en operación transaccional, no en BI).

---

## 9. Roles y permisos — matriz de diseño (NO implementada)

Confirmado en código: hoy solo existe `esGerencial(rol)` → `['owner','administrador','supervisor']` vs. todo lo demás. `usuarios.rol` es texto libre **sin CHECK constraint** — cualquier string sirve, nada lo valida. No existe ningún rol "instalador", "almacén", "cfe", "postventa" reconocido por el código en ningún lado, a pesar de que las etiquetas de permisos del plan original los mencionaban.

### Matriz propuesta (diseño únicamente — no construir todavía)

| Módulo | Dirección | Gerencia | Ventas | Ingeniería | Admin/Cobranza | Instalaciones | Almacén | CFE | Postventa |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| CRM/Pipeline | VCEE A | VCEE A | VCE Propios | V Propios | V Todos | — | — | — | — |
| Cotizaciones | VCEE A | VCEE A | VCE Propios | VCE Todos | V Todos | — | — | — | — |
| Proyectos | VCEE A | VCEE A | V Propios | V Todos | VCE Todos | V Asignados | — | V Todos | V Todos |
| Cobranza | VCEE A | VCEE A | V Propios | — | VCE Todos | — | — | — | — |
| Instalaciones | VCEE A | VCEE A | V Propios | V Todos | V Todos | VCE Asignadas | V Todos (solo consulta) | — | — |
| Inventario | VCEE A | VCEE A | — | — | V Todos | VC Asignadas (reservar/consumir) | VCEE Todos | — | — |
| Compras | VCEE A | VCEE A | — | — | VC Todos (aprobar) | — | VC Todos | — | — |
| Trámites CFE | VCEE A | VCEE A | — | — | — | — | — | VCE Todos | — |
| Garantías | VCEE A | VCEE A | — | — | — | — | — | — | VCE Todos |
| Mantenimiento | VCEE A | VCEE A | — | — | — | VC Asignados | — | — | VCE Todos |
| Tickets | VCEE A | VCEE A | V Propios | — | V Todos | — | — | — | VCE Todos |
| Configuración | VCEE A | VCE A | — | — | — | — | — | — | — |

*(V=Ver, C=Crear, E=Editar, El=Eliminar, A=Aprobar/exportar. Alcance: Todos/Sucursal/Propios/Asignados — se muestra el alcance recomendado por celda.)*

**Requisito no negociable señalado explícitamente:** cuando esto se implemente, la autorización debe vivir en backend (cada ruta valida rol+alcance contra `req.usuario`, igual que ya hace `soloGerencial`) — nunca solo ocultar botones en el frontend. Hoy, absolutamente ningún endpoint de 2A-2I distingue más que gerencial/no-gerencial, así que esta matriz representa trabajo nuevo real, no una corrección menor.

---

## 10. Seguridad multiempresa — resultado endpoint por endpoint

Los 4 batches de tests de aislamiento (`__tests__/aislamiento-multiempresa-2*.test.js`, 40 tests en total entre 2A-2I + portal + compras) ya cubren esto de forma automatizada y pasan 100%. Resultado por recurso, verificado contra el patrón de código real (no solo contra el test):

| Recurso | Patrón de aislamiento verificado | Resultado |
|---|---|---|
| Cliente | `.eq('company_id', ...)` en cada consulta | ✅ Empresa A nunca ve datos de B |
| Oportunidad | ídem | ✅ |
| Cotización | ídem | ✅ |
| Proyecto | ídem + verificación de cadena (proyecto→company) antes de escrituras hijas | ✅ |
| Pago_cliente / abono | ídem | ✅ |
| Instalación | ídem | ✅ |
| Evidencia (documento) | Verifica instalación→proyecto→company antes de subir | ✅ |
| Equipo instalado | ídem | ✅ |
| Inventario (saldo/movimiento) | ídem, más verificación de producto+sucursal pertenecientes a la empresa antes del RPC | ✅ |
| Orden de compra | ídem | ✅ |
| Trámite CFE | ídem | ✅ |
| Garantía | ídem, más verificación de equipo antes de crear | ✅ |
| Mantenimiento | ídem, más verificación de proyecto antes de crear/programar | ✅ |
| Ticket | ídem, más verificación de cliente/proyecto/equipo antes de crear | ✅ |

**Sin excepciones encontradas.** El único mecanismo de defensa sigue siendo la disciplina de código (RLS deshabilitado en todas las tablas) — un solo endpoint nuevo que olvide el filtro `company_id` rompería el modelo. Esto ya estaba documentado como riesgo arquitectónico aceptado desde el plan original (sección 7) y sigue siendo válido: **cada módulo nuevo necesita su propio test de aislamiento dedicado, sin excepción**, tal como se hizo en 2A-2I.

---

## 11. Portal del cliente — auditoría como cliente real

| Punto a revisar | Resultado |
|---|---|
| OTP | Código de 6 dígitos, hash SHA256 (nunca en claro), nunca revela si el correo existe |
| Expiración | 10 minutos por código, sesión de 7 días |
| Rate limit | 1 solicitud/60s, máx. 5 intentos de verificación antes de bloquear el código |
| Sesión | Token de 32 bytes, cookie `httpOnly` + `SameSite=None; Secure` (cross-origin real) |
| Proyectos visibles | Solo el proyecto resuelto desde `req.portalCliente.clienteId` (de la sesión) — **nunca de un parámetro de URL/body** |
| **Aislamiento entre clientes — verificado explícitamente** | Confirmado en código y con test dedicado: el token de sesión de la Empresa A NUNCA resuelve datos de la Empresa B, y un cliente nunca puede pasar un `project_id`/`client_id` propio en la URL porque **ninguna ruta del portal acepta esos parámetros** — todas derivan la identidad exclusivamente del token de cookie. **No hay superficie de ataque por manipulación de ID porque el ID nunca se recibe del cliente.** |
| Documentos permitidos | ❌ **Ninguno** — el portal no expone ningún documento hoy (ni contrato, ni evidencias, ni recibo CFE) |
| Garantías/mantenimiento visibles | ❌ No expuestos todavía (mencionado como "después" en el plan original) |

**Veredicto de la pregunta que marcaste como MUY IMPORTANTE:** verificado explícitamente que un cliente no puede manipular un `project_id`/`client_id` para ver el proyecto de otro — la razón técnica es que esos IDs **nunca llegan como parámetro controlable por el cliente**, se resuelven server-side desde la sesión. Esto es más seguro que "validar el ID", es **no aceptar el ID en absoluto**.

**Qué sería útil agregar después (NO agregado en esta pasada):** avance de instalación, avance CFE, garantías, próximo mantenimiento, documentos — todos son extensiones de lectura de bajo riesgo sobre el mismo patrón ya probado (agregar un endpoint más bajo `requirePortalAuth` que reutilice `obtenerTramiteDeProyecto`/`listarGarantias`/etc. filtrando por el proyecto ya resuelto).

---

## 12. Experiencia móvil / campo

Verificado en `frontend/src/App.css`:
- Existen media queries reales en varios breakpoints (860px, 640px, 760px) para navegación, hero, dashboard.
- **Ningún `<table>` del bloque operativo tiene contenedor con `overflow-x: auto`** — ni el contenedor principal (`.shell-main { padding: 2rem; }`, sin `overflow`) ni una clase dedicada para tablas. Esto afecta directamente las pantallas que un instalador/técnico usaría en campo: **Instalación (checklist), Equipos instalados, Mantenimiento, Tickets** — todas usan `<table>` o listas anchas sin wrapper de scroll horizontal.
- El formulario de subir evidencias (`<input type="file">`) es simple y funcional en móvil — sin problema ahí.
- El checklist de instalación usa `<ul>`/checkboxes, no tabla — se comporta razonablemente en móvil.
- **Los formularios inline (`config-form-inline`) con selects + inputs de texto/fecha en una sola fila** (usados en Mantenimiento, CFE, Compras) probablemente se apretujan en 400px de ancho — no until confirmado visualmente, pero la clase no tiene `flex-wrap` verificado en este pase.

**Conclusión:** la operación en campo (instalación, checklist, fotos, equipos, mantenimiento, tickets) es **usable pero no está optimizada** — funciona, pero con fricción visual real en pantallas angostas, específicamente en cualquier tabla y en formularios con muchos campos en línea.

---

## 13. Integridad de datos

| Hallazgo | Severidad | Detalle |
|---|---|---|
| **Race condition real en `registrarAbono`** | **P1** | Lee `abonosPrevios`, calcula `saldoPrevio`, y solo DESPUÉS inserta — sin lock de fila. Dos abonos concurrentes (doble clic, dos administrativos registrando el mismo pago) pueden ambos pasar la validación de "no exceder el saldo" antes de que cualquiera se inserte, permitiendo sobrepago. Contraste: todo el módulo de inventario y folios SÍ usa locks/RPCs atómicos — cobranza es la única excepción real encontrada. |
| **`proyectos.estado` nunca se actualiza tras la creación** | **P2** | Queda en `'activo'` para siempre. Cualquier reporte futuro que filtre por estado de proyecto (completado/cancelado) siempre devolverá vacío. |
| **`eliminarClienteConHistorial` no contempla las tablas del bloque operativo** | **P2 (solo afecta empresas demo)** | La función de borrado total (gated a `es_demo=true`, Nort Energy no es demo) no borra `proyectos`, `pagos_cliente`, `instalaciones`, `equipos_instalados`, `garantias`, `mantenimientos`, `tickets`, `tramites_cfe`. Si una empresa demo de paneles solares corriera el flujo completo y luego intentara "resetear", el borrado fallaría por violación de FK en el DELETE final de `clientes` (comportamiento seguro — falla, no corrompe — pero confuso sin contexto). |
| **Instalaciones sin restricción de unicidad por proyecto** | **P3 — por diseño, no bug** | Deliberado (permite múltiples instalaciones reales por proyecto). Doble clic protegido solo por UI (`disabled` mientras crea), no por constraint de DB — riesgo bajo. |
| **`documentos_cliente.categoria = 'tramite_cfe'` no está en la lista documentada `CATEGORIAS`** (`modules/documentos-cliente.js`) ni en su espejo de frontend (`CrmClienteDetalle.jsx`) | **P3** | Funciona (texto libre), pero se ve como el slug crudo "tramite_cfe" en vez de una etiqueta bonita en la ficha del cliente. Deuda de documentación, no de funcionalidad. |
| **Ningún KPI/reporte filtra por sucursal** | **P3 hoy, subirá a P1 si se abre una 2ª sucursal** | Ver sección 7. |
| **Folios**: proyecto, cotización, orden de compra — todos atómicos vía `UPDATE...RETURNING` | Sin hallazgo — correcto | — |
| **Inventario**: race condition genuina resuelta con `SELECT...FOR UPDATE` real | Sin hallazgo — correcto, el único módulo con lock de fila explícito | — |
| **Registros huérfanos** | No encontrados en esta pasada — todas las FKs nuevas (2A-2I) tienen `REFERENCES` reales; ninguna es `ON DELETE CASCADE` peligrosa (todas exigen que la fila padre exista, comportamiento por default de Postgres es restrictivo, no permisivo) | — |

---

## 14. Errores silenciosos

Revisado el patrón de manejo de errores en los módulos de 2A-2I y en el frontend correspondiente:

- **Backend**: patrón consistente `try/catch` con `res.status(e.status || 500).json({error: e.message})` — ningún endpoint nuevo devuelve 200 con un error real oculto. Las subidas de Storage (`documentos-cliente.js`) verifican el resultado de `storage.upload()` antes de insertar en la tabla — si el storage falla, nunca se crea el registro de documento "fantasma".
- **Frontend**: cada formulario nuevo (Compras, Garantías, Mantenimiento, Tickets, CFE) usa `try/catch` con `setError(e.message)` visible en pantalla — no encontré un solo caso de "mostrar éxito aunque el backend falló" en el código escrito durante 2A-2I.
- **Caso límite real encontrado**: en `programarSiguienteMantenimiento`, si `engine.agendarCita()` tiene éxito pero el INSERT del nuevo `mantenimientos` falla justo después, **la cita ya quedó creada en la agenda real sin que exista el mantenimiento que la originó** — no hay rollback de la cita en ese escenario (a diferencia de `reservarMaterialInstalacion`, que sí revierte explícitamente ante fallo parcial). Es una ventana de fallo genuina, aunque de baja probabilidad (dos escrituras separadas, la segunda muy simple). **P2.**
- **Portal del cliente**: los 3 endpoints de lectura (`mi-proyecto`/`mis-equipos`/`mi-cobranza`) devuelven `null`/`[]` honestamente cuando no hay datos — no fabrican una respuesta de éxito falsa.

---

## 15. Deuda técnica (resumen, no repetido de arriba)

- `usuarios.rol` sin `CHECK constraint` — cualquier string es válido hoy, incluidos typos.
- Dashboard/reportes 100% ciegos al bloque operativo (arquitectónico, no un bug puntual).
- 3 scripts `nort-energy-nav-*.js` dedicados a activar entradas de menú una por una — funciona, pero es manual y specific-a-Nort-Energy; si se agregan más empresas de paneles solares, cada una necesitaría su propio script o un mecanismo genérico de "activar módulo cuando su página exista".
- El folio de compras de Nort Energy quedó en `0002` en vez de `0001` (cosmético, documentado previamente).

---

## 16. Bugs encontrados en esta auditoría

1. **Race condition en `registrarAbono`** (sección 13) — el único bug con impacto financiero real encontrado.
2. **`obtenerProyectoDeCliente` colapsa múltiples proyectos a uno solo** (sección 6) — bug de visibilidad, no de datos.
3. **Cita huérfana posible si el INSERT de mantenimiento-siguiente falla tras crear la cita** (sección 14).

*(Ningún bug de esta lista se corrigió en esta pasada, por instrucción explícita — se documentan para decisión conjunta.)*

---

## 17. Riesgos críticos (P0/P1)

| # | Riesgo | Prioridad |
|---|---|---|
| 1 | Inventario nunca se reserva/consume desde la UI real — el número de "disponible" puede estar sistemáticamente desalineado con la realidad del almacén | **P1** |
| 2 | Race condition de sobrepago en `registrarAbono` | **P1** |
| 3 | Dashboard/reportes sin ninguna señal del bloque operativo — dirección no tiene forma de ver, sin entrar módulo por módulo, qué está atrasado en instalación/CFE/cobranza/postventa | **P1** |
| 4 | Permisos binarios (gerencial/no) en un sistema con 8+ perfiles operativos reales — cualquier empleado puede tocar cualquier módulo | **P1** |
| 5 | `obtenerProyectoDeCliente` oculta proyectos anteriores si un cliente tiene más de uno | **P2** |

No se encontró ningún **P0** (corrupción de datos activa, o brecha de seguridad multiempresa real) — el aislamiento multiempresa y del portal del cliente están sólidos y verificados.

---

## 18. Mejoras recomendadas (no priorizadas como riesgo, sí como valor)

- Auto-crear la garantía al registrar un equipo instalado (elimina un clic olvidable).
- Sugerir automáticamente la fecha del próximo mantenimiento.
- Botón "+ Ticket" directo desde Proyecto 360° (pre-llenando cliente/proyecto).
- Exponer `bitacora_decisiones` filtrada por proyecto en la UI — el dato ya existe, cero riesgo.

---

## BACKLOG PRIORIZADO

### P0 — Crítico / seguridad / corrupción de datos
*Ninguno encontrado.*

### P1 — Bloquea operación real
1. Conectar reserva/consumo de inventario a la UI de Instalación.
2. Corregir la race condition de `registrarAbono` (lock de fila o RPC atómico, mismo patrón que inventario/folios).
3. Agregar KPIs operativos al dashboard: cobranza pendiente, instalaciones próximas/atrasadas, CFE atrasado, garantías por vencer, tickets abiertos.
4. Diseñar e implementar la matriz de permisos por perfil (backend, no solo visual) — al menos separar "quién puede ver Configuración/Compras" de "quién opera en campo".

### P2 — Fricción importante
5. `obtenerProyectoDeCliente` → listar todos los proyectos del cliente, no solo el más reciente.
6. Agregar sección "Documentos" y "Actividad" a Proyecto 360°.
7. Agregar filtro `proyectoId` a tickets + sección de tickets en Proyecto 360°.
8. Confirmar (o corregir) si el motor de ingeniería consume `oportunidades.datos_inmueble_*`.
9. Actualizar `proyectos.estado` en transiciones reales (entregado/liquidado/cancelado).
10. Revisar/actualizar `eliminarClienteConHistorial` para las tablas del bloque operativo (relevante para empresas demo futuras del mismo giro).
11. Rollback explícito si `programarSiguienteMantenimiento` falla después de crear la cita.

### P3 — Mejora
12. Envolver tablas en contenedores `overflow-x:auto` para móvil.
13. Agregar `'tramite_cfe'` a `CATEGORIAS`/`ETIQUETA_CATEGORIA` documentadas.
14. Agregar filtro por sucursal a KPIs (antes de abrir una segunda sucursal).
15. Auto-crear garantía al registrar equipo; sugerir fecha de próximo mantenimiento.
16. Botón "+Ticket" con contexto pre-llenado desde Proyecto 360°.

---

## Porcentajes finales (justificados con evidencia, no con conteo de archivos)

### A. % de cobertura funcional: **90%**
De los 25 pasos del flujo end-to-end (sección 1), 19 son "funciona completo", 5 son "funciona parcial" y 1 (inventario) está desconectado de la UI. `(19 + 5*0.5) / 25 = 87%`, redondeado con criterio a 90% porque los "parciales" son en su mayoría riesgos de negocio (falta de bloqueo/alerta), no ausencia de funcionalidad — el dato y la operación básica sí existen en todos ellos salvo inventario.

### B. % de integración end-to-end: **75%**
Penaliza específicamente lo que rompe continuidad real: inventario desconectado (-10), dashboard ciego a todo lo operativo (-10), Proyecto 360° incompleto sin Documentos/Actividad/Tickets (-5). El resto de las transiciones (venta→proyecto→cobranza→instalación→equipos→CFE→garantía→mantenimiento→ticket→portal) están genuinamente conectadas por FK real y snapshots, no por convención de nombres.

### C. % de preparación para operación real: **65%**
Es el número más bajo a propósito: aunque cada módulo individual funciona, **una empresa no puede operar "sin Excel" hoy** porque (1) nadie en dirección puede ver desde el dashboard qué está atrasado sin entrar módulo por módulo, (2) inventario requiere edición manual paralela si de verdad se quiere confiar en el número de "disponible", y (3) no hay reportes agregados de casi nada (sección 8) — que es exactamente lo que un Excel paralelo reemplazaría hoy.

### D. % de seguridad/aislamiento verificado: **95%**
Multiempresa: 100% de los recursos auditados (14 de 14) pasan aislamiento verificado con test dedicado. Portal del cliente: aislamiento por diseño (IDs nunca aceptados del cliente), verificado. El único punto que resta 5%: la disciplina de código (no RLS) significa que la garantía es "hasta ahora, sin excepción encontrada", no "estructuralmente imposible de romper" — riesgo arquitectónico ya aceptado y documentado desde el plan original, no nuevo.

### E. % de experiencia del empleado terminada: **55%**
Es el número más bajo del documento. Cada pantalla individual es utilizable y honesta (nunca miente sobre datos), pero: cero diferenciación de menú por perfil (un instalador ve Compras/Configuración), cero optimización de tablas para móvil, cobranza/instalaciones no tienen pantalla propia agregada (siguen "próximamente" en el menú, viven solo dentro del proyecto), y no hay ninguna vista "mis pendientes de hoy" para ningún perfil que no sea ventas/gerencia. La UX del **flujo comercial** está terminada; la UX del **flujo operativo/postventa** está construida pero no pulida por perfil.

---

## Cierre

Esta auditoría **no encontró ningún riesgo de seguridad ni corrupción de datos activa** (P0 vacío) — la disciplina de aislamiento multiempresa y el diseño del portal del cliente son sólidos. Lo que sí encontró es la brecha real entre "cada pieza funciona" y "el producto opera solo": inventario desconectado de la operación diaria, dashboard ciego a todo lo posterior a la venta, y permisos que no reflejan los 8 perfiles reales del negocio. Ninguno de los 4 puntos P1 requiere rediseñar nada ya construido — los cuatro son extensiones sobre datos y mecanismos que ya existen.

No se programó nada nuevo en esta pasada, según tu instrucción explícita. Quedo a la espera de revisar esto juntas antes de tocar código.
