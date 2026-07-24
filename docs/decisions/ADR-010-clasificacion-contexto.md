# ADR-010 — Clasificación de contexto antes de responder (nunca asumir venta)

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Julio 2026 |
| Autora | Alina Navarro |
| Archivos | `modules/clasificacion-contexto.js` (catálogo, única fuente de verdad), `modules/prompt-builder.js`, `adapters/ai/ai-provider.js`, `adapters/ai/openai-provider.js`, `adapters/ai/mock-provider.js`, `modules/audit-logger.js` |

---

## Contexto

Al revisar las conversaciones reales del número de TARA-OS (ver conversación de esta sesión, 24 de julio), se encontró que al menos 3 de 5 conversaciones no eran prospectos comerciales — eran mensajes personales reales (una cena, un aviso escolar, alguien manejando en tráfico hablando de "Alina" y "David") que llegaron a un número que antes pertenecía a otra persona/empresa. En los 3 casos, TARA respondió con el mismo guion de ventas, sin detectar que el mensaje no iba dirigido a la empresa.

El diagnóstico de la dueña del producto: *"el problema no es el texto de bienvenida, sino que actualmente asume que cualquier mensaje es un prospecto y responde con el mismo pitch comercial. Eso debe desaparecer."* Se pidió explícitamente que este comportamiento fuera **parte del núcleo de TARA, independiente del giro de cada empresa** — no una regla especial de la demo de TARA-OS, sino un principio universal de la plataforma.

**Riesgo de negocio si no se corrige** (la razón por la que esto es una prioridad de producto, no solo un detalle técnico): cada empresa cliente de la plataforma hereda el mismo comportamiento. Un asistente que insiste con un pitch comercial a alguien que claramente no es un prospecto (un familiar, un aviso escolar, un mensaje de número equivocado) daña la percepción de la marca del cliente ante personas reales que no tienen relación con su negocio, desperdicia costo de IA en conversaciones que nunca van a convertir, y — al tratarse de WhatsApp Business — un patrón de respuestas insistentes o fuera de contexto es exactamente el tipo de señal que puede derivar en reportes de spam contra el número del cliente. No es un problema estético de un texto de bienvenida; es un problema de juicio conversacional que se repite en cada empresa de la plataforma.

## Decisión

TARA clasifica internamente el contexto real de cada mensaje **antes** de decidir cómo responder, en una de 8 categorías (`prospecto`, `cliente_existente`, `proveedor`, `conversacion_personal`, `numero_equivocado`, `spam`, `informacion_administrativa`, `contexto_insuficiente`), y solo vende/presenta la empresa si la clasificación lo justifica.

### Por qué esto NO requiere una excepción a ADR-005

La tabla de componentes congelados de ADR-005 (`WorkflowEngine`, `SchedulingEngine`, `ActionRunner`, adapters de `CalendarProvider`, `google-auth.js`, `Orchestrator`, integración multiempresa) **no incluye** `PromptBuilder`, `AIEngine`, ni los adapters de `AIProvider` (`openai-provider.js`, `mock-provider.js`, `ai-provider.js`). Este cambio se implementó completo dentro de esos módulos no congelados — **`orchestrator.js` no se tocó ni una línea**.

`PromptBuilder` además está explícitamente diseñado para esto: su propio docstring invita a extenderlo ("Extensible: agregar una clave aquí es suficiente para registrar un bloque nuevo"), con un registro de bloques (`MAPA_BLOQUES`) pensado exactamente para este tipo de adición.

### 1. Un bloque nuevo, universal y agnóstico: `clasificacion_contexto`

`modules/prompt-builder.js::bloque_clasificacion_contexto()` — a diferencia de todos los demás bloques (que se omiten si el contexto no trae datos), este bloque **nunca devuelve `null`**: es texto estático, no depende de ningún dato de `ctx`, por lo tanto aparece para **cualquier empresa sin excepción**, cumpliendo el requisito de ser "parte del núcleo, independiente del giro". Se agregó a `ORDEN_DEFAULT` justo después de `identidad` y antes de `objetivo` — el modelo conoce quién es antes de clasificar, y clasifica antes de conocer la meta comercial.

Instruye al modelo a clasificar el mensaje en 8 categorías y a decidir su respuesta según la categoría — nunca vender en `conversacion_personal`/`numero_equivocado`, agradecer sin vender en `informacion_administrativa`, preguntar en vez de presentar la empresa en `contexto_insuficiente`.

### 2. Un solo turno de IA, no dos llamadas — el orden de las claves del JSON fuerza el orden del razonamiento

Se consideró hacer una llamada de clasificación separada antes de la llamada de generación (dos llamadas a OpenAI por turno). Se descartó: duplica costo y latencia por cada mensaje, y el mismo resultado se logra con una sola llamada bien diseñada.

En vez de eso, `bloque_schema_json` ahora exige `"clasificacion_contexto"` como la **primera clave** del JSON de salida y `"respuesta_texto"` como la **última**. Como la generación de JSON de OpenAI es autoregresiva (token por token, de izquierda a derecha, en el orden de las claves del objeto), el modelo está forzado en la práctica a "escribir" su clasificación antes de poder escribir su respuesta — clasificar es la primera etapa, generar texto es la última, dentro de una única llamada. Esto implementa literalmente el pedido de la dueña del producto ("la generación de texto debe ser la última etapa del proceso, nunca la primera") sin el costo de duplicar la llamada.

### 3. Catálogo centralizado en un módulo propio — una sola fuente de verdad

Las 8 categorías (valor + descripción) viven en un módulo nuevo, `modules/clasificacion-contexto.js`, y en ningún otro lugar. Tanto `prompt-builder.js` (instrucciones + schema JSON que ve el modelo) como `adapters/ai/openai-provider.js::normalizarClasificacion()` (validación de lo que el modelo devuelve, mismo patrón ya usado para `INTENCIONES_VALIDAS`/`normalizarIntenciones()`) importan ese módulo — ninguno de los dos mantiene su propia copia de la lista.

