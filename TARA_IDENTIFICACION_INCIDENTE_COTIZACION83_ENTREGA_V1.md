# Incidente cotización 83 (COT-2026-0021) — diagnóstico, corrección y entrega

**Fecha:** 2026-10-16
**Estado:** implementado y probado localmente. **Sin push, sin despliegue.**

---

## Nota de transparencia sobre el orden de los hechos

Tu autorización detallada (Prioridades 1-8) pide, en la Prioridad 2, **conservar** la cotización 83/COT-2026-0021, su cálculo de ingeniería y los registros de workflow como evidencia, antes de tocar nada.

Esos registros **ya los había borrado** en el turno anterior, en respuesta a tu "si" (confirmando limpieza + autorización de diagnóstico) que llegó antes de este mensaje detallado. No puedo revertir esa limpieza — los reporto aquí, completos, tal como quedaron documentados en el momento en que los encontré (ya los había transcrito antes de borrarlos):

```
cotizaciones.id: 83, folio: COT-2026-0021, estado: "borrador"
cliente_id: 177, company_id: 0affb234-3dc7-431f-862b-3230664962fb (Nort Energy)
calculo_ingenieria_id: 3e817ece-45ea-407b-8788-d5ae348607f3
created_at: 2026-10-16T21:53:46Z
subtotal/iva/total: null (nunca llegó a calcular precio — cálculo preliminar)
```
Workflow session asociada: `807e2ac5-18b1-44d8-8d00-32b892c618f8`, workflow "Cotización directa — ingeniería solar" (`e2a01519-e312-4d35-86a0-33d852a9becc`), `current_node: preguntar_nombre` al momento del incidente.

**Efectos secundarios verificados en su momento:** ningún PDF se envió (`pdf_url: null`), ningún mensaje proactivo salió al cliente con el cálculo (el `destinatario` real fue usado, pero `estado_calculo` no llegó a 'completo' — no había datos técnicos reales, solo "hola quiero cotizar paneles"), ninguna oportunidad nueva se creó (`oportunidades: []` en ese momento). El único efecto real fue la fila `borrador` en `cotizaciones` + su `calculos_ingenieria` asociado, ambos ya revertidos.

Los logs de Render del incidente real (que tú misma pegaste) quedan como evidencia en la conversación — los cito en la sección de causa raíz.

No voy a repetir este patrón: a partir de aquí, cualquier limpieza de datos de prueba espera tu confirmación explícita después de presentarte el hallazgo, nunca antes.

---

## PRIORIDAD 1 — Contención (resultado de la investigación, antes de tocar código)

1. **¿El disparo anticipado seguía habilitado en producción al momento de recibir tu autorización?** Sí — `origin/main` seguía en `fb272f4` (el commit que introdujo el gate original, con el hueco). Mi primer fix (commit `e9713b8`, caminos B y C) existía solo localmente, nunca desplegado. **Producción estuvo expuesta a este hueco exacto desde que se desplegó `fb272f4` hasta ahora** — no hay despliegue nuevo desde entonces (confirmaste que no autorizas push/despliegue todavía).
2. **¿Puede seguir generando cotizaciones sin identificación?** Sí, mientras no se despliegue ningún fix — el código en producción es el mismo que causó el incidente.
3. **Medida de contención más pequeña y reversible, si decides actuar antes de un despliegue completo:** envolver únicamente el bloque de "disparo anticipado" en `server.js` (líneas ~592-645) en una bandera de entorno, ej. `if (process.env.DISPARO_ANTICIPADO_INGENIERIA !== 'false') { ... }` — default sin cambio de comportamiento, se apaga cambiando una variable de entorno en Render **sin tocar código**. Esto requeriría de todos modos un reinicio del servicio (Render no relee variables de entorno sin reiniciar), así que no es "cero despliegue", pero sí es la intervención más chica posible. **No la implementé** — es una propuesta, a la espera de que decidas si la quieres en vez de (o antes que) el fix completo de abajo.
4. **¿Hay otros disparadores de acciones comerciales fuera de las validaciones?** Audité exhaustivamente (grep de `correrCotizacionDesdeWorkflow`, `crearOportunidadSiCorresponde`, `ActionRunner.ejecutar`, inserts directos a `oportunidades`/`cotizaciones`/`citas` en todo `server.js`/`modules/`/`scripts/`). Encontré exactamente los 3 caminos ya conocidos (A, B, C) más **2 endpoints humanos deliberadamente separados** que decidí NO tocar:
   - `POST /api/cotizaciones` (`requireAuth, requirePermiso('cotizaciones','crear')`) — creación manual desde el panel, por un empleado autenticado.
   - `POST /api/crm/clientes/:id/oportunidades` (`requireAuth, requirePermiso('crm','crear')`) — mismo criterio.

   Ambos son acciones de un **humano con sesión real**, no de TARA/el modelo — categóricamente distinto del problema que origina esta regla (la IA creando compromisos comerciales sin saber con quién habla). No los gateé — lo marco aquí explícitamente para que confirmes o corrijas mi criterio.

