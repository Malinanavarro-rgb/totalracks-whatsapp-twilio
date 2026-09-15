# Auditoría — Workflow real de ventas de paneles solares (Nort Energy)

**Fecha:** 2026-09-15
**Alcance:** diagnóstico únicamente, sin cambios de código. Verificado contra el código real del repo y datos reales de producción (Supabase), no contra suposiciones.

---

## 1. Diagnóstico de cada error de la conversación real

### 1.1 "El bot avanza demasiado rápido / repite preguntas"

La conversación corrió el workflow **"Cotización directa — ingeniería solar"** (`trigger_value: solicitud_cotizacion`, confirmado por match exacto de cada pregunta contra `workflow_nodes` real de Nort Energy):

`preguntar_ubicacion` → `preguntar_consumo_kwh` → `preguntar_importe_recibo` → `preguntar_cobertura` → `preguntar_tipo_alimentacion` → `preguntar_voltaje` (dispara `ejecutar_motor_ingenieria`)

Es un **grafo lineal de un campo por nodo** (`modules/workflow-engine.js`). Cada nodo tiene una `pregunta` fija y un `siguiente_nodo` fijo — no hay bifurcación ni omisión salvo el mecanismo de "auto-advance" (ver 1.2). El "avance rápido" percibido es real: el sistema no evalúa si ya tiene información suficiente para varios campos a la vez ni prioriza inteligentemente qué preguntar — sigue el orden fijo de la tabla, siempre.

### 1.2 "Pregunta información que ya puede obtener de la foto del recibo CFE"

Esto **sí está implementado** (`modules/recibo-cfe.js`, `procesarReciboCFE()`), y **sí se ejecuta antes del turno de IA** (`server.js:320`, síncrono, `await`, antes de llamar al Orchestrator). El mecanismo:

1. Llega la foto → se descarga → si hay sesión activa del workflow `solicitud_cotizacion`, se manda a extracción por visión (`gpt-4o-mini`, prompt que prohíbe inventar).
2. Si extrae datos, **reemplaza `message.content`** por: `"El cliente envió su recibo de CFE. Datos leídos automáticamente del recibo: consumo aprox. X kWh/mes, importe aprox. $Y/mes."` — el Core nunca ve la imagen, ve este texto como si la clienta lo hubiera escrito.
3. Ese texto pasa por el extractor de IA normal (`datos_extraidos`), que debería llenar `consumo_mensual_kwh`/`importe_promedio_recibo` desde ahí.

**Por qué falló en la práctica:** la extracción de `datos_extraidos` en el paso 3 es una **segunda pasada de IA, no determinística** — depende de que el modelo relea correctamente ese texto sintético y llene ambas claves en el mismo turno. Si el recibo real solo mostraba con claridad UNO de los dos datos (el prompt de `recibo-cfe.js` explícitamente se niega a inventar el que no esté claro — comportamiento correcto y deseado), el resumen solo menciona ese uno, y el nodo actual solo avanza un campo por foto. Esto coincide exactamente con el patrón real: cada foto avanzó exactamente un nodo, nunca dos.

**Esto no es un bug de "no lee el recibo"** — es que el sistema depende de una relectura por IA del propio resumen para saber qué campo llenar, en vez de que `recibo-cfe.js` le diga directamente al WorkflowEngine "estos campos específicos ya están resueltos, no los preguntes". Existe la función correcta para esto (`WorkflowEngine.preSalvarDatosExtraidos()`, que `recibo-cfe.js` ya llama) pero solo rellena huecos para nodos **futuros no alcanzados aún** — el nodo **actual** de ese mismo turno se resuelve por el camino síncrono de `datos_extraidos`, no por `preSalvarDatosExtraidos()`.

### 1.3 "Permite agendar una visita sin recopilar todos los datos necesarios" — el hallazgo más grave

Dos causas raíz distintas, confirmadas por separado:

