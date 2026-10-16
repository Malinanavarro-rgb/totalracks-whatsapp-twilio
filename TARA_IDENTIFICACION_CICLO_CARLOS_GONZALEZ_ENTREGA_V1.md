# TARA Matrix™ — Corrección del incidente "Carlos González" / Nort Energy
### Ciclo de identificación + fuente única + no-reinicio de workflows + requisitos técnicos independientes
**Fecha:** 2026-10-16 · **Estado:** Implementado y probado localmente · **NO desplegado** (push/deploy pendientes de tu autorización)

---

## 1. Causa raíz (confirmada, no hipótesis)

Dos bugs independientes, ambos reales y verificados contra el código y contra datos de producción:

**Bug B — `adapters/ai/openai-provider.js::normalizarOutput()`** construía el `AIOutput` con una lista fija de campos que **no incluía `datos_contacto`** — el objeto literal de retorno simplemente no lo mencionaba. Cada llamada al modelo descartaba en silencio la identificación que el modelo sí extraía. Verificado con `SELECT count(*) FROM clientes WHERE motivo_consulta IS NOT NULL` = **0 en toda la plataforma**, desde que el campo existe.

**Bug A — `modules/orchestrator.js::procesarMensaje()`, paso 9** — el bloque que pregunta por el dato de identificación faltante sobreescribía `aiOutput.respuesta_texto` **incondicionalmente**, incluso cuando el paso 8 (WorkflowEngine) ya había fijado la pregunta real del nodo activo. Esto desalineaba lo que el cliente veía de lo que el workflow creía haber preguntado, y esa desalineación es la que corrompía `captured_fields` turno a turno — exactamente el patrón observado en la sesión real de Carlos González (`workflow_sessions.id = 230718f7-...`).

Ninguno de los dos bugs es exclusivo de Nort Energy — ambos son de plataforma.

---

## 2. Qué se implementó (alcance exacto)

### 2.1 Bug B — `datos_contacto` ya no se descarta
- `adapters/ai/openai-provider.js`: `normalizarOutput()` agrega `datos_contacto: normalizarDatosContacto(data.datos_contacto)` — nueva función que solo acepta `{nombre, motivo}` como strings, descarta cualquier otro tipo (nunca reenvía el objeto crudo del modelo).
- `INTENCIONES_VALIDAS` ahora incluye `solicitud_visita_tecnica` (estaba en el schema de `prompt-builder.js` pero no en esta lista — se normalizaba a `consulta_general` sin que nadie lo supiera). Las otras 6 intenciones no se tocaron.
- `adapters/ai/mock-provider.js`: agrega `datos_contacto: null` explícito al contrato, para que el mock y el provider real tengan la misma forma.
- Prueba de contrato nueva (`__tests__/openai-provider.test.js`) que compara los campos estructurados del schema real (`prompt-builder.js`) contra lo que `normalizarOutput()` garantiza — si se agrega un campo nuevo al schema y el normalizador lo olvida, esta prueba falla antes de que se repita "0 filas en producción durante meses".

### 2.2 Bug A — el paso 9 ya no pisa una respuesta ya resuelta
`procesarMensaje()` ahora rastrea `respuestaYaResuelta` (se activa si el workflow respondió en el paso 8, o si una acción de agenda generó texto real en el paso 9). La pregunta de identificación faltante **solo** reemplaza el texto cuando nadie más ya le respondió al cliente este turno. Bloquear la acción comercial (filtrar `accionesAutorizadas`) sigue siendo incondicional — eso no cambió, solo el TEXTO que se muestra.

### 2.3 Fuente única de identificación
`_resolverIdentificacion(clienteRaw, datosContacto, capturedFields)` ahora acepta un tercer argumento opcional: los `captured_fields` de la sesión de workflow. Un nombre capturado por el nodo `preguntar_nombre` de un workflow cuenta exactamente igual que uno dicho en conversación libre — misma validación (`_validarDatoContacto`), mismo destino de persistencia. Precedencia: dato de este turno (conversación libre) > dato de workflow > dato ya persistido.

