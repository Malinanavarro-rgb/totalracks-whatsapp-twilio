# NORT_ENERGY_PORTAL_PLAN.md

**Bloque operativo principal — de "cotización aceptada" a "cliente con sistema instalado, en garantía y con postventa activa"**
Auditoría original: 2026-09-09. **Esta revisión: 2026-09-22**, después de las Fases 1-6 del Centro de Conocimiento, la Auditoría Expediente/Cotizador, y las 9 entregas del Cotizador Solar Inteligente (Propuestas, Simulador, Descuentos, BOM, Financiamiento, Margen/Markup, Datos del inmueble, Documentos del cliente, sincronización de presupuesto).

Este documento responde, en orden, las 10 preguntas del bloque operativo pedido: qué existe, qué se reutiliza, el modelo de datos completo, qué es CORE vs VERTICAL, el orden técnico, el riesgo multiempresa, contradicciones con la arquitectura congelada, y el % de avance. **No se ha escrito ni una sola línea de código de las subfases 2A-2I — es 100% diseño, a la espera de tu aprobación**, tal como pediste.

---

## 0. Respuestas directas a tus 10 puntos

1. **Qué existe** → sección 1.
2. **Qué se reutiliza / qué es nuevo** → sección 2 (tabla resumen) + sección 4 (detalle por subfase).
3. **Modelo de datos completo** → sección 4.
4. **Tablas nuevas exactas** → una por subfase, sección 4.
5. **Tablas existentes reutilizadas** → sección 2.
6. **Relaciones** → diagrama de la sección 3 + cada subfase.
7. **CORE TARA vs VERTICAL solar** → sección 5.
8. **Orden técnico correcto** → sección 6.
9. **Riesgo de aislamiento multiempresa** → sección 7 (mecanismo exacto + patrón obligatorio + tests).
10. **Contradicciones con la arquitectura congelada (ADR-005)** → sección 8: **ninguna.** Todo lo propuesto es tablas nuevas, módulos nuevos y rutas nuevas — el Core (`WorkflowEngine`, `Orchestrator`, `ContextBuilder`, `PromptBuilder`, `AIProvider`, `ChannelAdapter`, `SchedulingEngine`, `CalendarProvider`, `ActionRunner`) no se toca en ninguna subfase. El único punto donde un módulo nuevo *usa* al Core es 2C/2I, que crean citas (`agenda.js`) exactamente como ya lo hace cualquier otro flujo — sin modificarlo.
11. **% de avance antes de empezar** → sección 9: **0% de las subfases 2A-2I.** Lo que sí existe (cotizador, expediente, atribución de leads, agenda) es insumo, no parte de este bloque.

---

## 1. Qué existe hoy — auditoría en vivo (2026-09-22)

Confirmado por consulta directa a la base de datos real de producción, no asumido.

