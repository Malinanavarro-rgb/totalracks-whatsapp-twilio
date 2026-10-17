# TARA Matrix™ — Diagnóstico: escalamiento prematuro a "revisión de especialista"
### Prueba controlada de WhatsApp, Nort Energy, post-despliegue 8363132
**Fecha:** 2026-10-17 · **Estado:** Solo diagnóstico — **sin cambios de código, push, despliegue ni limpieza de registros**

---

## 1. Causa raíz (demostrada, no hipótesis)

**`server.js`, bloque "disparo anticipado" (líneas 592-651) llama a `correrCotizacionDesdeWorkflow()` directamente, sin pasar por el ActionRunner ni por el Orchestrator — y por lo tanto nunca llega a la nueva verificación de requisitos técnicos (`_camposTecnicosFaltantes`) que agregué el 2026-10-16.**

Ese bloque ya fue corregido para identificación en el incidente de la cotización 83 (verifica `puedeEjecutarseAccionComercial` antes de disparar), pero **nunca se actualizó para la nueva regla "identificación Y requisitos técnicos"** — porque esa regla nueva la agregué únicamente dentro del registro de `ejecutar_motor_ingenieria` en `ActionRunner` (`modules/orchestrator.js::crearOrchestrator()`), un lugar que este bloque de `server.js` no toca ni conoce.

Es exactamente el mismo patrón del incidente anterior ("3 caminos, una validación centralizada") — pero aplicado a un requisito que agregué DESPUÉS de cerrar los 3 caminos, y que nunca propagué al tercero.

### Evidencia (datos reales de la prueba, leídos en vivo de Supabase)

**`workflow_sessions`** (sesión real, activa):
```json
{
  "workflow_id": "e2a01519-...",  // Cotización directa — ingeniería solar
  "current_node": "preguntar_ubicacion",
  "status": "activo",
  "captured_fields": { "nombre": "Alberto Gzz" },
  "total_turnos": 1
}
```
El workflow avanzó CORRECTAMENTE del nodo `preguntar_nombre` a `preguntar_ubicacion` — el Bug A/fuente única siguen funcionando bien.

**`decision_logs`** (turno 2, "Con Alberto Gzz"):
- `ai_call`: intención `solicitud_cotizacion`, `acciones_count: 1`.
- `accion`: `crear_oportunidad`, `exito: true` — legítima, ya identificado (nombre+motivo), no es el bug.
- `channel_event` (mensaje_enviado): **"Gracias, Alberto. ¿En qué ciudad o municipio está la instalación?"** — esta es la respuesta CORRECTA del turno, generada por el Orchestrator. El mensaje de "revisión de especialista" **no aparece en ningún log de auditoría** — confirma que vino de un camino que no pasa por `AuditLogger`.

**`calculos_ingenieria`** (el cálculo que SÍ se creó, `id: 9dfe8908-...`):
```json
"datos_entrada": { "ubicacion": null, "consumoMensualKwh": null, "pctCoberturaDeseado": null, ... }  // TODO null
"estado_calculo": "bloqueado"
"alertas": [
  { "tipo": "potencia_requerida_error", "severidad": "bloqueo" },
  { "tipo": "consumo_faltante",         "severidad": "bloqueo" },
  { "tipo": "hsp_faltante",             "severidad": "bloqueo" },
  { "tipo": "ficha_tecnica_incompleta", "severidad": "bloqueo" },
  { "tipo": "red_desconocida",          "severidad": "bloqueo" }
]
```
El motor corrió con `capturedFields = { nombre: "Alberto Gzz" }` — **absolutamente ningún dato técnico**, porque `server.js` arma `capturedFields` desde `sesionActiva.captured_fields` (que en ese momento solo tenía el nombre) y nunca verifica que falten los demás antes de llamar al motor.

## 2. Respuestas directas a tus preguntas

