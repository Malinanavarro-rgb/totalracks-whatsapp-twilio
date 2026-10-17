# TARA Matrix™ — Corrección del incidente "Alberto Gzz" (disparo anticipado sin requisitos técnicos)
**Fecha:** 2026-10-17 · **Estado:** Implementado y probado localmente · **NO desplegado**

---

## 1. Corrección mínima implementada

`server.js`, bloque de disparo anticipado: se envuelve la llamada a `correrCotizacionDesdeWorkflow` con `if (camposTecnicosFaltantes(capturedFields).length === 0)`. La función es la MISMA que ya protege los caminos A/B — se importa desde `modules/orchestrator.js`, nunca se copia ni se reimplementa. El gate de identificación (`puedeEjecutarseAccionComercial`) sigue exactamente igual, sin tocarse — ambas condiciones son independientes y ambas deben cumplirse, como ya pediste.

**Diff exacto** (1 archivo, 17 inserciones, 5 eliminaciones):
```diff
-const { crearOrchestrator, resolverIdentificacion } = require('./modules/orchestrator');
+const { crearOrchestrator, resolverIdentificacion, camposTecnicosFaltantes } = require('./modules/orchestrator');
...
-            const calculo = await correrCotizacionDesdeWorkflow(supabaseServicio, {
-              companyId: message.company_id, clienteId: cliente.id, capturedFields, destinatario: message.from,
-            });
-            if (calculo) yaRespondioIngenieria = true;
+            if (camposTecnicosFaltantes(capturedFields).length === 0) {
+              const calculo = await correrCotizacionDesdeWorkflow(supabaseServicio, {
+                companyId: message.company_id, clienteId: cliente.id, capturedFields, destinatario: message.from,
+              });
+              if (calculo) yaRespondioIngenieria = true;
+            }
```

## 2. Revisión de los 3 caminos — resultado

Grep exhaustivo de todos los call sites reales de `correrCotizacionDesdeWorkflow` en el repositorio. Solo existen **2 caminos de producción**:

| Camino | Ubicación | Validación de identificación | Validación técnica |
|---|---|---|---|
| **A** — conversación libre | `modules/orchestrator.js` paso 9, vía ActionRunner | ✅ (ya existía) | ✅ (agregado 2026-10-16) |
| **B** — nodo final de workflow | `modules/orchestrator.js::_finalizarWorkflow`, vía ActionRunner | ✅ (ya existía) | ✅ (agregado 2026-10-16) |
| **C** — disparo anticipado | `server.js` líneas 628-657 | ✅ (ya existía, incidente 83) | ✅ **(agregado ahora)** |

Los únicos otros call sites (`scripts/validar-*.js`, `scripts/generar-pdf-ejemplo.js`) son herramientas manuales de un solo uso invocadas por un desarrollador desde la terminal — mismo criterio ya aceptado para los 2 endpoints manuales del CRM, no son un "camino" de producción. **No encontré ningún cuarto camino.**

## 3. Pruebas (nuevo archivo `__tests__/disparo-anticipado-requisitos-tecnicos.test.js`, 6 pruebas)

Como `server.js` no tiene hoy ningún arnés de pruebas (ni `supertest` ni ninguna ruta HTTP probada), y construir uno ahora sería una expansión de alcance más allá de la corrección mínima que pediste, la prueba usa las MISMAS funciones reales y puras del bloque corregido (`camposTecnicosFaltantes`, `puedeEjecutarseAccionComercial`, `resolverIdentificacion`) replicando exactamente su cadena de condiciones — sin llamar nunca a `correrCotizacionDesdeWorkflow` de verdad (cero escrituras).

| Escenario | Resultado |
|---|---|
| **Reproducción exacta del incidente** (identificado + `capturedFields={nombre:'Alberto Gzz'}`) | NO se dispara (antes SÍ se disparaba — este es el fix) |
| Identificado, falta `pct_cobertura_deseado` | NO se dispara |
| Identificado, datos técnicos completos | SÍ se dispara (caso legítimo no se rompe) |
| Identificado, con `historial_consumo_kwh` (≥12 meses) en vez de `consumo_mensual_kwh` | SÍ se dispara (alternativa real del motor respetada) |
| Sin motivo (identificación incompleta), datos técnicos completos | NO se dispara (el gate de identificación se conserva) |
| Auditoría: `MOTORES` solo tiene `paneles_solares` | confirmado |

**Resultado global:** 2535/2535 pruebas, 127 suites, 0 regresiones.

## 4. Compatibilidad multiempresa (auditoría, punto 4)

