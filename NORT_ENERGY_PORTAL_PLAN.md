# NORT_ENERGY_PORTAL_PLAN.md

**Auditoría y plan de implementación — Portal operativo de Nort Energy dentro de TARA Matrix**
Fecha de auditoría: 2026-09-09. Repositorio: `/Users/alinanavarro/Downloads/tara-ttracks` (`totalracks-whatsapp-twilio`, desplegado en Render como servicio `totalracks-whatsapp-twilio`).

Este documento es el resultado de la auditoría solicitada — **no se ha modificado código ni base de datos de producción para escribirlo**, salvo las lecturas de solo consulta necesarias para confirmar esquemas reales.

---

## A. Estado actual

TARA Matrix es una plataforma SaaS multi-tenant (Node.js/Express + Supabase/Postgres + React/Vite) que hoy da servicio real a ~16 empresas, entre ellas Total Racks (la empresa original, con el Core más probado), varios salones de belleza, y tres empresas de paneles solares: **Empresa Demo Paneles Solares** (demo), **Nort Energy** (real, con WhatsApp conectado) y **GONDOR** (real, sin WhatsApp conectado aún).

La arquitectura sigue el patrón **"Motor Universal"**: el comportamiento específico de una industria vive como **datos** (`plantillas_industria`, `ui_config`, `dashboard_kpis_seed`, `nav_labels` por empresa), nunca como ramas `if industria` en el código. El Core conversacional (`WorkflowEngine`, `Orchestrator`, `ContextBuilder`, `PromptBuilder`, `AIProvider`, `ChannelAdapter`, `SchedulingEngine`, `CalendarProvider`, `ActionRunner`, `google-auth.js`) está **congelado** (ADR-005, `docs/ARQUITECTURA-CONGELADA-v1.0.md`) — no se modifica salvo causa justificada, documentada y aprobada.

Aislamiento multiempresa: **`company_id` es invariante en toda tabla**, filtrado en cada query desde el backend. **RLS está deshabilitado en absolutamente todas las tablas revisadas** — el aislamiento se garantiza 100% por disciplina de código (`req.usuario.company_id` en rutas autenticadas, `supabaseServicio` de service_role solo en webhooks/cron sin usuario final), no por políticas de Postgres. Esto es una decisión arquitectónica ya asumida en todo el sistema, no un descuido — pero significa que cualquier tabla nueva debe seguir exactamente el mismo patrón (nunca confiar en que "Supabase ya lo aísla").

---

## B. Qué ya existe (reutilizable directo, sin tocar Core)

