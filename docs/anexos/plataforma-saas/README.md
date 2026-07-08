# Anexo — Plataforma SaaS Multiempresa
## Documento de Arquitectura · Motor de Agenda + Validación Multivertical + Configuración sin Código

| Campo | Valor |
|-------|-------|
| Estado | Propuesta — pendiente de aprobación antes de programar |
| Fecha | 6 de julio de 2026 |
| Referencia | Extiende `docs/constitution/v3-constitution.md` (TARA-CONST-001). No la contradice. Complementa `docs/roadmap/README.md` sin modificarlo. |
| Alcance | Documento de arquitectura únicamente. Ningún código se modifica hasta aprobación explícita. |

---

## 0. Contexto y mandato

FASE 4B cerró la validación de Total Racks como primer cliente en producción: WorkflowEngine (M5) en producción, 384 tests pasando, criterios comerciales de piloto ajustados. A partir de aquí, **no se agrega funcionalidad específica de Total Racks** salvo correcciones que surjan del piloto.

El mandato cambia: TARA deja de evolucionar *para* un cliente y empieza a evolucionar *como producto*. Este documento cubre las tres iniciativas solicitadas:

1. **Motor de Agenda** — módulo de calendario desacoplado, usable por cualquier empresa.
2. **Validación con un segundo giro** — probar que el motor de workflows generaliza fuera de Total Racks.
3. **Plataforma multiempresa configurable** — sistematizar qué se puede configurar sin escribir código.

### Por qué esto es un Anexo y no una fase numerada del roadmap

`docs/roadmap/README.md` y el Artículo 18 de la Constitución ya tienen una numeración con historia (FASE 1 → FASE 4B, cada una con tareas documentadas bajo esos nombres). Insertar aquí una "FASE 5" con sub-fases — y correr el resto del roadmap una posición — generaría confusión de aquí a un mes, cuando nadie recuerde si "FASE 6" es Memory Engine o Dashboard.

**Decisión:** estas tres iniciativas viven como **Anexos** mientras se validan en producción, sin tocar la numeración existente:

| Nombre del usuario | Nombre en este documento |
|---|---|
| FASE 1 — Motor de Agenda | **ANEXO A** |
| FASE 2 — Validación con segundo giro | **ANEXO B** |
| FASE 3 — Plataforma Multiempresa configurable | **ANEXO C** |

El roadmap (`docs/roadmap/README.md`, Artículo 18) **no se modifica** con este documento. Cuando los tres anexos estén implementados y probados en producción, corresponde una reorganización completa del roadmap (v2) con la experiencia real del producto — no antes. Ver sección 7.

---

## 1. Principios que se mantienen sin cambio

Este plan no introduce ninguna excepción a la Constitución. En particular:

- **P1** (el Kernel no conoce negocios) — el `SchedulingEngine` nuevo es tan agnóstico como `WorkflowEngine`: no sabe si agenda una manicura o una visita técnica.
- **P2** (configuración sobre código) — agregar un asesor, un horario o un servicio nuevo es un INSERT, no un deploy.
- **P3** (el canal es reemplazable) — el motor de agenda no depende de WhatsApp; usa el mismo `Message`/`ChannelAdapter` que ya existe.
- **ADR-002** (invariante `company_id`) — toda tabla nueva lleva `company_id NOT NULL` y ninguna función del Kernel opera sin él.
- **R7** (dependencias inyectadas, no singletons) — el `SchedulingEngine` recibe su `CalendarProvider` por constructor, igual que `AIEngine` recibe sus `AIProvider`.

---

## 2. ANEXO A — Motor de Agenda

### 2.1 Objetivo

Un módulo del Kernel (`modules/scheduling-engine.js`) que cualquier empresa pueda usar para: consultar disponibilidad, agendar, reagendar, cancelar, confirmar y recordar citas — con múltiples asesores, horarios laborales configurables, sin doble reserva, y sin acoplarse a Google Calendar como único proveedor.

### 2.2 Por qué esto no es "una integración con Google Calendar"

Si se implementara como una llamada directa a la API de Google dentro del Orchestrator o del Workflow, se violaría P1 y P3 de la misma forma que hubiera sido un error llamar a Twilio directamente desde el Orchestrator. La solución es la misma que ya existe para IA y canales: **puerto + adaptador**.

```
                    ┌─────────────────────────┐
                    │   SchedulingEngine (M10) │   ← Kernel, agnóstico de proveedor
                    │   modules/               │
                    └───────────┬─────────────┘
                                │ usa
                    ┌───────────▼─────────────┐
                    │   CalendarProvider       │   ← Puerto (interfaz)
                    │   adapters/calendar/     │
                    │   calendar-provider.js   │
                    └───────────┬─────────────┘
                                │ implementado por
              ┌─────────────────┼─────────────────┐
   ┌──────────▼──────────┐          ┌─────────────▼───────────┐
   │ GoogleCalendarProvider│          │ MockCalendarProvider     │
   │ (adapters/calendar/)  │          │ (tests, sin red)         │
   └───────────────────────┘          │ OutlookCalendarProvider  │
                                       │ (futuro — mismo puerto)  │
                                       └──────────────────────────┘
```

Este es exactly el mismo patrón que `AIProvider` (`adapters/ai/ai-provider.js`) y `ChannelAdapter` (`adapters/channels/channel-adapter.js`) ya usan. No se inventa un patrón nuevo — se replica uno que ya está validado en producción.

### 2.3 Módulos nuevos