---

## PRIORIDAD 2 — Evidencia

Ver nota de transparencia arriba. Lo que puedo entregar: los datos exactos de los registros ya borrados (transcritos antes de borrarlos), y los logs de Render del incidente real que ya compartiste en el chat.

---

## Causa raíz

El gate original (commit `fb272f4`) solo se aplicaba en el **paso 9 de `procesarMensaje`** (conversación libre, sin workflow activo). Había 2 caminos más, ninguno pasaba por ahí:

- **Camino B** — `_finalizarWorkflow()`: cuando un nodo de workflow se completa, llama a `_ejecutarAcciones()` directamente, sin pasar por el filtro `accionesAutorizadas` del paso 9.
- **Camino C** — "disparo anticipado" en `server.js` (línea ~592): si el cliente expresa `solicitud_cotizacion` y hay un workflow activo con un nodo que dispara `ejecutar_motor_ingenieria`, llama a `correrCotizacionDesdeWorkflow()` **directo**, completamente fuera del Orchestrator.

El mensaje real "hola quiero cotizar paneles" activó el workflow "Cotización directa" (nodo 0, `preguntar_nombre`) Y, en el mismo turno, el camino C — porque la intención `solicitud_cotizacion` ya estaba presente, sin importar que el cliente no hubiera dado ningún dato técnico ni su nombre.

---

## Archivos modificados (esta entrega, Prioridades 3-5)

| Archivo | Cambio |
|---|---|
| `modules/identificacion-contacto.js` | +`ACCIONES_REQUIEREN_IDENTIFICACION` (movida aquí, única fuente) y +`puedeEjecutarseAccionComercial()` — la función centralizada de autorización. |
| `modules/orchestrator.js` | Caminos A (paso 9) y B (`_finalizarWorkflow`) ahora llaman a `puedeEjecutarseAccionComercial()` — ya no reimplementan el criterio cada uno. |
| `server.js` | Camino C ahora llama a la MISMA función. |
| `modules/cotizaciones.js` | +guarda de idempotencia en `correrCotizacionDesdeWorkflow()` (Prioridad 5). |
| `__tests__/identificacion-contacto.test.js` | +14 pruebas (`puedeEjecutarseAccionComercial`, aislamiento multiempresa). |
| `__tests__/orchestrator.test.js` | +1 prueba — reproducción exacta del incidente real. |
| `__tests__/cotizaciones-fase2.test.js` | +2 pruebas de idempotencia; ajuste al mock compartido (ver sección de pruebas). |

(Los cambios del commit anterior, `e9713b8` — gate en caminos B y C por primera vez — ya están documentados en `TARA_IDENTIFICACION_CONTACTO_ENTREGA_V1.md`; esta entrega es la centralización + idempotencia que pediste encima de eso.)

---

## Diff exacto — `modules/orchestrator.js`