| Área | Ya existe | Dónde |
|---|---|---|
| Multiempresa + roles base | `usuarios`, `usuarios_empresas` (rol: owner/administrador/supervisor/asesor, texto libre sin CHECK), `sucursal_id` ya en esta tabla | `migrations/025`, `076` |
| CRM | `clientes` (ya con dirección, código postal, entidad/estado, lat/lng, notas, asesor_id), `oportunidades` (con `tipo_rack` heredado de Total Racks, probabilidad, presupuesto_estimado/confirmado) | `modules/crm.js`, `crm-ui.js` |
| Pipeline visual | `CrmPipeline.jsx` — tablero drag-and-drop funcional sobre `pipeline_etapas` (configurable) y `oportunidades` | `frontend/src/pages/CrmPipeline.jsx` |
| Cotizador solar | Motor de ingeniería completo (`modules/motores-ingenieria/paneles-solares.js`), catálogo `productos` (panel/inversor con specs reales), `paquetes_solares`, workflow WhatsApp "Cotización directa" (6 nodos) ya replicado en Nort Energy | `modules/cotizaciones.js`, `scripts/nort-energy-cotizador-setup.js` |
| Cotizaciones — versionado y comerciales | `cotizaciones` ya tiene: `subtotal/iva/total`, `anticipo_pct`, `forma_pago`, `vigencia_dias`, `condiciones_comerciales`, `precio_final_autorizado`, `folio`, `version`, `cotizacion_padre_id`, `pdf_url`, gate de aprobación (`ingenieria_validada_para_cotizar_en/por`) | `migrations/088, 093, 094, 097` |
| PDF de cotización | Generación real (Puppeteer) + subida a Storage + envío por WhatsApp | `modules/cotizacion-pdf.js` |
| Agenda / citas | `SchedulingEngine` (Core, congelado) — multi-asesor, horarios por sucursal/asesor, doble-reserva con overlap real, Google Calendar opcional por empresa | `modules/scheduling-engine.js`, `modules/agenda.js` |
| Atribución de leads / WhatsApp Ads | **Ya construido en esta misma sesión**: `atribucion_leads` (telefono, company_id, hilo_id, cliente_id, `campaign_id`, `campaign_name`, `source_url`, `source_type`, `ctwa_clid`, `utm_*`, `gclid`, `fbclid`, `referral_metadata` jsonb crudo, `mensaje_texto`, jerarquía de 5 niveles de resolución) + `campanas_landing` (tokens de landing pages) | `modules/lead-atribucion.js`, `migrations/099-100` |
| Sucursales | Tabla `sucursales` (nombre + dirección, recién agregada) + `usuarios_empresas.sucursal_id`, `channel_endpoints.sucursal_id`, `hilos.sucursal_id` — **Nort Energy ya tiene su sucursal "Local Comercial CD VICTORIA - Local A" registrada** | `migrations/076`, `101` |
| Tareas/pendientes | Tabla `tareas` YA EXISTE (titulo, estado, responsable_id, fecha_limite, cliente_id, oportunidad_id, **proyecto_id**) — genérica, funcional, sin UI de panel todavía | `migrations/074` |
| Proyectos + bitácora | `proyectos` (estado/riesgo) y `bitacora_decisiones` — genéricos, "Modo Operador", sin UI de panel todavía | `migrations/074` |
| Notas/documentos de texto | Tabla `documentos` YA EXISTE — **pero es texto/markdown plano, NO archivos** (explícitamente diseñado así, ver comentario en la migración) | `migrations/074` |
| Storage de archivos reales | Patrón ya probado 2 veces: buckets privados + `createSignedUrl()` (`inbox-adjuntos`, `cotizaciones-pdf`) | `modules/inbox-adjuntos.js`, `modules/cotizacion-pdf.js` |
| Navegación por empresa | `companies.nav_labels` (jsonb) sobreescribe `plantillas_industria.ui_config` **por empresa individual**, incluyendo el arreglo completo `modulos` del menú — mecanismo ya en producción | `modules/auth.js::obtenerEmpresasDeUsuario()` |
| Dashboard por KPIs | Motor Universal de KPIs — registro de tipos (`conteo_oportunidades_por_estado`, `suma_oportunidades_mes`, `conteo_cotizaciones_por_estado`, etc.) interpretando `plantillas_industria.dashboard_kpis_seed` | `modules/dashboard-engine.js` |
| Branding por empresa | `companies.logo_url`, `color_acento` ya por empresa — Nort Energy puede tener su identidad sin tocar código | `companies` |

---

## C. Qué falta (no existe en absoluto hoy)

Confirmado por consulta directa a la base de datos real — estas tablas **no existen**:

- `instalaciones` / `equipos_instalados` (nada de checklist, cuadrilla, números de serie, fotos por etapa)
- `tramites_cfe`
- `garantias`
- `mantenimientos`
- `tickets` (postventa)
- `inventario` / `movimientos_inventario` (existencia, reservado, disponible)
- `compras` / `ordenes_compra` / `proveedores`
- `pagos` de **cliente final** (la tabla `pagos` que existe es exclusivamente la facturación de TARA a la organización por su suscripción — NO se puede ni se debe reutilizar para cobranza de Nort Energy a sus clientes; son dos negocios distintos)
- Ningún archivo real adjunto a cliente/proyecto (solo el recibo CFE que llega por WhatsApp queda como adjunto de conversación — no está modelado como "documento del expediente")
- Búsqueda global (no existe ningún endpoint de búsqueda cross-entidad)
- Roles granulares por departamento (hoy solo `owner/administrador/supervisor/asesor`, sin distinguir Ventas/Ingeniería/Instalaciones/CFE/Cobranza/Almacén/Postventa)
- Historial de movimientos de etapa en el pipeline (se puede ver el estado actual, no cuánto tiempo estuvo en cada etapa ni quién lo movió)
- `sucursal_id` en `clientes`, `oportunidades`, `cotizaciones`, `citas`, `productos`, `paquetes_solares` (solo empleados y canales están asociados a sucursal hoy)

---

## D. Qué debe modificarse (aditivo, sobre tablas existentes)

Todo lo siguiente es **`ALTER TABLE ... ADD COLUMN`, nullable, aditivo** — cero riesgo para Total Racks ni otras empresas, porque son columnas nuevas que el resto del sistema simplemente no usa:

- `clientes`: `rfc`, `colonia`, `municipio` (hoy solo hay `ciudad`/`entidad`), `whatsapp` (si se quiere distinguir de `telefono`), `sucursal_id`
- `oportunidades`: `sucursal_id`, `numero_paneles`, `proxima_accion_fecha` (ya existe `proxima_accion` como texto y `fecha_seguimiento` — revisar si ya cubre esto antes de agregar), `campo` de días-en-etapa se calcula, no se guarda
- `cotizaciones`: `descuento_pct`/`descuento_monto` explícito (hoy solo hay `condiciones_comerciales` como texto libre)
- `citas`: nada nuevo requerido — ya tiene `notas`, `servicio_id`, `precio_cobrado`
- `asesores`: `tipo` o `rol_operativo` (ej. `vendedor`/`instalador`/`tecnico`) — hoy es un pool plano sin distinción de función
- `productos`: columnas de inventario (`existencia`, `reservado`) — **decisión de diseño pendiente, ver sección F**

---

## E. Qué debe crearse (nuevo, aditivo)

Tablas nuevas — todas con `company_id NOT NULL REFERENCES companies(id)`, RLS deshabilitado (mismo patrón que el resto del sistema), índices por `company_id` + el campo de filtro más usado:

1. **`instalaciones`** — cliente_id, oportunidad_id/cotizacion_id, sucursal_id, numero_paneles, marca/modelo panel, inversor, microinversores, estructura, capacidad_kwp, fecha_programada, cuadrilla (texto o FK a un futuro `empleados`), tecnico_responsable_id, vehiculo, estado (CHECK con los 9 estados que pediste), checklist (jsonb), created_at/updated_at.
2. **`instalacion_evidencias`** — instalacion_id, tipo (`foto_antes|foto_durante|foto_despues|panel|inversor|proteccion|medidor|prueba|documento_firmado`), storage_path, numero_serie (nullable), subido_por, created_at.
3. **`tramites_cfe`** — instalacion_id o cliente_id, tipo_tramite, estado, fecha_ingreso, fecha_actualizacion, responsable_id, observaciones, medidor_bidireccional (boolean).
4. **`tramite_cfe_documentos`** — mismo patrón de evidencias.
5. **`garantias`** — instalacion_id, producto/equipo, marca, modelo, numero_serie, fecha_instalacion, meses_garantia, proveedor, estado.
6. **`garantia_reclamaciones`** — garantia_id, estado (abierta/diagnóstico/con proveedor/cambio autorizado/resuelta/cerrada), historial.
7. **`mantenimientos`** — instalacion_id, tipo, fecha_programada, fecha_realizada, proximo_mantenimiento, responsable_id, observaciones.
8. **`tickets`** — cliente_id, instalacion_id, tipo, prioridad, estado, responsable_id, historial (o tabla `ticket_eventos` aparte).
9. **`inventario_movimientos`** — producto_id, tipo (`entrada|salida|reserva|liberacion`), cantidad, instalacion_id (si aplica), sucursal_id, created_at — **más simple y más seguro que agregar `existencia` directo a `productos`** (evita condiciones de carrera, da historial real). `existencia_actual` se calcula sumando movimientos, o se cachea con un trigger si el volumen lo justifica.
10. **`proveedores`**, **`ordenes_compra`**, **`orden_compra_items`** — proveedor, material solicitado/recibido, costos, fechas, saldo.
11. **`pagos_cliente`** (nombre deliberadamente distinto de `pagos` para no confundir con la facturación SaaS de TARA) — cotizacion_id/venta, total, anticipo, pagos parciales (o tabla `pagos_cliente_abonos` 1:N), saldo, forma_pago, referencia, comprobante_storage_path, estado.
12. **`documentos_adjuntos`** (archivos reales, distinto del `documentos` de texto ya existente) — entidad_tipo (`cliente|oportunidad|instalacion|garantia|tramite_cfe`), entidad_id, categoria, storage_path, subido_por, created_at. Reusa el patrón de bucket + signed URL ya probado.
13. **`empleados`** (opcional, evaluar si `asesores` + un campo `tipo` basta, o si de verdad se necesita un concepto separado de "empleado" que no siempre agenda citas — ej. alguien de Almacén no necesita fila en `asesores`).

---

## F. Cambios de base de datos — resumen y riesgos

Todas las tablas nuevas son additive. El único punto que requiere una decisión de diseño explícita:

