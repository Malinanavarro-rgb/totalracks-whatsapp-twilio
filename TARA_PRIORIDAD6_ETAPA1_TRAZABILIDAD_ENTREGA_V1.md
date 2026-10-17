# TARA Matrix™ — Prioridad 6, etapa 1: trazabilidad de mensajes proactivos
**Fecha:** 2026-10-17 · **Implementado y probado localmente — NO desplegado**

---

## 1. Auditoría de `enviarProactivoWhatsApp()` y todos sus orígenes reales

Grep exhaustivo de todo el repositorio: **exactamente 2 orígenes reales** de mensajes proactivos automatizados (excluí `/api/conversaciones/:clienteId/mensajes` en `server.js` — es un mensaje que un humano autenticado escribe desde el panel, no uno que TARA envía por sí sola; ya tiene su propio `usuario.id` en el contexto de la petición):

1. **`modules/cotizaciones.js::enviarProactivoWhatsApp()`** — usada por `correrCotizacionDesdeWorkflow()` (seguimiento de ingeniería bloqueada/incompleta, y el mensaje previo al PDF cuando el cálculo cierra automático).
2. **`modules/recordatorios.js::_procesarRecordatorio()`** — recordatorios de citas (cron), llama a `channelAdapter.sendProactive()` **directamente**, sin pasar por `enviarProactivoWhatsApp()` — un segundo origen separado que también necesitaba cubrirse.

**Hallazgo adicional de la auditoría (relevante para el punto 5):** tanto `TwilioWhatsAppAdapter.sendProactive()` como `MetaCloudWhatsAppAdapter.enviarMensaje()` **descartaban el identificador del mensaje que el proveedor sí devuelve** — Twilio regresa `message.sid` y nunca se leía; Meta regresa `{messages:[{id}]}` en el body y nunca se parseaba. Corregido en ambos — ahora retornan `{proveedor, messageId}`.

## 2-3. Mecanismo reutilizado y campos registrados

Nuevo método `AuditLogger.logMensajeProactivo()` (`modules/audit-logger.js`) — reutiliza `decision_logs` y el tipo `'channel_event'` ya existentes (ningún catálogo ni tabla nueva), con `payload.subtipo: 'mensaje_proactivo'` para distinguirlo. Registra exactamente los campos pedidos: `company_id`, `cliente_id`, `conversation_id` (cuando existe), `tipo_accion`, `componente_origen`, fecha (`created_at`, automática), y `resultado`.

## 4. Envío solicitado / aceptado / entregado

`resultado` toma 2 valores posibles en esta etapa: `'aceptado_por_proveedor'` o `'error_proveedor'`. **"Solicitado" es implícito** — cada fila existe porque el envío se intentó; no agregué una fila separada para "antes de intentar" porque duplicaría escrituras sin aportar información nueva. **"Entregado" nunca se usa** — confirmarlo requiere el webhook de status callback de Twilio/Meta, explícitamente fuera de esta etapa, como pediste. Si querías 3 filas persistidas en vez de este criterio, dímelo y lo ajusto.

## 5. Identificadores por proveedor

| Proveedor | Antes | Ahora |
|---|---|---|
| Twilio | `message.sid` se descartaba | Se captura y se guarda como `message_id` |
| Meta | `{messages:[{id}]}` nunca se leía | Se parsea y se guarda como `message_id` |

Ambos quedan en `payload.message_id` — listos para una futura conciliación con un webhook de status, sin necesidad de ningún cambio adicional cuando llegue esa etapa.

## 6. Información sensible

Nunca se guarda el mensaje completo — solo `textoPreview`, recortado a 80 caracteres dentro del propio `AuditLogger` (mismo criterio que `preview` en `logChannelEvent`, ya existente). No se tocan credenciales en ningún punto.

## 7. Comportamiento si falla la escritura de auditoría

