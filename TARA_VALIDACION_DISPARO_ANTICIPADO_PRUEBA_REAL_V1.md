# TARA Matrix™ — Análisis forense del evento "cotización de ingeniería disparada anticipadamente"
### Prueba real de WhatsApp, cliente 177, post-despliegue 6367a98
**Fecha:** 2026-10-17 · **Solo análisis — sin cambios de código, despliegues ni eliminación de registros**

---

## 1. Estado del sistema justo antes del disparo (03:16:18 UTC)

Reconstruido a partir de `conversaciones` (secuencia exacta de preguntas/respuestas, cada una coincide con el siguiente nodo real, sin saltos) + el `datos_entrada` real guardado en el cálculo (confirma la reconstrucción). **No se usó el estado actual del cliente** — el estado actual incluye datos de turnos posteriores (tipo_alimentacion, voltaje_sitio) que todavía no existían en este momento.

| Dato | Valor en el momento del disparo | Naturaleza |
|---|---|---|
| Identificación persistida (`clientes.nombre`) | "Roberto Gzz" | **Capturado real** (turno 2, "roberto gzz") |
| Motivo de consulta (`clientes.motivo_consulta`) | "cotizar paneles solares" | **Capturado real** (turno 1, datos_contacto del primer mensaje) |
| `ubicacion` | "en mty" | **Capturado real**, texto crudo — nunca se normalizó a "Monterrey, Nuevo León" |
| `consumo_mensual_kwh` | "3000" | **Capturado real**, derivado por el modelo de "6000 bimestral" (conversión bimestral→mensual) |
| `importe_promedio_recibo` | "6000" | **Capturado real** (turno 5, "6000 pesos") |
| `pct_cobertura_deseado` | "90" | **Capturado real**, EN ESE MISMO TURNO ("si 90%") — el que dispara la verificación |
| `tipo_alimentacion` | **ausente** | Todavía no capturado — el nodo correspondiente no se había alcanzado |
| `voltaje_sitio` | **ausente** | Todavía no capturado |
| `captured_fields` completo reconstruido | `{nombre, ubicacion:"en mty", consumo_mensual_kwh:"3000", importe_promedio_recibo:"6000", pct_cobertura_deseado:"90"}` (posiblemente + `ciudad`/`frecuencia_recibo`, campos auxiliares no ligados a ningún nodo — no puedo precisar en qué turno exacto se agregaron sin un snapshot histórico, que el esquema actual no guarda) | — |

**Ningún valor fue "predeterminado"** (no se usó el default de 90% por afirmación ambigua — el cliente escribió el número explícitamente) **ni "calculado"** (el motor corre DESPUÉS de este punto — ningún resultado de ingeniería existía todavía).

## 2. Validaciones — qué puedo demostrar y qué no

**No existen logs individuales de `puedeEjecutarseAccionComercial()` ni de `camposTecnicosFaltantes()`** — el bloque de disparo anticipado (`server.js`) no escribe a `decision_logs`/`AuditLogger` en ningún punto de su propia decisión (confirmado: no hay ninguna entrada `tipo:"accion"` con `ejecutar_motor_ingenieria` cerca de las 03:16:18, a diferencia de las 03:17:06, donde SÍ aparece una — esa es la de camino B, ver punto 3). Lo único que registra este camino es la línea de consola que tú capturaste de los logs crudos de Render ("cotización de ingeniería disparada anticipadamente"), que no es un log estructurado ni persistente en Supabase.

**Lo que SÍ puedo afirmar con confianza, por inferencia lógica directa del código (no por log):** dado que `correrCotizacionDesdeWorkflow` efectivamente corrió (hay una cotización real, id 85), y el código tiene la forma `if (autorizacion.autorizada) { if (camposTecnicosFaltantes(capturedFields).length === 0) { ...llamar... } }`, ambas condiciones necesariamente devolvieron verdadero/vacío en ese momento. Con los datos reconstruidos arriba (identificación completa, `ubicacion`+`consumo_mensual_kwh`+`pct_cobertura_deseado` presentes), esto es exactamente lo que las funciones reales producirían — lo confirmé ejecutando ambas funciones localmente con esos datos exactos: `puedeEjecutarseAccionComercial` → `autorizada:true`; `camposTecnicosFaltantes` → `[]`. Esto demuestra que el COMPORTAMIENTO es coherente con el código, pero no es un log directo del momento real.