**¿Inventario como columna (`productos.existencia`) o como historial (`inventario_movimientos`)?** Recomiendo historial — es el patrón que ya usa el resto del sistema para todo lo que necesita auditoría (`decision_logs`, `bitacora_decisiones`), evita condiciones de carrera cuando dos personas reservan material al mismo tiempo, y permite el reporte de "Inventario" (sección 20) sin reconstruir historia. Lo confirmo contigo antes de la Fase 7.

**Riesgo de multiempresa**: cero, si cada tabla nueva respeta `company_id` desde el día uno y cada query nueva lo filtra — exactamente el mismo patrón ya usado en las 96 migraciones existentes. El riesgo real no es de diseño, es de disciplina de implementación turno a turno; cada fase de este plan incluye una verificación explícita de esto (ver sección L).

---

## G. Cambios de frontend

- **Navegación exclusiva de Nort Energy**: usar `companies.nav_labels.modulos` (ya soportado, cero cambio de Core) para agregar Instalaciones, Inventario, Garantías/Mantenimiento, Tickets, Cobranza al menú — **sin tocar el menú de GONDOR, la demo, ni ninguna otra empresa**, porque `nav_labels` es por `company_id`, no por `industria_slug`.
- Nuevas páginas: `Instalaciones.jsx` + `InstalacionDetalle.jsx`, `Inventario.jsx`, `TramitesCfe.jsx`, `Garantias.jsx`, `Mantenimientos.jsx`, `Tickets.jsx`, `Cobranza.jsx`, `ExpedienteCliente.jsx` (la vista 360° — probablemente una ampliación de `CrmClienteDetalle.jsx` existente con tabs nuevos, no una página nueva desde cero).
- `CrmPipeline.jsx`: ampliar tarjetas con días-en-etapa (calculado desde `updated_at` o desde un nuevo `oportunidad_historial_etapas`), próxima acción, número de paneles, probabilidad.
- Búsqueda global: nuevo componente en `Shell.jsx` + endpoint backend que consulta varias tablas por `company_id` + término.
- Dashboard: extender `dashboard-engine.js` con los KPI_TIPOS nuevos que dependan de las tablas de la sección E (no se pueden construir antes de que esas tablas existan).

---

## H. Cambios de backend

- Nuevos módulos siguiendo el patrón ya establecido (`modules/instalaciones.js`, `modules/inventario.js`, `modules/tramites-cfe.js`, `modules/garantias.js`, `modules/mantenimientos.js`, `modules/tickets.js`, `modules/cobranza.js`, `modules/proveedores.js`) — cada uno recibe `supabase` (ya con sesión), filtra por `company_id`, expone funciones puras testeables (mismo molde que `modules/agenda.js`/`modules/crm-ui.js`).
- Rutas nuevas en `server.js` bajo `requireAuth`, mismo molde que las ~90 rutas `/api/*` existentes.
- **`ejecutar_motor_ingenieria`** y el resto del motor de cotización se **reutilizan tal cual** — ninguna acción de ActionRunner nueva es necesaria para lo que pediste; instalaciones/inventario/etc. son módulos de panel (uso humano), no de conversación de WhatsApp.
- El registro de "cliente potencial + oportunidad" desde un lead de WhatsApp **ya está resuelto** por `lead-atribucion.js` (construido esta sesión) — no hay nada que hacer aquí salvo, opcionalmente, mostrar el origen (Facebook/Google/Orgánico) en la ficha de cliente y en reportes.

---

## I. Permisos

Esta es la brecha más grande del sistema actual frente a tu solicitud. Hoy:

- Solo 3 roles "ven todo" (`owner`, `administrador`, `supervisor` = `ROLES_GERENCIALES`) vs. todo lo demás cae en "solo lo suyo" — es **binario**, no departamental.
- `usuarios_empresas.rol` es texto libre sin restricción — técnicamente ya se puede insertar `'ventas'`, `'instalaciones'`, etc. hoy mismo sin migración.
- **Pero no existe ninguna lógica que interprete esos roles nuevos** — hay que construirla explícitamente para cada módulo (Ventas ve sus leads/cotizaciones, Instalaciones ve sus instalaciones asignadas, etc.), backend primero, nunca solo esconder botones en el frontend (como ya pediste explícitamente).