**(a) El workflow "Cotización directa" nunca pregunta dirección — en ningún nodo.** Sus 6 nodos son: ubicación (ciudad/municipio, no dirección), consumo_kwh, importe_recibo, % cobertura, tipo de alimentación, voltaje. Termina en `ejecutar_motor_ingenieria`, no en agendar una visita. El otro workflow de Nort Energy, "Calificación completa y agenda de visita técnica" (`solicitud_visita_tecnica`), sí agenda al final (`preguntar_hora_preferida` → acción `agendar_cita_con_horario_solicitado`) pero **tampoco tiene ningún nodo con `campo: 'direccion'`** — sus 11 nodos son nombre, tipo_propiedad, consumo (importe), frecuencia_recibo, ciudad, colonia, pisos, climas, tipo_techo, espacio_azotea, hora_preferida. **Ninguno de los dos workflows de Nort Energy tiene un campo de dirección física.** Esto es un hueco de diseño de datos, confirmado contra la tabla `workflow_nodes` real — no una falla del motor.

**(b) `acciones_propuestas` no tiene ninguna validación server-side contra lo que la empresa tiene permitido.** Esto es el hallazgo estructural más serio:

- `personalities.capacidades` de Nort Energy es `null` → el Orchestrator usa el default `CAPACIDADES_FASE2 = ['crear_oportunidad']` (`modules/orchestrator.js:50`).
- El prompt que ve el modelo (`modules/prompt-builder.js::bloque_schema_json`) sí refleja esa restricción: `"acciones_propuestas": [{"tipo": "crear_oportunidad", ...}]` — al modelo se le dice que SOLO puede proponer `crear_oportunidad`.
- Pero **`ActionRunner.ejecutar()` (`modules/action-runner.js`) despacha por `accion.tipo` contra un registro GLOBAL y compartido entre TODAS las empresas** (`agendar_cita`, `agendar_cita_con_horario_solicitado`, `reagendar_cita`, `cancelar_cita`, `crear_ticket_soporte`, `ejecutar_motor_ingenieria`, todos registrados sin condición en `crearOrchestrator()`). **No existe ningún punto del código que verifique que el `tipo` que el modelo propuso esté dentro de las `capacidades` reales de la empresa antes de ejecutarlo.**

Un LLM no obedece un enum de manera perfecta — sobre todo bajo presión conversacional ("le urge agendar ya"). Si el modelo propone `{"tipo": "agendar_cita_con_horario_solicitado", ...}` aunque el prompt solo le haya listado `crear_oportunidad`, el Orchestrator lo ejecuta igual, **agendando una cita real en Google Calendar** sin que ese flujo haya pasado nunca por el nodo estructurado que pide fecha/hora/dirección. Esto explica con precisión lo observado: una cita real quedó agendada sin ninguna validación de datos mínimos, fuera de cualquier grafo de nodos.

### 1.4 "'Ok' interpretado como selección"

Cuando hay sesión de workflow activa y el nodo actual usa `modo_respuesta: 'replace_ai'`, el valor capturado es `datos_extraidos[campo] ?? mensajeCliente.trim()` (`orchestrator.js:437-439`) — si la IA no extrajo nada claro, usa el texto crudo del cliente ("Ok") **tal cual**, sin ninguna validación de que responda la pregunta. Para las preguntas de nodo (fijas, deterministas) esto sí es un bug real y corregible con una regla simple. Para la negociación de día/hora que sí re-preguntó correctamente en el transcript real, eso ocurrió en modo conversación libre (sin nodo activo, ver 1.3-b) — funcionó ahí por buen juicio del modelo en ese turno particular, no por ninguna garantía del sistema. Es decir: **hoy no hay ninguna protección determinística contra respuestas ambiguas** — cuando "funciona" es por suerte del modelo, no por diseño.

### 1.5 "Repite la confirmación final dos veces"

No hay ningún chequeo de idempotencia en `_finalizarWorkflow`/`_ejecutarAcciones`. Si el turno se reprocesa (reintento del proveedor de WhatsApp, doble webhook, etc.) o si el flujo libre post-workflow vuelve a proponer la misma acción, no hay guardia que impida ejecutar `agendar_cita_con_horario_solicitado` dos veces o reenviar el mismo texto de confirmación.

---

## 2. Qué parte del workflow/código provoca cada problema (resumen técnico)

