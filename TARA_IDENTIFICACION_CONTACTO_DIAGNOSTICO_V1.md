# TARA — Identificación obligatoria de contacto (nombre + motivo), diagnóstico y plan

**Fecha:** 2026-10-16
**Estado:** diagnóstico + propuesta técnica — **cero código tocado.** Responde a tu regla: *"TARA no debe avanzar a flujo comercial/cotización/agendamiento sin conocer el nombre del contacto y qué necesita, de forma natural, sin repetir preguntas."*

---

## 1. Diagnóstico

### 1.1 Tu preocupación sobre el nombre de perfil de WhatsApp — no es un problema hoy

Verifiqué el código real: `modules/crm.js::obtenerOCrearCliente(telefono, companyId)` crea cada cliente nuevo con `nombre: 'Sin nombre'` **hardcodeado** — nunca lee `ProfileName` del webhook. El nombre de perfil SÍ se captura en los adapters de canal (`adapters/channels/meta-cloud-whatsapp.js`, `twilio-whatsapp.js`), pero queda aislado en `raw_metadata.ProfileName` del mensaje — confirmé con grep exhaustivo que **nunca se lee fuera de ahí**: no llega a `clientes.nombre`, no llega al prompt, no llega a ningún módulo del Core. No hay nada que corregir en ese punto específico.

### 1.2 El hueco real: fuera de un flujo de agenda, "ya me dio su nombre" no se guarda en ningún lado

Esto es lo que de verdad hay que resolver. Encontré dos mecanismos de memoria, y ninguno cubre el caso completo:

- **Dentro de un workflow activo** (`modules/workflow-engine.js` + `workflow_sessions.captured_fields`): si el cliente ya dio su nombre durante un flujo de calificación, el Orchestrator salta esa pregunta correctamente (`_avanzarSaltandoRespondidos`). Pero esto se pierde en cuanto el workflow termina o pasan 24h, y **nunca se sincroniza con `clientes.nombre`** — `MAPA_CAMPOS_OPORTUNIDAD` (`modules/crm.js`) copia campos a `oportunidades` pero deliberadamente no incluye `nombre`.
- **En conversación libre (sin workflow)**: el mecanismo que debería recordar el nombre (`modules/context-builder.js` + `_mapearDatosCliente`) depende de que `clientes.nombre` ya no sea `'Sin nombre'` — pero como se confirmó arriba, **nada en el pipeline conversacional actualiza esa columna**. Y el campo `dc.datos` (donde deberían vivir otros datos capturados) está literalmente `{}` hardcodeado, marcado en el código como *"FASE 3: vendrá de la última conversación"* — nunca se implementó.

**Conclusión honesta:** hoy, "TARA ya sabe el nombre/motivo de este cliente" es, en la práctica, una impresión que el modelo se forma leyendo el historial crudo de los últimos turnos (máximo 8 por default) — no un dato verificado. Por eso puede repetir la pregunta o, al revés, avanzar sin haber confirmado nada: no hay ninguna validación estructurada, solo una instrucción de prompt.

### 1.3 No existe ningún campo de "motivo de consulta"

Lo más cercano es `oportunidades.descripcion`, pero es una plantilla autogenerada (`Cliente interesado en ${categoria_principal}`) — nunca el texto real que dijo el cliente.

### 1.4 El patrón de gate más parecido a lo que pides ya existe — pero cubre solo la mitad del problema

El handler `agendar_cita_con_horario_solicitado` (`modules/orchestrator.js`) ya tiene exactamente el mecanismo que describes: si falta un dato (`camposRequeridos`), responde `{tipo: 'faltan_datos', campos}` y genera una pregunta natural (`_preguntaPorDatoFaltante` — ya incluye `nombre: '¿con quién tengo el gusto?'`). **Pero este gate solo se activa cuando la acción viene de un workflow recién completado** (`_finalizarWorkflow` le pasa `capturedFields` reales). Cuando la misma acción se propone en conversación 100% libre (paso 9 de `procesarMensaje`), `ctx.capturedFields` llega vacío — el gate nunca corre ahí. Y `crear_oportunidad` no tiene ningún gate, en ningún camino.

### 1.5 Aislamiento multiempresa — ya garantizado, sin cambios necesarios

`clientes.company_id` es la columna de aislamiento en todo el pipeline (confirmado desde la migración 003 hasta el flujo real del webhook) — cualquier cambio que haga seguirá pasando por el mismo `company_id` ya resuelto, sin tocar ese mecanismo.

