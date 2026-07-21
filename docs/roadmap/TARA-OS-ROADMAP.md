# TARA-OS Roadmap

Documento vivo — reemplaza al roadmap anterior por "Fases" (`docs/roadmap/README.md`, que se conserva como referencia histórica) como fuente de verdad sobre en qué versión está TARA-OS y qué falta.

A partir de hoy, TARA-OS se trata como un producto de software profesional: cada versión tiene nombre, objetivos claros, funcionalidades cerradas, documentación, pruebas y un **changelog** — y se **congela** antes de empezar la siguiente. El changelog real vive en [`CHANGELOG.md`](../../CHANGELOG.md) (raíz del repo); este documento es el mapa de versiones, no el detalle de cada cambio.

**Regla de congelamiento** (hereda de ADR-005): una versión cerrada no se reabre por "ya que estoy aquí, lo mejoro". Solo se toca por un bug real con reproducción, o por evidencia de un piloto real que exponga un vacío — mismo criterio que ya protege al Core desde v0.1.

---

## Mapa de versiones

| Versión | Nombre | Estado |
|---|---|---|
| v0.1 | Infraestructura | ✅ Completada |
| v0.2 | Portal del Cliente | ✅ Completada |
| v0.3 | Canales e Integraciones | 🔧 En desarrollo |
| v0.4 | Inbox Inteligente | ⏳ Pendiente |
| v0.5 | CRM Inteligente | ⏳ Pendiente |
| v0.6 | Agenda Inteligente | ⏳ Pendiente |
| v0.7 | Modo Operador Completo | ⏳ Pendiente (con base ya construida — ver nota) |
| v0.8 | Panel Maestro | ⏳ Pendiente (gran parte ya existe — ver nota) |
| v1.0 | Primer cliente funcionando completamente | — |

---

## v0.1 — Infraestructura

**✅ Completada**

**Objetivo:** que TARA-OS exista como plataforma multiempresa real y operable — el motor conversacional, el modelo de datos, la autenticación, y todo lo necesario para que un negocio real corra sobre ella.

**Funcionalidades cerradas:**
- Core conversacional congelado y validado dos veces con clientes de giros distintos: `Orchestrator`, `WorkflowEngine`, `SchedulingEngine`, `ActionRunner`, `ContextBuilder`, `PromptBuilder`, `AIEngine` (adapters de IA intercambiables).
- Jerarquía multiempresa `Organization → Company`, aislamiento por `company_id` en toda la plataforma.
- Autenticación mediada por backend (login, roles owner/administrador/supervisor/asesor, usuario↔empresa muchos-a-muchos), invitaciones con link (sin correo automático todavía).
- Motor de Agenda (`SchedulingEngine` + Google Calendar opcional), CRM (ficha 360°, seguimientos, pipeline), Conversaciones en tiempo real + intervención humana, Configuración de empresa completa (personalidad, Knowledge Base, servicios, horarios, canales, usuarios).
- Billing & Suscripciones: catálogo de planes, suscripciones, métodos de pago, pagos, motor de estados canónico.
- Panel Maestro (base): Dashboard con métricas globales, Organizaciones, Planes, Centro de Cobro, Auditoría — administración de la plataforma por Alina como Super Admin.
- Plantillas de industria (detección automática de giro + siembra de personalidad/KB/servicios/pipeline/workflow).

**Documentación:** `docs/decisions/ADR-002` a `ADR-007`, `docs/constitution/v3-constitution.md`, `docs/ARQUITECTURA-CONGELADA-v1.0.md`, `docs/decisions/AUDITORIA-ARQUITECTURA-SAAS-2026-07.md`.

**Pruebas:** suite completa en `__tests__/`, todo el Core con cobertura de regresión (Anexo A/B).

**Congelamiento:** el Core (tabla de ADR-005) no se toca salvo bug reproducible o evidencia de piloto real — vigente desde el 9 de julio de 2026, sin excepciones nuevas desde entonces salvo la ya documentada (`Orchestrator._mapearPersonalidad()`).

---

## v0.2 — Portal del Cliente

**✅ Completada**

**Objetivo:** que una empresa pueda darse de alta y operar TARA-OS por su cuenta, sin que Alina intervenga en cada paso.

**Funcionalidades cerradas:**
- Registro público (`/registro`): una sola operación crea cuenta, Organization+Company, detecta el giro y siembra su configuración inicial, vincula al usuario como *owner*, y arranca un plan de prueba (Launch).
- Recuperación de contraseña (`/recuperar-password` → `/restablecer-password`), sobre Supabase Auth nativo.
- Onboarding corto post-registro: confirma lo que la plantilla de industria ya sembró, invita a conectar el primer canal — no bloqueante.
- Centro de Conexiones: conectar un número de WhatsApp (Meta) desde el panel, sin terminal.
- Administrar suscripción (ver plan/estado/historial de pagos, cambiar método de pago) desde el propio panel de la empresa.
- Invitar usuarios y asignar permisos (ya existía desde v0.1, confirmado como parte de este portal).

**Documentación:** plan de arquitectura de esta fase (auditoría de autenticación/invitaciones/organizaciones previa al diseño), este mismo roadmap.