| Problema | Módulo/archivo | Mecanismo exacto |
|---|---|---|
| Preguntas repetidas tras enviar el recibo | `modules/recibo-cfe.js` + `modules/orchestrator.js::_manejarWorkflow` | Datos del recibo dependen de una relectura de IA por turno, no de una asignación directa del nodo actual |
| Sin dirección antes de agendar | `workflow_nodes` (datos, no código) + `modules/action-runner.js` | Ningún nodo captura dirección; `ActionRunner` ejecuta cualquier acción registrada sin validar `capacidades` de la empresa |
| Visita agendada fuera del flujo estructurado | `modules/orchestrator.js::_ejecutarAcciones` / `ActionRunner.ejecutar` | Sin filtro server-side de `accion.tipo` contra `capacidades` de la empresa |
| "Ok" capturado como respuesta válida | `modules/orchestrator.js::_manejarWorkflow` (línea ~437) | Fallback a `mensajeCliente.trim()` sin validar que responda la pregunta del nodo |
| Confirmación duplicada | `modules/orchestrator.js::_finalizarWorkflow` | Sin idempotencia por `appointment_status`/reintento |

---

## 3. Componentes existentes que SÍ podemos reutilizar (nada de esto se duplica)

- **`WorkflowEngine`** (`workflow-engine.js`) — motor de nodos, `avanzar()`, `preSalvarDatosExtraidos()`, `tieneSesionCompletadaReciente()`. Se extiende, no se reemplaza.
- **`modules/recibo-cfe.js`** — extracción de recibo ya funciona bien y ya está integrado; el problema es de propagación al nodo actual, no de extracción.
- **`modules/cotizaciones.js`** — motor de ingeniería (`correrCotizacionDesdeWorkflow`, `mapearCapturedFieldsAInfoTecnica`), generación de folio, dedup de oportunidad abierta (`_resolverOportunidadAbierta`, ya existe y ya usa el criterio correcto: cualquier estado ≠ 'Perdido').
- **`modules/scheduling-engine.js` + `modules/google-auth.js`** — agenda real, Google Calendar por empresa. No se toca.
- **`ActionRunner`** — mecanismo de registro de acciones ya correcto en diseño; solo le falta el filtro de capacidades antes de ejecutar.
- **`modules/prompt-builder.js::bloque_schema_json`** — ya construye `datos_extraidos` dinámicamente desde `campos_faltantes` (hay una noción parcial de "qué falta" que se puede convertir en el sistema de estados que pides).
- **`crm.js::crearOportunidadSiCorresponde`** — mismo criterio de dedup que `cotizaciones.js`, ya en uso.

---

## 4. Qué campos faltan actualmente

**En `workflow_nodes` (ambos workflows de Nort Energy):** dirección completa, colonia (falta en "Cotización directa", existe en "Visita técnica"), propiedad propia/rentada, número de paneles estimado, observaciones del cliente, referencias de ubicación.

**En `oportunidades` (tabla completa, confirmado por schema real):** la tabla solo tiene `descripcion` (texto libre) y `presupuesto_estimado/confirmado` — **cero campos estructurados** de los que pide tu lista (`lead_source`, `property_type`, `city`, `colonia`, `address`, `cfe_bill_received`, `consumption_kwh`, `bill_amount`, `cfe_rate`, `electrical_phase`, `voltage`, `coverage_target`, `estimated_panels`, `estimated_kwp`, `visit_date`, `visit_time`, `appointment_status`, `missing_fields`, `next_action`). Hoy esos datos solo viven en `workflow_sessions.captured_fields` (JSONB), que se pierde de vista una vez que la sesión se marca `completado` y nadie vuelve a consultarla desde el CRM.

**En `citas`:** no hay campo de dirección tampoco (`citas` solo tiene id, company_id, cliente_id, asesor_id, calendar_event_id, inicio, fin, estado, origen_workflow_id, recordatorio_enviado, servicio_id, precio_cobrado, notas) — `notas` podría llevar la dirección como texto libre hoy, pero no es estructurado.

---

## 5. Propuesta de nuevo flujo (resumen — detalle completo antes de implementar)

