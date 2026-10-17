# TARA Matrix™ — Plan de estabilización: ingeniería solar (post-incidente Roberto Gzz/cotización 85)
**Fecha:** 2026-10-17 · **Prioridad 1: implementada y probada localmente, NO desplegada.** Prioridades 2-6: diagnóstico y propuesta — nada implementado.

---

## PRIORIDAD 1 — Contención (implementada localmente)

### Cambio exacto
`server.js`, bloque de disparo anticipado: se agrega una constante `DISPARO_ANTICIPADO_INGENIERIA_ACTIVO = false` que desactiva por completo el atajo, sin tocar ninguna otra cosa.

```diff
+  const DISPARO_ANTICIPADO_INGENIERIA_ACTIVO = false;
+
   let yaRespondioIngenieria = false;
   try {
     const intenciones = resultado.ai_output?.intenciones || [];
-    if (intenciones.includes('solicitud_cotizacion')) {
+    if (DISPARO_ANTICIPADO_INGENIERIA_ACTIVO && intenciones.includes('solicitud_cotizacion')) {
```

**Alcance:** este bloque SOLO maneja el atajo de "disparo anticipado" (camino C) — ya confirmado en la entrega anterior que es exclusivo de `ejecutar_motor_ingenieria`/paneles solares. No toca WhatsApp (los webhooks siguen funcionando igual), no toca el Orchestrator, no toca ningún workflow ni su camino normal de finalización (camino B). El resultado observable: un cliente que complete el workflow de ingeniería solar nodo por nodo sigue recibiendo su predimensionamiento igual que siempre — solo deja de dispararse ANTES de llegar al nodo final.

**Pruebas:** 2535/2535, 127 suites, sin regresiones (la desactivación no tiene prueba automatizada propia porque — igual que el resto de este bloque — vive en `server.js`, sin arnés de pruebas; se verificó con `node --check` + lectura directa del diff).

### Hallazgo pedido: ¿el camino normal (B) puede reproducir el mismo problema?

**Sí, confirmado con evidencia real de esta misma prueba.** A las 03:17:06, cuando el workflow llegó de verdad a su nodo final (`preguntar_voltaje`), el camino B (`_finalizarWorkflow` → ActionRunner) ejecutó `ejecutar_motor_ingenieria` — quedó registrado en `decision_logs` (`tipo:"accion"`, `exito:true`). Como la guarda de idempotencia interceptó esta llamada (encontró la cotización 85, creada 50 segundos antes por el camino C), no se creó una segunda fila — pero si el camino C hubiera estado desactivado desde el principio (como ahora), **el camino B habría sido el que generara el cálculo `bloqueado` con "en mty" sin resolver**, porque usa exactamente la misma `camposTecnicosFaltantes()` (verifica presencia, no validez).

**No desactivé el camino B** — es el mecanismo normal e indispensable de completar el workflow; desactivarlo rompería la función completa de cotización solar, no solo el atajo. Este hallazgo es la justificación directa de la Prioridad 2.

### Plan de despliegue (pendiente de tu autorización)
1. Commit solo de este archivo.
2. Push + verificación de Render (commit exacto, no solo `/health`).
3. Confirmación funcional: un cliente de prueba que complete el workflow de ingeniería solar nodo por nodo (camino B) sigue recibiendo su predimensionamiento; una solicitud repetida de "cotízame" a mitad del workflow ya NO dispara nada hasta completar todos los nodos.

### Reversión
Cambiar `DISPARO_ANTICIPADO_INGENIERIA_ACTIVO` a `true` — revert de una sola línea, sin migración, reactiva el atajo tal cual estaba (incluyendo su limitación conocida).

---

## PRIORIDAD 2 — Validación técnica reutilizable (propuesta, NO implementada)

### Problema
`camposTecnicosFaltantes()` (mi corrección anterior) solo valida **presencia** (`capturedFields.ubicacion` no está vacío). No valida si el valor es:
- **Válido** sintácticamente (`_numeroOrNull`, `_normalizarPctCobertura`, `_normalizarTipoAlimentacion` — YA EXISTEN en `modules/cotizaciones.js` y ya hacen esto).
- **Resoluble** por el motor (`ubicacion` necesita matchear contra `irradiacion_regional` vía `_normalizarUbicacion` + `resolverHSP` — YA EXISTEN, requieren una consulta async a Supabase).
- **Suficiente para calcular** — la combinación de los 3 niveles anteriores para todos los campos requeridos.

### Diseño propuesto (reutiliza 100% del motor existente, no duplica nada)
Una función nueva, async (a diferencia de la actual, síncrona — porque resolver ubicación requiere una consulta real a la base de datos, la MISMA tabla que ya usa el motor):

