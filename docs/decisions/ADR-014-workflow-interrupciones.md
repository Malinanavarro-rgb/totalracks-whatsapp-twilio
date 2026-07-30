# ADR-014 — Excepción puntual a ADR-005: el workflow no debe capturar cualquier mensaje como respuesta válida

| Campo | Valor |
|-------|-------|
| Estado | **Propuesta — pendiente de aprobación, sin implementar** |
| Fecha | 30 de julio de 2026 |
| Autora | Alina Navarro |
| Componente que toca | `modules/orchestrator.js` (`procesarMensaje`, `_manejarWorkflow`) — parte de la tabla congelada de ADR-005 |
| Evidencia | Conversación real de producción, cliente id 115, `+5218142850036`, Empresa Demo Paneles Solares, 2026-07-30 17:00–17:03 UTC |

---

## 1. Sección exacta de `orchestrator.js` a modificar

**`_manejarWorkflow()`, líneas 434-439** (el bug en sí):
```js
const valorExtraido = nodo.campo ? (aiOutput.datos_extraidos || {})[nodo.campo] : undefined;
const valorParaNodo = (valorExtraido != null && String(valorExtraido).trim() !== '')
  ? String(valorExtraido).trim()
  : mensajeCliente.trim();   // ← fallback ciego: usa el mensaje completo sin validar que responda la pregunta
```

**`procesarMensaje()`, línea 213** (precondición necesaria para poder clasificar la interrupción):
```js
workflow_state: null,   // FASE 5
```
Este campo ya existe en el contrato de `ContextBuilder` (`@typedef WorkflowState {nombre, paso_actual, objetivo, etapa_objetivo}`, `context-builder.js:47-51`) pero nunca se llena — es la pieza "FASE 5" pendiente desde antes de este bug. Sin esto, el modelo no tiene forma de saber que existe una pregunta pendiente, y por lo tanto no puede clasificar si un mensaje la responde o no.

## 2. Por qué no se puede resolver fuera de Orchestrator

| Capa | Por qué no alcanza |
|---|---|
| **Prompt** (`prompt-builder.js`) | Puede pedirle al modelo que clasifique la interrupción, pero necesita saber CUÁL es la pregunta pendiente — ese dato hoy no le llega (`workflow_state` es `null`). El prompt no puede inventar contexto que Orchestrator no le pasa. |
| **`workflow_seed`** (datos, `plantillas_industria`) | Es solo la definición estática de nodos/preguntas — no tiene forma de decidir en tiempo real si un mensaje concreto responde el campo. Es dato, no lógica. |
| **Extractor** (`aiOutput.datos_extraidos`, ya en `openai-provider.js`) | Ya hace su parte correctamente: en esta conversación real, dejó `hora_preferida: null` porque el cliente no dio una hora — el extractor no falló. **El bug está en lo que Orchestrator hace DESPUÉS de ver ese `null`.** |
| **CRM** (`modules/crm.js`) | No tiene visibilidad de sesiones de workflow ni de nodos — su única relación es `requiereCrearOportunidad()`, un problema distinto (ver diagnóstico previo). |
| **`server.js`** | Es capa de plataforma, corre antes/después del turno completo — no tiene acceso a `nodo`/`sesion` de workflow (eso vive dentro de `Orchestrator`, nunca se expone hacia afuera). |
| **Middleware previo** | No existe un punto de entrada intermedio entre "mensaje recibido" y "Orchestrator decide" — meterlo ahí duplicaría el acceso a `workflow_sessions`/`workflow_nodes` que hoy solo conoce `WorkflowEngine`, invocado desde dentro de Orchestrator. |

La decisión de "¿este mensaje responde el campo pendiente?" solo se puede tomar con dos datos que **hoy solo se juntan dentro de `Orchestrator`**: (a) cuál es el campo/pregunta pendiente (`nodo`, ya resuelto ahí) y (b) qué extrajo/clasificó el modelo de este turno (`aiOutput`, ya resuelto ahí). No hay forma honesta de resolverlo sin tocar el punto donde ambos ya conviven.

## 3. Comportamiento actual vs. esperado

**Actual**: si el modelo no extrae un valor para el campo pendiente, Orchestrator usa el mensaje completo del cliente como si fuera la respuesta — sin importar su contenido. Evidencia real: `hora_preferida: "Me puedes decir el ahorro aproximado"`, nodo marcado `completado`, cita agendada a la hora *default* de `_parsearHoraPreferida` (10 a.m., porque no había ningún patrón de hora en ese texto) — una cita que nadie pidió a esa hora.

**Esperado**: si el mensaje no responde el campo pendiente, el workflow **no avanza ni se marca completado** — permanece en el mismo nodo. TARA responde lo que el cliente preguntó/dijo, y retoma la pregunta pendiente en la misma respuesta.

## 4. Cambio mínimo propuesto