| Área | Estado real | Detalle |
|---|---|---|
| **Multiempresa + roles** | Completo | `usuarios` + `usuarios_empresas` (rol texto libre, hoy solo `owner\|administrador\|supervisor\|asesor` con filas activas), `sucursal_id` ya en `usuarios_empresas` |
| **Sucursales** | Parcial | Tabla `sucursales` (id, company_id, nombre, direccion, activo) — Nort Energy tiene 1 fila real. **Sin `sucursal_id` en `clientes` ni `oportunidades`** — sí en `cotizaciones`, `citas` (vía `servicio_id`→no, ver abajo), `hilos`, `usuarios_empresas` |
| **CRM** | Completo | `clientes` (27 columnas incl. `rfc`, `numero_servicio_cfe`, `tarifa_cfe`, `colonia`, `municipio`, `lat/lng`), `oportunidades` (43 columnas) — **confirmado: ninguna de las dos tiene `sucursal_id` todavía**, a diferencia de `cotizaciones`, que sí lo tiene desde la migración 102 |
| **Datos técnicos del inmueble** | Completo (2026-09-22) | `oportunidades.tipo_techo/orientacion_techo/inclinacion_techo_grados/sombras_presentes/sombras_descripcion/area_techo_m2/ubicacion_centro_carga/capacidad_centro_carga_a` + `datos_inmueble_capturado_por/en` |
| **Cotizador solar** | Completo | Motor de ingeniería puro, `productos` (28 columnas, incl. costos internos), `paquetes_solares`, 3 propuestas, simulador interactivo, BOM panel+inversor, descuentos con aprobación, financiamiento configurable, margen/markup interno — ver `modules/cotizaciones.js`, `propuestas-solares.js`, `cotizacion-lineas.js`, `cotizacion-descuento.js`, `planes-financiamiento.js`, `rentabilidad.js` |
| **Cotizaciones — estados** | Parcial, gap real encontrado hoy | `cotizaciones.estado` CHECK: `borrador\|enviada\|vista\|aceptada\|rechazada\|vencida`. **`aceptada_en` y `estado='aceptada'` se LEEN en `CotizacionDetalle.jsx` pero NINGÚN código los escribe nunca** — hoy es físicamente imposible que una cotización llegue a `'aceptada'`. Es el primer punto de la subfase 2A. |
| **Documentos del cliente** | Completo (2026-09-22) | `documentos_cliente` — subida manual + clasificar adjuntos de chat sin duplicar, bucket `documentos-cliente` privado + `inbox-adjuntos` referenciado |
| **Documentos de proveedor (fichas técnicas)** | Completo | `documentos_proveedor` + bucket propio — distinto propósito (catálogo interno, no expediente de cliente) |
| **PDF de cotización** | Completo | Puppeteer + bucket `cotizaciones-pdf` + envío WhatsApp |
| **Agenda / citas** | Completo (Core, congelado) | `SchedulingEngine`, `citas` (`asesor_id` FK a `asesores`, NO a `usuarios` directo; `servicio_id`, `precio_cobrado`, `notas`) |
| **Atribución de leads (Meta/WhatsApp Ads)** | Completo | `atribucion_leads` + `campanas_landing` — resolución de 5 niveles, ya probado |
| **"Proyectos" genéricos (Modo Operador)** | Existe, casi vacío, ya anticipa lo que pides | `proyectos` (nombre, descripcion, estado `activo\|pausado\|completado\|cancelado`, riesgo `bajo\|medio\|alto`) **YA TIENE** `oportunidad_id`/`cotizacion_id` (agregados en la migración 088, del propio Fase 1 del cotizador) — 1 sola fila real en producción, de Total Racks, no de Nort Energy. Usado hoy solo por `operador-tools.js::proyectosEnRiesgo` (IA de Modo Operador) |
| **Tareas** | Existe, casi vacía | `tareas` (titulo, estado, responsable_id, fecha_limite, cliente_id, oportunidad_id, **proyecto_id**) — 2 filas reales, de Total Racks |
| **Bitácora** | 3 sistemas distintos, ninguno cubre "cambios de negocio" | `decision_logs` (telemetría técnica IA), `bitacora_decisiones` (notas manuales de negocio, texto libre), `plataforma_audit_log` (acciones de Super Admin). Ninguno registra automáticamente "se movió de etapa X a Y" |
| **Documentos de texto (`documentos`)** | Existe, 0 filas | Markdown/texto plano, explícitamente NO archivos — no es lo que necesitamos para evidencias |
| **Storage real** | 5 buckets privados en producción | `inbox-adjuntos`, `cotizaciones-pdf`, `documentos-proveedor`, `documentos-cliente` (privados) + `imagenes-empresa` (público, logos) |
| **`pagos`** | Existe, **NO es cobranza de cliente** | Exclusivamente facturación de TARA a la organización por su suscripción SaaS — confirmado, nunca se debe reutilizar para dinero que un cliente le paga a Nort Energy |
| **Permisos** | Binario | Solo `esGerencial()` (ve todo de su empresa) vs. todo lo demás (solo lo suyo). Sin roles departamentales (instalador/técnico/CFE/almacén) |
| **Inventario / compras / instalaciones / CFE / garantías / mantenimiento / tickets** | **No existen — cero tablas, cero módulos** | Confirmado por consulta directa, no hay ni siquiera un intento previo |

---

## 2. Qué se reutiliza tal cual (regla: si ya existe, no se duplica)

| Necesitas | Usa esto, tal cual | Por qué no crear algo nuevo |
|---|---|---|
| Identidad del cliente, dirección, CFE | `clientes` (ya tiene `numero_servicio_cfe`, `tarifa_cfe`, `direccion`, `lat/lng`) | Ya completo para lo que 2A-2I necesitan leer |
| Snapshot técnico vendido | `cotizaciones.info_tecnica` (jsonb) + `calculos_ingenieria` (inmutable, versionado) + `cotizacion_lineas` | Ya es un snapshot real — el proyecto solo necesita apuntar a la versión de cotización ganadora, nunca recalcular |
| El "expediente post-venta" en sí | **`proyectos`**, extendida | Ya tiene `oportunidad_id`/`cotizacion_id`, `riesgo`, `estado` genérico. Evita el error de inventar un segundo concepto de "proyecto" |
| Pendientes operativos internos (ej. "confirmar fecha con el cliente") | **`tareas`**, tal cual | Ya tiene `proyecto_id` — cualquier tarea de instalación/CFE/cobranza es una fila más, sin tabla nueva |
| Fotos/documentos de un proyecto (evidencias, identificación, comprobante de pago) | **`documentos_cliente`**, extendida | Ya resuelve subida manual + clasificación de adjuntos de WhatsApp + bucket + URL firmada. Construir `instalacion_evidencias` aparte sería literalmente la misma tabla otra vez |
| Citas de visita técnica / instalación / mantenimiento | `citas` + `servicios` (tipo de cita) + `SchedulingEngine` | El motor de agenda ya resuelve traslapes, multi-asesor, recordatorios — no se reconstruye para "cita de instalación" |
| Quién puede ver qué | `modules/permisos.js::esGerencial()` + `req.usuario.company_id` | Se extiende (sección 5), no se reemplaza |
| Guardar archivos con seguridad | Patrón bucket privado + `createSignedUrl()` | Tercera vez que se usa este patrón (después de `inbox-adjuntos`/`documentos-proveedor`/`documentos-cliente`) — nunca reinventar storage |
| Precio, IVA, descuento, financiamiento de la venta | `cotizaciones` + `cotizacion_lineas` + `planes_financiamiento` | El proyecto no recalcula nada de esto — solo LEE la cotización ganadora |
| Costo real de cada equipo | `productos.costo_proveedor/costo_instalacion/costo_materiales/costo_interno_nort_energy` | `equipos_instalados` (nueva, ver 2D) guarda un snapshot del costo en el momento de instalar, pero el catálogo interno ya existe |