**Pruebas:** `__tests__/auth.test.js` (recuperación), `__tests__/registro.test.js`, `__tests__/meta-auth.test.js` (Centro de Conexiones) — 1024 pruebas totales en verde al cierre de esta versión.

**Congelamiento:** cerrada el 20-21 de julio de 2026 (commits `10d7f2f`, `d096be7`, `54de830`). Probada en vivo de punta a punta en producción (registro real, login inmediato, suscripción trial, limpieza de datos de prueba).

**Nota honesta:** en esta misma ventana de trabajo también se construyó la primera versión de **Modo Operador** (Nivel 1 y Nivel 3) — cronológicamente antes que el Portal del Cliente, pero por estructura de producto pertenece a v0.7, no aquí. Se documenta en ambos lugares para que quede claro que ese trabajo ya existe y no se repite.

---

## v0.3 — Canales e Integraciones

**🔧 En desarrollo**

**Objetivo:** que cualquier empresa pueda comunicarse con sus clientes por el canal que prefiera, sin depender de Twilio ni de que Alina conecte nada a mano.

**Pendiente de cerrar esta versión:**
- Migrar Sugar Salon (único cliente real en Twilio hoy) a Meta WhatsApp — requiere acción de Alina en Meta Business Manager, igual que se hizo para Salud y Belleza.
- Retirar Twilio del código por completo (adapter, cliente, rutas de webhook, dependencia de `package.json`) una vez Sugar Salon esté migrado y verificado en vivo.
- Adaptadores de canal nuevos para Facebook Messenger e Instagram (hoy no existen — es trabajo del mismo tamaño que la integración de Meta WhatsApp, no un formulario).
- Canal de correo (sin precedente hoy — probablemente OAuth de Gmail o IMAP/SMTP).

**Ya construido dentro de esta versión (adelantado):** formulario de conexión de WhatsApp sin terminal (Centro de Conexiones, técnicamente entregado en v0.2 pero es infraestructura de esta versión).

---

## v0.4 — Inbox Inteligente

**⏳ Pendiente**

**Objetivo (a definir con más detalle cuando le toque su turno):** unificar las conversaciones de todos los canales conectados en una sola bandeja, con triage/priorización asistido por IA — quién necesita atención humana ya, quién puede esperar.

---

## v0.5 — CRM Inteligente

**⏳ Pendiente**

**Objetivo (a definir):** que el CRM deje de ser un registro pasivo y empiece a sugerir — próxima acción por cliente, riesgo de fuga, oportunidades que llevan tiempo sin movimiento.

---

## v0.6 — Agenda Inteligente

**⏳ Pendiente**

**Objetivo (a definir):** optimización real de horarios (huecos, sobrecupo, sugerencias de reagendado), no solo el calendario transaccional que ya existe desde v0.1.

---

## v0.7 — Modo Operador Completo

**⏳ Pendiente — con base ya construida**

**Ya en producción (construido en la misma ventana que v0.2, ver nota ahí):**
- Nivel 1 (TARA-OS/Panel Maestro) y Nivel 3 (Empresa) del motor de razonamiento libre — `modules/operador-engine.js` + `modules/operador-tools.js`.
- Tablas de memoria institucional: `tareas`, `proyectos`, `bitacora_decisiones`, `documentos`.
- Catálogo inicial de herramientas de solo lectura (tareas abiertas, proyectos en riesgo, decisiones recientes, buscar documentos, resumen de pipeline, buscar cliente).
- Aislamiento por alcance verificado en producción (una empresa nunca ve datos de otra).

**Falta para "completo":**
- Nivel 2 (Organización) — hoy sin caso de uso real (casi todas las organizaciones son 1:1 con una empresa).
- Ampliar el catálogo de herramientas (métricas financieras, agenda, CRM más a fondo).
- Aprovechar Modo Operador desde Modo Cliente (ej. una acción de `ActionRunner` que cree una tarea de seguimiento automáticamente) — solo con evidencia real de necesidad.

---

## v0.8 — Panel Maestro

**⏳ Pendiente — gran parte ya existe**

**Ya en producción desde v0.1 y reforzado en v0.2:** Dashboard (MRR/ARR/churn), Organizaciones (alta, suspender/reactivar, impersonación), Planes, Centro de Cobro (rentabilidad por cliente), Auditoría, y ahora Pregúntale a TARA (Modo Operador Nivel 1).

**Esto significa que v0.8, tal como está planteada, no describe trabajo nuevo todavía** — antes de darle contenido real a esta versión, hace falta que Alina defina qué específicamente falta que el Panel Maestro no hace hoy (¿más analítica? ¿gestión de equipo interno de TARA-OS? ¿algo distinto?). Queda como placeholder honesto hasta esa definición.

---

## v1.0 — Primer cliente funcionando completamente

Un negocio real, dado de alta por autoservicio (v0.2), con su canal conectado sin ayuda de Alina (v0.3), atendiendo clientes reales, con Alina pudiendo preguntarle a TARA por su estado (v0.7) desde el Panel Maestro (v0.8) — sin haber tocado el Core ni una sola vez fuera de las excepciones ya documentadas.