## 3. Cotización y cálculo

| | |
|---|---|
| Cotización creada | **id 85**, `estado: "borrador"`, creada 03:16:16 |
| Cálculo de ingeniería | **id `192a6cfe-...`**, `estado_calculo: "bloqueado"` |
| Oportunidad asociada | **id 70** — la MISMA del incidente anterior (Alberto Gzz) — se reutilizó por ser una oportunidad abierta existente del mismo cliente, no se creó una nueva |
| Alertas técnicas | 4 de severidad `bloqueo`: `potencia_requerida_error` ("Falta HSP"), `hsp_faltante` ("no se pudo resolver la ubicación"), `ficha_tecnica_incompleta`, `red_desconocida` (tipo_alimentación/voltaje aún no capturados) |
| Datos usados (`datos_entrada`) | `ubicacion:"en mty"`, `consumoMensualKwh:3000`, `importePromedioRecibo:6000`, `pctCoberturaDeseado:0.9`, `voltajeSitio:null`, `tipoAlimentacion:null` — coincide exactamente con mi reconstrucción del punto 1 |
| Resultado del predimensionamiento | **Ninguno** — el cálculo quedó bloqueado antes de producir un resultado válido |
| ¿Por qué `hsp_faltante`? | Confirmé que **"Monterrey, Nuevo León" sí existe** en el catálogo de irradiación regional — el problema es que `_normalizarUbicacion` busca la palabra "monterrey" dentro del texto libre, y "en mty" (abreviatura informal) nunca la contiene. No es un defecto de esta corrección — es un límite ya existente del emparejamiento de texto libre. |
| ¿Duplicados? | **No se creó una segunda cotización.** A las 03:17:06, cuando el workflow completó su nodo final (`preguntar_voltaje`), el camino B (`_finalizarWorkflow`) SÍ intentó `ejecutar_motor_ingenieria` de nuevo — esto queda confirmado por una entrada real en `decision_logs` (`tipo:"accion"`, `tipo_accion:"ejecutar_motor_ingenieria"`, `exito:true`, 03:17:06.572). La guarda de idempotencia (ventana de 2 minutos, Prioridad 5 del incidente 83) interceptó esta segunda llamada y devolvió el cálculo 192a6cfe ya existente en vez de crear uno nuevo — funcionó correctamente. |

## 4. Conversación después del disparo

- La siguiente pregunta de Lucía fue la correcta (voltaje) — **no repitió ningún dato ya capturado**.
- **Hallazgo nuevo, no relacionado con el disparo anticipado**: el mensaje del cliente inmediatamente después de "¿monofásica, bifásica o trifásica?" fue *"me puedes generar una pre cotizacion"* — un mensaje fuera de tema, no una respuesta real. El workflow lo capturó de todas formas como si fuera la respuesta de `tipo_alimentacion` (`captured_fields.tipo_alimentacion = "me puedes generar una pre cotizacion"`, dato basura) y avanzó igual. Esto es exactamente el vacío de "validación semántica de nodos" que ya habíamos documentado como NO implementado en la corrección anterior — ahora lo vi ocurrir en vivo. No lo corregí (no estaba autorizado en este cambio).
- **Resultado prematuro informado al cliente**: en el turno final ("220v"), la respuesta que recibió el cliente fue: *"Con el consumo de 3000 kWh al mes... estimamos que necesitarías un sistema de aproximadamente 10 kWp"* — **este número no viene del cálculo real** (que quedó bloqueado, sin resultado). Es una estimación que el modelo generó por su cuenta en el texto libre de esa respuesta, independiente del motor de ingeniería real. Es un hallazgo nuevo y separado — el modelo "inventando" una cifra técnica plausible — no algo introducido por esta corrección, pero sí relevante para la confianza en las respuestas de Lucía.
- **Mensajes fuera del historial principal**: dado que el cálculo quedó `bloqueado`, el código de `correrCotizacionDesdeWorkflow` debería haber enviado el mensaje proactivo de seguimiento ("Con los datos que me diste, tu proyecto necesita revisión de un especialista...") — el mismo patrón del incidente Alberto Gzz. **No puedo confirmar esto desde ningún log** (confirma el vacío de trazabilidad ya documentado) — necesito que confirmes directamente desde el hilo real de WhatsApp si ese mensaje llegó entre las 03:16:18 y las 03:16:25 aproximadamente.