---

## 3. Relación entre entidades (diagrama textual)

```
cliente ──┬── oportunidad ──── cotización (versionada, folio, estado)
          │                         │
          │                         │ (al marcarla "aceptada" — acción nueva, 2A)
          │                         ▼
          └──────────────────── proyecto (=`proyectos`, extendida)
                                     │  snapshot: oportunidad_id, cotizacion_id, cliente_id,
                                     │  sucursal_id, asesor_id, ubicacion, config_vendida (jsonb)
                    ┌────────────────┼─────────────────┬──────────────┬───────────────┐
                    ▼                ▼                 ▼              ▼               ▼
             pagos_cliente    instalaciones      tramites_cfe    garantias      mantenimientos
             (2B)             (2C)               (2E)            (2H, nace     (2I)
                                  │                                de equipos)      │
                                  ▼                                                  │
                          equipos_instalados (2D) ─────────────────────────────────┘
                                  │
                                  ▼
                          documentos_cliente (2D, extendida: instalacion_id, fase)

inventario_movimientos (2F) ── reserva/consume material para una instalación
ordenes_compra (2G) ── genera entrada de inventario al recibirse
tickets (2I) ── referencia cliente + proyecto + opcionalmente equipo_instalado
tareas (existente) ── proyecto_id ya soportado, se usa en cualquier subfase
```

---

## 4. Decisiones de arquitectura que necesitan tu aprobación explícita

Antes del detalle por subfase, cuatro decisiones reales — no las tomo en silencio:

**(1) Reutilizar `proyectos` en vez de crear `ventas`/`proyectos_solares`.**
Ya tiene exactamente los campos ancla que necesitas (`oportunidad_id`, `cotizacion_id`, `riesgo`, `estado`) y hoy está prácticamente vacía. Le agrego (aditivo): `cliente_id`, `sucursal_id`, `asesor_id`, `ubicacion_instalacion` (text o lat/lng), `numero_proyecto` (folio tipo `NE-0001`), `config_vendida` (jsonb — snapshot), y un campo nuevo **`tipo`** (`'interno'` default | `'venta'`) para que la IA de Modo Operador (`proyectosEnRiesgo`) siga viendo solo proyectos internos salvo que se le pida explícitamente lo contrario. Riesgo real: bajo — solo 1 fila existente en toda la plataforma, y solo un tool de IA la lee hoy.
*Alternativa si prefieres no tocar `proyectos`: tabla `ventas` nueva, 100% paralela. Cuesta una tabla más y algo de lógica duplicada (estado/riesgo), pero aísla totalmente Modo Operador de las ventas solares.*

**(2) Extender `documentos_cliente` en vez de crear `instalacion_evidencias`.**
Le agrego `instalacion_id` (nullable, FK nueva) y `fase` (nullable: `'antes'|'durante'|'despues'`) — el resto (bucket, categoría, subida/clasificación) ya funciona. Evita reconstruir la misma tabla que se entregó hace unos minutos en esta misma sesión.

**(3) "Marcar cotización como aceptada" — acción que hoy no existe.**
Es el disparador de todo el bloque y hoy no hay ningún botón ni función que la escriba. La agrego en 2A: acción humana explícita (un gerencial o el asesor dueño la marca), registra `aceptada_en` + quién, y desde ahí se ofrece "Convertir a proyecto" — nunca automático, siempre una decisión.

**(4) Inventario como movimientos, no como columna.**
`inventario_movimientos` (entrada/salida/reserva/liberación/ajuste/devolución) en vez de `productos.existencia`. Mismo patrón que ya usa todo el sistema para lo que necesita auditoría real y evita condiciones de carrera cuando dos personas reservan material a la vez. La existencia se calcula sumando movimientos (con un índice adecuado, no cuesta caro a este volumen).

Si no me dices lo contrario, implemento las 4 tal como están descritas — son las que menos tablas nuevas y menos riesgo real producen.

---

## 5. CORE genérico de TARA vs. VERTICAL solar — clasificación real, no automática

Analizado módulo por módulo, no por intuición:

| Módulo | Clasificación | Por qué |
|---|---|---|
| `proyectos` (extendida) | **Híbrido** | La tabla y el concepto son 100% genéricos (cualquier industria puede tener "proyecto post-venta"); `config_vendida` (jsonb) es donde vive lo específico de cada industria — para Nort Energy trae kWp/paneles/inversor, para otra industria traería otra cosa. El código que la lee/escribe es genérico. |
| **`pagos_cliente` (cobranza)** | **CORE genérico** | Anticipo + pagos parciales + saldo es universal — cualquier empresa que venda algo caro (Total Racks vendiendo racks industriales, un salón vendiendo un paquete de tratamientos) lo necesita igual. |
| **`instalaciones`** | **Híbrido** | El núcleo (programación, cuadrilla, checklist configurable, estados) es genérico — aplica a instalar un rack industrial o un sistema solar igual de bien. Los CAMPOS específicos solares (paneles, inversor, kWp) van en un jsonb `detalle_tecnico`, no en columnas duras — así el núcleo sirve a cualquier industria de instalación física. |
| **`equipos_instalados`** | **CORE genérico** | Número de serie + garantía + marca/modelo es universal (aplica a un aire acondicionado, un rack, un panel solar). |
| **`tramites_cfe`** | **VERTICAL solar puro** | CFE, medidor bidireccional, interconexión — no existe fuera de energía solar/eléctrica en México. Nunca se disfraza de genérico. |
| **`garantias`** | **CORE genérico** | Nace de `equipos_instalados` (genérico) — el concepto "este equipo con este número de serie tiene garantía" no es solar. |
| **`mantenimientos`** | **CORE genérico** | Igual que garantías — cualquier equipo instalado puede necesitar mantenimiento programado. |
| **`tickets` (postventa)** | **CORE genérico**, con **categorías VERTICAL** | La tabla y el flujo (abrir/priorizar/resolver/cerrar) son genéricos; el catálogo de categorías (`baja_generacion`, `microinversor`...) es configurable por empresa — mismo patrón que `plantillas_industria` ya usa para KPIs y checklists. |
| **`inventario_movimientos`, `ordenes_compra`, `proveedores`** | **CORE genérico** | Cualquier empresa que venda producto físico necesita esto exactamente igual — de hecho es lo que más valor tendría fuera de Nort Energy. |
| **Checklists (instalación, evidencias por categoría, trámite CFE)** | **CORE genérico como mecanismo, VERTICAL en contenido** | El mecanismo (una lista configurable de ítems por empresa/tipo, guardada como datos) es genérico — mismo espíritu que `plantillas_industria.ui_config` ya usa. El CONTENIDO del checklist de instalación solar (revisar orientación, sombras, centro de carga) es específico de Nort Energy, cargado como datos vía script, nunca hardcodeado en el motor. |

**Regla aplicada en todo el diseño**: ninguna tabla nueva tiene una columna `es_solar` ni un `if (industria === 'paneles_solares')` en el código. Lo específico de cada industria vive en `jsonb` (datos) o en catálogos configurables (`plantillas_industria`, o una tabla de configuración nueva por checklist) — exactamente el patrón "Motor Universal" que ya sostiene todo TARA Matrix.

---

## 6. Las 9 subfases técnicas (2A-2I)

Formato por subfase: tablas/migraciones · relaciones · endpoints · UI · permisos · reutilización · tests · riesgos · criterio de aceptación.

### 2A — Proyecto solar / venta

- **Tablas/migraciones**: 1 migración — `ALTER TABLE cotizaciones` (nada nuevo, ya tiene lo necesario); `ALTER TABLE proyectos ADD COLUMN cliente_id, sucursal_id, asesor_id, ubicacion_instalacion, numero_proyecto, config_vendida jsonb, tipo text DEFAULT 'interno'`. Índice único en `numero_proyecto` por `company_id`.
- **Relaciones**: `proyectos.cliente_id → clientes`, `.oportunidad_id → oportunidades` (ya existe), `.cotizacion_id → cotizaciones` (ya existe), `.sucursal_id → sucursales`, `.asesor_id → asesores`.
- **Endpoints**: `POST /api/cotizaciones/:id/marcar-aceptada` (nuevo — el gap real encontrado); `POST /api/cotizaciones/:id/convertir-a-proyecto` (crea la fila `proyectos`, copia snapshot desde `cotizacion_lineas`+`calculos_ingenieria` a `config_vendida`, genera `numero_proyecto`); `GET /api/proyectos/:id`, `GET /api/proyectos` (lista).
- **UI**: botón "Marcar como aceptada" + "Convertir a proyecto" en `CotizacionDetalle.jsx`; nueva página `ProyectoDetalle.jsx` (esqueleto — el contenido rico es 2B en adelante).
- **Permisos**: convertir a proyecto — gerencial o el asesor dueño de la cotización.
- **Reutilización**: `proyectos`/`tareas` (existentes), `generarFolio`-like para `numero_proyecto` (mismo patrón RPC atómico que `generarFolio()`).
- **Tests**: unitarios de la conversión (snapshot correcto, idempotencia — no duplica proyecto si ya existe uno para esa cotización), aislamiento multiempresa.
- **Riesgos**: bajo — aditivo puro, la única fila real de `proyectos` no se toca (es de otra empresa).
- **Criterio de aceptación**: una cotización `aceptada` se convierte en un `proyecto` con snapshot correcto; la misma cotización no se puede convertir dos veces; Total Racks/GONDOR/demo no ven ningún cambio.

