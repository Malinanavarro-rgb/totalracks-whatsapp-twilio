# TARA Matrix™ — Incidente real: Lucía no completa la cotización
**Fecha del diagnóstico:** 2026-10-18 · **Solo lectura — sin cambios de código, sin push, sin despliegue**

Conversación real auditada: `cliente_id 261`, `company_id` Nort Energy, 18-oct-2026 16:11–16:15 UTC (10:11–10:15 hora de Monterrey). Evidencia consultada en modo solo lectura: `conversaciones`, `workflow_sessions`, `workflow_nodes`, `workflows`, `clientes`, `decision_logs`, `cotizaciones`, `calculos_ingenieria`.

---

## FASE 1 — Trazabilidad: qué pasó exactamente

**Workflow activo:** `e2a01519-e312-4d35-86a0-33d852a9becc`, "Cotización directa — ingeniería solar" (trigger `solicitud_cotizacion`), el mismo que usa `modules/orchestrator.js::_manejarWorkflow()` / `WorkflowEngine` (`modules/workflow-engine.js`) — **no hay ningún segundo motor involucrado**, es el camino que ya veníamos auditando toda la sesión.

**Nodo que recibió "220":** `preguntar_voltaje` — confirmado como el nodo final real (`es_fin: true`, `siguiente_nodo: null`), con `acciones: [{ tipo: 'ejecutar_motor_ingenieria', parametros: {} }]` **correctamente configurado** (descarté mi primera hipótesis de que faltaba la acción — sí está).

**¿El workflow terminó, quedó bloqueado o perdió su estado?** Terminó correctamente — `workflow_sessions.status = 'completado'`, con los 8 campos capturados intactos (`ciudad`, `ubicacion`, `consumo_mensual_kwh`, `importe_promedio_recibo`, `pct_cobertura_deseado`, `tipo_alimentacion`, `voltaje_sitio`, `nombre`). **No perdió nada — el estado está completo y disponible.**

**¿Se intentó ejecutar el motor de ingeniería?** **No.** El código de `_finalizarWorkflow()` (`modules/orchestrator.js:1045-1056`) evalúa primero el gate de identificación (`puedeEjecutarseAccionComercial`, única función de autorización para `ejecutar_motor_ingenieria` desde Prioridad 3) — **antes** de llamar al `ActionRunner` real. El gate bloqueó la acción, así que `ejecutar_motor_ingenieria` nunca llegó a ejecutarse — cero intento real del motor.

**¿Se creó alguna cotización o cálculo?** No — confirmado, cero filas en `cotizaciones` y `calculos_ingenieria` para este cliente. Coherente con el punto anterior.

**¿El sistema detectó que faltaba el nombre?** No — ese no fue el campo bloqueante. El nodo `preguntar_nombre` capturó literalmente "es para mi casa" (el cliente no respondió su nombre, respondió a destiempo lo que parece ser la respuesta a la SIGUIENTE pregunta) — como ese valor es un texto no-nulo y distinto de "Sin nombre", `puedeEjecutarseAccionComercial` lo acepta como "nombre presente" (sin validar que *parezca* un nombre real — ver Problema C.1 abajo). El campo real que faltaba era **`motivo`** — ver siguiente punto.

**¿P7 interpretó "3000 mensual" como ambiguo?** Todo indica que no, y until ahora no hay una captura de log que lo contradiga: `captured_fields.consumo_mensual_kwh = "3000"` se guardó sin ningún `consumo_mensual_kwh_fuente` (la marca que P7 agrega siempre que SÍ pasa por `interpretarConsumoDeclarado()` con un resultado determinado — ver Prioridad 7). La explicación más probable, trazada en el propio código (`modules/consumo-electrico.js:84-92`): `interpretarConsumoDeclarado()` devuelve de inmediato "nada que interpretar" (`campo: null`) cuando `aiOutput.datos_consumo_declarado.valor` llega vacío ese turno — y en ese caso, `modules/orchestrator.js:820-828` cae al valor crudo (`datos_extraidos`/mensaje tal cual) **sin ninguna protección**, exactamente el comportamiento pre-P7. `decision_logs` no guarda el payload completo de `datos_consumo_declarado` (solo un resumen de auditoría), así que no puedo confirmarlo con el dato crudo exacto de ese turno — lo marco como la explicación más probable según el código, no como un hecho 100% verificado con el log crudo.

**¿Por qué se generó exactamente la respuesta genérica "¿en qué te puedo ayudar?"?** Esto SÍ está 100% confirmado, es texto literal del código, no algo que el modelo inventó ni un estado perdido:

```js
// modules/orchestrator.js:1174-1193, _preguntaPorDatoFaltante()
const PREGUNTAS = {
  ...
  motivo: '¿en qué te puedo ayudar?',   // ← línea 1180
  ...
};
```

