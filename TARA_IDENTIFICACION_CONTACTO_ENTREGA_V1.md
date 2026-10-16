# TARA — Identificación obligatoria de contacto, entrega

**Fecha:** 2026-10-16
**Estado:** implementado y probado localmente. **Sin push, sin migración corrida, sin despliegue.**

---

## 1. Resumen

TARA ahora exige nombre + motivo de consulta antes de ejecutar `crear_oportunidad`, `agendar_cita`, `agendar_cita_con_horario_solicitado` o `ejecutar_motor_ingenieria` — en las 4 empresas de la plataforma, sin distinción (Nort Energy, Gondor, Total Racks y cualquier otra), vía el mismo mecanismo de `company_id` ya usado en todo el sistema. La conversación general (preguntas informativas, dudas, urgencias) nunca se bloquea — el gate solo filtra esas 4 acciones.

## 2. Archivos modificados/nuevos

| Archivo | Cambio |
|---|---|
| `migrations/132_identificacion_contacto.sql` | Nuevo, aditivo. `clientes.motivo_consulta` + `motivo_consulta_fuente` + `motivo_consulta_actualizado_en`. **No corrida.** |
| `modules/identificacion-contacto.js` | Nuevo — mismo esqueleto que `clasificacion-cliente.js`. |
| `modules/orchestrator.js` | **Se tocó** (Core congelado, excepción documentada abajo). |
| `modules/prompt-builder.js` | +campo `datos_contacto` en el schema JSON (aditivo). |
| `__tests__/identificacion-contacto.test.js` | Nuevo — 16 pruebas. |
| `__tests__/orchestrator.test.js` | +18 pruebas nuevas, +1 campo en el fixture `makeCliente()` (ver sección 6). |

`modules/crm.js`, `modules/workflow-engine.js`, `adapters/channels/*`, `server.js` — **sin cambios.**

## 3. Causa, cambios mínimos y alternativas descartadas (excepción al Core)

**Causa:** confirmé en el diagnóstico previo que, fuera de un workflow activo, "el cliente ya dio su nombre/motivo" no se persistía en ningún lado estructurado — `clientes.nombre` nunca se actualizaba desde conversación libre, y no existía ningún campo de motivo. El único gate parecido (`agendar_cita_con_horario_solicitado` + `camposRequeridos`) solo protegía el camino de workflow completado, nunca conversación libre ni `crear_oportunidad`.

**Cambios mínimos realizados en `modules/orchestrator.js`** (diff completo en la sección 7):
1. 1 `require` nuevo (función pura de `identificacion-contacto.js`).
2. 2 funciones módulo-nivel nuevas (`_validarDatoContacto`, `_resolverIdentificacion`) + 1 constante (`ACCIONES_REQUIEREN_IDENTIFICACION`) — ninguna toca `_ejecutarAcciones`, `_finalizarWorkflow`, `WorkflowEngine`, `AIProvider` ni `ChannelAdapter`.
3. Constructor: 1 línea (dependencia opcional, null-safe, mismo patrón que `_actualizarClasificacion`).
4. Paso 9 de `procesarMensaje`: se filtra `accionesAutorizadas` con una condición adicional, y se agrega una rama de 4 líneas que reemplaza el texto si una acción comercial quedó bloqueada — reutiliza `_preguntaPorDatoFaltante()` ya existente, solo se le agrega la entrada `motivo` al mapa.
5. Paso 11.5 nuevo: 10 líneas, mismo patrón exacto que el paso 11 ya existente (`_actualizarClasificacion`).
6. `crearOrchestrator()`: 1 require + 1 línea de wiring, mismo patrón que `actualizarClasificacion`.
7. `module.exports`: 3 líneas, exporta los helpers puros nuevos para prueba directa (mismo patrón que `parsearHoraPreferida`/`esAcuseAmbiguo`).