### 1.6 Anti-bucle — no existe hoy un freno estructural en conversación libre

Solo hay una instrucción puntual de prompt para el caso de "reencauce" (no repetir la pregunta de reencauce). No hay verificación de "la última pregunta del asistente fue X y el campo sigue vacío" en general.

---

## 2. Dónde vive cada pieza (arquitectura)

| Pieza | Archivo | ¿Se toca? |
|---|---|---|
| Creación de cliente | `modules/crm.js::obtenerOCrearCliente` | No |
| Memoria de campos capturados (workflow) | `modules/workflow-engine.js` | No |
| Memoria de campos capturados (libre) | `modules/context-builder.js::_mapearDatosCliente` | No — el fix real no es ahí, es que nadie actualiza `clientes.nombre` |
| Gate de agenda existente | `modules/orchestrator.js` (`agendar_cita_con_horario_solicitado`, `_preguntaPorDatoFaltante`) | Se **reutiliza y generaliza**, no se reescribe |
| Schema JSON que llena el modelo | `modules/prompt-builder.js` | Se **amplía** (aditivo) |
| Persistencia de clasificación (patrón a replicar) | `modules/clasificacion-cliente.js` | No se toca — se usa como plantilla para un módulo hermano |
| Pipeline de acciones (dónde interceptar) | `modules/orchestrator.js`, paso 9 (`procesarMensaje`) | Se **toca** — es Core congelado (ADR-005), con la misma disciplina de excepción ya usada para el bug de agenda de septiembre |

**El 70% de esto es seguir un patrón ya construido** (`clasificacion-cliente.js`), no inventar uno nuevo.

---

## 3. Propuesta de implementación (sin construir todavía)

### 3.1 Dato nuevo, aditivo: `clientes.motivo_consulta` + `motivo_consulta_fuente`
Migración nueva (aditiva, mismo patrón que `migrations/126_clasificacion_cliente.sql`):
```sql
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS motivo_consulta text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS motivo_consulta_fuente text CHECK (motivo_consulta_fuente IN ('cliente', 'ia_inferido', 'manual'));
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS motivo_consulta_actualizado_en timestamptz;
```
`clientes.nombre` ya existe — no necesita columna nueva, solo que alguien lo actualice.

### 3.2 Nuevo módulo: `modules/identificacion-contacto.js` (mismo esqueleto que `clasificacion-cliente.js`)
- `actualizarIdentificacionAutomatica(supabase, clienteId, companyId, { nombre, motivo })` — llamada por el Orchestrator en cada turno, vía dependencia inyectada (igual que `actualizarClasificacion`/`registrarConsumoIA`, nunca importado directo por el Core). Solo escribe `nombre` si hoy es `'Sin nombre'`; solo escribe `motivo_consulta` si está vacío o su fuente es `'ia_inferido'` (nunca pisa `'cliente'` ni `'manual'`). Nunca lanza.
- `tieneIdentificacionCompleta(cliente)` — función pura: `cliente.nombre !== 'Sin nombre' && !!cliente.motivo_consulta`. Es el único punto de verdad que consulta el gate — **validación estructurada, no una instrucción de prompt**.

### 3.3 Ampliar el schema JSON del modelo (aditivo)
En `modules/prompt-builder.js`, agregar al bloque de schema un campo opcional:
```json
"datos_contacto": { "nombre": "string o null — SOLO si el cliente lo dijo en este turno", "motivo": "string o null — en sus propias palabras, SOLO si ya lo dijo" }
```
Mismo criterio de honestidad que ya rige `datos_extraidos`/`confianza` en otras partes del schema: nunca inventar, solo reportar lo que el cliente realmente dijo.

### 3.4 El gate — generalizar el mecanismo que ya existe, en el paso 9 del Orchestrator
```js
// orchestrator.js, justo antes de construir accionesAutorizadas (línea ~375)
const ACCIONES_REQUIEREN_IDENTIFICACION = new Set(['crear_oportunidad', 'agendar_cita', 'agendar_cita_con_horario_solicitado', 'ejecutar_motor_ingenieria']);
const identificacionCompleta = tieneIdentificacionCompleta({ ...clienteRaw, ...aiOutput.datos_contacto });

const accionesAutorizadas = propuestas.filter(a => {
  if (!a?.tipo || !capacidadesResueltas.includes(a.tipo)) return false;
  if (ACCIONES_REQUIEREN_IDENTIFICACION.has(a.tipo) && !identificacionCompleta) return false; // reemplaza el texto, no bloquea la respuesta
  return true;
});
```
Si una acción comercial quedó bloqueada por falta de identificación, se reusa el patrón ya existente de `_textoDesdeResultadoDeAgenda`/`_preguntaPorDatoFaltante` (ampliando su mapa con `nombre`/`motivo`) para generar la pregunta natural — **nunca un mensaje tipo "necesito tu nombre y motivo" robótico**, una sola pregunta por turno, priorizando el dato que falte.

