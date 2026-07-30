# ADR-013 — Modo Demo en Tiempo Real

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Julio 2026 |
| Autora | Alina Navarro |
| Archivos | `migrations/083_modo_demo.sql` (nuevo), `modules/plataforma-demo.js` (nuevo), `server.js`, `frontend/src/admin/pages/DemoEnVivo.jsx` (nuevo), `frontend/src/admin/adminApi.js`, `frontend/src/admin/AdminApp.jsx`, `frontend/src/admin/AdminShell.jsx` |

---

## Contexto

Mostrarle TARA a un prospecto exigía hasta ahora crear una empresa completa y conectarle un número de WhatsApp propio (ver `scripts/crear-empresa-demo-paneles-solares.js`, ADR de la plantilla `paneles_solares`) — fricción real: Meta no permite migrar un número que ya tiene cuenta de WhatsApp activa (bloqueador real encontrado con el número de Salud y Belleza/Total Racks, sin resolver todavía), y un número dedicado por vertical no escala a "otros giros después".

La dueña del producto pidió algo distinto: reusar el número oficial de TARA-OS para todo el tráfico normal, y que **solo durante una ventana de tiempo programada, y solo para un teléfono autorizado**, ese mismo número responda como si fuera una empresa demo de un giro específico — con acciones reales (cliente registrado, oportunidad creada, cita agendada), no una simulación de pantalla. Instrucción explícita: *"No quiero que construyas otro motor separado para la demo... quiero reutilizar el motor actual de TARA"* y *"No modifiques el Core congelado ni rompas los ADR existentes."*

Antes de programar, se hizo un diagnóstico de solo lectura (3 exploraciones + verificación directa de los archivos clave) siguiendo esa misma instrucción. El hallazgo central: **casi todo lo necesario ya existía** — la pieza que faltaba era una capa delgada de intercepción, no un sistema nuevo.

## Decisión

### 1. El molde ya existía: `plataforma_impersonaciones`

`modules/plataforma-impersonacion.js` (migración 069, "entrar como admin a cualquier empresa para soporte") ya es, literalmente, una sesión temporal con ventana de tiempo (`token`, `iniciado_en`, `expira_en`, `finalizado_en`). `sesiones_demo` (migración 083) sigue el mismo molde exacto, con `authorized_phone` en vez de `token`, y sin necesidad de cookie (se resuelve por número de teléfono, no por sesión de navegador).

### 2. La restricción real: el reply channel depende del company_id real, no del demo

En `server.js`, tanto el webhook de Twilio como el de Meta resuelven el número/credencial de salida (`channelRouter.resolverEndpointDeEmpresa()` / `obtenerAdapterMetaParaEmpresa()`) **antes** de invocar `procesarMensajeEntrante()`, usando el `company_id` real (el dueño del número físico). Por eso el override de `message.company_id` hacia la empresa demo se inserta **después** de resolver esas credenciales de salida y **antes** de llamar a `procesarMensajeEntrante()` — la respuesta sigue saliendo por el número físico correcto, mientras que cliente, hilo, horario, personalidad, Orchestrator, ActionRunner y `decision_logs` operan sobre la empresa demo. Es un cambio de una variable en la capa de plataforma; **cero cambios a `orchestrator.js`/`context-builder.js`/`workflow-engine.js`.**

```js
const sesionDemo = await resolverSesionDemoActiva(supabaseServicio, message.from);
if (sesionDemo) message.company_id = sesionDemo.company_id;
```

Sin sesión activa (el caso normal, 100% del tráfico), `message.company_id` no cambia — mismo comportamiento de siempre.

### 3. Cero motor nuevo — todo lo que ejecuta TARA ya es genérico por company_id

`obtenerOCrearCliente`, `Orchestrator.procesarMensaje`, y las acciones ya registradas (`crear_oportunidad`, `agendar_cita_con_horario_solicitado`) ya operan de forma 100% genérica por `company_id` — no se escribió ninguna lógica nueva para que TARA "registre al cliente, califique, cotice y agende" en la empresa demo: es exactamente lo que ya hacen para cualquier empresa real. `MockCalendarProvider` (ya el fallback automático cuando una empresa no tiene Google Calendar conectado) permite agendar citas reales en la tabla `citas` sin que la empresa demo necesite ninguna cuenta de Google.

La empresa demo tampoco se crea por sesión: se reusa una empresa demo pre-armada por giro (`companies.es_demo = true`, ej. "Empresa Demo Paneles Solares", migración 082) — el selector de "Activar demo en tiempo real" solo elige entre las ya construidas.

### 4. Aislamiento de datos — garantizado por construcción, no por código nuevo