1. **`prompt-builder.js` (no congelado)** — nuevo bloque, se agrega SOLO si `ctx.workflow_state` no es null:
   ```
   ## PREGUNTA PENDIENTE
   Le preguntaste al cliente: "{workflow_state.objetivo}"
   En "campo_pendiente_respondido", indica true SOLO si el mensaje actual responde
   directamente esa pregunta. Si el cliente preguntó otra cosa, cambió de tema, pidió
   hablar con una persona, o su mensaje no tiene relación con esa pregunta, usa false.
   Ante la duda de si una respuesta corta y directa sí contesta la pregunta, prefiere true.
   ```
   Nuevos campos en `bloque_schema_json()`:
   ```json
   "campo_pendiente_respondido": true | false | null,
   "tipo_interrupcion": "pregunta" | "correccion" | "cambio_intencion" | "cancelacion" | "solicitud_humano" | "irrelevante" | null
   ```
   (`null` en ambos cuando no hay `workflow_state` — el 100% del tráfico sin workflow activo, o sea casi todas las empresas hoy, no ve ningún campo nuevo con contenido).

2. **`openai-provider.js` (no congelado)** — leer y pasar ambos campos nuevos en `aiOutput`, con default `null` si el modelo no los incluye (mismo patrón que todos los campos opcionales existentes).

3. **`orchestrator.js::procesarMensaje()` (congelado — la excepción)** — antes de construir el contexto (línea ~203), un *peek* de solo lectura a la sesión/nodo activos (reusa `this._workflow.obtenerSesionActiva()`/`obtenerNodoActual()`, ya existentes, sin mutar nada):
   ```js
   let workflowStatePeek = null;
   if (clienteRaw?.id) {
     const sesionActiva = await this._workflow.obtenerSesionActiva(company_id, clienteRaw.id);
     if (sesionActiva) {
       const nodoActivo = await this._workflow.obtenerNodoActual(sesionActiva);
       if (nodoActivo) workflowStatePeek = { nombre: sesionActiva.workflow_id, paso_actual: nodoActivo.nombre, objetivo: nodoActivo.pregunta, etapa_objetivo: nodoActivo.campo };
     }
   }
   ```
   y pasar `workflow_state: workflowStatePeek` en vez de `null`.

4. **`orchestrator.js::_manejarWorkflow()` (congelado — la excepción, el fix real)** — reemplazar el fallback ciego:
   ```js
   // Antes:
   const valorParaNodo = (valorExtraido != null && ...) ? ... : mensajeCliente.trim();
   const resultado = await this._workflow.avanzar(sesion, nodo, valorParaNodo);

   // Después:
   const esInterrupcion = aiOutput.campo_pendiente_respondido === false;
   if (esInterrupcion) {
     this._log.logAccion(ctx, 'workflow_interrupcion', { tipo: aiOutput.tipo_interrupcion, nodo: nodo.nombre }, { info: true }, { session_id: sessionId });
     return `${aiOutput.respuesta_texto} ${nodo.pregunta}`.trim();
   }
   const valorParaNodo = (valorExtraido != null && ...) ? ... : mensajeCliente.trim();
   const resultado = await this._workflow.avanzar(sesion, nodo, valorParaNodo);
   ```
   Si `campo_pendiente_respondido` es `true` o `null` (modelo no lo incluyó, o no hay workflow activo), el comportamiento es **idéntico al actual** — cero cambio para el resto de los flujos. Solo cuando es explícitamente `false` se retiene el nodo.

## 5-6. Por qué no queda específico de paneles solares — generaliza a cualquier industria/campo

Nada en el cambio menciona un `campo` ni una industria por nombre. `workflow_state.objetivo`/`etapa_objetivo` se leen de `nodo.pregunta`/`nodo.campo` — los mismos que ya usa cualquier `workflow_seed` (Total Racks, Tienda Soccer, Salón de Belleza, Paneles Solares). El mecanismo es: *"¿el mensaje de este turno responde la pregunta que YA le hice, sea cual sea?"* — funciona igual si la pregunta pendiente es `talla` (Tienda Soccer), `fecha_entrega` (Total Racks) o `hora_preferida` (Paneles Solares).

**Segundo ejemplo, industria distinta, para probar que generaliza:**
Total Racks, nodo pendiente = `cantidad` ("¿Cuántos racks necesitas?"). Cliente responde: "¿Manejan garantía?" → `campo_pendiente_respondido: false`, `tipo_interrupcion: "pregunta"` → Orchestrator responde la garantía + retoma "¿Cuántos racks necesitas?" — mismo mecanismo, cero código nuevo por industria.

## 7. Tipos de interrupción reconocidos (y alcance real de cada uno en este cambio)