Esto no era el diseño original: la primera versión sí duplicaba las 8 categorías (una vez en el Set de validación, otra vez como texto literal en dos bloques del prompt). Se centralizó explícitamente para eliminar el riesgo de que alguien agregue una categoría nueva en un lugar y se le olvide en el otro — quedarían desincronizados sin que ningún test lo detectara. `__tests__/clasificacion-contexto.test.js` prueba la centralización directamente: mockea el catálogo compartido con una categoría de prueba y confirma que se propaga sola a ambos consumidores.

Un valor fuera del catálogo (o ausente) se normaliza a `CLASIFICACION_POR_DEFECTO` (`'contexto_insuficiente'`), **nunca a `'prospecto'`** — asumir venta por defecto ante un valor inesperado del modelo sería reintroducir exactamente el problema que este ADR resuelve.

### 4. Nunca se muestra al cliente; disponible para auditoría

`clasificacion_contexto` vive únicamente en `AIOutput` — nunca se envía al cliente (solo `respuesta_texto` sale por el canal). Se agregó a `modules/audit-logger.js::logAICall()` para que quede disponible en `decision_logs` — permite en el futuro consultar, por ejemplo, cuántas conversaciones de una empresa fueron `numero_equivocado` en una semana.

### 5. Qué NO se tocó

- `orchestrator.js` — cero cambios. El control de flujo (workflows, acciones, guardado) sigue exactamente igual; el `Orchestrator` sigue sin saber nada de "ventas" ni "clasificación", como siempre.
- `modules/crm.js`, tabla `conversaciones` — sin cambios de schema. `clasificacion_contexto` no se persiste ahí (evita tocar la tabla congelada del Core, ver hallazgo previo del plan de Inbox Inteligente); vive en `decision_logs` vía `audit-logger.js`.
- Ninguna configuración por-empresa (`personalidad`, `reglas`, `plantillas_industria`) — el principio es universal, no una opción activable por industria.

---

## Pruebas

- `__tests__/clasificacion-contexto.test.js` (nuevo) — el catálogo tiene exactamente 8 categorías con valor/descripción no vacíos, `CLASIFICACION_POR_DEFECTO` nunca es `'prospecto'` y sí pertenece al catálogo, y una prueba de centralización real: mockea el módulo del catálogo con una categoría de prueba y confirma que se propaga sola tanto a `bloque_schema_json()` como a `openai-provider.js` (si esta prueba pasara sin que ambos consumidores importaran el módulo compartido, sería la señal de que hay una copia paralela).
- `__tests__/prompt-builder.test.js` — `bloque_clasificacion_contexto()` (siempre presente, nunca `null`, agnóstico al ctx, lista las 8 categorías, instruye no vender), `ORDEN_DEFAULT` (posición justo después de `identidad`), `bloque_schema_json()` (incluye el campo, aparece antes que `respuesta_texto` **dentro del bloque JSON**, no en cualquier parte del string).
- `__tests__/ai-engine.test.js` — `OpenAIProvider` normaliza clasificaciones válidas, ausentes (→ `contexto_insuficiente`) y fuera de catálogo (→ `contexto_insuficiente`, nunca `prospecto`); las 8 categorías válidas se aceptan todas.
- `__tests__/audit-logger.test.js` — `logAICall()` incluye `clasificacion_contexto` en el payload.
- Regresión completa: 1257/1257 tests, cero cambios en `orchestrator.js`.

**Verificación de mutación (que los tests fallen si se quita la funcionalidad):** se probó manualmente revirtiendo cada pieza clave (enforcement del catálogo, orden de las claves del JSON, posición en `ORDEN_DEFAULT`, la instrucción de "no vender", el campo en `audit-logger.js`) y confirmando que el test correspondiente falla. Esto encontró un falso positivo real: la prueba original de "`clasificacion_contexto` aparece antes que `respuesta_texto`" usaba `indexOf`, que encontraba ambas palabras en la *prosa instructiva* del bloque (que también las menciona en ese orden) en vez de en el JSON de ejemplo — pasaba aunque se invirtiera el orden real dentro del JSON. Se corrigió a `lastIndexOf` (el JSON de ejemplo es la última aparición de ambos términos) y se reconfirmó que sí detecta la regresión.

**Validación real en vivo (24 de julio):** se ejecutó `crearOrchestrator()` directo (sin HTTP) contra la empresa TARA-OS con 2 de los mensajes personales reales encontrados en esta misma sesión y una pregunta de negocio real:
| Mensaje | `clasificacion_contexto` | Respuesta de TARA |
|---|---|---|
| "Cena hoy? A las 9?" | `conversacion_personal` | "Parece que el mensaje no era para mí. ¡Espero que disfrutes tu cena!" — sin pitch. |
| "¿Qué onda, Lina?... le llevo unos dulces a tu hija" | `numero_equivocado` | "Parece que te has confundido de número..." — sin pitch. |
| "¿A qué se dedican ustedes?" | `contexto_insuficiente` | Presenta TARA-OS con naturalidad y ofrece profundizar. |
Los 3 clientes de prueba generados por esta validación se eliminaron de Supabase (tabla `clientes`/`conversaciones`) al terminar.

---

## Regla permanente

> TARA nunca asume que un mensaje es una oportunidad de venta. Antes de responder, clasifica el contexto real de la conversación; solo presenta la empresa o vende si la clasificación lo justifica. Este principio vive en el Core (PromptBuilder + AIProvider), es universal para cualquier empresa, y no es una opción configurable por industria ni por empresa.
