# TARA Matrix™ — Prioridad 7: interpretación y validación determinista del consumo eléctrico
**Fecha:** 2026-10-17 · **Implementado y probado localmente — NO desplegado**

---

## FASE A — Diagnóstico

### Cómo se capturan/almacenan/usan hoy estos 4 datos

| Dato | Captura | Almacenamiento | Uso |
|---|---|---|---|
| `consumo_mensual_kwh` | Nodo de workflow (`preguntar_consumo_kwh`), el modelo llena `datos_extraidos.consumo_mensual_kwh` | `workflow_sessions.captured_fields` (jsonb) | `mapearCapturedFieldsAInfoTecnica()` → `calcularConsumoAnual()` (× 12) |
| `historial_consumo_kwh` | Solo vía foto de recibo CFE (`recibo-cfe.js`) | `captured_fields` (jsonb) | Alternativa más precisa a consumo_mensual_kwh |
| `importe_promedio_recibo` | Nodo `preguntar_importe_recibo` | `captured_fields` (jsonb) | Solo `calcularAhorro()` — NUNCA para dimensionar (confirmado en P2) |
| Datos del recibo CFE (foto) | `modules/recibo-cfe.js` (visión GPT-4o) | Se normalizan y pre-guardan en `captured_fields` | Igual que arriba |

### Dónde el modelo interpreta y dónde el motor asume

**El hallazgo central:** `modules/prompt-builder.js::bloque_schema_json()` construye el schema de `datos_extraidos` SOLO con los nombres de campo (`{"consumo_mensual_kwh": null}`) — **sin ninguna descripción de unidad ni periodo**. El modelo infiere del NOMBRE del campo ("mensual", "kwh") que debe convertir lo que el cliente dijo a esa forma — y lo hace **en silencio, sin verificación posterior**. Esto es exactamente lo que pasó en el incidente real: "6000 bimestral" → el modelo escribió "3000", una conversión correcta esa vez, pero sin ninguna garantía de que siempre lo sea.

`modules/orchestrator.js::_manejarWorkflow()` toma `datos_extraidos[nodo.campo]` y lo usa DIRECTAMENTE como la respuesta del nodo — ninguna validación de rango, unidad o periodo.

`mapearCapturedFieldsAInfoTecnica()` (`modules/cotizaciones.js`) confía ciegamente en que `consumo_mensual_kwh` YA es mensual — lo multiplica × 12 sin ninguna verificación.

### El hallazgo que cambió el diseño

**`modules/recibo-cfe.js` YA resuelve esto correctamente — pero solo para fotos.** Cuando un cliente sube una foto de su recibo, el módulo extrae `periodo_inicio`/`periodo_fin` REALES del documento, calcula un factor de conversión exacto (`30 / díasDelPeriodo`) y nunca asume "÷2" a ciegas — está documentado explícitamente así desde 2026-08-10. El patrón correcto ya existía en el código; solo nunca se aplicó a la conversación de texto.

**Segundo hallazgo:** `frecuencia_recibo` ya es un campo configurado en `personality.campos_requeridos` de Nort Energy — el modelo YA lo extrae (confirmado capturado como `"bimestral"` en la prueba real de Roberto Gzz) — pero **nada en el código lo consulta jamás**. No lo descarté ni dupliqué: lo reutilizo como señal de respaldo (ver Fase B).

### Esquema actual (antes de proponer nada)

`workflow_sessions.captured_fields` es `jsonb` — sin esquema fijo. **No hizo falta ninguna columna ni migración nueva** — toda la Fase B se construye sobre claves que ya caben en ese jsonb.

---

## FASE B — Interpretación determinista

Nuevo módulo puro `modules/consumo-electrico.js::interpretarConsumoDeclarado()`. El modelo ya NO convierte nada — reporta la cifra CRUDA (`datos_consumo_declarado: {valor, unidad, periodo, aproximado}`, nuevo campo del schema, mismo patrón que `datos_contacto`) y el código decide:

| Entrada | Salida |
|---|---|
| kWh + mensual | Se usa tal cual |
| kWh + bimestral | ÷2 (regla explícita y documentada — único caso de conversión permitido) |
| kWh + periodo desconocido | **Pide aclaración** — nunca asume |
| MXN + cualquier periodo | Se guarda como `importe_promedio_recibo` — **nunca se convierte a kWh** (no hay datos tarifarios verificables) |
| Sin unidad | **Pide aclaración de unidad** — nunca adivina kWh vs. pesos |
| `frecuencia_recibo` ya capturado y el cliente no repitió el periodo | Se usa como respaldo (reutilizado, no un campo nuevo) |

---

## FASE C — Integración

