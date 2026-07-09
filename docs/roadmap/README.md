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

**Objetivo:** convertir TARA en un producto comercial. El Core ya funciona y está congelado — el esfuerzo se concentra en construir la experiencia alrededor de él.

Frentes de trabajo (sin orden de prioridad fijo todavía — se prioriza según se vaya definiendo):

- **Dashboard** — visibilidad operativa por empresa.
- **Agenda propia de TARA** — interfaz sobre el modelo de datos ya validado (`citas`, `asesores`, `horarios_laborales`). **Google Calendar queda como integración opcional futura, no como dependencia del producto** — la fuente de verdad es la tabla `citas` (ya el caso desde TA.3: si Google falla o no está conectado, la agenda de TARA sigue funcionando igual).
- **Portal de administración** — onboarding de empresas sin SQL directo.
- **Gestión de empresas** — alta, configuración, estado.
- **Gestión de usuarios y asesores** — hoy `asesores` existe a nivel de datos; falta la capa de gestión.
- **Conversaciones en tiempo real** — visibilidad de conversaciones activas por empresa.
- **Intervención humana** — "Tomar conversación" / "Regresar a TARA": un humano puede pausar al bot y retomar el control, y devolverlo.
- **CRM** — sobre la base ya existente (`clientes`, `oportunidades`).
- **Reportes** — métricas operativas y comerciales por empresa.
- **Configuración por empresa** — reglas, personalidad, catálogos, sin migración por cada ajuste (ya parcialmente resuelto por `personalities.reglas`, `servicios`, `mensajes_automaticos`).
- **Experiencia SaaS** — el conjunto anterior como producto cohesivo, no como piezas sueltas.

**Restricción vigente:** el Core (tabla "estables" de `docs/ARQUITECTURA-CONGELADA-v1.0.md`) no se toca para construir esto salvo bug o evidencia real — la plataforma se construye *sobre* el Core, no *dentro* de él.

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