| Módulo | Ubicación | Rol |
|---|---|---|
| `CalendarProvider` (puerto) | `adapters/calendar/calendar-provider.js` | Contrato: `consultarDisponibilidad()`, `crearEvento()`, `actualizarEvento()`, `cancelarEvento()`, `nombre` |
| `GoogleCalendarProvider` | `adapters/calendar/google-calendar-provider.js` | Implementación con `googleapis`, OAuth2 por empresa |
| `MockCalendarProvider` | `adapters/calendar/mock-calendar-provider.js` | Para tests — igual que `MockProvider` en `adapters/ai/` |
| `SchedulingEngine` (M10) | `modules/scheduling-engine.js` | Lógica pura: horarios, asesores, asignación, anti-doble-reserva. No conoce Google. |
| `ActionRunner` (M8 — completar el stub existente) | `modules/action-runner.js` | Reemplaza `Orchestrator._ejecutarAcciones()`, que ya está marcado como *"stub FASE 4B — Action Runner"* en el código actual (`modules/orchestrator.js:525`) |

**Hallazgo importante:** el punto de extensión ya existe. `orchestrator.js` líneas 227-229 y 524-562 contienen literalmente el comentario `// ACCIONES (stub FASE 4B — Action Runner)`. Esto no es una decisión nueva — es completar algo que la arquitectura ya anticipó. El `ActionRunner` deja de ser un `if (accion.tipo === 'crear_oportunidad')` hardcodeado y pasa a ser un registro de handlers:

```js
class ActionRunner {
  constructor() { this._handlers = new Map(); }
  registrar(tipo, handlerFn) { this._handlers.set(tipo, handlerFn); }
  async ejecutar(accion, ctx) {
    const handler = this._handlers.get(accion.tipo);
    if (!handler) return { error: `Acción desconocida: ${accion.tipo}` };
    return handler(accion.parametros, ctx);
  }
}
```

El `SchedulingEngine` se registra ahí con 4 tipos de acción: `consultar_disponibilidad`, `agendar_cita`, `reagendar_cita`, `cancelar_cita`. `crear_oportunidad` (lo único que existe hoy) se migra al mismo mecanismo sin cambiar su comportamiento.

### 2.4 Modelo de datos nuevo

Todas las tablas siguen el patrón ya establecido: `company_id NOT NULL REFERENCES companies(id)`, RLS deshabilitado (server-side con service role, igual que el resto — ADR-002), índices por `company_id`.

```sql
-- Credenciales de calendario por empresa. Genérica por proveedor.
CREATE TABLE calendar_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  proveedor     text NOT NULL,          -- 'google' | 'outlook' (futuro)
  credenciales  jsonb NOT NULL,         -- tokens OAuth cifrados a nivel aplicación
  calendario_id text,                   -- ID del calendario externo por defecto
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

-- Asesores/recursos que pueden recibir citas.
CREATE TABLE asesores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  nombre         text NOT NULL,
  email          text,
  calendario_id  text,                  -- calendario externo específico del asesor (opcional)
  activo         boolean NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

-- Horarios laborales. asesor_id NULL = aplica a todos los asesores de la empresa.
CREATE TABLE horarios_laborales (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  asesor_id    uuid REFERENCES asesores(id),
  dia_semana   integer NOT NULL,        -- 0=domingo … 6=sábado
  hora_inicio  time NOT NULL,
  hora_fin     time NOT NULL,
  zona_horaria text NOT NULL DEFAULT 'America/Monterrey'
);

-- Citas. Es el registro operativo — equivalente a workflow_sessions pero para agenda.
CREATE TABLE citas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  cliente_id        bigint NOT NULL REFERENCES clientes(id),
  asesor_id         uuid NOT NULL REFERENCES asesores(id),
  calendar_event_id text,               -- ID del evento en el proveedor externo
  inicio            timestamptz NOT NULL,
  fin               timestamptz NOT NULL,
  estado            text NOT NULL DEFAULT 'agendada',
  -- valores: agendada | confirmada | reagendada | cancelada | completada | no_show
  origen_workflow_id uuid REFERENCES workflows(id),  -- nullable: cita puede originarse fuera de un workflow
  recordatorio_enviado boolean NOT NULL DEFAULT false,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Evita doble reserva a nivel de base de datos, no solo de aplicación.
CREATE UNIQUE INDEX idx_citas_sin_doble_reserva
  ON citas (asesor_id, inicio)
  WHERE estado IN ('agendada', 'confirmada', 'reagendada');
```

El índice único parcial es la pieza crítica: la prevención de doble reserva **no puede depender solo de que `SchedulingEngine` consulte antes de escribir** — dos mensajes casi simultáneos (el mismo problema que ya resolvió la "cola por conversación" del commit de hoy, pero ahora entre *dos clientes distintos* pidiendo el mismo asesor) deben fallar en la base de datos, no en la lógica de aplicación.

### 2.4.1 Preparado para evolucionar a múltiples recursos por cita (sin implementarlo ahora)

**MVP confirmado: una cita usa un solo recurso** (`citas.asesor_id`, `NOT NULL`). Para el salón de uñas del Anexo B esto es suficiente — la manicurista *es* el recurso.

**Decisión de diseño para no bloquear el crecimiento futuro:** no se modela `asesores` como si fuera genéricamente "el único tipo de recurso posible" en ningún punto del código o del schema que sea costoso deshacer. Concretamente:

- `citas.asesor_id` se mantiene como el **recurso principal obligatorio** — nunca se elimina ni se renombra, así que ningún cliente que ya use el sistema se rompe cuando se agregue soporte multi-recurso.
- Cuando haga falta reservar recursos adicionales (sala, estación, equipo, vehículo), la extensión es **aditiva**: una tabla nueva `citas_recursos` (`cita_id`, `recurso_id`, `tipo_recurso`) que registra recursos *adicionales* de una cita, sin tocar `citas` ni `asesores`. El índice anti-doble-reserva de hoy (`asesor_id, inicio`) se replica igual para cada nuevo tipo de recurso (`recurso_id, inicio`) en la tabla nueva — mismo patrón, no uno distinto.
- `SchedulingEngine.consultarDisponibilidad()` recibe como parámetro qué recurso(s) evaluar; hoy siempre se le pasa un asesor. El día que haga falta, se le puede pasar una lista de recursos sin cambiar su forma de invocación desde el Orchestrator/Workflow.