## 5. Tabla cronológica

| Mensaje recibido | Nodo anterior | Datos capturados este turno | Nodo siguiente | Acción ejecutada | Respuesta enviada |
|---|---|---|---|---|---|
| "Hola, quiero cotizar paneles solares" | (inicio) | motivo_consulta (vía datos_contacto, persistido en CRM) | preguntar_nombre | — | "...¿Con quién tengo el gusto?" |
| "roberto gzz" | preguntar_nombre | nombre="Roberto Gzz" | preguntar_ubicacion | crear_oportunidad (op. 70) | "Gracias, Roberto. ¿En qué ciudad...?" |
| "en mty" | preguntar_ubicacion | ubicacion="en mty" | preguntar_consumo_kwh | crear_oportunidad | "¿Cuántos kWh consumes...?" |
| "6000 bimestral" | preguntar_consumo_kwh | consumo_mensual_kwh="3000" | preguntar_importe_recibo | crear_oportunidad | "¿Cuál es el importe promedio...?" |
| "6000 pesos" | preguntar_importe_recibo | importe_promedio_recibo="6000" | preguntar_cobertura | crear_oportunidad | "¿Qué porcentaje...?" |
| **"si 90%"** | preguntar_cobertura | **pct_cobertura_deseado="90"** | preguntar_tipo_alimentacion | crear_oportunidad **+ `ejecutar_motor_ingenieria` vía disparo anticipado (camino C, sin log estructurado)** → cotización 85 / cálculo 192a6cfe (bloqueado) | "¿Tu instalación eléctrica es monofásica...?" **(+ posible mensaje proactivo "revisión de especialista", no confirmable por log)** |
| "me puedes generar una pre cotizacion" | preguntar_tipo_alimentacion | tipo_alimentacion="me puedes generar una pre cotizacion" (dato basura — mensaje fuera de tema capturado igual) | preguntar_voltaje | crear_oportunidad | "¿Sabes si tu servicio es 110/127V o 220V?" |
| "220v" | preguntar_voltaje | voltaje_sitio="220" | (fin — completado) | `ejecutar_motor_ingenieria` vía camino B (logueado, idempotencia activada → reutiliza cálculo 192a6cfe, no crea otro) + crear_oportunidad | Estimación libre del modelo ("~10 kWp") — no del cálculo real |

## Conclusión

**B — Ejecución prematura, pero NO por una falla de la corrección que acabamos de desplegar.**

El gate que implementamos (`puedeEjecutarseAccionComercial` + `camposTecnicosFaltantes`) funcionó exactamente como se diseñó: ambas condiciones se cumplieron con datos REALES (no vacíos, a diferencia del incidente Alberto Gzz) antes de permitir la ejecución. El problema expuesto es distinto y preexistente: el disparo anticipado se activa por la sola presencia de los campos (no por su validez/resolución real — "en mty" nunca iba a resolver a un HSP válido) y por una intención (`solicitud_cotizacion`) que el modelo repite en casi todos los turnos de esta conversación, no por una solicitud explícita puntual del cliente en ese momento. El resultado fue una cotización/cálculo real pero `bloqueado` — no uno con datos completamente vacíos como antes, pero tampoco uno útil.

No implementé ningún cambio — esto requiere tu decisión sobre si el disparo anticipado debe, además, verificar que la ubicación resuelva a un HSP real antes de disparar, lo cual es una extensión nueva, no parte de la corrección ya autorizada.

**No declaro la prueba exitosa.** Necesito tu confirmación sobre el mensaje proactivo (punto 4) antes de continuar con cualquier otro paso.