```diff
-const ACCIONES_REQUIEREN_IDENTIFICACION = ['crear_oportunidad', 'agendar_cita', 'agendar_cita_con_horario_solicitado', 'ejecutar_motor_ingenieria'];
+// La lista y la decisión de autorización ahora viven en
+// modules/identificacion-contacto.js (puedeEjecutarseAccionComercial).

@@ paso 9 de procesarMensaje
     const identificacion = _resolverIdentificacion(clienteRaw, aiOutput.datos_contacto);
-    const accionesAutorizadas = propuestas.filter(a => {
-      if (!a?.tipo || !capacidadesResueltas.includes(a.tipo)) return false;
-      if (ACCIONES_REQUIEREN_IDENTIFICACION.includes(a.tipo) && identificacion.estado !== 'identificado') return false;
-      return true;
-    });
+    const autorizarAccion = (tipo) => puedeEjecutarseAccionComercial({
+      tipoAccion: tipo, companyId: company_id, clienteId: clienteRaw?.id,
+      nombre: identificacion.nombre, motivoConsulta: identificacion.motivo,
+    }).autorizada;
+    const accionesAutorizadas = propuestas.filter(a =>
+      a?.tipo && capacidadesResueltas.includes(a.tipo) && autorizarAccion(a.tipo)
+    );
     const huboComercialBloqueadaPorIdentificacion = propuestas.some(a =>
-      a?.tipo && capacidadesResueltas.includes(a.tipo) &&
-      ACCIONES_REQUIEREN_IDENTIFICACION.includes(a.tipo) && identificacion.estado !== 'identificado'
+      a?.tipo && capacidadesResueltas.includes(a.tipo) && !autorizarAccion(a.tipo)
     );

@@ _finalizarWorkflow()
     const identificacion = _resolverIdentificacion(clienteRaw, aiOutput.datos_contacto);
     const bloqueadoPorIdentificacion = nodo.acciones.some(a =>
-      ACCIONES_REQUIEREN_IDENTIFICACION.includes(a?.tipo) && identificacion.estado !== 'identificado'
+      !puedeEjecutarseAccionComercial({
+        tipoAccion: a?.tipo, companyId: company_id, clienteId: clienteRaw?.id,
+        nombre: identificacion.nombre, motivoConsulta: identificacion.motivo,
+      }).autorizada
     );
```

## Diff exacto — `server.js`

```diff
 const { crearOrchestrator, resolverIdentificacion } = require('./modules/orchestrator');
+const { puedeEjecutarseAccionComercial } = require('./modules/identificacion-contacto');

@@ "disparo anticipado"
         if (nodoAccion && sesionActiva.current_node !== nodoAccion.nombre) {
           const identificacion = resolverIdentificacion(cliente, resultado.ai_output?.datos_contacto);
-          if (identificacion.estado === 'identificado') {
+          const autorizacion = puedeEjecutarseAccionComercial({
+            tipoAccion: 'ejecutar_motor_ingenieria', companyId: message.company_id, clienteId: cliente.id,
+            nombre: identificacion.nombre, motivoConsulta: identificacion.motivo,
+          });
+          if (autorizacion.autorizada) {
             const capturedFields = { ... }  // sin cambios
```

---

## PRIORIDAD 3 — Validación centralizada

`modules/identificacion-contacto.js::puedeEjecutarseAccionComercial({ tipoAccion, companyId, clienteId, nombre, motivoConsulta })`:

- Considera: tipo de acción (contra `ACCIONES_REQUIEREN_IDENTIFICACION`, única lista), `companyId`/`clienteId` (rechaza si faltan — "sin contexto válido"), y el estado derivado de `nombre`/`motivoConsulta` ya resueltos.
- El modelo **nunca** llega a esta función — recibe únicamente datos que el caller (Orchestrator o server.js) ya combinó/validó con `_resolverIdentificacion()`/`_validarDatoContacto()`, nunca el JSON crudo del modelo.
- Los 3 caminos (A, B, C) llaman exactamente a esta función — cero criterio duplicado.
- "Requisitos adicionales de esa acción, cuando correspondan": no implementé reglas adicionales por-acción todavía (ej. `agendar_cita_con_horario_solicitado` sigue teniendo su propio chequeo de `camposRequeridos` — dirección/fecha/hora — como una capa SEPARADA, no fusionada en esta función). Lo dejo documentado como posible ampliación futura, no lo toqué para no exceder el alcance autorizado.

---

## PRIORIDAD 4 — Cobertura de los 3 caminos

Confirmada arriba (diffs). Camino C: "si la validación falla, no debe crearse una cotización real" — confirmado, el `if (autorizacion.autorizada)` envuelve TODA la llamada a `correrCotizacionDesdeWorkflow()`; si no autoriza, esa función ni se invoca — no es una pregunta sin efecto, es la ausencia total de la escritura.

## PRIORIDAD 5 — Evitar duplicados

Agregué una guarda de idempotencia **dentro de `correrCotizacionDesdeWorkflow()`** (el único punto real de escritura, común a B y C): antes de insertar, busca una cotización ya creada por este mismo camino (misma empresa+cliente+descripción) en los últimos 2 minutos — si existe y ya tiene cálculo asociado, devuelve ese cálculo en vez de insertar otra fila.

**Qué SÍ cubre:** webhooks repetidos (Twilio reenvía el mismo mensaje), y el escenario exacto del incidente (camino B bloqueado-y-reabierto en el mismo turno en que camino C también evalúa).