En `_finalizarWorkflow`, la identificación resuelta con esta fuente ampliada se **persiste de inmediato** vía `_actualizarIdentificacion` (antes de decidir si la acción corre), para que un nombre que solo vivía en `captured_fields` no se pierda aunque la acción siga bloqueada por falta de motivo. La llamada posterior (paso 11.5) es redundante pero segura — ambas pasan por la misma función idempotente, nunca hay dos fuentes de verdad.

### 2.4 No reiniciar workflows
Cuando `_finalizarWorkflow` bloquea por identificación incompleta (o por datos técnicos incompletos, ver 2.5), **ya no llama a `iniciarSesion()`**. Antes, esto reiniciaba el workflow a su nodo inicial, descartando todo el progreso técnico real ya capturado. Ahora la sesión se deja tal cual (`status: 'completado'`, `captured_fields` intactos) y solo se pide el dato que falta.

**Límite conocido, documentado, no resuelto aquí:** no existe hoy un mecanismo para retomar automáticamente la acción bloqueada una vez que el cliente completa el dato faltante, sin tocar WorkflowEngine (que está congelado). El cliente necesita volver a manifestar intención de cotizar en un turno posterior. Diseñar una reanudación automática segura (sin riesgo de reactivar una sesión vieja indebidamente) requiere un mecanismo nuevo — te lo presento como propuesta separada si quieres que lo resolvamos.

### 2.5 Requisitos técnicos completos (tu "observación adicional")
Nueva verificación, **independiente** de la identificación: `ejecutar_motor_ingenieria` (registrado en `crearOrchestrator`, zona de wiring — no se tocó la clase `Orchestrator`) ahora exige que `ubicacion`, `consumo_mensual_kwh`, `importe_promedio_recibo` y `pct_cobertura_deseado` estén presentes en `captured_fields` antes de llamar a `correrCotizacionDesdeWorkflow`. Si falta alguno, devuelve `{tipo:'faltan_datos', campos, motivo:'tecnico'}` — mismo contrato que ya usa `agendar_cita_con_horario_solicitado`, reutilizado tal cual (ninguna cotización ni cálculo se inserta en ese caso).

`tipo_alimentacion` y `voltaje_sitio` quedan **fuera** de este requisito a propósito: sus propios nodos dicen explícitamente "si no lo sabes, no hay problema" y el motor ya los trata como opcionales con default — no es una regla nueva, es respetar la que ya existía.

---

## 3. Lo que NO se implementó (detenido deliberadamente, per tu instrucción)

**Validación semántica de nodos** ("preguntar_nombre no debe aceptar 'Es para mi casa'", "Carlos González no debe aceptarse como ubicación"). La causa raíz de esto en el incidente real fue el desajuste de texto (Bug A) — una vez corregido, el mecanismo que producía esas capturas incorrectas ya no existe para conversaciones nuevas. Agregar validación de **contenido** por tipo de campo (heurísticas de "esto no parece un nombre") es una capacidad nueva, no trivial, con riesgo real de rechazar respuestas legítimas — exactamente el tipo de cambio que tu autorización pide que detenga y proponga aparte. No lo implementé. Si quieres que lo diseñemos, es un siguiente paso independiente.

---

## 4. Archivos modificados

