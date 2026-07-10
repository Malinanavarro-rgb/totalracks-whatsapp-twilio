# Roadmap — TARA Matrix™

---

## Estado actual

**Core baseline v1 — congelado y validado** · 9 de julio de 2026

El motor conversacional y de agenda (`WorkflowEngine`, `SchedulingEngine`, `ActionRunner`, integración multiempresa) quedó validado dos veces de forma independiente — Anexo A (Total Racks, cliente real, Google Calendar real) y Anexo B (Salón de Uñas, sintético, sin Google) — y se congela como baseline v1 (`docs/decisions/ADR-005-baseline-v1-core-freeze.md`). No se modifica por iniciativa propia; solo por bugs con reproducción o evidencia de un piloto real.

**El foco de desarrollo cambia de "el motor" a "la plataforma alrededor del motor".**

---

## Fases

| Fase | Nombre | Estado | Fecha |
|------|--------|--------|-------|
| FASE 1 | Bot single-tenant básico | Completa | Ene 2026 |
| FASE 2 | Arquitectura hexagonal — Orchestrator, AIEngine, ContextBuilder | Completa | Mar 2026 |
| FASE 3 | Multi-tenant — routing dinámico, aislamiento validado | Completa | Jun 2026 |
| FASE 4 | WorkflowEngine (M5) + ActionRunner (M8) + Motor de Agenda (Anexo A) + segundo giro validado (Anexo B) | **Completa — Core baseline v1** | Jul 2026 |
| FASE 5 | Plataforma SaaS | **En curso — foco actual** | — |
| FASE 6 | Memory Engine (M9) + personalización a largo plazo | Futura, diferida | — |

---

## FASE 4 — Motor conversacional y de agenda (cerrada)

**Resultado:** TARA pasó de responder a actuar, y ese "actuar" quedó validado dos veces sobre giros de negocio distintos sin tocar el motor.

- WorkflowEngine (M5) + ActionRunner (M8) — flujos estructurados y ejecución de acciones.
- Motor de Agenda (Anexo A): `SchedulingEngine`, `CalendarProvider`/`GoogleCalendarProvider`, OAuth + cifrado de credenciales, recordatorios — validado con Total Racks, cita real en Google Calendar.
- Segundo giro (Anexo B): mismo Kernel, giro estructuralmente distinto (agenda transaccional de salón de uñas), validación sintética — cero cambios en `WorkflowEngine`.

**Ver evidencia completa:** `docs/anexos/plataforma-saas/README.md` (secciones 2 y 3.7), `docs/decisions/ADR-005-baseline-v1-core-freeze.md`.

---

## FASE 5 — Plataforma SaaS (foco actual)

**Objetivo:** convertir TARA en un producto comercial multiempresa. El Core ya funciona y está congelado — el esfuerzo se concentra en construir la experiencia alrededor de él. Diseño funcional completo (sitemap, módulos, permisos por rol, MVP vs. futuro) aprobado antes de escribir código — ver `docs/anexos/plataforma-saas/README.md`.

**Principio vigente en todas las sub-fases:** el Core (tabla "estables" de `docs/ARQUITECTURA-CONGELADA-v1.0.md`) no se toca para construir esto salvo bug o evidencia real (ADR-005) — la plataforma se construye *sobre* el Core, no *dentro* de él. Cada sub-fase reusa el mismo camino de escritura del motor (`SchedulingEngine`, `ActionRunner`) en vez de duplicar lógica.

| Sub-fase | Nombre | Estado | Fecha |
|---|---|---|---|
| Fase 1 | Login + Supabase Auth + roles + usuario↔empresa (muchos-a-muchos) | ✅ Completa | 9 jul 2026 |
| Fase 2 | Centro de Operaciones (dashboard, 8 métricas multiempresa) | ✅ Completa | 9 jul 2026 |
| Fase 3 | Conversaciones en tiempo real + intervención humana ("Tomar conversación"/"Regresar a TARA") | ✅ Completa | 9 jul 2026 |
| Fase 4 | Agenda propia de TARA (UI sobre `citas`/`asesores`/`horarios_laborales`) | ✅ Completa | 9 jul 2026 |
| Fase 5 | CRM (clientes, historial, seguimientos) | ⏳ Siguiente | — |
| Fase 6 | Configuración de empresa (personalidad, KB, usuarios, horarios, servicios, canales) | Futura | — |
| Fase 7 | Reportes | Futura | — |

**Fase 1 — Login:** `usuarios`/`usuarios_empresas` (muchos-a-muchos, un usuario puede pertenecer a varias empresas con rol distinto en cada una), sesión mediada 100% por el backend (cookie `httpOnly`, el frontend nunca toca Supabase ni el JWT), 4 roles (owner/administrador/supervisor/asesor).

**Fase 2 — Centro de Operaciones:** 8 métricas (conversaciones activas/atendidas hoy, clientes nuevos, IA vs. humano, tiempo promedio de respuesta, citas agendadas, alertas) calculadas en `modules/dashboard.js`, siempre filtradas por `company_id` del usuario autenticado — nunca por uno que mande el cliente. Agnóstico de giro (sin conceptos de ventas/oportunidades).

**Fase 3 — Conversaciones + intervención humana:** un asesor puede tomar una conversación (TARA deja de responder) y devolverla. Implementado enteramente en la capa de plataforma (webhook de `server.js` + `modules/conversaciones.js`) — **cero cambios al Orchestrator/WorkflowEngine**. Tabla nueva `mensajes_humanos` (aditiva) para los mensajes que pasan por un humano.

**Fase 4 — Agenda propia de TARA:** vista por día agrupada por asesor, alta de citas (cliente existente o nuevo), reagendado y cancelación. Un solo camino de escritura: reusa `SchedulingEngine.agendarCita()/reagendarCita()/cancelarCita()` — el mismo que usa la conversación de WhatsApp. Base multiusuario agregada: `asesores.usuario_id` vincula un asesor de agenda con su cuenta de login, permitiendo que un rol Asesor vea/gestione solo su propia agenda.

**Google Calendar sigue siendo integración opcional, no dependencia del producto** — la fuente de verdad de la agenda es la tabla `citas` (ya el caso desde TA.3: si Google falla o no está conectado, la agenda de TARA sigue funcionando igual vía `MockCalendarProvider`).

---

## FASE 6 — Memory Engine

**Objetivo:** TARA recuerda a sus clientes entre conversaciones.

Un cliente que habló hace 3 meses vuelve y TARA recupera contexto relevante: presupuesto, preferencias, decisiones tomadas.

**Módulos:** M9 MemoryManager
**Ver decisión:** `docs/decisions/ADR-004-memory-engine.md` (diferida — revisar si FASE 5 expone una necesidad concreta)

---

## Lo que no está en el roadmap (y por qué)

| Item | Razón |
|------|-------|
| Multi-idioma | No hay demanda actual; la arquitectura lo soporta cuando sea necesario |
| SMS como canal | `channel_endpoints.canal` ya tiene el campo; es un adapter nuevo cuando haya demanda |
| Integración con CRMs externos (HubSpot, Salesforce) | `ActionRunner` lo habilitaría vía webhook cuando haya demanda concreta |
| ML propio para predicción de cierre | Overhead innecesario; OpenAI cubre el caso de uso actual |
| Diseño de 4 nodos completo de Anexo B (nodo intermedio con acción) | Requiere extender `Orchestrator` — no se hace por iniciativa propia, ver condición de reapertura en ADR-005 |