**Qué NO se construye en Anexo A:** la tabla `citas_recursos`, el concepto general de "tipo de recurso" (`recursos` como entidad configurable), ni la lógica de reservar más de un recurso a la vez. Se deja solo el camino de extensión documentado aquí para que, si un futuro giro lo necesita, no implique romper `citas` ni migrar datos existentes — solo agregar una tabla y un parámetro opcional.

### 2.5 Integración con el sistema actual

- **Workflow → Agenda:** `workflow_nodes.acciones` (columna `jsonb`, migración 005) ya soporta `[{"tipo": "agendar_cita"}]` sin ninguna migración adicional — es el mismo mecanismo que hoy dispara `crear_oportunidad`. Un workflow de "Descubrimiento Comercial" puede terminar en un nodo con `modo_respuesta: 'silent'` (ya reservado en el schema, no usado aún) que ejecuta `agendar_cita` en lugar de solo responder texto.
- **AIOutput → Agenda:** el catálogo de intenciones (FASE 4A) puede extender el catálogo cerrado con `'agendar_cita'` como séptima intención, o mantenerlo dentro de `solicitud_cotizacion`/`interes_compra` según el giro — se decide por empresa, no en el Kernel.
- **Orchestrator:** un solo cambio estructural — `_ejecutarAcciones()` deja de tener el `if` hardcodeado y delega a `ActionRunner.ejecutar()`. El resto del flujo (`_paso('acciones', ...)`) no cambia.

**Decisiones de producto confirmadas:**

- **Asignación automática de asesor.** `SchedulingEngine` resuelve qué asesor asignar (menor carga / primero disponible, salvo que el cliente pida uno específico) *antes* de escribir en `citas` — el cliente nunca ve un estado "sin asignar". Por eso `citas.asesor_id` es `NOT NULL`: la fila solo se crea una vez resuelta la asignación.
- **Citas fuera de un workflow.** `citas.origen_workflow_id` se mantiene nullable — una cita puede nacer de un workflow completo de descubrimiento o de una intención directa de agendar sin las preguntas previas. El `SchedulingEngine` es invocable de forma independiente al `WorkflowEngine`, no solo como acción de un nodo.

### 2.6 Recordatorios automáticos — la pieza que no existe hoy

Este es el único componente genuinamente nuevo en términos de infraestructura, no solo de código: **hoy TARA es 100% reactiva**. Solo actúa cuando llega un mensaje (webhook de Twilio). No hay ningún proceso que se ejecute por sí solo.

Los recordatorios requieren lo contrario: un proceso que despierte sin que nadie escriba, revise `citas` próximas a `inicio`, y envíe un mensaje proactivo.

**Buena noticia:** la pieza de salida ya existe. `ChannelAdapter.sendProactive()` está definida en el puerto (`adapters/channels/channel-adapter.js:76`) y **ya implementada** en `TwilioWhatsAppAdapter` (`adapters/channels/twilio-whatsapp.js:119`) — se usó en T4A.11 para "entrega async vía REST API". No hay que construir el envío proactivo; ya existe y está probado en producción.

Lo que falta es el disparador. Dos opciones, evaluadas en la sección de riesgos (2.7):

| Opción | Descripción | Trade-off |
|---|---|---|
| **A — Render Cron Job** | Servicio separado en `render.yaml` que corre `node scripts/enviar-recordatorios.js` cada N minutos | Nuevo servicio a mantener; costo adicional en Render; simple y explícito |
| **B — pg_cron en Supabase** | Un cron a nivel de Postgres llama a un webhook interno de `server.js` | Sin servicio nuevo en Render; acopla la lógica de disparo a Supabase |

**Decisión confirmada:** Opción A — Render Cron Job. Mantiene la separación de responsabilidades (Supabase = datos, Render = cómputo) y es consistente con cómo ya está desplegado el resto del sistema (`render.yaml` existente). TA.7 implementa esto.

Los recordatorios (y las confirmaciones/cancelaciones/reprogramaciones) son **mensajes operativos** — plantilla siempre confiable, personalización de IA opcional y nunca bloqueante. La regla completa y el porqué están en Anexo C, sección 4.2.1. Consecuencia directa para este cron: **nunca espera a OpenAI de forma bloqueante** — construye el mensaje desde la plantilla primero, y si la personalización de IA no responde dentro de un timeout corto, envía la plantilla tal cual. El cron nunca falla por una caída de OpenAI.

### 2.7 Qué se reutiliza íntegramente

| Componente | Reutilización |
|---|---|
| `ChannelAdapter.sendProactive()` | 100% — ya implementado, sin cambios |
| `AuditLogger` | 100% — `logAccion()` ya registra el resultado de cualquier acción, incluida agenda |
| Patrón puerto/adaptador | 100% — se replica el patrón de `AIProvider`, no se inventa uno nuevo |
| `company_id` como invariante | 100% — todas las tablas nuevas lo heredan |
| `_paso()` (medición de timing + captura de error sin `throw`) | 100% — el nuevo paso `agenda` en el Orchestrator usa el mismo helper |
| Convención de migraciones numeradas (`migrations/0XX_*.sql`) | 100% — continúa la secuencia desde `014_` |

### 2.8 Riesgos de esta fase