- `correrCotizacionDesdeWorkflow` (línea 764 de `modules/cotizaciones.js`) hardcodea `industriaSlug: 'paneles_solares'` — **siempre**, sin excepción.
- `modules/motores-ingenieria/index.js::MOTORES` solo registra `paneles_solares` — ningún otro motor existe hoy.
- Consulté en vivo (solo lectura) `workflow_nodes` de **todas** las empresas: la acción `ejecutar_motor_ingenieria` aparece en exactamente 3 nodos, los 3 llamados `preguntar_voltaje`, de los 3 workflows clonados "Cotización directa — ingeniería solar" (Nort Energy y 2 empresas más con el mismo workflow). Ningún otro Industry Profile usa esta acción.
- **Conclusión:** `camposTecnicosFaltantes()` es seguro de aplicar universalmente dondequiera que aparezca el tipo de acción literal `ejecutar_motor_ingenieria`, porque hoy esa acción es, por construcción, exclusivamente solar. El fix no aplica ningún requisito solar a otra industria — simplemente nunca se activa fuera de ese contexto.

## 5. Mensajes y trazabilidad (punto 5 — documentado, nada implementado)

`_textoSeguimientoIngenieria()` se envía vía `enviarProactivoWhatsApp()` → `adapter.sendProactive()` (Twilio/Meta) — un **envío directo a la API del canal, sin ningún registro**: no inserta en `conversaciones`, no llama a `AuditLogger`. Esto NO es un gap nuevo de esta corrección — es una característica sistémica de **todo** mensaje "proactivo" en la plataforma. Confirmé exactamente 3 llamadores de `sendProactive`/`enviarProactivoWhatsApp` en todo el código: los recordatorios de citas (`modules/recordatorios.js`), este seguimiento de ingeniería (`modules/cotizaciones.js`), y un envío proactivo desde el panel (`server.js:1152`) — los 3 comparten el mismo vacío de trazabilidad.

**Riesgo documentado:** cualquier mensaje enviado por estos 3 caminos es invisible para quien revise `conversaciones` o `decision_logs` — como pasó aquí, donde el mensaje de "revisión de especialista" no aparecía en ningún lado hasta que lo reportaste tú directamente desde WhatsApp.

**Cómo evitarlo sin construir un sistema nuevo:** agregar una sola escritura a `decision_logs` (la tabla que YA existe y YA usa el flujo principal) dentro de `enviarProactivoWhatsApp()` mismo — un único punto, ya que las 3 llamadas pasan por adaptadores que podrían centralizarse ahí. No lo implementé — es un cambio que toca un componente compartido por recordatorios de citas también, y merece su propia autorización explícita, no colarlo dentro de esta corrección urgente.

## 6. Evidencia conservada

Verifiqué (solo lectura) que los 3 registros siguen exactamente como en el diagnóstico — nada se modificó ni se eliminó:

| Registro | Estado actual |
|---|---|
| `cotizaciones.id = 84` | `estado: "borrador"`, `calculo_ingenieria_id: 9dfe8908-...`, `oportunidad_id: 70` |
| `calculos_ingenieria.id = 9dfe8908-...` | `estado_calculo: "bloqueado"` (5 alertas de bloqueo, datos de entrada vacíos) |
| `oportunidades.id = 70` | `estado: "Nuevo"` |

**Relación:** la cotización 84 referencia al cálculo 9dfe8908 Y a la oportunidad 70 — los 3 son parte del mismo efecto secundario del bug, creados en la misma ventana de 2 segundos (02:45:30–02:45:33). La oportunidad 70 en sí es un efecto LEGÍTIMO de la identificación completa (no del bug) — pero quedó encadenada a una cotización que nunca debió crearse. Quedan intactos a la espera de tu decisión sobre qué hacer con ellos.

## 7. Riesgos pendientes

- La guarda de idempotencia (2 min) significa que si se reintenta la misma conversación pronto, el sistema seguiría devolviendo el cálculo 9dfe8908 (vacío) en vez de uno nuevo — relevante si decides limpiar y reintentar.
- El gap de trazabilidad de mensajes proactivos (punto 5) sigue sin resolver — afecta también a recordatorios de citas, no solo a este flujo.
- La validación semántica de nodos (del incidente anterior) sigue sin implementar.
- Sin reanudación automática tras completar identificación (gap ya documentado antes).

## 8. Plan de despliegue

1. Push a `main`, verificar Deploys tab en Render (commit exacto, no solo `/health`).
2. `/api/diagnostics` — confirmar 8/8 `ok`.
3. Repetir la prueba controlada exacta (mensaje 1 + mensaje 2) con el mismo contacto, confirmando que ya NO se crea una segunda cotización/cálculo y que no llega el mensaje de "revisión de especialista".

## 9. Procedimiento de reversión

Revert de un solo commit (sin migración) — restaura el comportamiento anterior (incluyendo el bug, ya activo en producción desde antes de esta sesión).

---

**No se hizo push ni despliegue.** Los registros de evidencia (cotización 84, cálculo 9dfe8908, oportunidad 70) siguen intactos. Quedo a la espera de tu autorización para el commit/push.