| Archivo | Cambio |
|---|---|
| `adapters/ai/openai-provider.js` | `normalizarOutput()` incluye `datos_contacto`; `INTENCIONES_VALIDAS` +1 valor |
| `adapters/ai/mock-provider.js` | agrega `datos_contacto: null` al contrato |
| `modules/orchestrator.js` | `_resolverIdentificacion` (3er argumento), paso 9 (precedencia de texto), `_finalizarWorkflow` (persistencia inmediata + no-reinicio + etiqueta `motivo`), `_preguntaPorDatoFaltante` (+4 preguntas técnicas), nueva `_camposTecnicosFaltantes`/`CAMPOS_TECNICOS_REQUERIDOS_COTIZACION`, handler `ejecutar_motor_ingenieria` en `crearOrchestrator` |
| `__tests__/orchestrator.test.js` | 1 test existente corregido (comportamiento deliberadamente distinto), 17 tests nuevos |
| `__tests__/openai-provider.test.js` | **nuevo** — 12 tests (Bug B + sync de intenciones + contrato anti-regresión) |

No se tocó: `WorkflowEngine`, `ActionRunner` (clase), `modules/identificacion-contacto.js`, `modules/cotizaciones.js`, ningún esquema de base de datos, ninguna regla de negocio existente de agenda.

---

## 5. Pruebas ejecutadas

```
Test Suites: 125 passed, 125 total
Tests:       2523 passed, 2523 total
```

Suite completa del proyecto, cero regresiones. De los tuyos 10 puntos requeridos:

| # | Requisito | Cubierto por |
|---|---|---|
| 1 | Nombre capturado y persistido | "fuente única" — test "nombre capturado SOLO por el workflow... `actualizarIdentificacion` llamado con Carlos González" |
| 2 | Motivo capturado y persistido | `openai-provider.test.js` (Bug B) + tests de persistencia existentes |
| 3 | Respuestas del workflow nunca sobreescritas | "Bug A" — test con workflow activo + acción bloqueada simultánea |
| 4 | Respuesta incorrecta no avanza el nodo | **No implementado** — ver sección 3 |
| 5 | Identificación completa permite continuar | tests preexistentes "nodo final CON identificación completa" |
| 6 | Workflow incompleto nunca genera cotizaciones | "REPRODUCCIÓN DEL INCIDENTE" (identificación) + nuevo test "tecnico" (datos técnicos) |
| 7 | Workflow completo preserva progreso si falta identificación | "NO reabre la sesión" |
| 8 | No duplica cotizaciones | cubierto por la guarda de idempotencia ya existente (Prioridad 5, incidente 83) — sin cambios aquí |
| 9 | No mezcla datos entre empresas | `puedeEjecutarseAccionComercial` no se tocó — test de aislamiento multiempresa preexistente sigue vigente |
| 10 | Conversaciones generales siguen funcionando | tests preexistentes "Caso D" y "cliente que no quiere dar su nombre" |

---

## 6. Riesgos restantes

- **Sesiones ya corrompidas antes de este fix** (ej. la sesión real de Carlos González) quedan con `captured_fields` mezclados — este fix no repara datos históricos, solo evita que vuelva a pasar.
- **Reanudación no automática** tras completar identificación (ver 2.4) — gap de UX conocido, no resuelto.
- **Validación semántica de nodos** no implementada (ver sección 3) — un escenario de respuesta fuera de orden todavía puede producir una captura incorrecta, aunque el mecanismo que lo disparó en el incidente real (Bug A) ya está cerrado.

---

## 7. Plan de despliegue (cuando autorices)

1. Confirmar rama y diff exacto antes de push (igual que en 183e432).
2. Push a main, verificar en Render Deploys tab que el commit activo coincide.
3. `/health` + verificación de que no hay errores de ejecución.
4. **No** se requiere migración — ningún cambio de esquema.
5. Validación controlada (no con datos reales de Nort Energy) antes de cualquier prueba con un cliente real.

## 8. Plan de reversión

Revert de un solo commit (sin dependencias de migración) — restaura el comportamiento anterior íntegro, incluyendo el bug del ciclo. Dado que el bug ya está activo en producción hace tiempo (no es una regresión nueva), revertir no introduce un problema nuevo, solo mantiene el existente.

---

**No se hizo push ni se desplegó nada.** Quedo a la espera de tu revisión antes de llevar esto a producción.