| Riesgo | Severidad | Mitigación |
|---|---|---|
| No existe infraestructura de proceso en background hoy | Alta | Resuelto con Render Cron Job (2.6, decisión confirmada) |
| Doble reserva por condición de carrera entre dos clientes | Alta | Índice único parcial a nivel DB (2.4), no solo lógica de aplicación |
| **No existe hoy ningún proyecto de Google Cloud para TARA** — hay que crearlo desde cero, y la verificación de OAuth para scopes de Calendar puede tomar semanas si Google la exige | **Alta** (confirmado — no había proyecto previo) | Crear el proyecto e iniciar el proceso de verificación **en paralelo con TA.1–TA.4**, no esperar a TA.5. Mientras no esté verificado, operar en modo de prueba (límite ~100 usuarios de prueba en la app OAuth) — suficiente para Total Racks + el segundo giro de ANEXO B, insuficiente para escalar a más empresas |
| Zona horaria por asesor vs. zona horaria de la empresa (`personality.zona_horaria` ya existe) | Media | `horarios_laborales.zona_horaria` es explícito por fila, no heredado implícitamente |
| Refresh de tokens OAuth expirados sin que nadie lo note | Media | `GoogleCalendarProvider` debe fallar de forma visible en `AuditLogger`, nunca en silencio (Artículo P7/P8 de la Constitución) |
| Cifrado de `calendar_credentials.credenciales` | Alta (seguridad) | **Confirmado:** cifrado simétrico (AES-256-GCM) a nivel de aplicación, con clave maestra en variable de entorno de Render (`CALENDAR_CREDENTIALS_KEY` o similar) — mismo modelo de confianza que ya se usa para `TWILIO_AUTH_TOKEN`/`OPENAI_API_KEY`. No se introduce una dependencia de KMS externo en esta fase. |

### 2.9 Tareas incrementales (ANEXO A)

| ID | Tarea | Tipo | DoD |
|---|---|---|---|
| TA.0 | Tag + `ROLLBACK-ANEXO-A.md` | Setup | Igual convención que fases previas |
| TA.0.1 | Crear proyecto de Google Cloud + pantalla de consentimiento OAuth + iniciar proceso de verificación (scopes de Calendar) | Infra — **arrancar en paralelo con TA.1, tiene semanas de espera** | Proyecto creado, credenciales de sandbox disponibles para TA.5 |
| TA.1 | Puerto `CalendarProvider` + `MockCalendarProvider` | Código | Contrato definido, tests con mock |
| TA.2 | Migraciones `014`–`017`: `calendar_credentials`, `asesores`, `horarios_laborales`, `citas` | DB | Tablas creadas, índice anti-doble-reserva verificado con test de concurrencia |
| TA.3 | `SchedulingEngine` (M10): disponibilidad, asignación automática, anti-doble-reserva en lógica de aplicación | Código | Tests unitarios — igual cobertura que `workflow-engine.test.js` |
| TA.4 | `ActionRunner` (M8): extraer de `orchestrator.js`, migrar `crear_oportunidad` | Código | Tests de integración; comportamiento actual sin regresión |
| TA.5 | `GoogleCalendarProvider`: OAuth2, CRUD de eventos | Código | Prueba manual contra un calendario real de sandbox |
| TA.6 | Registrar 4 acciones de agenda en `ActionRunner` | Código | `agendar_cita` disparable desde un nodo de workflow de prueba |
| TA.7 | Disparador de recordatorios (Render Cron Job) — renderiza `mensajes_automaticos` (Anexo C, 4.2.1), personalización de IA con timeout corto y no bloqueante, usa `sendProactive()` existente | Infra + Código | Corre en horario definido; si OpenAI no responde a tiempo, envía la plantilla base sin personalización y sin fallar |
| TA.8 | Tests de integración Orchestrator + SchedulingEngine | Tests | Flujo completo mockeado, sin red real |
| TA.9 | Deploy + validación con Total Racks (agenda de visita, caso ya existente) | Validación | Cita real creada y visible en Google Calendar |

---

## 3. ANEXO B — Validación con un segundo giro

### 3.1 El objetivo real de esta fase

No es "conseguir un segundo cliente". Es **una prueba de arquitectura**: si agregar un giro de negocio distinto requiere tocar `modules/` o `adapters/`, la plataforma no es una plataforma todavía — es un bot de Total Racks con una capa de configuración encima. El criterio de éxito no es comercial, es arquitectónico: **cero líneas nuevas en el Kernel.**

### 3.2 Análisis comparativo

| Criterio | Salón de uñas | Paneles solares |
|---|---|---|
| Forma del workflow | Selección de servicio → asesor → horario → confirmación. Ciclo corto, transaccional. | Descubrimiento de necesidad → volumen/consumo → presupuesto → cotización. Ciclo largo, consultivo. |
| Similitud estructural con Total Racks | Baja — no hay "oportunidad"/cotización como eje central | **Alta** — mismo patrón que Descubrimiento Comercial (`volumen_estimado`, `presupuesto_aproximado`, `plazo_compra`) |
| Estrés real sobre ANEXO A (Motor de Agenda) | **Máximo** — la cita ES el producto final de la conversación, no un anexo | Bajo/medio — una visita técnica es posible pero no es el corazón del flujo |
| Riesgo de "copiar sin darse cuenta" el workflow de Total Racks | Bajo — la forma del negocio obliga a un diseño distinto | **Alto** — es fácil terminar reescribiendo Descubrimiento Comercial con otro nombre |
| Volumen de citas / valor de recordatorios automáticos | Alto — no-shows son un problema de negocio real y medible | Bajo — pocas visitas, alto valor cada una, seguimiento manual es viable |
| Catálogo de servicios | Simple (lista de servicios con duración y precio) — valida ANEXO C (tabla `servicios`) | Más complejo, similar a lo ya modelado para Total Racks |

### 3.3 Recomendación

**Salón de uñas — confirmado.**

Razón principal: valida en un solo giro las dos cosas que más importan ahora mismo — que el `WorkflowEngine` genera un flujo *estructuralmente distinto* al de Total Racks (sin quote/discovery largo), y que el `SchedulingEngine` de ANEXO A funciona en producción bajo carga real (múltiples asesoras/manicuristas, alto volumen de citas, no-shows).