```js
async function validarRequisitosTecnicos(supabase, capturedFields) {
  const { infoTecnica } = mapearCapturedFieldsAInfoTecnica(capturedFields); // YA EXISTE
  const ubicacionResuelta = await _normalizarUbicacion(supabase, infoTecnica.ubicacion); // YA EXISTE
  const hsp = await resolverHSP(supabase, { nombreUbicacion: ubicacionResuelta }); // YA EXISTE

  return {
    ubicacion:   { presente: !!capturedFields.ubicacion, valido: !!infoTecnica.ubicacion, resoluble: !!hsp },
    consumo:     { presente: !!capturedFields.consumo_mensual_kwh || !!capturedFields.historial_consumo_kwh, valido: infoTecnica.consumoMensualKwh != null || !!infoTecnica.historialConsumo },
    cobertura:   { presente: !!capturedFields.pct_cobertura_deseado, valido: infoTecnica.pctCoberturaDeseado != null },
    suficiente:  /* los 3 campos con resoluble/valido=true */,
  };
}
```

Esta función **reemplazaría** a `camposTecnicosFaltantes()` en los 3 caminos (A/B vía ActionRunner, y C si se reactiva) — mismo punto único de verdad, ahora con 3 niveles en vez de 1. No se duplica ninguna fórmula del motor — se reutilizan sus propios normalizadores y catálogos tal cual.

### Riesgo de este cambio
Al requerir una consulta async a `irradiacion_regional`, el punto de verificación dentro del ActionRunner (actualmente síncrono) necesita volverse async — ya lo es (`ejecutar_motor_ingenieria` ya es un handler async), así que es un cambio contenido, pero toca la firma interna de la validación en los 3 caminos — más que una línea, menos que un refactor.

---

## PRIORIDAD 3 — Ubicaciones: reconocer abreviaturas inequívocas (propuesta, NO implementada)

### Problema
`_normalizarUbicacion` busca si el nombre COMPLETO de la ciudad (ej. "monterrey") aparece como substring del texto libre. "en mty" nunca lo contiene.

### Diseño propuesto
Agregar, ANTES del match actual, un segundo intento contra un **mapa explícito y acotado de abreviaturas inequívocas** de las ciudades más comunes (mty→monterrey, gdl→guadalajara, cdmx→ciudad de méxico, etc.) — **solo se usa si la abreviatura mapea a EXACTAMENTE una ciudad del catálogo real** (nunca se adivina entre varias). Si no hay match ni directo ni por abreviatura, el comportamiento sigue igual que hoy: se usa el texto libre tal cual, y `resolverHSP` lo reporta como no resuelto — **nunca se inventa una ubicación ni se usa un valor predeterminado**.

```js
const ABREVIATURAS_CIUDAD_CONOCIDAS = { mty: 'monterrey', gdl: 'guadalajara', cdmx: 'ciudad de méxico', slp: 'san luis potosí', ... };
// dentro de _normalizarUbicacion, si no hay match directo:
const abreviatura = ABREVIATURAS_CIUDAD_CONOCIDAS[texto.trim()] || Object.keys(ABREVIATURAS_CIUDAD_CONOCIDAS).find(abr => new RegExp(`\\b${abr}\\b`).test(texto));
if (abreviatura) { /* reintentar el match con el nombre completo */ }
```

### Alternativa (más robusta, pero requiere migración)
Agregar una columna `alias` (array de texto) a `irradiacion_regional`, poblada por Alina/un admin — evita hardcodear una lista en JS que se desactualiza, pero requiere una migración nueva. Lo presento como alternativa, no la propongo como primer paso dado que agregarías alcance (schema) a un cambio que hoy puede resolverse solo en código.

---

## PRIORIDAD 4 — Validación semántica de nodos (propuesta concreta, NO implementada)

### Hallazgo que la motiva
Nodo `preguntar_tipo_alimentacion` preguntó "¿monofásica, bifásica o trifásica?" — el cliente respondió "me puedes generar una pre cotizacion" (una petición, no una respuesta) — se guardó tal cual en `captured_fields.tipo_alimentacion`.

### Por qué esta vez SÍ es implementable sin tocar WorkflowEngine
En el incidente anterior marqué esto como "posible cambio extenso al WorkflowEngine congelado". Revisándolo de nuevo con este caso real: **ya existe el precedente exacto** — `_esAcuseAmbiguo()` (`modules/orchestrator.js`), que vive en el Orchestrator (no en WorkflowEngine) y ya rechaza una respuesta ambigua ANTES de llamar a `avanzar()`, reutilizando `_REGEX_PREGUNTA_CON_OPCIONES` para detectar cuándo la pregunta del nodo ofrece varias opciones explícitas. Propongo extender ese MISMO mecanismo, no crear uno nuevo:

1. **Nodos con opciones explícitas en la pregunta** (como tipo_alimentacion: "monofásica, bifásica o trifásica"): si la respuesta del cliente no contiene NINGUNA de las palabras-opción extraídas de la pregunta, se trata igual que un acuse ambiguo hoy — se vuelve a preguntar, no se captura. Extiende `_esAcuseAmbiguo`, no lo reemplaza.
2. **Nodos con `tipo_campo: 'number'`** (ya existe esta columna en `workflow_nodes`, **nunca se consulta hoy** — confirmé que ni WorkflowEngine ni Orchestrator la leen): si el valor candidato no contiene ningún dígito, no se captura, se vuelve a preguntar.
3. **Nodos de texto libre sin opciones** (nombre, ubicación): **fuera de alcance de esta propuesta** — validar esto de forma segura sin generar falsos rechazos es mucho más difícil (un nombre o una ciudad pueden ser casi cualquier cosa) y es exactamente el tipo de "heurística general" que puede rechazar respuestas legítimas. Lo dejo explícitamente pendiente.

### Riesgo
Bajo para los 2 casos propuestos (ambos ya tienen una señal estructural real — opciones explícitas en el texto, o un tipo de campo declarado — no es una heurística inventada de cero). Nulo para WorkflowEngine (no se toca).

---

## PRIORIDAD 5 — Respuestas de TARA cuando el cálculo está bloqueado (propuesta, NO implementada)

### Hallazgo
Cuando `ejecutar_motor_ingenieria` corre, el turno principal NO usa el resultado real del cálculo para responder — `_textoDesdeResultadoDeAgenda()` no reconoce esa forma de resultado (solo conoce `agendada`/`sin_disponibilidad`/`faltan_datos`), así que cae al texto libre del modelo. Esto es lo que produjo "~10 kWp" inventado por el modelo, sin relación con el cálculo real (que quedó bloqueado, sin ningún resultado).

### Diseño propuesto
Agregar un caso nuevo a `_textoDesdeResultadoDeAgenda()` (mismo mecanismo ya usado para agenda, no uno nuevo) para resultados de `ejecutar_motor_ingenieria`:
- `estado_calculo: 'completo'` → texto generado desde `calculo.resultados` reales (número de paneles, kWp) — nunca del modelo.
- `estado_calculo: 'bloqueado'` → el mismo mensaje honesto de "necesita revisión de especialista", como respuesta PRINCIPAL (no solo proactiva aparte).
- Nunca se deja pasar el texto libre del modelo cuando el motor corrió este turno — mismo criterio que ya existe para evitar que el modelo "confirme" una cita que nunca se agendó.

### Distinción pedida (información general / estimación orientativa / resultado validado)
Con el cambio anterior, cualquier mención de un número de paneles/kWp SOLO podría venir de un cálculo real con `estado_calculo:'completo'` — eliminando por completo la posibilidad de una "estimación orientativa" inventada por el modelo en este contexto específico.

---

## PRIORIDAD 6 — Trazabilidad de mensajes proactivos (propuesta, NO implementada — sin tocar el componente compartido)

Ya documentado en la entrega anterior: `enviarProactivoWhatsApp()`/`sendProactive()` no registra nada. Para "origen y estado de entrega" completo, hacen falta 2 piezas separadas:
1. **Origen** (quién/qué disparó el envío): una escritura a `decision_logs` dentro de `enviarProactivoWhatsApp()` — bajo riesgo, reutiliza la tabla existente.
2. **Estado de entrega** (¿Twilio/Meta lo entregó de verdad?): requiere el `MessageSid` de la respuesta de Twilio/Meta y un webhook de status callback (`MessageStatus`) — Twilio ya lo soporta, pero hoy TARA no tiene ningún endpoint que lo reciba. Esto es significativamente más grande que el punto 1 — una integración nueva, no una línea de logging.

No toqué `enviarProactivoWhatsApp`, `sendProactive` ni `modules/recordatorios.js` — confirmado, cero cambios de código en este punto.

---

## Riesgos pendientes (acumulado)
- Mientras la Prioridad 1 esté desplegada, el flujo de "mándame la cotización antes de terminar" (motivación original del disparo anticipado) deja de funcionar — el cliente debe completar el workflow normal. Trade-off consciente, reversible con una línea.
- El camino B conserva la misma limitación de presencia-no-validez hasta que se implemente la Prioridad 2.
- Las Prioridades 3-6 no están implementadas — el riesgo de "en mty" sin resolver, captura de datos basura en nodos de opciones, y el modelo inventando cifras siguen activos en producción hasta que se autoricen.

## Entrega
Diagnóstico completo arriba, dividido en los 6 puntos que pediste. **Solo la Prioridad 1 tiene código listo — sin desplegar.** Las Prioridades 2-6 son propuestas para que decidas cuál autorizar primero; ninguna se implementó.