Cadena exacta: `_finalizarWorkflow()` → gate de identificación bloquea por `campoFaltante: 'motivo'` (nunca por nombre) → sintetiza `{tipo:'faltan_datos', campos:['motivo'], motivo:'identificacion'}` (línea 1053) → `_textoDesdeResultadoDeAgenda()` → `_preguntaPorDatoFaltante(['motivo'])` → `PREGUNTAS.motivo`. **El sistema no perdió el hilo de la conversación — literalmente está preguntando "¿cuál es el motivo de tu consulta?", solo que con una redacción idéntica a un saludo genérico de bienvenida**, lo cual hace parecer que reinició cuando en realidad tiene los 8 datos técnicos completos y disponibles en `captured_fields`.

**¿Por qué faltaba `motivo` si el cliente escribió "quiero una cotización" en su primer mensaje?** Por diseño documentado (`modules/orchestrator.js:98-100`): "ningún workflow tiene hoy un nodo dedicado a motivo_consulta" — `motivo` depende ÚNICAMENTE de que el modelo haya extraído `datos_contacto.motivo` en algún turno libre, o de `clientes.motivo_consulta` ya persistido (confirmado `null` en este cliente). El propio disparador del workflow (`trigger_value: 'solicitud_cotizacion'`, que es justamente la intención que el cliente expresó en su mensaje 1) **nunca se usa como fuente válida de `motivo`** — es información que el sistema ya tiene (literalmente activó este workflow por eso) pero que la función de identificación ignora por completo.

---

## FASE 2 — Aislamiento: ¿es el mismo problema que la atribución cruzada?

**No, son problemas completamente distintos — confirmado con evidencia, no solo descartado por suposición.** Revisé el `company_id` de los 9 mensajes de la conversación completa (`conversaciones`, `workflow_sessions`): los 9 muestran exactamente `0affb234-3dc7-431f-862b-3230664962fb` (Nort Energy), sin ningún cambio. El fix de aislamiento multiempresa (commit `6aa4efa`, ya desplegado) funcionó correctamente aquí — la conversación nunca perdió ni cambió de empresa. Este incidente ocurre 100% dentro de Nort Energy, en la lógica de identificación/cierre de workflow — no hay ninguna relación con `lead-atribucion.js` ni `channel-router.js`.

---

## Resumen de los 4 problemas (confirmando tu análisis, con la causa exacta)

| # | Tu diagnóstico | Causa exacta confirmada |
|---|---|---|
| A | El workflow termina sin completar su objetivo | El workflow SÍ completa (`status: completado`, acción configurada) — lo que falla es el **gate de identificación posterior**, que bloquea antes de llegar al motor |
| B | No usa la intención comercial persistente | El `trigger_value` del workflow (`solicitud_cotizacion`) nunca se reutiliza como `motivo` — se vuelve a pedir algo que el sistema ya sabía |
| C | Faltan confirmar datos importantes | 2 causas distintas: (C.1) el nodo "nombre" no valida que la respuesta *parezca* un nombre; (C.2) `interpretarConsumoDeclarado()` depende de que el modelo pueble `datos_consumo_declarado` ese turno — si no lo hace, no hay red de protección |
| D | Respuesta no alineada con el estado de ingeniería | Consecuencia directa de A — como el motor nunca corrió, no hay `calculo`/`cotización` que gobierne la respuesta (la protección de Prioridad 5, que si existe, nunca llega a activarse) |

---

## FASE 3 — Propuesta de corrección mínima (NO IMPLEMENTADA — solo diseño, a la espera de tu autorización)

1. **El texto de `PREGUNTAS.motivo`** (`modules/orchestrator.js:1180`) debería dejar de ser un saludo genérico — algo como *"Para preparar tu cotización, ¿me confirmas qué te gustaría cotizar?"* — nunca indistinguible de un reinicio de conversación.
2. **`_resolverIdentificacion()`** (`modules/orchestrator.js:102-108`) debería aceptar el `trigger_value` del workflow activo como fuente válida de `motivo` cuando el workflow fue disparado por una intención comercial explícita (`solicitud_cotizacion`, `solicitud_visita_tecnica`, etc.) — evitando volver a pedir algo que el propio disparo del workflow ya demuestra.
3. **El nodo `preguntar_nombre`** necesita una validación mínima (ya existe el campo `validacion` en `workflow_nodes`, hoy `null` para este nodo) para rechazar respuestas que claramente no son un nombre (ej. frases con verbos/preposiciones) y volver a preguntar, en vez de aceptarlas tal cual.
4. **P7 (`interpretarConsumoDeclarado`)** necesita un respaldo determinista cuando `datos_consumo_declarado` llega vacío pero el nodo actual SÍ es justo el nodo de consumo/importe — en ese caso específico (no en conversación libre), se sabe con certeza que el cliente SÍ está respondiendo esa pregunta, así que un valor sin unidad declarada debería tratarse como ambiguo igual, no como "nada que interpretar".

Ninguno de estos 4 cambios toca fórmulas solares, y el único que roza `WorkflowEngine` es el #3 (agregar una validación a un nodo existente vía el campo `validacion` que ya existe en el esquema) — consistente con tu restricción de "no modificar WorkflowEngine sin autorización adicional": lo dejo explícitamente marcado para tu decisión, no lo implico como ya aprobado.

---

**No implementé nada de lo anterior. No modifiqué código. No hice push ni despliegue.** Quedo a la espera de tu autorización para la Fase 3/4 (implementación + pruebas que reproduzcan este incidente exacto).