Paneles solares es una validación más débil precisamente porque *se parece demasiado* a Total Racks: sería fácil aprobar el "segundo giro" sin haber probado nada nuevo, reintroduciendo sin querer patrones de Total Racks en el Kernel.

Nota: paneles solares sigue siendo un buen tercer giro más adelante, cuando el objetivo sea validar ciclos de venta largos en vez del motor de agenda.

### 3.4 Diseño de alto nivel del nuevo workflow (sin construir aún)

No se diseña el workflow completo en este documento — eso es trabajo de ANEXO B, no de este plan de arquitectura. Se deja anotado el esqueleto para que la fase de diseño parta de algo:

```
Intención: interes_compra / solicitud_cotizacion → "agendar_servicio" (nueva intención o reuso)
  Nodo 1: ¿qué servicio? (catálogo de servicios de la empresa — tabla `servicios`, ANEXO C)
  Nodo 2: ¿con qué asesora o sin preferencia? (asignación automática si no hay preferencia — SchedulingEngine)
  Nodo 3: SchedulingEngine.consultarDisponibilidad() → presentar 2-3 horarios
  Nodo final (silent): SchedulingEngine.agendarCita() → confirmación
```

Este esqueleto usa `workflows`/`workflow_nodes` sin ninguna columna nueva — confirma que FASE 4A ya diseñó el schema con la flexibilidad necesaria.

### 3.5 Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Terminar copiando el patrón de Descubrimiento Comercial "porque es lo que ya funciona" | Alta | El criterio de éxito de 3.1 (cero líneas en el Kernel) es necesario pero no suficiente — revisar explícitamente que el *workflow en sí* no sea un clon con otro vocabulario |
| Catálogo de servicios (`servicios`, ANEXO C) se necesita *antes* de poder construir este workflow | Media | Secuenciar: ANEXO C (al menos la tabla `servicios`) debe adelantarse parcialmente, o ANEXO B construye una versión mínima ad-hoc que luego migra |
| Validación sintética puede no revelar reglas de negocio reales de un salón de uñas (ej. políticas de cancelación, tiempos de servicio reales) | Media | Confirmado (3.6, TB.0): es validación interna, no cliente real. Los datos de servicios/horarios/reglas se inventan de forma realista pero no están validados por un negocio operando — cuando se busque un cliente real de este giro más adelante, revisar el workflow contra sus reglas reales antes de asumir que ya está "listo" |

### 3.6 Tareas incrementales (ANEXO B)

| ID | Tarea | Tipo |
|---|---|---|
| TB.0 | ~~Confirmar si es cliente real o validación interna~~ — **Confirmado: validación interna/sintética.** No hay cliente real de salón de uñas todavía; se construye como prueba de arquitectura con datos de ejemplo | Decisión de negocio — resuelta |
| TB.1 | Diseñar workflow completo (nodos, catálogo de intenciones, reglas comerciales del giro) — con datos y reglas sintéticas pero realistas | Diseño |
| TB.2 | Seed de datos: empresa, personalidad, servicios, asesores, horarios (sintéticos) | DB |
| TB.3 | Prueba de aislamiento: confirmar que este giro no interfiere con Total Racks (mismo criterio que T3.12/T4A.12) | Validación |
| TB.4 | Deploy y piloto interno (sin cliente final real — validar el flujo de punta a punta con mensajes de prueba) | Validación |

---

## 4. ANEXO C — Plataforma de Configuración

### 4.1 Qué ya es configurable sin código hoy

Esto ya existe y funciona — no hay que construirlo:

| Elemento | Tabla | Estado |
|---|---|---|
| Empresa | `companies` | Configurable — 1 INSERT |
| Personalidad / tono / objetivo | `personalities` | Configurable |
| Base de conocimiento | `knowledge_base` | Configurable |
| Workflow y sus nodos | `workflows`, `workflow_nodes` | Configurable (FASE 4A) |
| Número de WhatsApp | `channel_endpoints` | Configurable (FASE 3) |
| Reglas de comportamiento | `personalities.reglas` (jsonb) | Configurable, aunque hoy se ha usado vía migraciones ad-hoc por cliente (011–013) en vez de como flujo estándar |

### 4.2 Qué falta generalizar

| Elemento pedido por el usuario | Estado actual | Qué falta |
|---|---|---|
| Productos o servicios | No existe tabla estructurada — vive disperso en `knowledge_base` (texto libre) | Nueva tabla `servicios` (company_id, nombre, duracion_minutos, precio, asesores_habilitados) — necesaria además para ANEXO A/ANEXO B |
| Horarios | No existe | `horarios_laborales` (definida en ANEXO A, sección 2.4) |
| Calendario | No existe | `calendar_credentials`, `asesores` (ANEXO A) |
| Campos del CRM | Parcialmente — `personality.campos_requeridos` ya se lee en `_mapearEmpresaConfig`, pero las tablas `clientes`/`conversaciones`/`oportunidades` tienen columnas con nombres específicos de Total Racks | Ver 4.3 — es el hallazgo más importante de esta fase |
| Mensajes automáticos | No existe | Nueva tabla `mensajes_automaticos` — diseño completo en 4.2.1, con separación confirmada entre mensajes operativos (siempre plantilla) y conversacionales (con IA) |
| Criterios comerciales | Existe como `personalities.reglas`, pero el proceso para poblarlo ha sido una migración SQL nueva por cada ajuste (migraciones 011, 012, 013 son específicas de Total Racks) | No es un problema de schema — es un problema de *proceso*. Formalizar que "ajustar reglas comerciales" es un UPDATE a una fila existente, no una migración nueva |

### 4.2.1 Mensajes operativos vs. mensajes conversacionales — diseño confirmado

Separación de producto, no solo de schema: no todos los mensajes automáticos tienen el mismo requisito de confiabilidad.