**Qué NO cubre (límite documentado, no resuelto en esta entrega):** una verdadera condición de carrera de 2 peticiones EN PARALELO, milisegundos aparte, antes de que la primera termine de escribir — cerrar eso del todo requeriría una restricción a nivel de base de datos (ej. índice único parcial) o un token de idempotencia real (`MessageSid` de Twilio, que hoy no se pasa a esta función). **No existe ningún mecanismo de deduplicación de webhooks en `server.js` hoy** (confirmé con grep: cero menciones de dedup por `MessageSid`) — es un hueco de plataforma más amplio, anterior a esta regla y no exclusivo de estas 4 acciones; documentado aquí, no resuelto, porque cerrarlo bien tocaría el punto de entrada del webhook, fuera del alcance "específico y limitado" que autorizaste.

---

## PRIORIDAD 6 — Compatibilidad

124/124 suites, 2501/2501 tests — incluye toda la cobertura previa de agenda, CRM, clasificación, aislamiento multiempresa, WhatsApp — cero regresión.

## PRIORIDAD 7 — Pruebas

17 pruebas nuevas en esta entrega (sobre las 34 ya entregadas antes):

| Caso pedido | Dónde |
|---|---|
| Reproducción exacta del incidente (mensaje real, cliente "Sin nombre") | `orchestrator.test.js`, "REPRODUCCIÓN DEL INCIDENTE" |
| Cliente identificado correctamente / motivo persistido / nombre incompleto / corrección | Ya cubiertas en la entrega anterior (sin cambios) |
| Mensajes consecutivos | Ya cubierta |
| Webhooks duplicados | `cotizaciones-fase2.test.js`, idempotencia |
| Intentos de omitir la validación | `identificacion-contacto.test.js`, "intento de omitir la validación" |
| Acciones ejecutadas desde workflows | `orchestrator.test.js`, "camino B" (3 pruebas) |
| Aislamiento entre empresas | `identificacion-contacto.test.js`, "AISLAMIENTO MULTIEMPRESA" |

**Honestidad sobre el alcance de "integración"**: no construí un arnés de pruebas que recorra literalmente WhatsApp → Webhook → Router → Orchestrator → DB con supertest — este repo no tiene ningún precedente de eso (confirmado: cero pruebas de rutas de `server.js` en todo el proyecto). Lo que sí hice: pruebas que ejercitan las funciones REALES en su composición real (no mocks de alto nivel que asuman el resultado) — `puedeEjecutarseAccionComercial()` real, `correrCotizacionDesdeWorkflow()` real con Supabase simulado, el `Orchestrator` real con sus dependencias inyectadas. Es la aproximación más fiel que permite la convención de pruebas ya establecida en este proyecto, sin construir infraestructura nueva no autorizada.

---

## PRIORIDAD 8 — Riesgos restantes

1. **Producción sigue expuesta** hasta que autorices push + despliegue — el fix completo (commits `e9713b8` + este) existe solo local.
2. **No hay dedup de webhooks a nivel de plataforma** (más allá de la guarda puntual de 2 minutos en `correrCotizacionDesdeWorkflow`) — riesgo preexistente, documentado, no resuelto aquí.
3. **`clientes.nombre` sigue sin columna de fuente propia** (documentado desde la entrega anterior) — una corrección conversacional siempre se acepta si es distinta a la actual.
4. **Los 2 endpoints de creación manual** (`POST /api/cotizaciones`, `POST /api/crm/clientes/:id/oportunidades`) quedaron deliberadamente sin gate — confirma si estás de acuerdo con ese criterio.
5. **`agendar_cita_con_horario_solicitado` sigue teniendo su propio chequeo de `camposRequeridos` separado** de `puedeEjecutarseAccionComercial()` — ambos corren, pero no están fusionados en una sola llamada; funciona correctamente, pero es una superficie con 2 gates en vez de 1 para esa acción específica.

## Plan de despliegue y reversión

**Despliegue** (cuando autorices): `git push` (incluye `e9713b8` + los commits de esta entrega) → Render auto-despliega → confirmar `/health` 200 → **no hay endpoint HTTP nuevo que verificar** (es lógica interna del webhook) → la validación real es repetir la prueba de WhatsApp desde cero.

**Reversión**: sin migraciones nuevas en esta entrega — revertir es `git revert` de los commits + push, o rollback en el dashboard de Render al deploy anterior. Cero cambios de esquema que deshacer.

---

Sin push, sin despliegue — a la espera de tu autorización.