- Fusionar conceptualmente los dos workflows en un único recorrido adaptativo con **prioridad de captura**: intención → tipo propiedad + ciudad → **recibo CFE cuanto antes** → procesar recibo → preguntar solo lo que falte → predimensionar preliminar → CTA (cotización / visita) → si visita: dirección + colonia + nombre + fecha + hora (todos obligatorios antes de poder llamar a la acción de agendar) → confirmar.
- Añadir nodos de dirección/colonia/propiedad-propia-o-rentada a ambos workflows (aditivo, no se borra nada existente).
- Mover la asignación de campos extraídos del recibo a una ruta **directa y determinística** (recibo-cfe.js llama a `avanzar()`/actualiza el nodo actual directamente si su campo coincide, en vez de depender de que la IA vuelva a leerlo).
- Agregar el filtro de `capacidades` en `Orchestrator._ejecutarAcciones` **antes** de llamar a `ActionRunner.ejecutar` — cualquier acción fuera de las capacidades de la empresa se descarta y se loguea, nunca se ejecuta.
- Agregar una validación explícita de precondiciones para `agendar_cita_con_horario_solicitado` (dirección + fecha + hora presentes) — si falta algo, la acción se rechaza con un motivo claro en vez de ejecutar a medias.
- Guardar los campos capturados en `oportunidades` (migración aditiva de columnas) cuando el workflow avanza, no solo al final — así el CRM ve el progreso en vivo, no solo cuando se completa.

## 6. Reglas de validación antes de agendar (a implementar)

`agendar_cita_con_horario_solicitado` NO se ejecuta si falta cualquiera de: dirección completa, ciudad, fecha, hora, nombre/contacto. Si falta algo, la acción devuelve un resultado explícito (`{tipo: 'faltan_datos', campos: [...]}`) que el Orchestrator traduce en la pregunta natural del dato que falta — nunca confirma.

## 7. Archivos/migraciones que se necesitarán (para implementación, sujeto a tu autorización)

- **Migración nueva** (aditiva, nullable): columnas estructuradas en `oportunidades` (lead_source, property_type, city, colonia, address, cfe_bill_received, consumption_kwh, bill_amount, cfe_rate, electrical_phase, voltage, coverage_target, estimated_panels, estimated_kwp, visit_date, visit_time, appointment_status, missing_fields jsonb, next_action).
- `workflow_nodes` de Nort Energy — nodos nuevos (dirección, colonia si falta, propiedad propia/rentada) vía script, no migración de schema.
- `modules/orchestrator.js` — filtro de capacidades antes de `ActionRunner.ejecutar` (afecta a **todas** las empresas, ver riesgos).
- `modules/action-runner.js` o un nuevo módulo de validación — precondiciones de `agendar_cita_con_horario_solicitado`.
- `modules/recibo-cfe.js` — asignación directa al nodo actual en vez de solo `preSalvarDatosExtraidos`.
- `modules/crm.js` / `modules/cotizaciones.js` — escribir a las nuevas columnas de `oportunidades` conforme avanza el workflow.

## 8. Riesgos de romper otras empresas dentro de TARA Matrix

- **El filtro de capacidades en `Orchestrator._ejecutarAcciones` es un cambio al Core compartido** — afecta a TODAS las empresas, no solo Nort Energy. Es objetivamente una corrección de seguridad/integridad (nadie debería poder ejecutar acciones no autorizadas), pero hay que verificar que ninguna empresa activa dependa hoy, aunque sea sin querer, de una acción fuera de sus `capacidades` declaradas — auditoría rápida de `decision_logs`/`acciones` antes de activar el filtro.
- Los nodos nuevos en `workflow_nodes` son aditivos y van solo en las filas de Nort Energy (`company_id` específico) — cero riesgo para GONDOR/Demo/otras.
- Las columnas nuevas en `oportunidades` son nullable y aditivas — cero cambio de comportamiento para Total Racks ni ninguna empresa que no las use.
- `modules/recibo-cfe.js` ya tiene guard por `trigger_value === 'solicitud_cotizacion'` — cualquier cambio ahí se mantiene acotado a ese workflow específico.

---

## Veredicto de esta fase

Diagnóstico completo. El hallazgo más importante y con mayor impacto de seguridad/confiabilidad es el **punto 1.3(b)**: el sistema no valida server-side que una acción propuesta por la IA esté dentro de lo que la empresa autorizó — esto puede estar afectando (en menor medida, dependiendo del prompt de cada una) a cualquier empresa con `capacidades` restringidas, no solo a Nort Energy.

Quedo a la espera de tu autorización explícita para empezar a implementar, según lo que pediste.