| | 🟢 Mensajes operativos | 🔵 Mensajes conversacionales |
|---|---|---|
| Ejemplos | Confirmación de cita, recordatorio, cancelación, reprogramación, confirmación de pago, confirmación de pedido | Seguimiento post-cotización, "¿cómo te fue con el servicio?", reactivación de clientes, agradecimiento, encuestas de satisfacción |
| Fuente de los datos críticos | Siempre la plantilla — fecha, hora, dirección, asesor, monto nunca los genera la IA | El AIEngine normal (mismo pipeline que cualquier conversación) |
| Rol de la IA | Opcional, aditivo, nunca bloqueante — puede agregar una frase breve de tono, nunca puede cambiar ni reescribir los datos de la plantilla | Es el motor principal — la respuesta completa la genera el AIEngine, igual que hoy |
| Qué pasa si la IA no responde o tarda | Se envía la plantilla base tal cual, sin esperar. El envío nunca se bloquea por esto | Aplica el fallback normal de `AIEngine` (`FALLBACK_OUTPUT`, ya existente) |
| Disparado por | Mayormente el Render Cron Job (Anexo A, 2.6) o `ActionRunner` al completar una acción de agenda | El flujo conversacional normal (mensaje entrante → Orchestrator) |

**Regla de diseño (aplica a `mensajes_automaticos` y a cualquier mensaje operativo futuro):**

1. La fecha, hora, dirección, asesor y cualquier dato crítico provienen **siempre** de variables de la plantilla (`{{variable}}`), nunca de texto generado.
2. La personalización de IA es un paso **posterior y opcional**: intenta agregar una frase corta de tono; si falla, tarda más de un timeout corto, o no está disponible, el mensaje se envía **exactamente con la plantilla base** — nunca se bloquea el envío esperándola.
3. Cada empresa configura el tono de sus plantillas (no el contenido crítico) — mismo lugar donde hoy se configura personalidad (`personalities`), disponible desde el futuro panel de administración (fuera de alcance de este documento, ver 4.4).

```sql
CREATE TABLE mensajes_automaticos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  tipo        text NOT NULL,
  -- valores: confirmacion_cita | recordatorio_cita | cancelacion_cita | reprogramacion_cita |
  --          confirmacion_pago | confirmacion_pedido | (conversacionales no viven aquí — usan el AIEngine normal)
  categoria   text NOT NULL DEFAULT 'operativo',   -- 'operativo' | 'conversacional'
  plantilla   text NOT NULL,   -- con variables {{nombre}}, {{servicio}}, {{fecha}}, {{hora}}, {{asesor}}, etc.
  permite_ia  boolean NOT NULL DEFAULT true,        -- si false, nunca se intenta personalizar con IA
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
```

Esta tabla es exclusivamente para mensajes **operativos**. Los conversacionales no necesitan tabla propia — ya usan `knowledge_base`/`personalities.reglas`/`PromptBuilder` como cualquier otra conversación; lo único nuevo ahí sería, eventualmente, disparar ese tipo de mensaje de forma proactiva (ej. reactivación) usando el mismo `ChannelAdapter.sendProactive()` que ya existe — pero sin la restricción de plantilla fija.

### 4.3 Hallazgo: fuga de vocabulario de negocio en el schema (viola P1/Artículo 15)

La tabla `conversaciones` tiene una columna `tipo_rack_detectado` y `oportunidades` tiene `tipo_rack` (ver `modules/crm.js:86` y `:131`). Son nombres específicos de Total Racks dentro de tablas que la Constitución define como universales.

Esto no rompió nada hasta ahora porque solo existía un giro de negocio. **Sí va a doler en ANEXO B**: cuando el salón de uñas empiece a generar conversaciones, el campo `tipo_rack_detectado` va a contener el nombre de un servicio de manicura, lo cual es funcionalmente correcto pero es la señal exacta de contaminación que el Artículo 15 de la Constitución pide corregir: *"Una condición `if` que menciona un nombre de empresa, producto o industria específica"* — en este caso es el nombre de la columna, no un `if`, pero el efecto es el mismo: alguien que lea el schema asume que TARA es de racks.

**Propuesta:** renombrar a `categoria_principal` (que además es el nombre que ya usa `AIOutput.categoria_principal` en el puerto de IA — el schema pasaría a coincidir con el contrato que ya existe, en vez de tener dos nombres para el mismo concepto). Es una migración de renombre de columna, no de dato — bajo riesgo, alto valor de higiene arquitectónica antes de escalar a más giros.

Verificado en código: el impacto está contenido a `modules/crm.js:86` y `:131` (los dos únicos sitios de escritura) y a las definiciones de columna en `setup-db.js:60` y `:78`. No aparece en ningún prompt, módulo del Kernel ni test — confirma que es una migración de bajo riesgo, no una reescritura.

### 4.3.1 Hallazgo relacionado: `oportunidades`/`cotizaciones` no generalizan a todos los giros (esto no es un bug)

Más allá del nombre de columna, la tabla `oportunidades` (`setup-db.js:74-88`) está modelada como un pipeline B2B de ciclo largo: `presupuesto_estimado`, `probabilidad`, `proxima_accion`, `razon_cierre`. Es el vocabulario correcto para una venta consultiva como Total Racks — pero no para un giro transaccional como el salón de uñas de ANEXO B, donde el objeto de negocio central es la `cita` (ANEXO A), no la `oportunidad`.

**No se propone ningún cambio de schema por esto.** La conclusión correcta no es "adaptar `oportunidades` para que sirva a cualquier giro" — es documentar explícitamente que **no todo giro usa todas las tablas**: un giro de agenda transaccional puede simplemente no generar filas en `oportunidades`/`cotizaciones`, y eso es válido. Se deja anotado aquí para que nadie en ANEXO B intente forzar el concepto de "oportunidad" donde no aplica.

### 4.3.2 Hallazgo menor: `setup-db.js` está desactualizado