`AuditLogger.log()` ya era fire-and-forget y nunca lanza (lo confirmé leyendo el código antes de tocar nada) — logMensajeProactivo() hereda esa garantía. El log se escribe **después** de que el envío real ya terminó (éxito o error), nunca antes — un fallo de escritura en `decision_logs` no puede, por construcción, provocar un segundo intento de envío. Probado explícitamente (prueba #3).

## 8. Verificación de que no afecta a otras empresas/mecanismos

- `enviarProactivoWhatsApp()`/`recordatorios.js` son mecanismos **ya compartidos** por todas las empresas — no se agregó ninguna rama específica de ninguna empresa, solo logging genérico parametrizado por el `companyId` que cada llamada ya traía.
- Prueba dedicada de aislamiento multiempresa (2 envíos a empresas distintas, nunca se mezcla `company_id` entre registros).
- No se tocaron fórmulas del motor, `WorkflowEngine`, ni ninguna regla comercial — confirmado por el diff (solo adaptadores, `cotizaciones.js`, `recordatorios.js`, `audit-logger.js`).

## Diff (7 archivos de código + 3 de pruebas)
```
adapters/channels/twilio-whatsapp.js     +13/-4   captura message.sid
adapters/channels/meta-cloud-whatsapp.js +12/-1   parsea messages[0].id
modules/audit-logger.js                  +51      logMensajeProactivo()
modules/cotizaciones.js                  +60/-4   enviarProactivoWhatsApp() con meta opcional + logging
modules/recordatorios.js                 +28/-2   mismo logging en el 2do origen
```

## Pruebas (16 nuevas, en 3 archivos)

**`__tests__/trazabilidad-mensajes-proactivos.test.js`** (nuevo, 6 pruebas) — los 6 escenarios obligatorios exactos: enviado correctamente, error del proveedor, error de auditoría sin afectar el envío, ausencia de identificadores opcionales, aislamiento multiempresa, prevención de duplicados.

**`__tests__/audit-logger.test.js`** (+5 pruebas) — `logMensajeProactivo()` a nivel unitario: forma del registro, recorte del preview a 80 caracteres, identificadores ausentes, `resultado='error_proveedor'`, silencio seguro ante fallo de escritura.

**`__tests__/recordatorios.test.js`** (+2 pruebas, con `AuditLogger` real, no un stub) — confirma que `cliente_id` viene de `cita.cliente_id`, y que un error del proveedor se registra sin marcar `recordatorio_enviado`. Las 8 pruebas preexistentes se ajustaron para inyectar un `auditLogger` stub (evita que la escritura nueva de auditoría desordene sus mocks posicionales existentes — cero cambio de comportamiento, solo de aislamiento de prueba).

**Resultado global: 2568/2568, 129 suites, 0 regresiones.**

## Riesgos pendientes
- "Entregado" sigue sin poder confirmarse (fuera de alcance, como pediste).
- `enviarProactivoWhatsApp()` construye una instancia nueva de `AuditLogger` en cada llamada (simple, sin estado compartido) — si en el futuro se requiere `flush()` coordinado con el resto del sistema, habría que revisar este patrón.
- El posible doble mensaje al cerrar una cotización (PDF + seguimiento) — como dijiste, no lo mezclé aquí, queda para revisión aparte.

## Propuesta de despliegue (para tu aprobación — nada desplegado todavía)
1. Commit solo de los archivos listados arriba.
2. Push + verificación de Render (commit exacto, `/health`, `/api/diagnostics`).
3. Validación funcional sugerida (sin mensajes comerciales reales): confirmar en Supabase que una fila nueva en `decision_logs` con `payload.subtipo='mensaje_proactivo'` aparece tras el próximo recordatorio de cita o seguimiento de cotización real en producción.

---

## Los 2 pendientes que mencionaste (anotados, no perdidos — nada implementado)

1. **Validación de periodo/unidades de consumo** (mensual vs. bimestral vs. importe en pesos) — documentado como vacío desde P2, sigue sin un mecanismo determinista.
2. **Catálogo solar — Ciudad Victoria, Tampico y otras localidades de Nort Energy** — requiere datos de HSP reales con fuente y metodología verificable; no agregué ninguna ciudad nueva en este trabajo, como indicaste explícitamente para este despliegue.

**No hice push ni despliegue.** Quedo a la espera de tu revisión.