Cliente, oportunidad y cita de una sesión demo se crean bajo el `company_id` de la empresa demo — un tenant distinto a cualquier empresa real. No hay tabla compartida que mezcle ambos; el aislamiento no depende de una regla nueva, es la misma garantía multi-tenant que ya protege a cualquier par de empresas reales entre sí.

### 5. "Ver panel en vivo" reusa la impersonación existente — no es un panel nuevo

En vez de construir un agregador de una sola pantalla, la fase 1 reusa `POST /api/admin/companies/:id/impersonar` (ya en producción): el super-admin entra al panel real de la empresa demo (Operaciones/Inbox/CRM/Agenda, con el polling de 4s ya existente) — se ve, literalmente, como si la empresa demo ya fuera clienta, sin escribir una sola línea de UI de demo aparte. Un agregador dedicado de una sola pantalla queda documentado como mejora opcional futura, solo si este flujo resulta insuficiente en un pitch de ventas en vivo.

### 6. Resumen automático de cierre — agregación, no tabla de reporte nueva

`generarResumenSesion()` (en `modules/plataforma-demo.js`) agrega, al finalizar una sesión, lo que ya existe: el cliente creado con ese teléfono, sus oportunidades, sus citas, y el conteo de `decision_logs` por tipo dentro de la ventana de la sesión — sin ninguna tabla de auditoría nueva. Se calcula una sola vez al cierre y se guarda en `sesiones_demo.resumen` (jsonb).

### 7. Gap real identificado, explícitamente fuera de esta fase: cotización con folio

`modules/cotizador.js` calcula un total pero no genera folio ni lo persiste (no existe tabla `cotizaciones` en todo el sistema). Es un vacío real de la plataforma, no exclusivo del Modo Demo. Se documenta como fase separada (columna aditiva `oportunidades.cotizacion jsonb`, extendiendo el handler `crear_oportunidad` ya registrado) — no se construyó en esta fase para no bloquear la demo en vivo con un cambio que beneficia a todo el sistema y merece su propia revisión.

---

## Pendiente de acción manual (Alina)

1. Aplicar `migrations/083_modo_demo.sql` en Supabase + `NOTIFY pgrst, 'reload schema';` (crea `sesiones_demo`, agrega `companies.es_demo`, y marca "Empresa Demo Paneles Solares" como demo).
2. Configurar más empresas demo por giro conforme se necesiten (mismo mecanismo del Motor Universal, `es_demo = true` en cada una).
3. Antes de cada demo en vivo: confirmar que `horarios_laborales` de la empresa demo cubre la hora programada (ver nota de riesgo abajo) — no es un límite del código, es una empresa como cualquier otra, con su propio horario de atención.

---

## Pruebas

- `__tests__/plataforma-demo.test.js` (nuevo, 17 tests): `crearSesionDemo` (validación de campos, rechazo con 409 si ya hay sesión activa para ese teléfono, error de INSERT), `resolverSesionDemoActiva` (sesión vigente, ausente, con error, caché), `finalizarSesionDemo` (sesión inexistente/ya cerrada, cierre + resumen + auditoría), `generarResumenSesion` (con y sin cliente registrado), `listarSesionesActivas`, `listarEmpresasDemo`.
- Mutation testing verificado en vivo durante esta implementación: se rompió deliberadamente la condición del 409 (duplicados) y la condición de caché — ambos tests fallaron como se esperaba, confirmando que no son falsos positivos.
- `npm test`: 74 suites / 1318 tests, en verde — cero cambios a pruebas del Core.
- El interceptor de `server.js` no tiene test dedicado: no existe hoy ningún test de los webhooks de `server.js` en el proyecto (ninguna de las dos rutas, ni antes de este cambio) — se documenta como límite ya existente, no una omisión nueva. La garantía de aislamiento la dan los tests de `resolverSesionDemoActiva()` (unitarios) más el hecho de que todo lo que ocurre después de la asignación de `company_id` ya está cubierto por las pruebas propias de `orchestrator.js`/`crm.js`, sin importar de qué empresa sea ese `company_id`.

---

## Regla permanente

> Cualquier intercepción de tráfico por teléfono/ventana de tiempo (demos, pruebas piloto, lo que sea) se resuelve en la capa de plataforma **después** de fijar el canal de salida real y **antes** de invocar al Core — nunca dentro de `orchestrator.js`/`context-builder.js`/`workflow-engine.js`, y nunca creando un motor de conversación paralelo. Si TARA ya sabe hacer algo para una empresa real (calificar, cotizar, agendar), ya sabe hacerlo para una empresa demo — el único trabajo nuevo es decidir, por teléfono y ventana de tiempo, a qué `company_id` pertenece el turno.