`setup-db.js` es el script de creación de schema de la era single-tenant (FASE 1). Sus tablas `clientes`, `conversaciones` y `oportunidades` no tienen columna `company_id` — se agregó después vía `migrations/003_company_id_en_crm.sql` y nunca se retrofiteó en este archivo. Ejecutar `npm run setup-db` hoy crearía un schema desalineado con producción.

No es urgente — no se usa en el flujo de alta de empresas actual (eso es SQL directo en Supabase, per ADR-002) — pero es deuda documental: alguien que lo encuentre puede asumir que refleja el schema vigente. Se deja como tarea de bajo esfuerzo dentro de ANEXO C (T C.7): actualizarlo o marcarlo explícitamente como histórico/no vigente, con un comentario apuntando a `migrations/` como fuente de verdad.

### 4.4 Qué NO se incluye en esta fase

- **UI de configuración.** Sigue siendo trabajo de una fase posterior (la antigua FASE 6 del roadmap). ANEXO C solo asegura que *el modelo de datos* soporte configuración total — el mecanismo de alta sigue siendo INSERT/UPDATE directo en Supabase, igual que hoy.
- **Multi-idioma, multi-moneda.** Fuera de alcance salvo que el segundo giro (ANEXO B) lo requiera explícitamente.

### 4.5 Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Renombrar `tipo_rack` en producción con Total Racks activo | Media | Migración con `ALTER TABLE ... RENAME COLUMN`, no `DROP`+`CREATE` — cero downtime, ADR-002 ya establece este tipo de migración como afectando a todos los tenants simultáneamente |
| Tabla `servicios` nueva pero `knowledge_base` ya cumple parcialmente ese rol para Total Racks | Baja | No migrar el contenido existente de Total Racks — `servicios` es opt-in para giros que necesitan catálogo estructurado (agenda), `knowledge_base` sigue existiendo para contenido libre |
| Proliferar tablas de configuración sin una capa que las junte (`obtenerConfigEmpresa` crece indefinidamente) | Media | Evaluar, al cierre de ANEXO C, si `obtenerConfigEmpresa` necesita paginar/seleccionar qué carga según qué Skills/Tools tiene activas el Workspace (esto ya está previsto conceptualmente en el Artículo 10 de la Constitución — Skills) |
| Forzar el concepto de "oportunidad" en un giro transaccional (salón de uñas) que no lo necesita | Media | Documentado en 4.3.1: un giro puede no usar `oportunidades`/`cotizaciones` — no se fuerza compatibilidad de schema entre giros que no la necesitan |
| `setup-db.js` desalineado del schema real de producción | Baja | Actualizar o marcar como histórico (T C.7); `migrations/` sigue siendo la fuente de verdad, no se toca ese proceso |

### 4.6 Tareas incrementales (ANEXO C)

| ID | Tarea | Tipo |
|---|---|---|
| TC.1 | Migración: renombrar `tipo_rack_detectado`→`categoria_principal`, `tipo_rack`→`categoria_principal` | DB |
| TC.2 | Tabla `servicios` | DB |
| TC.3 | Tabla `mensajes_automaticos` | DB |
| TC.4 | Actualizar `_mapearEmpresaConfig` y `crm.js` para usar los nombres genéricos | Código |
| TC.5 | Documentar el "checklist de alta de empresa" consolidado (todas las tablas de 4.1+4.2) como un solo documento operativo | Docs |
| TC.6 | Validar de punta a punta con el segundo giro de ANEXO B usando solo el checklist, sin tocar código | Validación |
| TC.7 | Actualizar `setup-db.js` (agregar `company_id` y tablas faltantes) o marcarlo explícitamente como histórico, apuntando a `migrations/` como fuente de verdad | Docs — baja prioridad |

---

## 5. Riesgos generales consolidados

| Riesgo | Anexo | Severidad | Estado |
|---|---|---|---|
| Ausencia de proceso en background (recordatorios) | A | Alta | Resuelto en diseño — Render Cron Job (TA.7) |
| Doble reserva por condición de carrera | A | Alta | Resuelto en diseño — índice único parcial a nivel DB (2.4) |
| No existe proyecto de Google Cloud; verificación OAuth puede tomar semanas | A | **Alta** (confirmado — no había proyecto previo) | Mitigado — TA.0.1 arranca en paralelo con TA.1, no bloquea el resto |
| Cifrado de `calendar_credentials.credenciales` | A | Alta (seguridad) | Resuelto en diseño — AES-256-GCM con clave maestra en env var de Render |
| Recordatorios/confirmaciones deben ser confiables aunque OpenAI esté caído | A | Alta | Resuelto en diseño — mensajes operativos con plantilla + IA aditiva no bloqueante (4.2.1) |
| Copiar sin darse cuenta el workflow de Total Racks en el segundo giro | B | Alta | Mitigación de proceso — revisar explícitamente en TB.1, no solo confiar en "cero líneas en el Kernel" |
| Validación sintética (sin cliente real) puede no capturar reglas reales de un salón de uñas | B | Media | Aceptado conscientemente (TB.0) — revisar contra reglas reales cuando exista un cliente de este giro |
| Fuga de vocabulario de negocio en el schema (`tipo_rack`) | C (hallazgo, pre-existente) | Media — sube a Alta si se pospone más allá de B | Mitigación planeada — TC.1, antes de abrir Anexo B |
| `oportunidades`/`cotizaciones` no generalizan a todo giro | C (hallazgo, pre-existente) | Baja | Documentado (4.3.1) — no requiere cambio de schema |
| `setup-db.js` desalineado del schema real | C (hallazgo, pre-existente) | Baja | TC.7, baja prioridad |
| Crecimiento no controlado de tablas de configuración sin capa de selección | C | Media, a mediano plazo | Sin resolver — evaluar al cierre de Anexo C |

---

## 6. Qué se reutiliza vs. qué es nuevo — resumen ejecutivo