### 2B — Cobranza

- **Tablas/migraciones**: `pagos_cliente` (proyecto_id, cotizacion_id, total_vendido, anticipo_requerido_pct/monto, estado, created_at) + `pagos_cliente_abonos` (pagos_cliente_id, monto, forma_pago, referencia, fecha, comprobante_storage_path, registrado_por, notas) — 1:N para permitir múltiples pagos reales.
- **Relaciones**: `pagos_cliente.proyecto_id → proyectos`; `pagos_cliente_abonos.pagos_cliente_id → pagos_cliente`; comprobantes reutilizan `documentos_cliente` (categoría `comprobante_pago`, ya existe) en vez de un campo de archivo aparte — el abono solo guarda el `documento_id` si aplica.
- **Endpoints**: `POST /api/proyectos/:id/pagos` (crea `pagos_cliente` al convertir el proyecto, monto del snapshot), `POST /api/pagos-cliente/:id/abonos`, `GET /api/proyectos/:id/pagos` (total, pagado, saldo, % pagado, estado calculado).
- **UI**: sección "Cobranza" en `ProyectoDetalle.jsx` — lista de abonos + formulario, barra de progreso de pago.
- **Permisos**: registrar abono — gerencial o rol nuevo `cobranza` (texto libre, ya soportado por `usuarios_empresas.rol`).
- **Reutilización**: `documentos_cliente` para comprobantes — cero tabla de archivos nueva.
- **Tests**: cálculo de saldo/% con múltiples abonos, estado deriva correctamente (`pendiente_anticipo → anticipo_recibido → pago_parcial → liquidado`), nunca permite abono negativo ni mayor al saldo sin advertencia.
- **Riesgos**: bajo. Único cuidado real: nunca confundir con `pagos` (SaaS) — nombre deliberadamente distinto, comentado en la migración.
- **Criterio de aceptación**: un proyecto muestra saldo correcto con 3+ abonos parciales reales de prueba; estado se recalcula solo, nunca se guarda "a mano".

### 2C — Instalaciones

- **Tablas/migraciones**: `instalaciones` (proyecto_id, sucursal_id, fecha_programada, hora, responsable_id, cuadrilla text[], estado, checklist_completado jsonb, detalle_tecnico jsonb, observaciones) + `checklists_config` (company_id, tipo=`'instalacion'`, items jsonb ordenado — configurable, no hardcodeado) + tabla o campo para historial de cambio de estado (reutilizar `bitacora_decisiones` con `proyecto_id` ya soportado, en vez de una tabla nueva de auditoría).
- **Relaciones**: `instalaciones.proyecto_id → proyectos`; el checklist de una instalación referencia `checklists_config` de su empresa (o copia snapshot del checklist al crearla, para que cambios futuros al catálogo no alteren instalaciones ya en curso — mismo principio que el snapshot de 2A).
- **Endpoints**: CRUD de instalación, `PATCH /api/instalaciones/:id/estado`, `PATCH /api/instalaciones/:id/checklist` (marca ítems), `GET/POST /api/checklists-config` (admin, gerencial).
- **UI**: `Instalaciones.jsx` (tablero/lista por estado) + `InstalacionDetalle.jsx` (checklist interactivo, datos de cuadrilla).
- **Permisos**: nuevo rol operativo `instalador`/`tecnico` — ve solo sus instalaciones asignadas (mismo patrón "solo lo suyo" que ya usa `asesor` en CRM).
- **Reutilización**: `citas`+`SchedulingEngine` para la fecha/hora programada (una instalación puede generar una `cita` real con `servicio_id='instalación'`, sin reconstruir agenda); `tareas.proyecto_id` para pendientes sueltos.
- **Tests**: transición de estados válida, checklist snapshot no se altera si el catálogo cambia después, aislamiento multiempresa.
- **Riesgos**: medio — es la subfase con más superficie nueva. Mitigado dividiéndola de 2D (evidencias/equipos van aparte).
- **Criterio de aceptación**: una instalación de prueba recorre los 10 estados, el checklist se marca y persiste, aparece en el proyecto.

### 2D — Evidencias / equipos instalados