**Importante — lo que NO se bloquea** (tu punto 4): el gate solo filtra `acciones_propuestas` (`crear_oportunidad`, agendar, cotizar) — la respuesta conversacional normal (`aiOutput.respuesta_texto`) nunca pasa por aquí. Preguntas generales, urgencias, explicación de servicios, siguen respondiéndose sin bloqueo.

### 3.5 Por qué esto resuelve el anti-bucle sin un mecanismo aparte
En cuanto el cliente da su nombre/motivo, el modelo lo reporta en `datos_contacto` **ese mismo turno**, se persiste de inmediato vía `actualizarIdentificacionAutomatica`, y para el turno siguiente `clienteRaw.nombre` ya es real — el gate dejará de bloquear y de preguntar, sin necesitar una regla de "no repitas" aparte. Es una consecuencia del dato ya estando correcto, no un parche sobre el síntoma.

---

## 4. Archivos que se tocarían (nada implementado todavía)

| Archivo | Cambio |
|---|---|
| `migrations/1XX_identificacion_contacto.sql` | Nuevo, aditivo. |
| `modules/identificacion-contacto.js` | Nuevo — mismo patrón que `clasificacion-cliente.js`. |
| `modules/prompt-builder.js` | +campo `datos_contacto` en el schema (aditivo). |
| `modules/orchestrator.js` | **Se toca** (Core congelado, ADR-005) — nuevo gate en paso 9, misma disciplina de excepción ya usada en septiembre para el bug real de agenda; se documenta línea por línea como las excepciones anteriores. |
| `server.js` | Inyectar `actualizarIdentificacion` al Orchestrator (mismo punto donde ya se inyecta `actualizarClasificacion`). |

**No se toca**: `modules/crm.js` (salvo que decidas también sincronizar `MAPA_CAMPOS_OPORTUNIDAD` con `nombre`, opcional), `workflow-engine.js`, ningún adapter de canal, ninguna otra empresa de forma especial (aplica igual a todas por diseño, vía `company_id`).

---

## 5. Pruebas que cubriría la implementación (si autorizas)

- Contacto nuevo sin nombre ni motivo → primera respuesta pregunta de forma natural, nunca bloquea info general.
- Cliente da nombre y motivo en el mismo mensaje → no se repite ninguna pregunta, oportunidad se crea en el siguiente turno con datos completos.
- Nombre incompleto (solo nombre, falta motivo) → pregunta solo lo que falta, una vez.
- Consulta directa de precio sin identificarse → responde la info general, pide nombre antes de cotizar/agendar (igual que tu ejemplo 3).
- Mensajes consecutivos repitiendo lo mismo → nunca vuelve a preguntar lo ya capturado (verificación por `tieneIdentificacionCompleta`, no por releer el historial).
- Cambio de intención a mitad de conversación → el gate se reevalúa por tipo de acción, no se queda pegado al primer intento.
- Aislamiento multiempresa → mismo mecanismo de `company_id` ya probado en el resto de la plataforma, prueba explícita de que un cliente de una empresa nunca hereda identificación de otra.

---

## 6. Riesgos

- **Toca Core congelado** (`orchestrator.js`) — igual que las excepciones ya documentadas, requiere tu autorización explícita antes de escribir una sola línea ahí (no solo de este diagnóstico).
- **Decisión pendiente**: ¿qué pasa con conversaciones YA en curso antes de este cambio, donde el cliente ya dio su nombre hace semanas pero nunca se persistió? Por diseño, la primera vez que corra el gate con un cliente antiguo sin `motivo_consulta`, preguntará una vez — no hay forma de "recuperar" retroactivamente el motivo de una conversación pasada sin leerla con IA (fuera de alcance de esta fase, salvo que lo pidas).
- **No se re-analiza con IA el historial viejo** para retro-poblar `motivo_consulta` de clientes existentes — si lo quieres, es una fase aparte (un script de backfill, no parte de esta regla en vivo).

---

Quedo a la espera de tu autorización antes de implementar cualquier parte de esta propuesta.