| Capa | Reutilización |
|---|---|
| Orchestrator, ContextBuilder, PromptBuilder, AIEngine, AuditLogger, ChannelRouter, WorkflowEngine | **100% reutilizados sin cambio de contrato** |
| `config.js`, `crm.js` | Reutilizados — solo el hallazgo de 4.3 requiere un rename, no una reescritura |
| Patrón puerto/adaptador | Reutilizado — se aplica el mismo molde a calendario |
| `channel-adapter.js` / `twilio-whatsapp.js` | 100% reutilizado, incluyendo `sendProactive()` ya implementado |
| Convenciones de proyecto (migraciones numeradas, `ROLLBACK-FASE*.md`, tests con provider mockeado, tablas con `company_id`) | 100% reutilizadas |
| **Nuevo:** `SchedulingEngine`, `CalendarProvider`+adaptadores, `ActionRunner` formal, 4 tablas de agenda (`calendar_credentials`, `asesores`, `horarios_laborales`, `citas`), disparador de recordatorios, tabla `servicios`, tabla `mensajes_automaticos` | Construcción nueva siguiendo el molde existente — ningún patrón inventado desde cero, todos replican puerto/adaptador o `company_id`-scoping ya validados |

**Estimación cualitativa:** esta es una extensión, no una reescritura. El Kernel existente no cambia de forma — se le agrega un módulo más (M10) y se termina uno que ya estaba pautado (M8).

---

## 7. Cuándo se reorganiza el roadmap (y por qué todavía no)

`docs/roadmap/README.md` y el Artículo 18 de la Constitución **no se tocan con este documento**. Decisión explícita: no renumerar hasta tener los tres anexos funcionando en producción.

Razón: hoy el roadmap tiene historia (FASE 1 → FASE 4B, cada una con tareas documentadas bajo esos nombres). Renumerar ahora — insertar sub-fases, correr Memory Engine/Dashboard/API/Billing una posición — antes de saber si el Motor de Agenda, el segundo giro y la plataforma configurable van a salir como se diseñaron aquí, arriesga tener que renumerar dos veces. Es más limpio mantener el roadmap intacto y tratar estas tres iniciativas como anexos temporales mientras se validan.

**Condición de salida:** cuando ANEXO A, ANEXO B y ANEXO C estén implementados y probados en producción (no solo diseñados), corresponde una sesión de reorganización completa del roadmap — un "roadmap v2" — hecha con la experiencia real del producto en vez de con la proyección de este documento. Ese es el momento de decidir dónde encajan estos anexos en la numeración definitiva, qué pasa con Memory Engine/Dashboard/API pública/Billing, y si algo de lo diseñado aquí cambió en la implementación real.

Hasta entonces, este documento y sus tareas (TA.x, TB.x, TC.x) son la única referencia de estas tres iniciativas — no aparecen en `docs/roadmap/README.md` ni en el Artículo 18.

---

## 8. Plan de implementación incremental — orden sugerido

1. **TA.0.1 — arrancar de inmediato, en paralelo con todo lo demás.** Crear el proyecto de Google Cloud e iniciar el proceso de verificación OAuth. Tiene semanas de espera y no bloquea ningún otro paso — es el único ítem de este plan con un reloj externo corriendo, así que es el primero en iniciarse aunque no sea el primero en completarse.
2. **TA.0–TA.4** — Puerto de calendario + ActionRunner formal + modelo de datos (incluye el diseño extensible de 2.4.1), con `MockCalendarProvider`. Todo esto se puede construir y testear sin credenciales reales de Google.
3. **TA.5–TA.9** — Integración real con Google (usa las credenciales de sandbox de TA.0.1), disparador de recordatorios con la lógica híbrida plantilla+IA de 4.2.1, deploy con Total Racks (que ya tiene un caso de uso de "agendar visita" implícito en su Descubrimiento Comercial).
4. **TC.1** — Adelantar el rename de `tipo_rack` *antes* de abrir el segundo giro (evita nacer con deuda técnica en la primera conversación del salón de uñas).
5. **TC.2–TC.3** — Tablas `servicios` y `mensajes_automaticos` (con `categoria`/`permite_ia`, 4.2.1), ya que ANEXO B las necesita.
6. **TB.0–TB.4** — Diseño y piloto interno/sintético del segundo giro, usando ANEXO A y el resto de ANEXO C ya construidos.
7. **TC.5–TC.6** — Cerrar con el checklist operativo de alta de empresa, validado con el giro sintético de Anexo B.
8. **TC.7** — Baja prioridad, sin urgencia: actualizar o marcar como histórico `setup-db.js`. Puede hacerse en cualquier momento sin afectar el resto del plan.

Regla permanente heredada de la Constitución (R4): ningún paso avanza al siguiente sin el 100% de los tests pasando.

---

## Bitácora

| Fecha | Evento |
|---|---|
| 2026-07-06 | Documento de arquitectura propuesto — pendiente de aprobación antes de programar |
| 2026-07-06 | Revisado sección por sección con Alina. Confirmado: nomenclatura de Anexos (no se renumera el roadmap todavía); Anexo A — Render Cron Job para recordatorios, proyecto de Google Cloud a crear desde cero (TA.0.1, arranca en paralelo), cifrado AES-256-GCM con clave en env var, asignación automática de asesor, citas fuera de workflow permitidas, un solo recurso por cita en MVP con extensión aditiva prevista (2.4.1); hallazgos de deuda técnica `tipo_rack`/`tipo_rack_detectado`, `oportunidades` no generaliza a todo giro, `setup-db.js` desactualizado; Anexo B — salón de uñas confirmado sobre paneles solares, validación interna/sintética (sin cliente real todavía); Anexo C — mensajes operativos (plantilla, IA aditiva no bloqueante) vs. conversacionales (IA normal). Pendiente: decidir cuándo se pasa a implementación. |