- **Extracción:** `prompt-builder.js` (nuevo campo del schema) + `openai-provider.js::normalizarOutput()` (nueva función `normalizarDatosConsumoDeclarado()`, valida tipo/catálogo, descarta cualquier valor fuera de lo esperado).
- **Workflow:** `modules/orchestrator.js::_manejarWorkflow()` — en el turno donde el nodo activo es `consumo_mensual_kwh` o `importe_promedio_recibo`, se interpreta de forma determinista ANTES de llamar a `avanzar()`. Si es ambiguo, se pide aclaración y el nodo **conserva su estado** (mismo mecanismo ya usado para el "acuse ambiguo"). Si el cliente contestó con el OTRO campo de consumo, se pre-guarda para cuando se necesite y se vuelve a pedir el dato de ESTE nodo — nunca se inventa una conversión pesos→kWh.
- **`validarRequisitosTecnicos()`:** **sin ningún cambio** — sigue verificando presencia/validez de `captured_fields`, que ahora llegan ya depurados por el nuevo mecanismo. La compatibilidad es automática.
- **WorkflowEngine:** **no se tocó.** El punto de intercepción vive enteramente en el Orchestrator (mismo criterio ya usado para el acuse ambiguo) — no hizo falta ningún cambio al Core congelado.

### Límite conocido, no resuelto aquí
`_avanzarSaltandoRespondidos()` (auto-avance de nodos cuando el cliente ya dio el dato antes de que se le pregunte) **no pasa por este nuevo intérprete** — sigue usando `datos_extraidos` directamente. Si un cliente menciona su consumo de forma ambigua ANTES de llegar al nodo dedicado (ej. en el primer mensaje), ese caso específico no queda cubierto. El incidente real (Roberto Gzz) ocurrió en el nodo dedicado, que sí queda cubierto. Extender el auto-avance es un cambio más amplio (afecta todos los campos, no solo consumo) — lo señalo en vez de ampliar el alcance sin autorización.

---

## Hallazgo durante la implementación (corregido antes de entregar)

Al construir `normalizarOutput()`, encontré que **mi propio campo nuevo (`datos_consumo_declarado`) se habría perdido en silencio** — exactamente el mismo patrón que causó el Bug B original con `datos_contacto`. `normalizarOutput()` nunca lo incluía en su objeto de retorno. Lo corregí antes de terminar, y actualicé la prueba de contrato existente (la que detecta pérdidas silenciosas futuras) para que también lo cubra — la prueba confirmó el problema y confirma la corrección.

---

## FASE D — Pruebas (10 escenarios + hallazgos adicionales)

**`__tests__/consumo-electrico.test.js`** (22 pruebas, nivel función pura):
1. «$3,000 bimestrales» → `importe_promedio_recibo` = 1500.
2. «3,000 kWh mensuales» → `consumo_mensual_kwh` = 3000, sin conversión.
3. «1,500 kWh» sin periodo → pide aclaración (y variante: con `frecuencia_recibo` de respaldo, no pregunta de nuevo).
4. «Aproximadamente $2,000» sin periodo → pide aclaración.
5. «2,400 kWh cada dos meses» → 1200.
6. Valor sin unidad → pide aclaración de unidad (nunca adivina).
7. Valores negativos/cero/no-numéricos → tratados como "nada declarado", nunca lanzan.
8. Sin dato declarado este turno → no interpreta nada (compatible con datos históricos).
9. Función pura, sin acceso a datos de empresa — nada que aislar a este nivel.
10. Consumo claro y completo → se interpreta sin pedir aclaración (no se vuelve un interrogatorio).

**`__tests__/orchestrator.test.js`** (+7 pruebas de integración): reproducción exacta del incidente real (confirma que gana el valor determinista, NUNCA el que el modelo haya podido inventar), el caso de contestar con el campo equivocado, aclaración específica para importe vs. kWh, compatibilidad cuando el modelo no manda el campo nuevo, y un valor que contradice uno anterior en la misma sesión (gana el turno nuevo, interpretado de forma determinista).

**`__tests__/openai-provider.test.js`** (+6 pruebas): valida que `normalizarOutput()` nunca deja pasar una unidad o periodo fuera del catálogo controlado.

**Resultado global: 2603/2603, 130 suites, 0 regresiones.**

---

## Riesgos de compatibilidad

- **Sesiones ya en curso** (iniciadas antes de este cambio): si el modelo de un turno anterior ya guardó un `consumo_mensual_kwh` numérico en `captured_fields`, ese valor se sigue respetando tal cual — nunca se re-valida retroactivamente.
- **Gap de auto-avance** documentado arriba, no resuelto.
- **El modelo podría, en teoría, seguir llenando `datos_extraidos.consumo_mensual_kwh` directamente además de `datos_consumo_declarado`** — mi cambio hace que el valor determinista SIEMPRE gane sobre `datos_extraidos` para estos 2 campos específicamente, así que esto no representa un riesgo real, solo lo señalo como parte de la auditoría.

## Plan de despliegue (para tu aprobación — nada desplegado)
1. Commit de los 8 archivos listados.
2. Push + verificación de Render.
3. Validación sugerida (sin datos comerciales reales): un mensaje de prueba con una cifra bimestral explícita debe avanzar con el valor ya dividido; uno sin periodo debe generar una pregunta de aclaración, nunca una cotización.

## Procedimiento de reversión
Revert de un solo commit, sin migración (confirmado: ningún cambio de esquema). Restaura el comportamiento anterior (incluyendo la dependencia total en la conversión silenciosa del modelo).

---

**No hice push ni despliegue.** No se tocaron fórmulas solares, mensajería compartida ni reglas comerciales fuera de este alcance. Ningún punto de esta implementación requirió migración ni cambio de arquitectura — lo confirmo explícitamente, como pediste verificar antes de continuar.
