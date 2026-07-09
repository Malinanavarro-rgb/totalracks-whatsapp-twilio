# Arquitectura Congelada v1.0

| Campo | Valor |
|-------|-------|
| Estado | Vigente — actualizado tras el cierre de Anexo A y Anexo B |
| Fecha de congelamiento original | 6 de julio de 2026 |
| Fecha de última actualización | 9 de julio de 2026 (ver `docs/decisions/ADR-005-baseline-v1-core-freeze.md`) |
| Commit de referencia | `b80c69c` (Anexo B validado, 477/477 tests) |
| Vigente durante | Construcción de la plataforma SaaS alrededor del Core (`docs/roadmap/README.md`). Anexo A y B ya validados y congelados como baseline v1 — ver ADR-005. Anexo C queda parcialmente adelantado (`servicios`, `mensajes_automaticos`); el resto (rename `tipo_rack`, checklist de alta) no es el foco actual. |
| Precedencia | Sujeta a `docs/constitution/v3-constitution.md` (TARA-CONST-001) y a `docs/decisions/ADR-005-baseline-v1-core-freeze.md`. Este documento es un recorte operativo, no reemplaza a ninguno de los dos. |

---

## Por qué existe este documento

Durante la implementación de los Anexos A/B/C, cualquier persona o sesión de IA que toque código necesita saber, sin leer la Constitución completa, qué puede tocar libremente y qué requiere detenerse a pensar primero. Este documento responde esa pregunta en una página.

**"Congelado" no significa "nunca cambia".** Significa: no se modifica como efecto secundario de construir Agenda, Segundo Giro o Plataforma de Configuración. Si construir un Anexo obliga a tocar algo de la lista de abajo, eso es una señal de alerta, no un detalle de implementación — se sigue la regla de cambio.

---

## Regla de cambio

Si durante la implementación de un Anexo se descubre que una decisión de `docs/anexos/plataforma-saas/README.md` ya no es viable por una limitación técnica real, o que hace falta modificar un componente estable:

1. **Detener** la implementación de esa tarea puntual.
2. **Documentar la causa** — qué se intentó, qué limitación real se encontró, por qué la decisión original no funciona.
3. **Proponer alternativas** antes de cambiar código de un componente estable o una decisión ya aprobada.
4. Ningún cambio a un componente estable se hace en silencio dentro de un commit de feature — queda registrado explícitamente.

---

## Componentes estables (no modificar salvo causa justificada)

| Componente | Ubicación | Por qué está congelado |
|---|---|---|
| WorkflowEngine (M5) | `modules/workflow-engine.js` | Validado dos veces, sin cambios de código entre ambas: Total Racks (real, Anexo A) y Salón de Uñas (sintético, Anexo B). Baseline v1 — ver ADR-005. |
| Orchestrator (M7) | `modules/orchestrator.js` | `_ejecutarAcciones()`/`_finalizarWorkflow()` extendidos y validados en TA.4/TA.6/TA.9/Anexo B. Cualquier extensión futura (ej. nodo intermedio con acción, ver ADR-005) requiere pasar por ADR, no es una excepción abierta. |
| AIProvider (puerto) + `OpenAIProvider`/`MockProvider` | `adapters/ai/` | Contrato validado en producción. `CalendarProvider` replica su patrón, no lo toca. |
| ChannelAdapter (puerto) + `TwilioWhatsAppAdapter` | `adapters/channels/` | Incluye `sendProactive()`, ya usado por T4A.11 y reutilizado tal cual por los recordatorios del Anexo A. |
| `SchedulingEngine` (M10) | `modules/scheduling-engine.js` | Baseline v1 (ADR-005) — validado con Google real (Anexo A) y `MockCalendarProvider` (Anexo B). `citas` es la fuente de verdad; Google Calendar es integración opcional best-effort, no dependencia. |
| `CalendarProvider` (puerto) + `GoogleCalendarProvider`/`MockCalendarProvider` | `adapters/calendar/` | Baseline v1 (ADR-005) — ambos providers validados con datos reales de dos empresas distintas. |
| `ActionRunner` (M8) | `modules/action-runner.js` | Baseline v1 (ADR-005) — formalizado en TA.4, extendido en TA.6/TA.9, reusado sin cambios en Anexo B. |
| `google-auth.js` (OAuth + cifrado) | `modules/google-auth.js` | Baseline v1 (ADR-005) — flujo OAuth real completo, validado con Total Racks. |
| Knowledge Base | tabla `knowledge_base`, lectura en `modules/config.js` | Sigue existiendo para contenido libre; `servicios` es una tabla nueva y separada, no un reemplazo. |
| CRM base | `modules/crm.js`, tablas `clientes`/`conversaciones`/`oportunidades` | Única excepción ya aprobada y acotada: el rename `tipo_rack`→`categoria_principal` (TC.1, no priorizado por ahora). Cualquier otro cambio a estas tablas o a `crm.js` requiere pasar por la regla de cambio. |
| ContextBuilder, PromptBuilder, AuditLogger, ChannelRouter | `modules/context-builder.js`, `modules/prompt-builder.js`, `modules/audit-logger.js`, `modules/channel-router.js` | Kernel puro (Artículo 4 de la Constitución). Nada en el roadmap actual tiene motivo para tocarlos. |
| Integración multiempresa (`company_id` como invariante) | Toda tabla nueva desde ADR-002 | Baseline v1 (ADR-005) — confirmado sin colisión entre dos empresas reusando la misma intención del catálogo cerrado. |
| Constitución y ADRs 001-005 | `docs/constitution/`, `docs/decisions/` | Los principios (P1-P8, R1-R10) no se renegocian por iniciativa propia. |

---

## Componentes en evolución (foco actual: plataforma SaaS alrededor del Core)

| Componente | Estado actual | Fase que lo construye |
|---|---|---|
| `servicios`, `mensajes_automaticos` | Existen (adelantados de Anexo C), en uso desde Anexo B/TA.7 | Se completan según necesidad real, no por diseño especulativo |
| Plataforma de configuración (checklist de alta de empresa, generalización de campos CRM, rename `tipo_rack`) | Parcial — algunas piezas ya configurables (4.1 del Anexo C) | Anexo C, sin fecha fija — no es el foco actual |
| Dashboard, portal de administración, gestión de empresas/usuarios/asesores | No iniciado | FASE 5 — Plataforma SaaS (ver roadmap) |
| Agenda propia de TARA (UI sobre la tabla `citas`, ya existente) | No iniciado — el modelo de datos (`citas`, `asesores`, `horarios_laborales`) ya existe y está validado | FASE 5 |
| Conversaciones en tiempo real + intervención humana ("Tomar conversación"/"Regresar a TARA") | No iniciado | FASE 5 |
| CRM, reportes | No iniciado (existe `oportunidades` como base parcial) | FASE 5 |
| Multiempresa (Organization/Workspace formal), Billing | Parcial / no iniciado | Futuro, fuera del foco actual |
| Memory Engine (M9) | Diferido (ADR-004) | FASE 6 |

---

## Cómo se usa este documento

Antes de tocar algo de la tabla "estables": se aplica la regla de cambio (bug con reproducción, o evidencia de un piloto real — ver ADR-005). No se modifica por "ya que estoy aquí, lo mejoro" ni por generalización especulativa. Todo lo que sí es foco activo vive en la tabla "en evolución" y se puede tocar directo.