- **Tablas/migraciones**: `ALTER TABLE documentos_cliente ADD COLUMN instalacion_id, fase` (nullable — ver decisión 2 de la sección 4); `equipos_instalados` (proyecto_id, instalacion_id, tipo_equipo, marca, modelo, numero_serie, potencia_capacidad, proveedor, fecha_instalacion, garantia_meses, documento_evidencia_id → documentos_cliente, notas).
- **Relaciones**: `equipos_instalados.proyecto_id → proyectos`, `.instalacion_id → instalaciones`, `.documento_evidencia_id → documentos_cliente`.
- **Endpoints**: `POST /api/instalaciones/:id/evidencias` (reusa la ruta de subida de `documentos_cliente`, solo agrega `instalacion_id`/`fase`), `POST /api/instalaciones/:id/equipos`, `GET /api/proyectos/:id/equipos`.
- **UI**: sección de evidencias con selector fase×categoría en `InstalacionDetalle.jsx`; formulario de "registrar equipo" (marca/modelo/serie), pre-llenado con el `garantia_meses` del `productos` del catálogo si aplica.
- **Permisos**: instalador/técnico puede subir evidencias y registrar equipos de SU instalación asignada.
- **Reutilización**: 100% del módulo `documentos-cliente.js` ya construido — cero storage nuevo.
- **Tests**: equipo queda ligado permanentemente al proyecto aunque la instalación cambie de estado; evidencia por fase se filtra correctamente.
- **Riesgos**: bajo — extiende infraestructura ya probada en vivo esta sesión.
- **Criterio de aceptación**: un proyecto de prueba muestra 3 equipos con número de serie real y evidencias clasificadas por fase, visibles desde el expediente del proyecto.

### 2E — Trámites CFE

- **Tablas/migraciones**: `tramites_cfe` (proyecto_id, estado, fecha_inicio, fecha_ingreso, ultima_actualizacion, responsable_id, folio_cfe, medidor_bidireccional boolean, notas).
- **Relaciones**: `tramites_cfe.proyecto_id → proyectos`; documentos/evidencias del trámite reutilizan `documentos_cliente` (categoría nueva `tramite_cfe`, o `instalacion_id`/`proyecto_id` directo — sin tabla de documentos propia).
- **Endpoints**: CRUD + `PATCH /api/tramites-cfe/:id/estado` (siempre actualiza `ultima_actualizacion`).
- **UI**: sección "CFE" en `ProyectoDetalle.jsx`; en el listado, marcar visualmente (badge de alerta) cualquier trámite con `ultima_actualizacion` > N días sin cambio — configurable, no un número fijo en el código.
- **Permisos**: rol nuevo `cfe`/`gerencial`.
- **Reutilización**: `documentos_cliente` para expediente CFE.
- **Tests**: cálculo de "días sin actualización", aislamiento multiempresa.
- **Riesgos**: bajo. Explícitamente **sin integración directa con CFE** — es seguimiento manual, tal como pediste.
- **Criterio de aceptación**: un trámite de prueba pasa por sus 10 estados, el badge de alerta aparece correctamente pasado el umbral configurado.

### 2F — Inventario

- **Tablas/migraciones**: `inventario_movimientos` (producto_id, tipo CHECK entrada/salida/reserva/liberacion/ajuste/devolucion, cantidad, sucursal_id, proyecto_id nullable, usuario_id, fecha, referencia, observaciones).
- **Relaciones**: `.producto_id → productos` (ya existe, catálogo real ya usado por el cotizador), `.sucursal_id → sucursales`, `.proyecto_id → proyectos`.
- **Endpoints**: `POST /api/inventario/movimientos`, `GET /api/inventario/existencia` (agregado por producto+sucursal, sumando movimientos), `POST /api/instalaciones/:id/reservar-material`, `POST /api/instalaciones/:id/consumir-material`.
- **UI**: `Inventario.jsx` (existencia por producto/sucursal + historial de movimientos).
- **Permisos**: rol `almacen`/gerencial.
- **Reutilización**: `productos` como catálogo — cero tabla de "producto" paralela.
- **Tests**: existencia calculada nunca queda negativa sin bloquear la operación (reserva/salida rechazada con mensaje claro si no alcanza), aislamiento multiempresa.
- **Riesgos**: medio — requiere una transacción atómica (RPC en Postgres, mismo patrón que `generarFolio()`) para que dos reservas simultáneas no dejen stock negativo por condición de carrera.
- **Criterio de aceptación**: reservar más material del disponible se rechaza; dos reservas concurrentes de prueba nunca dejan existencia negativa.

### 2G — Compras y proveedores

- **Tablas/migraciones**: `proveedores` (nombre, contacto, notas), `ordenes_compra` (proveedor_id, sucursal_id, proyecto_id nullable, estado, fecha_solicitada/esperada/recibida), `orden_compra_items` (orden_id, producto_id, cantidad, costo_unitario, cantidad_recibida).
- **Relaciones**: encadenadas entre sí + `productos`.
- **Endpoints**: CRUD de proveedores/órdenes, `POST /api/ordenes-compra/:id/recibir` (genera `inventario_movimientos` tipo `entrada` automáticamente, con un flag/constraint que evite duplicar la entrada si se llama dos veces).
- **UI**: `Compras.jsx` + `OrdenCompraDetalle.jsx`.
- **Permisos**: gerencial o rol `compras`.
- **Reutilización**: `inventario_movimientos` (2F) como destino de la recepción — nunca un segundo mecanismo de "sumar stock".
- **Tests**: recibir una orden dos veces no duplica la entrada de inventario.
- **Riesgos**: bajo, depende de que 2F ya esté estable (por eso va después).
- **Criterio de aceptación**: una orden de compra de prueba, al recibirse, genera exactamente un movimiento de entrada por partida.