| Tipo | Se clasifica | Efecto en este cambio |
|---|---|---|
| Pregunta del cliente | Sí | Responde + retoma pregunta pendiente (comportamiento nuevo, el caso principal) |
| Mensaje irrelevante | Sí | Mismo tratamiento que "pregunta" — no avanza, retoma pregunta |
| Solicitud de humano | Sí (se registra `tipo_interrupcion`) | **Alcance limitado**: en este cambio se trata igual que cualquier no-respuesta (no avanza el workflow). Escalar realmente a un humano (handoff) es una función ya existente pero separada (`atendido_por='humano'`) — no se conecta aquí para no ampliar el alcance de esta excepción puntual. Lo dejo anotado como extensión futura. |
| Cancelación | Ya manejado hoy | Sin cambios — `intenciones.includes('cancelar_flujo')` (línea 420) sigue resolviéndose antes de llegar a esta lógica. |
| Cambio de intención | Sí (se registra) | Mismo tratamiento que "pregunta" en este cambio — no re-enruta a otro workflow. Re-enrutar mid-sesión es una función nueva más grande, fuera de alcance aquí. |
| Corrección de información anterior (ej. "no espera, dije 3 pisos no 2") | Sí (se registra) | **No se sobrescribe retroactivamente ningún campo ya capturado en este cambio** — eso exigiría lógica adicional de "encontrar a qué campo pasado se refiere la corrección", un problema distinto y más grande. Se clasifica para no perder la señal, pero el comportamiento es el mismo que "pregunta" (no avanza el nodo actual). |
| Respuesta válida al campo esperado | Sí | Comportamiento actual, sin cambios — avanza normalmente. |

Ser honesta con el alcance: de los 7 tipos, el cambio resuelve completamente el problema reportado (preguntas/mensajes irrelevantes que no deben corromper el campo pendiente) y dos casos ya funcionan hoy (cancelación). Los otros tres (solicitud de humano con handoff real, cambio de intención con re-enrutamiento, corrección retroactiva) quedan **clasificados pero no actuados de forma especial** — para mantener el fix mínimo, tal como pediste. Si alguno de esos tres se vuelve un problema real reportado, es una excepción nueva y separada, no una ampliación silenciosa de esta.

## 8. Cómo se conserva el estado del workflow durante una interrupción

No se llama a `this._workflow.avanzar()` en absoluto — `sesion.current_node` y `sesion.captured_fields` quedan exactamente como estaban. La sesión sigue "activa" en el mismo nodo. Nada se escribe en `workflow_sessions` durante una interrupción (a diferencia de hoy, que si escribe un campo corrupto).

## 9. Cómo retoma TARA la pregunta pendiente

En la misma respuesta del turno de la interrupción: `${aiOutput.respuesta_texto} ${nodo.pregunta}` — responde la pregunta del cliente y, a continuación, repite la pregunta que quedó pendiente. No se necesita un turno adicional ni lógica de "recordar para después" — el nodo nunca se movió.

## 10. Riesgos

- **Falso negativo** (el modelo dice `false` aunque el mensaje sí respondía): el workflow se detiene un turno de más, repite la pregunta — molesto pero no daña datos. Mitigado con la instrucción "ante la duda, prefiere true" en el prompt.
- **Falso positivo** (el modelo dice `true` para algo que no responde): mismo riesgo que existe HOY con `datos_extraidos` (no es nuevo, no lo empeora).
- **Costo/latencia**: dos campos más en el JSON de salida — variación de tokens despreciable.
- **`campo_pendiente_respondido` ausente en la respuesta del modelo** (por ejemplo con `MockProvider` en tests, o si el modelo falla el formato): se trata como `null` → comportamiento idéntico al actual, nunca bloquea.

## 11. Pruebas de regresión

- **Los 4 workflows reales existentes** (Total Racks, Tienda Soccer, Salón de Belleza, Paneles Solares) completados de principio a fin con respuestas directas — deben comportarse exactamente igual que hoy (cero cambio, `campo_pendiente_respondido` no presente o `true` en todos esos turnos).
- **Reproducción exacta de la conversación real** (este ADR): mismos 7 mensajes, mismo orden. Turno 6 ("me puedes decir el ahorro aproximado") no debe modificar `hora_preferida`, la sesión debe seguir en `preguntar_hora_preferida`/`activo`, la respuesta debe incluir el ahorro + la pregunta de agenda. Turno 7 ("hoy a las 2pm") debe ser el que realmente complete el nodo y agende.
- **Segundo ejemplo cruzado de industria** (punto 6, Total Racks/`cantidad`) para confirmar que no quedó específico de paneles solares.
- **Mutation testing**: invertir la condición (`=== true` en vez de `=== false`, o quitar el `return` temprano) y confirmar que el test de la reproducción exacta falla.
- `npm test` completo en verde antes de considerar el cambio terminado.

## 12. Documentación de la excepción

Este mismo archivo (`ADR-014-workflow-interrupciones.md`) documenta la excepción. Al aprobarse e implementarse, se agrega una fila nueva a la tabla "Excepciones documentadas" de `ADR-005-baseline-v1-core-freeze.md` (mismo formato que la fila existente de `_mapearPersonalidad()`), y este documento cambia su estado de "Propuesta" a "Aceptada" con la fecha real de implementación.

---

## Trabajo en paralelo (no toca Core, procede sin esperar aprobación de este ADR)

Autorizado explícitamente: saludo duplicado, plantilla de paneles solares (nombre, dirección/colonia, campos de calificación, disponibilidad antes de preguntar hora), `requiereCrearOportunidad()` en `crm.js`, frontend de sesión demo en vivo. Se documentan por separado, en commits propios, sin tocar `orchestrator.js`.