**Alternativas descartadas:**
- *Ponerlo todo dentro de `modules/identificacion-contacto.js` sin tocar Orchestrator*: imposible — el punto de intercepción (antes de ejecutar `acciones_propuestas`) solo existe dentro de `procesarMensaje`; cualquier solución "desde afuera" requeriría que otro módulo llamara al Core, invirtiendo la arquitectura ("ningún módulo llama a otro directamente", regla explícita del encabezado del archivo).
- *Extender `camposRequeridos`/el gate ya existente de `agendar_cita_con_horario_solicitado` en vez de uno nuevo*: descartada — ese gate vive dentro de un handler de `ActionRunner` (fuera del Core), y solo corre para esa UNA acción cuando viene de un workflow completado (`sesionCompletada.captured_fields`). No hay forma de que un handler de `ActionRunner` vea `acciones_propuestas` completas ni bloquee `crear_oportunidad` — por diseño, cada handler solo ve la acción que le toca ejecutar.
- *Resolver la identificación con una llamada a IA aparte (reclasificar el historial)*: descartada por desproporcionada — el schema JSON del turno actual ya basta (mismo criterio de `datos_extraidos`), no hace falta una segunda llamada a OpenAI.
- *Guardar el estado de identificación en una tabla/columna de enum aparte*: descartada explícitamente por tu instrucción — se deriva de `clientes.nombre`/`motivo_consulta` con una función pura (`resolverEstadoIdentificacion`), cero esquema nuevo para el estado en sí.

**No se tocó**: `WorkflowEngine`, `AIProvider`/`AIEngine`, ningún `ChannelAdapter`, `_ejecutarAcciones`, `_finalizarWorkflow`, `ActionRunner`. No encontré ninguna dependencia indispensable que obligara a tocar esos componentes — si hubiera aparecido una, me habría detenido a pedir autorización antes de seguir, como indicaste.

## 4. Identificación estructurada — no solo el modelo decide

- El modelo reporta `datos_contacto.nombre`/`.motivo` en el JSON del turno (ampliación aditiva del schema, `prompt-builder.js`), con la misma disciplina que `datos_extraidos`: null salvo que el cliente lo haya dicho explícitamente.
- El backend **valida** antes de confiar: `_validarDatoContacto()` rechaza valores no-string, vacíos, o el placeholder `"Sin nombre"` (en cualquier capitalización) — un intento de hacer que el modelo "confirme" una identificación falsa no pasa esta validación.
- La fuente de verdad final es siempre `clientes.nombre`/`motivo_consulta` — `_resolverIdentificacion()` combina lo persistido con lo nuevo-y-validado de este turno, nunca confía solo en lo que el modelo "cree".

## 5. Estados de identificación — derivados, sin tabla nueva

`resolverEstadoIdentificacion({ nombre, motivoConsulta })` → `'sin_identificar' | 'parcial' | 'identificado'`, calculado en vivo desde las columnas ya existentes — ninguna tabla ni columna de estado nueva.

## 6. Resultados de pruebas

124/124 suites, 2480/2480 tests (34 nuevas: 16 de `identificacion-contacto.js`, 18 de la integración en `orchestrator.js`). `vite build` del frontend limpio (sin cambios de frontend en esta fase).

**Nota de transparencia sobre el fixture compartido**: el gate es una restricción real y siempre activa — 3 pruebas ya existentes de `orchestrator.test.js` (que no tenían que ver con identificación, probaban confirmación de citas y `faltan_datos` de dirección) empezaron a fallar porque su fixture de cliente por default no tenía motivo de consulta. Les agregué `motivo_consulta: 'Cotización de rack selectivo'` al fixture compartido `makeCliente()` — así quedan "ya identificadas" por default (como lo estaban implícitamente antes de esta fase) y las pruebas NUEVAS de identificación usan sus propios fixtures sin ese campo para probar el bloqueo. Lo marco explícitamente porque es el único ajuste a una prueba preexistente, no algo nuevo que construí.

Cobertura exacta de tu lista:

| Caso pedido | Resultado |
|---|---|
| Cliente nuevo que da nombre y necesidad juntos | ✅ — se ejecuta ese mismo turno |
| Cliente que da primero el nombre | ✅ — bloqueado, pregunta motivo |
| Cliente que da primero la necesidad | ✅ — bloqueado, pregunta nombre |
| Cliente que ya tiene nombre en CRM | ✅ — solo falta motivo, lo pregunta |
| Cliente que corrige su nombre | ✅ — el valor nuevo gana |
| Cliente que cambia de necesidad | ✅ — el motivo nuevo reemplaza al anterior |
| Cliente que no quiere dar su nombre | ✅ — acción sigue bloqueada, conversación general continúa |
| Mensajes consecutivos | ✅ |
| Prevención de preguntas repetidas | ✅ — una vez persistido, no se repite en el turno siguiente |
| Intentos de omitir el gate | ✅ — "Sin nombre"/vacío enviado por el modelo se rechaza en el backend |
| Aislamiento multiempresa | ✅ — UPDATE siempre con `.eq('company_id', ...)` además de `clienteId` |
| Compatibilidad con agenda y WhatsApp | ✅ — `agendar_cita_con_horario_solicitado` probado con y sin identificación |
| Sin oportunidades duplicadas | ✅ — turno bloqueado nunca llama `crearOportunidad`; turno identificado, exactamente una vez |