### 2H — Garantías

- **Tablas/migraciones**: `garantias` (equipo_instalado_id → **obligatorio**, no nullable — nace del equipo, nunca de texto suelto; fecha_inicio, meses_garantia, proveedor); `garantia_reclamaciones` (garantia_id, estado, descripcion, historial jsonb o tabla de eventos).
- **Relaciones**: `garantias.equipo_instalado_id → equipos_instalados` (2D).
- **Endpoints**: `POST /api/equipos-instalados/:id/garantia` (crea la garantía a partir del equipo — el asesor nunca captura marca/modelo/serie de nuevo), CRUD de reclamaciones.
- **UI**: desde `equipos_instalados` en el proyecto, botón "Ver garantía" / "Abrir reclamación"; `Garantias.jsx` con vista global.
- **Permisos**: gerencial o rol `postventa`.
- **Reutilización**: 100% de `equipos_instalados` (2D) — sin este orden, garantías tendría que reinventar marca/modelo/serie, exactamente lo que pediste evitar.
- **Tests**: no se puede crear una garantía sin un equipo real; aislamiento multiempresa.
- **Riesgos**: bajo, pero **depende estrictamente de que 2D ya exista** — es la razón del orden en la sección 7.
- **Criterio de aceptación**: una reclamación de garantía de prueba muestra automáticamente marca/modelo/serie/fecha de instalación reales, sin captura manual redundante.

### 2I — Mantenimiento / Postventa

- **Tablas/migraciones**: `mantenimientos` (proyecto_id, tipo, fecha_programada, fecha_realizada, tecnico_id, checklist jsonb, mediciones jsonb nullable, proximo_mantenimiento date); `tickets` (cliente_id, proyecto_id nullable, equipo_instalado_id nullable, categoria, prioridad, estado, responsable_id) + `ticket_eventos` (ticket_id, tipo, texto, autor_id, created_at) para la línea de tiempo.
- **Relaciones**: `mantenimientos.proyecto_id → proyectos`; `tickets.cliente_id → clientes`, `.proyecto_id → proyectos`, `.equipo_instalado_id → equipos_instalados` (nullable, para ligar un ticket a un equipo específico cuando aplique).
- **Endpoints**: CRUD de mantenimientos (`POST /api/mantenimientos/:id/programar-siguiente` crea una `cita` real vía `agenda.js`), CRUD de tickets + eventos.
- **UI**: `Mantenimientos.jsx`, `Tickets.jsx` + `TicketDetalle.jsx` (línea de tiempo).
- **Permisos**: `postventa`/`tecnico`/gerencial.
- **Reutilización**: `citas`+`SchedulingEngine` para programar el próximo mantenimiento — cero motor de recordatorios nuevo.
- **Tests**: programar el siguiente mantenimiento crea una cita real y consistente; aislamiento multiempresa.
- **Riesgos**: bajo — es la subfase con más reutilización de todo el bloque.
- **Criterio de aceptación**: un ticket de prueba recorre su línea de tiempo completa; un mantenimiento programa su siguiente cita real en la agenda.

---

## 7. Seguridad — aislamiento multiempresa (mecanismo exacto)

**Cómo funciona hoy, verificado leyendo el código, no asumido:**

1. El navegador manda dos cookies: `tara_session` (JWT de Supabase Auth) y `tara_company` (el `company_id` que el usuario dice estar usando).
2. `requireAuth` → `resolverSesion()` NUNCA confía en la cookie `tara_company` por sí sola. Primero valida el JWT contra Supabase Auth (`auth.getUser(token)`) para obtener el **id real** del usuario autenticado. Después busca una fila en `usuarios_empresas` con `usuario_id = <id real> AND company_id = <el de la cookie> AND activo = true`.
3. **Si esa fila no existe — así se manipule la cookie, la URL o el body — la sesión se rechaza con 401.** `req.usuario.company_id` solo se llena con un valor ya verificado contra la membresía real.
4. Cada ruta del panel filtra explícitamente `.eq('company_id', req.usuario.company_id)` en cada consulta — **RLS está deshabilitado en todas las tablas**, así que este filtro explícito es la única barrera real. No es un descuido: es la disciplina de código ya usada en las ~100 rutas existentes, y **es la misma que se exige en las subfases 2A-2I.**

**Patrón obligatorio para toda ruta/función nueva de este bloque** (el mismo que ya usa `documentos-cliente.js::clasificarAdjuntoDeMensaje` con el cruce hilo→cliente):

