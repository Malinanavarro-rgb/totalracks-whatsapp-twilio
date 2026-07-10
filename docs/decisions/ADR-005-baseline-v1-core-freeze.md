# ADR-005 — Core baseline v1: freeze del motor conversacional y de agenda

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | 9 de julio de 2026 |
| Autora | Alina Navarro |
| Commits de referencia | `7bb4538`…`b80c69c` (TA.0–TA.9, Anexo B) |

---

## Contexto

Entre TA.0 y TA.9 (Anexo A) y TB.1–TB.4 (Anexo B) se construyó y validó dos veces, de forma independiente, el motor conversacional y de agenda de TARA:

1. **Anexo A — Total Racks (cliente real, producción):** `WorkflowEngine`, `SchedulingEngine`, `ActionRunner`, `GoogleCalendarProvider`, flujo OAuth completo. Validado con una cita real, un cliente real, un evento real en Google Calendar.
2. **Anexo B — Salón de Uñas (sintético, interno):** el mismo Kernel, un giro de negocio estructuralmente distinto (transaccional/agenda vs. consultivo/cotización), sin Google conectado (`MockCalendarProvider`), sin una sola línea de cambio en `WorkflowEngine`.

Ambas validaciones están documentadas con evidencia de ejecución real (no solo tests): `docs/anexos/plataforma-saas/README.md` sección 2 (Anexo A) y sección 3.7 (Anexo B, cierre formal).

## Problema a resolver

Con dos validaciones independientes exitosas, el motor deja de ser "código en construcción" y pasa a ser infraestructura sobre la que se va a construir producto (dashboard, portal de administración, CRM, reportes — ver roadmap actualizado). Sin una decisión explícita de freeze, cada nueva pieza de plataforma corre el riesgo de "mientras tanto, ajusto esto del motor" sin justificación — exactamente el problema que `docs/ARQUITECTURA-CONGELADA-v1.0.md` ya prevenía para los Anexos, ahora extendido a la siguiente etapa.

## Decisión

Se congela como **baseline v1** — estable, no se modifica por iniciativa propia — lo siguiente:

| Componente | Ubicación | Evidencia de validación |
|---|---|---|
| `WorkflowEngine` (M5) | `modules/workflow-engine.js` | Anexo A (real) + Anexo B (sintético) — cero cambios de código entre ambos |
| `SchedulingEngine` (M10) | `modules/scheduling-engine.js` | Anexo A (Google real) + Anexo B (Mock) + fix de zona horaria confirmado con una cita real |
| `ActionRunner` (M8) | `modules/action-runner.js` | Extraído en TA.4, extendido en TA.6/TA.9, reusado sin cambios en Anexo B |
| `CalendarProvider` (puerto) + `GoogleCalendarProvider`/`MockCalendarProvider` | `adapters/calendar/` | Ambos providers validados con datos reales |
| `google-auth.js` (OAuth + cifrado de credenciales) | `modules/google-auth.js` | Flujo OAuth real completado y probado con Total Racks |
| Orchestrator (M7) — coordinación, `_finalizarWorkflow`, `_ejecutarAcciones` | `modules/orchestrator.js` | Validado en ambos Anexos; el "graduado" de TA.9→Anexo B (handler de hora) confirma que la extensión es reusable entre empresas |
| Integración multiempresa (`company_id` como invariante en toda tabla nueva) | Todo lo anterior + `workflows`/`asesores`/`citas`/`horarios_laborales`/`servicios` | Confirmado sin colisión entre Total Racks y el salón sintético, incluso reusando la misma intención del catálogo cerrado |

Esto **actualiza** `docs/ARQUITECTURA-CONGELADA-v1.0.md`: los componentes de la tabla "en evolución" de ese documento correspondientes a Anexo A (`CalendarProvider`, `SchedulingEngine`, `ActionRunner`) se mueven a "estables".

**Confirmación de diseño explícita (pedida directamente, no inferida):** la tabla `citas` es la **fuente principal de verdad** de la agenda de TARA. Google Calendar es una **integración opcional**, best-effort, no una dependencia del producto — ya implementado así desde TA.3 (`_sincronizarCalendarioBestEffort`: si Google falla, la cita queda agendada igual) y TA.6 (`MockCalendarProvider` como fallback automático si una empresa no conecta Google). Este ADR formaliza esa propiedad ya existente como decisión de arquitectura permanente, no como un detalle de implementación incidental.

## Regla de cambio (vigente a partir de este ADR)

No se modifica ningún componente de la tabla anterior salvo:
1. **Bugs** — con reproducción clara y test de regresión (mismo criterio ya usado en el fix de zona horaria de TA.9 y en `buscarAsesorPorNombre`).
2. **Evidencia proveniente de un piloto real** — un cliente real (no sintético) que exponga una limitación concreta del motor, documentada igual que TB.0–TB.4.
3. Explícitamente, **no** por: "ya que estoy aquí, lo mejoro", refactors de estilo, o generalización especulativa para un caso de uso hipotético.

Cualquier cambio a estos componentes, aun justificado, se documenta explícitamente (qué se encontró, por qué, qué alternativas se consideraron) — no se hace en silencio dentro de un commit de feature de plataforma.

## Consecuencia para el roadmap

El esfuerzo de desarrollo se redirige a construir la plataforma **alrededor** del motor, no a seguir iterando el motor mismo: dashboard, agenda propia de TARA (UI), portal de administración, gestión de empresas/usuarios/asesores, conversaciones en tiempo real, intervención humana, CRM, reportes, configuración por empresa, experiencia SaaS. Ver `docs/roadmap/README.md` (actualizado el mismo día que este ADR).

## Excepciones documentadas (cambios posteriores al Core, con justificación)

| Fecha | Componente | Qué cambió | Por qué | Alternativas consideradas |
|---|---|---|---|---|
| 9 jul 2026 | `Orchestrator._mapearPersonalidad()` | Se agregó `instruccionesDePersonalidad()` (`modules/personalidad-presets.js`) — 3 líneas de instrucción opcionales (longitud de respuesta, uso de emojis, nivel de iniciativa), aditivo, sin cambiar lógica de decisión existente | Dirigido explícitamente por la dueña del producto (Fase 6, Configuración amigable de IA): las opciones de negocio que ve el cliente deben tener efecto real desde el día uno, no solo guardarse para una implementación futura | (a) guardar las opciones sin aplicarlas todavía — descartada porque la dueña pidió efecto real inmediato; (b) tocar `PromptBuilder` en vez de `Orchestrator` — descartada porque el string de identidad ya se ensambla en `_mapearPersonalidad`, agregar el bloque ahí es el cambio más chico posible |

## Condición para reabrir

Este ADR se revisa si:
- Un piloto real (no sintético) expone un bug o limitación arquitectónica del motor que no se puede resolver sin tocar un componente de la tabla congelada.
- Se decide construir un tercer giro de negocio y esa construcción por sí sola revela un límite genuino de generalización (no cubierto por Anexo A/B).
- Se decide construir el diseño de 4 nodos completo de Anexo B (nodo intermedio que ejecuta acción y muestra resultado) — eso sí requeriría tocar `Orchestrator`, y debe pasar por este mismo proceso de ADR, no implementarse por iniciativa propia.