## 7. Diff exacto de `modules/orchestrator.js` y `modules/prompt-builder.js`

```diff
diff --git a/modules/orchestrator.js b/modules/orchestrator.js
index f06c243..2db8f97 100644
--- a/modules/orchestrator.js
+++ b/modules/orchestrator.js
@@ -38,6 +38,7 @@
 const { randomUUID }  = require('crypto');
 const { ActionRunner } = require('./action-runner');
 const { instruccionesDePersonalidad } = require('./personalidad-presets');
+const { resolverEstadoIdentificacion } = require('./identificacion-contacto');
 
 // ═════════════════════════════════════════════════════════════════════════════
 // CONSTANTES
@@ -55,6 +56,43 @@ const CAPACIDADES_FASE2 = ['crear_oportunidad'];
 // _textoDesdeResultadoDeAgenda), nunca se deja pasar la promesa sin respaldo.
 const ACCIONES_SENSIBLES_DE_AGENDA = ['agendar_cita', 'agendar_cita_con_horario_solicitado', 'reagendar_cita', 'cancelar_cita'];
 
+const ACCIONES_REQUIEREN_IDENTIFICACION = ['crear_oportunidad', 'agendar_cita', 'agendar_cita_con_horario_solicitado', 'ejecutar_motor_ingenieria'];
+
+function _validarDatoContacto(valor) {
+  if (typeof valor !== 'string') return null;
+  const limpio = valor.trim();
+  if (!limpio || limpio.toLowerCase() === 'sin nombre') return null;
+  return limpio;
+}
+
+function _resolverIdentificacion(clienteRaw, datosContacto) {
+  const nombre = _validarDatoContacto(datosContacto?.nombre)
+    || (clienteRaw?.nombre && clienteRaw.nombre !== 'Sin nombre' ? clienteRaw.nombre : null);
+  const motivo = _validarDatoContacto(datosContacto?.motivo) || clienteRaw?.motivo_consulta || null;
+  return { nombre, motivo, estado: resolverEstadoIdentificacion({ nombre, motivoConsulta: motivo }) };
+}
+
 // ═════════════════════════════════════════════════════════════════════════════
 // ORCHESTRATOR
 // ═════════════════════════════════════════════════════════════════════════════
@@ -129,6 +167,11 @@ class Orchestrator {
     this._actualizarClasificacion = deps.actualizarClasificacion || null;
 
+    this._actualizarIdentificacion = deps.actualizarIdentificacion || null;
+
@@ -373,10 +416,27 @@ class Orchestrator {
     const propuestas = aiOutput.acciones_propuestas || [];
-    const accionesAutorizadas = propuestas.filter(a => a?.tipo && capacidadesResueltas.includes(a.tipo));
+    const identificacion = _resolverIdentificacion(clienteRaw, aiOutput.datos_contacto);
+    const accionesAutorizadas = propuestas.filter(a => {
+      if (!a?.tipo || !capacidadesResueltas.includes(a.tipo)) return false;
+      if (ACCIONES_REQUIEREN_IDENTIFICACION.includes(a.tipo) && identificacion.estado !== 'identificado') return false;
+      return true;
+    });
     const huboAgendaBloqueada = propuestas.some(a =>
       a?.tipo && !capacidadesResueltas.includes(a.tipo) && ACCIONES_SENSIBLES_DE_AGENDA.includes(a.tipo)
     );
+    const huboComercialBloqueadaPorIdentificacion = propuestas.some(a =>
+      a?.tipo && capacidadesResueltas.includes(a.tipo) &&
+      ACCIONES_REQUIEREN_IDENTIFICACION.includes(a.tipo) && identificacion.estado !== 'identificado'
+    );
 
     const accionesResult = await this._paso('acciones', timings, () =>
       this._ejecutarAcciones(accionesAutorizadas, ctx, clienteRaw, aiOutput, sessionId)
@@ -385,6 +445,15 @@ class Orchestrator {
       const textoReal = this._textoDesdeResultadoDeAgenda(accionesResult.value, huboAgendaBloqueada);
       if (textoReal) aiOutput = { ...aiOutput, respuesta_texto: textoReal };
     }
+    if (huboComercialBloqueadaPorIdentificacion) {
+      const campoFaltante = identificacion.nombre ? 'motivo' : 'nombre';
+      aiOutput = { ...aiOutput, respuesta_texto: this._preguntaPorDatoFaltante([campoFaltante]) };
+    }
 
     // ── 10. Guardar conversación ───────────────────────────────────────────
@@ -414,6 +483,22 @@ class Orchestrator {
       }
     }
 
+    if (this._actualizarIdentificacion && clienteRaw?.id) {
+      try {
+        await this._actualizarIdentificacion(clienteRaw.id, message.company_id, {
+          nombre: identificacion.nombre, motivo: identificacion.motivo,
+        });
+      } catch (err) {
+        this._log.logError(ctx, 'crm.actualizarIdentificacion', err, { session_id: sessionId });
+      }
+    }
+
     // ── 12. Consumo de IA (Fase 1 TARA AI Engine, 2026-10-16) ─────────────
@@ -850,6 +935,7 @@ class Orchestrator {
       hora:      '¿en qué horario te queda bien?',
       nombre:    '¿con quién tengo el gusto?',
+      motivo:    '¿en qué te puedo ayudar?',
     };
@@ -1109,6 +1195,7 @@ function crearOrchestrator(overrides = {}) {
   const { actualizarClasificacionAutomatica } = require('./clasificacion-cliente');
+  const { actualizarIdentificacionAutomatica } = require('./identificacion-contacto');
@@ -1316,6 +1403,8 @@ function crearOrchestrator(overrides = {}) {
     actualizarClasificacion: overrides.actualizarClasificacion
       || ((clienteId, companyId, clasificacion) => actualizarClasificacionAutomatica(supabase, clienteId, companyId, clasificacion)),
+    actualizarIdentificacion: overrides.actualizarIdentificacion
+      || ((clienteId, companyId, datos) => actualizarIdentificacionAutomatica(supabase, clienteId, companyId, datos)),
@@ -1326,4 +1415,7 @@ module.exports = {
   esAcuseAmbiguo: _esAcuseAmbiguo,
+  resolverIdentificacion: _resolverIdentificacion,
+  validarDatoContacto: _validarDatoContacto,
+  ACCIONES_REQUIEREN_IDENTIFICACION,
 };

diff --git a/modules/prompt-builder.js b/modules/prompt-builder.js
@@ -248,6 +248,7 @@
   "datos_extraidos":     ${datosSchema},
+  "datos_contacto":      {"nombre": "string o null — SOLO si el cliente lo dijo en ESTE turno", "motivo": "string o null — en sus propias palabras, SOLO si ya lo dijo en ESTE turno"},
   "intenciones":         [...],
@@ -255,7 +256,8 @@
 IMPORTANTE: en "datos_extraidos" ... No inferir, no asumir, no adivinar.
+IMPORTANTE: en "datos_contacto", "nombre" y "motivo" son null salvo que el cliente los haya dicho explícitamente EN ESTE turno — nunca inventes, nunca repitas un valor que ya dio en un turno anterior.`;
```

*(Diff resumido para legibilidad — el archivo completo en el repo tiene los comentarios explicativos íntegros, citados en la sección 3.)*

## 8. Riesgos

- **`clientes.nombre` no tiene columna de fuente propia** (a diferencia de `motivo_consulta`) — una corrección conversacional del nombre siempre se acepta si es distinta al valor actual. Si en el futuro alguien edita el nombre manualmente desde el CRM y luego el cliente menciona un apodo en WhatsApp, hoy se sobreescribiría. No until encontré un camino real donde esto pase hoy (confirmado: no hay endpoint de edición manual de `clientes.nombre` en producción todavía), pero lo documento como límite conocido, no silencioso.
- **Conversaciones ya en curso antes de este cambio**: la primera vez que un cliente existente (con `motivo_consulta` vacío) proponga una acción comercial, se le preguntará el motivo una vez — no hay forma de recuperar retroactivamente ese dato de conversaciones pasadas sin un proceso de backfill aparte (fuera de esta fase).
- **Migración 132 no corrida todavía** — hasta que se corra, `clientes.motivo_consulta` no existe en producción; el código ya está listo pero no debe desplegarse antes de correr la migración (de lo contrario, cualquier INSERT/SELECT que la referencie fallaría).

---

Sin push, sin migración corrida, sin despliegue — a la espera de tu autorización para cada uno.
