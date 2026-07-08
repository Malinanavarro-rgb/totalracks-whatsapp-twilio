# Arquitectura Congelada v1.0

| Campo | Valor |
|-------|-------|
| Estado | Vigente |
| Fecha de congelamiento | 6 de julio de 2026 |
| Commit de referencia | `277038c` (FASE 4B — producción Total Racks, 384/384 tests) |
| Vigente durante | Implementación de `docs/anexos/plataforma-saas/README.md` (Anexo A, B, C) |
| Precedencia | Sujeta a `docs/constitution/v3-constitution.md` (TARA-CONST-001). Este documento es un recorte operativo de esa Constitución para la ventana de trabajo actual, no la reemplaza. |

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
| WorkflowEngine (M5) | `modules/workflow-engine.js` | Validado en producción con Total Racks (FASE 4A/4B). Los Anexos lo *usan* (workflows apuntan a `agendar_cita`, `servicios`), no lo modifican. |
| Orchestrator (M7) | `modules/orchestrator.js` | Coordinador del Kernel. Único cambio autorizado por el Anexo A: extraer `_ejecutarAcciones()` hacia `ActionRunner` — ya specificado en el documento, no es una excepción abierta. |
| AIProvider (puerto) + `OpenAIProvider`/`MockProvider` | `adapters/ai/` | Contrato validado en producción. `CalendarProvider` replica su patrón, no lo toca. |
| ChannelAdapter (puerto) + `TwilioWhatsAppAdapter` | `adapters/channels/` | Incluye `sendProactive()`, ya usado por T4A.11 y reutilizado tal cual por los recordatorios del Anexo A. |
| Knowledge Base | tabla `knowledge_base`, lectura en `modules/config.js` | Sigue existiendo para contenido libre; `servicios` (Anexo C) es una tabla nueva y separada, no un reemplazo. |
| CRM base | `modules/crm.js`, tablas `clientes`/`conversaciones`/`oportunidades` | Única excepción ya aprobada y acotada: el rename `tipo_rack`→`categoria_principal` (TC.1). Cualquier otro cambio a estas tablas o a `crm.js` fuera de ese rename requiere pasar por la regla de cambio. |
| ContextBuilder, PromptBuilder, AuditLogger, ChannelRouter | `modules/context-builder.js`, `modules/prompt-builder.js`, `modules/audit-logger.js`, `modules/channel-router.js` | Kernel puro (Artículo 4 de la Constitución). Ningún Anexo tiene motivo para tocarlos. |
| Constitución y ADRs 001-004 | `docs/constitution/`, `docs/decisions/` | Los principios (P1-P8, R1-R10) no se renegocian dentro de la implementación de un Anexo. |

---

## Componentes en evolución (este es el espacio de trabajo de los Anexos)

| Componente | Estado actual | Anexo/fase que lo mueve |
|---|---|---|
| `CalendarProvider` + `GoogleCalendarProvider`/`MockCalendarProvider` | No existe — se crea desde cero | Anexo A |
| `SchedulingEngine` (M10) | No existe — se crea desde cero | Anexo A |
| `ActionRunner` (M8) | Existe como stub hardcodeado en `Orchestrator._ejecutarAcciones()` | Anexo A lo formaliza |
| `servicios`, `mensajes_automaticos`, `citas`, `asesores`, `horarios_laborales`, `calendar_credentials` | No existen | Anexo A / Anexo C |
| Workflow del segundo giro (salón de uñas) | No existe — validación interna/sintética | Anexo B |
| Plataforma de configuración (checklist de alta de empresa, generalización de campos CRM) | Parcial — algunas piezas ya configurables (4.1 del Anexo C) | Anexo C |
| Dashboard operativo | No iniciado | Fuera de alcance de los Anexos — roadmap original, sin renumerar (ver Anexo, sección 7) |
| Multiempresa (Organization/Workspace formal) | Parcial — hoy `companies` hace las veces de Workspace (ADR-002) | Fuera de alcance de los Anexos |
| Billing | No iniciado | Fuera de alcance de los Anexos — roadmap original |
| Automatizaciones adicionales (más allá de agenda) | No iniciado | Futuro — depende de qué necesite un tercer giro |

---

## Cómo se usa este documento

Antes de escribir código para TA.x, TB.x o TC.x: si el cambio toca solo la columna "en evolución", se procede directo. Si toca algo de "componentes estables" más allá de las dos excepciones ya aprobadas (extracción de `ActionRunner` y rename `tipo_rack`), se aplica la regla de cambio antes de escribir una sola línea.