- Nunca usar un ID que llega en la URL/body para tocar una fila sin antes confirmar `.eq('company_id', req.usuario.company_id)` en esa misma fila.
- Al tocar una fila HIJA de otra (ej. agregar un pago a un proyecto, un equipo a una instalación), verificar la cadena completa: la instalación pertenece a la empresa, Y el proyecto de esa instalación también, antes de escribir.
- `supabaseServicio` (service_role) solo para operaciones de Storage con bucket privado — nunca para leer/escribir filas de negocio sin haber verificado ya la pertenencia con `req.supabase`.

**Por qué no activar RLS ahora**: activar RLS de golpe en tablas con años de tráfico real (Total Racks, salones) puede romper flujos que hoy dependen de `supabaseServicio` para tareas legítimas sin sesión de usuario (webhooks, cron, IA). Es un cambio de arquitectura que merece su propio proyecto aislado, con pruebas exhaustivas por tabla — no algo para colar dentro de este bloque. Se mantiene la disciplina de código, reforzada con tests.

**Tests de aislamiento — nuevos, obligatorios antes de dar por cerrada cada subfase**: un archivo `__tests__/aislamiento-multiempresa-operativo.test.js` con, por cada endpoint nuevo de 2A-2I, al menos un caso: *usuario autenticado de la Empresa A intenta leer/escribir un registro real de la Empresa B (por ID directo) → 404 o 403, nunca 200 con datos ajenos.* Se agrega incrementalmente, subfase por subfase, no al final.

---

## 8. Contradicciones con la arquitectura congelada (ADR-005)

**Ninguna.** Verificado explícitamente:

- `WorkflowEngine`/`Orchestrator`/`ContextBuilder`/`PromptBuilder`/`AIProvider`/`ChannelAdapter`: no se tocan — ninguna subfase agrega un nodo de workflow conversacional nuevo.
- `SchedulingEngine`/`CalendarProvider`: se **usan**, no se modifican — 2C y 2I crean filas `citas` exactamente como ya lo hace cualquier flujo de agenda existente.
- `ActionRunner`: no se agrega ninguna acción nueva de WhatsApp — todo este bloque es de panel (uso humano), no conversacional.

---

## 9. % de avance actual del bloque operativo

**0%.** Ninguna tabla, endpoint ni pantalla de 2A-2I existe todavía. Lo que sí existe (cotizador, expediente, atribución de leads, agenda, `proyectos`/`tareas` genéricos) es la base sobre la que se construye — confirmado en la sección 1, no se vuelve a construir.

---

## 10. Orden técnico correcto y dependencias

```
2A (proyecto/venta) ── prerequisito de TODO lo demás (todo cuelga de proyecto_id)
  │
  ├── 2B (cobranza)         ── depende solo de 2A
  │
  └── 2C (instalaciones)    ── depende solo de 2A
        │
        ├── 2D (evidencias/equipos)  ── depende de 2C (instalacion_id)
        │     │
        │     └── 2H (garantías)     ── depende ESTRICTAMENTE de 2D (equipo_instalado_id NOT NULL)
        │
        └── 2E (CFE)        ── depende solo de 2A (puede correr en paralelo a 2C/2D)

2F (inventario)          ── depende solo de `productos` (ya existe) — puede empezar en paralelo a 2C, pero 2C se beneficia de tenerlo listo para "reservar material"
  │
  └── 2G (compras)        ── depende de 2F (genera movimientos de entrada)

2I (mantenimiento/postventa) ── depende de 2A + 2D (para ligar tickets a equipos) — va al final
```

**Orden recomendado de implementación**: 2A → 2B → 2C → 2F → 2D → 2G → 2E → 2H → 2I. (2E puede adelantarse justo después de 2C si el negocio lo necesita antes que inventario — es la única reordenación segura, porque CFE no depende de nada más que 2A).

Cada subfase, sin excepción, sigue el mismo ritual ya usado en las 9 entregas del cotizador este mes: analizar → implementar → tests unitarios → **validar en vivo contra datos reales de Nort Energy** → limpiar datos de prueba → build de frontend → confirmar que Total Racks/GONDOR/demo no cambian → commit descriptivo → pedir confirmación explícita antes de cada push.

---

## 11. Lo que NO se va a construir en este bloque (alcance explícito)

- Integración directa con CFE (solo seguimiento manual, tal como pediste).
- RLS activado (se documenta el riesgo, no se activa de golpe).
- Contabilidad completa en cobranza (solo control operativo: cuánto se debe, cuánto se pagó).
- Automatización de compras (solo registro y recepción, sin predicción de demanda).
- Roles departamentales completos de golpe — se agregan según cada subfase los necesite, nunca todos de una vez "por si acaso".

---

*Este documento se actualiza al cerrar cada subfase (2A, 2B...), igual que el resto de los documentos de auditoría de esta sesión — nunca se reescribe desde cero, se extiende.*