| Pregunta | Respuesta |
|---|---|
| Intención/acciones por turno | Turno 1: `solicitud_cotizacion`, 1 acción propuesta (bloqueada, sin identificar). Turno 2: `solicitud_cotizacion`, 1 acción (`crear_oportunidad`, ejecutada — ya identificado) |
| Datos estructurados extraídos | Turno 2: solo `nombre: "Alberto Gzz"` — ningún otro campo técnico |
| Nombre/motivo persistidos | `clientes.nombre = "Alberto Gzz"`, `motivo_consulta = "cotizar paneles"` (fuente: `cliente`) — correctos |
| Nodo activo del workflow | `preguntar_ubicacion` — el workflow NO había llegado al nodo final |
| ¿Corrió `correrCotizacionDesdeWorkflow`? | **Sí** — vía el bloque "disparo anticipado" de `server.js`, no vía el workflow ni vía el Orchestrator |
| ¿Corrió el motor de ingeniería? | Sí, con 0 datos técnicos reales |
| ¿Alertas de `generarAlertas()`? | 5 alertas de bloqueo (ver arriba) |
| ¿Qué se creó? | `cotizaciones` (id 84, estado "borrador"), `calculos_ingenieria` (id 9dfe8908), `oportunidades` (id 70 — legítima). Cero tareas, cero citas |
| Componente que generó el mensaje de "especialista" | `modules/cotizaciones.js::_textoSeguimientoIngenieria('bloqueado')`, invocado dentro de `correrCotizacionDesdeWorkflow()`, enviado como mensaje PROACTIVO (`enviarProactivoWhatsApp`) — nunca pasa por `guardarConversacion` ni por `AuditLogger`, por eso no aparece en `conversaciones` ni en `decision_logs` |
| ¿Por qué no pidió el siguiente dato técnico? | El turno PRINCIPAL sí lo pidió correctamente ("¿En qué ciudad...?") — el problema es que el bloque de disparo anticipado, en PARALELO al turno normal, disparó el motor de ingeniería de forma prematura y mandó un segundo mensaje encima |

## 3. Componente exacto responsable

`server.js`, líneas 592-651 (comentario: *"Ingeniería y Cotización — disparo anticipado"*). Condición que disparó: intención `solicitud_cotizacion` + sesión de workflow activa + nodo con `ejecutar_motor_ingenieria` existe en el workflow + `current_node` todavía no es ese nodo + identificación válida (`puedeEjecutarseAccionComercial` autorizó). **No hay ninguna verificación de que `capturedFields` tenga los datos técnicos mínimos** antes de llamar a `correrCotizacionDesdeWorkflow` en la línea 642.

## 4. Efectos secundarios detectados

- `cotizaciones` id 84 (estado "borrador") y `calculos_ingenieria` id 9dfe8908 — ambos con datos vacíos, nunca deberían haberse creado todavía.
- `oportunidades` id 70 — creada legítimamente por la identificación válida (no es parte del bug).
- La guarda de idempotencia de 2 minutos (Prioridad 5, incidente 83) significa que si se reintenta la MISMA conversación dentro de 2 minutos, el sistema reutilizará este cálculo vacío en vez de crear uno nuevo — relevante para cualquier limpieza/reintento que planees.
- El workflow sigue `activo` en `preguntar_ubicacion` — no se reinició ni se perdió progreso (eso sigue funcionando bien).

## 5. Corrección mínima propuesta (NO implementada todavía)

Agregar la misma verificación de requisitos técnicos (`camposTecnicosFaltantes`, ya exportado desde `modules/orchestrator.js`) al bloque de disparo anticipado en `server.js`, inmediatamente después de la verificación de identificación (línea 634) y antes de llamar a `correrCotizacionDesdeWorkflow` (línea 642): si faltan campos, no disparar — se deja que el workflow siga su curso normal (que ya está pidiendo el dato correcto en el turno principal). Mismo criterio exacto que ya usa `agendar_cita_con_horario_solicitado` y el nuevo gate de `ejecutar_motor_ingenieria` — ningún mecanismo nuevo, ninguna regla de ingeniería alterada, solo cerrar el tercer camino que quedó sin la verificación nueva.

## 6. Pruebas de regresión necesarias

- Integración (extender `__tests__/integracion-identificacion-workflow.test.js`): reproducir exactamente esta conversación (nombre dado, workflow en nodo intermedio, identificación completa) y verificar que `correrCotizacionDesdeWorkflow` NO se llama mientras falten datos técnicos.
- Confirmar que el disparo anticipado SÍ sigue funcionando cuando los datos técnicos están completos (no romper el caso legítimo que originalmente motivó este bloque — "mándame la cotización" cuando ya se dieron todos los datos).
- Confirmar que la guarda de idempotencia no enmascare el comportamiento corregido en una prueba repetida.

## 7. Riesgos para otras empresas

Este bloque es agnóstico de industria (busca cualquier nodo con `ejecutar_motor_ingenieria`, no asume paneles solares) — **cualquier empresa que use un workflow con esa acción está expuesta al mismo patrón**: identificación completa + workflow a medio llenar + intención de cotizar repetida en un turno intermedio = cálculo prematuro con datos vacíos. Hoy esto aplica a los workflows de ingeniería solar vistos (Nort Energy y las otras empresas con el mismo workflow clonado).

---

**No se hizo ningún cambio de código, push, despliegue ni limpieza de registros.** Los datos de prueba (cotización 84, cálculo 9dfe8908, oportunidad 70) siguen intactos, a la espera de tu confirmación sobre qué hacer con ellos. Quedo a la espera de tu autorización para implementar la corrección mínima.