Propuesta: una función central `modules/permisos.js::puedeVer(rol, recurso, registro)` (o un mapa de reglas por rol × módulo), consultada en cada ruta nueva de instalaciones/CFE/inventario/etc. Los módulos YA existentes (agenda, CRM, conversaciones) seguirían funcionando exactamente igual — solo se extiende el catálogo de roles reconocidos para los módulos NUEVOS, sin romper el comportamiento actual de Total Racks ni de nadie con rol `owner/administrador/supervisor/asesor`.

---

## J. Integraciones

- **WhatsApp + atribución**: completo, ya construido y probado esta sesión (8/8 casos de prueba pasando) — nada nuevo que hacer aquí.
- **Google Calendar**: opcional por empresa vía OAuth (`google-auth.js`), Nort Energy hoy corre en `MockCalendarProvider` — conectarlo es una decisión de negocio tuya, no un bloqueo técnico. El Motor de Agenda ya soporta múltiples tipos de evento (citas comerciales, visitas, instalaciones) simplemente creando más filas de `citas` con `servicio_id` distintos — no requiere cambios de Core para la sección 7.
- **Motor de cotización**: reutilizado tal cual, cero duplicación.

---

## K. Riesgos

| Riesgo | Mitigación |
|---|---|
| Contaminar otras empresas vía `nav_labels`/`ui_config` compartido por industria | Usar `companies.nav_labels` (override por empresa individual), nunca tocar `plantillas_industria` de `paneles_solares` para agregar módulos exclusivos de Nort Energy — así GONDOR y la demo quedan intactas |
| Romper Total Racks al tocar módulos compartidos (CRM, Agenda) | Todo lo nuevo son tablas y rutas nuevas; los módulos compartidos (`crm.js`, `agenda.js`) no se modifican, solo se leen desde los módulos nuevos |
| Permisos "de mentiritas" (solo frontend) | Enforcement en backend desde el primer módulo nuevo, mismo patrón que `esGerencial()` ya usa en producción |
| Confundir `pagos` (SaaS) con cobranza de clientes | Nombre explícitamente distinto (`pagos_cliente`), documentado en la migración para que nadie lo reutilice mal en el futuro |
| Alcance — 25 secciones es un sistema ERP completo | Fases pequeñas, cada una entregable y verificable por separado (ver L) |

---

## L. Plan por fases

Confirmo tu orden propuesto, con una nota: **Fase 1 no requiere ninguna tabla nueva** — es 100% configuración (`nav_labels`, KPIs existentes) + UI. Esto la hace la fase más segura y rápida para validar el enfoque antes de comprometerse a las tablas nuevas de las fases siguientes.

1. **Arquitectura + navegación + permisos base + dashboard con KPIs ya existentes** (sin tablas nuevas)
2. **CRM ampliado + expediente 360° + pipeline con historial** (extiende `clientes`/`oportunidades`, agrega `oportunidad_historial_etapas`)
3. **Recibo CFE + ingeniería + cotizaciones** — ya construido, esta fase es solo pulir UI/UX si hace falta
4. **Ventas + cobranza** (`pagos_cliente`)
5. **Instalaciones + calendario + checklist + evidencias** (`instalaciones`, `instalacion_evidencias`)
6. **CFE + documentación** (`tramites_cfe`)
7. **Inventario + compras + proveedores**
8. **Garantías + mantenimiento + postventa**
9. **Reportes + automatizaciones + indicadores**
10. **QA, seguridad multiempresa, responsive, performance, producción**

Cada fase, sin excepción: (1) analizar impacto, (2) implementar, (3) migración, (4) pruebas reales (no solo unitarias — con datos de prueba desechables, patrón ya usado toda esta sesión), (5) corregir, (6) confirmar que Total Racks/GONDOR/demo siguen intactas, (7) commit descriptivo, (8) documentar.

---

## M. Criterios de aceptación (por fase, ejemplo Fase 1)

- El menú de Nort Energy muestra los módulos nuevos; el de Total Racks, GONDOR y la demo de paneles solares **no cambia en absoluto**.
- Un usuario con rol `asesor` en Nort Energy sigue viendo exactamente lo mismo que veía antes de esta fase.
- Dashboard de Nort Energy carga sin error y muestra al menos 5 KPIs reales (no inventados) usando datos existentes.
- Suite de tests completa (`npm test`) sigue en verde.
- Ninguna tabla existente fue alterada de forma destructiva.

(Criterios equivalentes, específicos, se definen al iniciar cada fase siguiente — no se listan los 10 aquí para no anticipar diseño antes de tu autorización.)
