# Pruebas — workflow real de ventas de paneles solares (Nort Energy)

**Fecha:** 2026-09-15. Complementa `NORT_ENERGY_WORKFLOW_SOLAR_AUDITORIA.md`.

Formato pedido: entrada del cliente → respuesta esperada → campos actualizados → estado del workflow → siguiente acción. Cada escenario está fundamentado contra el código real ya implementado (no es especulación) — donde el comportamiento actual es una **limitación conocida y no resuelta en este ciclo**, lo digo explícitamente en vez de simular que ya está arreglado.

Grafo real, ya actualizado, de los dos workflows de Nort Energy:

**Visita técnica** (`solicitud_visita_tecnica`): nombre → tipo_propiedad → importe_promedio_recibo → frecuencia_recibo → ciudad → colonia → numero_pisos → cantidad_aires_acondicionados → tipo_techo → espacio_azotea → **dirección (nuevo)** → hora_preferida (fin → `agendar_cita_con_horario_solicitado` con `camposRequeridos: ['direccion']`, `crear_oportunidad`).

**Cotización directa** (`solicitud_cotizacion`): ubicación → consumo_mensual_kwh → importe_promedio_recibo → pct_cobertura_deseado → tipo_alimentacion → voltaje_sitio (fin → `ejecutar_motor_ingenieria`).

---

**TEST 1 — Cliente manda recibo CFE desde el principio (primer mensaje, sin workflow activo todavía)**
- Entrada: [foto de recibo], sin texto.
- Respuesta esperada: `recibo-cfe.js` requiere sesión activa de `solicitud_cotizacion` (no existe aún) → cae a descripción genérica de imagen. La IA clasifica intención y, si detecta `solicitud_cotizacion`, arranca el workflow en `preguntar_ubicacion` (con transición, `prepend_ai`).
- Campos actualizados: ninguno del recibo todavía.
- Estado: sesión nueva, activa, en `preguntar_ubicacion` (o auto-avanzada si el mensaje ya incluía la ciudad, poco probable sin texto).
- Siguiente acción / **limitación conocida**: el recibo del primer mensaje no se reutiliza automáticamente al arrancar el workflow — el cliente tendría que reenviarlo una vez que ya hay sesión activa. No resuelto en este ciclo.

**TEST 2 — Cliente no tiene recibo**
- Entrada, en `preguntar_importe_recibo`: "no tengo el recibo a la mano".
- Respuesta esperada: no es un acuse ambiguo (no dispara la guardia nueva) ni un campo vacío → se captura tal cual y avanza a `preguntar_cobertura`.
- Campos actualizados: `importe_promedio_recibo = "no tengo el recibo a la mano"` (dato no numérico).
- Estado: avanza, no se bloquea.
- Siguiente acción / **limitación conocida**: el motor de ingeniería recibe un dato sucio — no inventa un cálculo con eso (cae a `estado_calculo: incompleto`, mensaje honesto de revisión humana, nunca un PDF automático con datos falsos), pero el campo en sí queda sucio en `captured_fields`. Validar tipo de dato antes de capturar es una mejora real pendiente, no resuelta en este ciclo.

**TEST 3 — Cliente responde "Ok" ante dos opciones** ✅ resuelto y probado (`esAcuseAmbiguo`, `__tests__/orchestrator.test.js`)
- Entrada: nodo con pregunta "¿Te funciona jueves o viernes?" → "Ok".
- Respuesta esperada: se repite la misma pregunta del nodo, sin avanzar.
- Campos actualizados: ninguno.
- Estado: mismo nodo, sesión activa.
- Siguiente acción: esperar "jueves" o "viernes" explícito.

**TEST 4 — Cliente quiere visita pero no ha dado dirección** ✅ resuelto y probado
- Con el nuevo nodo obligatorio, este caso ya no ocurre en el flujo normal (dirección se pide antes de la hora). Como defensa adicional: si por cualquier motivo `capturedFields.direccion` llegara vacío al ejecutar `agendar_cita_con_horario_solicitado`, la acción devuelve `{tipo: 'faltan_datos', campos: ['direccion']}`.
- Respuesta esperada: "¿me compartes la dirección completa — calle, número y colonia — donde sería la visita?" — nunca confirma.
- Campos actualizados: ninguno confirmado; **cero fila creada en `citas`**.
- Estado: la sesión se reabre (mismo criterio ya existente para `sin_disponibilidad`) — **limitación conocida compartida con ese camino**: reabrir reinicia el workflow desde el nodo de inicio, no desde donde quedó.
- Siguiente acción: el cliente retoma el flujo desde el principio.

**TEST 5 — Cliente proporciona ciudad pero no colonia**
- Entrada: ciudad real, luego "no sé" en `preguntar_colonia`.
- Respuesta esperada: "no sé" no es un acuse genérico (no dispara la guardia) → se captura literalmente y avanza a `preguntar_pisos`.
- Campos actualizados: `ciudad=<real>`, `colonia="no sé"`.
- Estado: avanza.
- Siguiente acción / **limitación conocida**: no hay validación de "colonia vacía/no sé" — solo de campo totalmente en blanco. No resuelto en este ciclo.

**TEST 6 — Cliente ya había proporcionado dirección anteriormente** ✅ ya funciona (mecanismo existente + mi fix de determinismo)
- Entrada: en un turno anterior al nodo de dirección, el cliente ya la mencionó espontáneamente junto con la ciudad.
- Respuesta esperada: si la IA la extrajo ese turno (o quedó pre-guardada), el auto-advance (`_avanzarSaltandoRespondidos`) salta `preguntar_direccion` sin volver a preguntarla.
- Campos actualizados: `direccion=<ya capturada>`.
- Estado: avanza automáticamente hasta `preguntar_hora_preferida`.
- Siguiente acción: pregunta directamente por el horario.

**TEST 7 — Cliente manda dos veces el mismo recibo**
- Entrada: segunda foto del mismo recibo, en un nodo que pide otro dato (ej. `preguntar_cobertura`).
- Respuesta esperada: `preSalvarDatosExtraidos` NO sobrescribe el importe ya guardado (protección existente). Pero el resumen sintético del recibo ("El cliente envió su recibo de CFE...") se usa como respuesta del nodo ACTUAL (cobertura), que no tiene relación con el recibo.
- Campos actualizados: `importe_promedio_recibo` se mantiene igual (no se duplica); `pct_cobertura_deseado` queda con el texto del resumen del recibo (dato sucio).
- Estado: avanza.
- Siguiente acción / **limitación conocida**: un adjunto que llega cuando el nodo activo pide otra cosa "ensucia" ese campo. Mejora futura: si el recibo se reconoce pero ninguno de sus campos coincide con `nodo.campo`, no usar el resumen como respuesta del nodo — no resuelto en este ciclo.

**TEST 8 — Cliente cambia la fecha después de confirmar** ✅ protegido
- Entrada, después de que la cita ya se creó de verdad: "mejor cámbiala para el viernes".
- Respuesta esperada: sin sesión activa (ya completada), conversación libre. `reagendar_cita` no está en las capacidades autorizadas de Nort Energy → se bloquea; como es una acción sensible de agenda, el texto se reemplaza por "Voy a coordinar tu visita técnica con nuestro equipo y te confirmo la fecha y hora en breve." — nunca confirma un cambio que no ocurrió.
- Campos actualizados: ninguno; la cita real en `citas` no se toca.
- Estado: sin workflow activo.
- Siguiente acción / **decisión deliberada**: reagendar por WhatsApp no está habilitado todavía para Nort Energy — requiere las mismas precondiciones duras antes de activarse, en una fase futura.

**TEST 9 — Cliente pregunta precio antes de terminar el cuestionario**
- Entrada, en medio del flujo (ej. `preguntar_tipo_techo`): "¿cuánto cuesta más o menos?"
- Respuesta esperada: el nodo usa `modo_respuesta: 'replace_ai'` — ignora lo que el modelo hubiera respondido sobre precio y envía la pregunta fija del nodo. El texto de la pregunta de precio se captura como si fuera la respuesta de `tipo_techo` (dato sucio).
- Campos actualizados: `tipo_techo` queda con texto no relacionado.
- Estado: avanza con dato sucio.
- Siguiente acción / **limitación conocida, preexistente, no introducida por este trabajo**: el sistema no detecta preguntas del cliente en medio de un nodo `replace_ai` para responderlas antes de seguir. Fuera del alcance que pude cubrir en este ciclo — lo marco como pendiente real, no lo doy por resuelto.

**TEST 10 — Cliente abandona la conversación y regresa posteriormente**
- Entrada, días después: "hola, sigo interesado".
- Respuesta esperada: la sesión sigue `activo` (no hay expiración automática) — el sistema la retoma en el mismo nodo. Si el saludo no es un acuse ambiguo reconocido, se captura tal cual como respuesta del campo pendiente (dato sucio).
- Campos actualizados: el campo del nodo activo queda con el saludo.
- Estado: activo, mismo nodo (con posible dato sucio).
- Siguiente acción / **limitación conocida**: no hay lógica de "retomar" ni expiración de sesiones inactivas. No resuelto en este ciclo.

**TEST 11 — Cliente no sabe voltaje ni fases** ✅ resuelto
- Las preguntas ya NO inducen una respuesta — actualizadas en producción: "¿Sabes si tu servicio es 110/127V o 220V? Si no lo sabes, no hay problema — nuestro técnico puede verificarlo durante la visita." (mismo criterio para monofásica/bifásica/trifásica).
- Entrada: "no sé".
- Respuesta esperada: se captura tal cual ("no sé") y avanza — el motor de ingeniería debe tratarlo como dato faltante, no como un valor inventado.
- Estado: avanza.
- Siguiente acción: el técnico verifica en la visita (ya lo dice la pregunta).

**TEST 12 — Cliente tiene negocio/industria con consumo elevado**
- Entrada: `tipo_propiedad="negocio"`, consumo/importe altos.
- Respuesta esperada: mismo flujo, sin bifurcación especial — el sistema no tiene hoy ninguna regla que trate distinto un consumo alto (ni la pedía la auditoría explícitamente como bloqueo).
- Campos actualizados: valores reales, altos, capturados sin filtro.
- Estado: avanza normalmente.
- Siguiente acción: cotización/motor de ingeniería con esos valores reales.

**TEST 13 — Cliente rentará el inmueble o el inmueble es rentado**
- La migración agregó la columna `oportunidades.propiedad_propia` (boolean) para uso del CRM/manual, **pero ningún nodo del workflow la pregunta todavía** — no estaba en el alcance de nodos que agregué (solo dirección, que era el hallazgo crítico de la auditoría).
- Estado actual: el dato no se captura por WhatsApp.
- Siguiente acción / **pendiente real, no resuelto en este ciclo**: agregar el nodo si se decide que es un dato de calificación crítico — la columna ya existe, lista para cuando se agregue.

**TEST 14 — El mismo cliente ya tiene una oportunidad activa** ✅ resuelto y probado
- Entrada: cliente con una oportunidad abierta (`estado != 'Perdido'`) completa el workflow de nuevo.
- Respuesta esperada: `crearOportunidadSiCorresponde` no crea una segunda oportunidad (dedup ya existente) — los nuevos `captured_fields` (dirección, consumo, etc.) se aplican como **UPDATE** a la oportunidad existente en vez de perderse.
- Campos actualizados: la oportunidad existente se enriquece con los datos nuevos.
- Estado: sin cambio en el conteo de oportunidades.
- Siguiente acción: el asesor ve el CRM actualizado con la calificación más reciente.

**TEST 15 — El cliente escribe después de que la visita ya fue confirmada** ✅ protegido
- Entrada: "gracias!" o "¿a qué hora era?" después de una cita real ya creada.
- Respuesta esperada: conversación libre (sesión completada, no se puede volver a completar). Si la IA no propone ninguna acción de agenda, responde libremente sin riesgo. Si llegara a proponer `agendar_cita_con_horario_solicitado` de nuevo (fuera de capacidades), se bloquea y el texto se reemplaza por el mensaje honesto de coordinación — nunca se crea una segunda cita ni se contradice la real.
- Campos actualizados: ninguno.
- Estado: sin workflow activo.
- Siguiente acción: ninguna acción automática; la cita real ya existente en `citas` es la única fuente de verdad.

---

## Resumen de cobertura

**Resueltos y con test automatizado:** 3, 4, 6, 8, 11, 14, 15 (7 de 15).
**Ya funcionaban correctamente antes de este trabajo (verificados, no rotos):** 6 (auto-advance), 14 (dedup).
**Limitaciones conocidas, documentadas, NO resueltas en este ciclo** (fuera del alcance que pude cubrir con el tiempo disponible — señaladas explícitamente, no ocultadas): 1 (recibo del primer mensaje), 2 y 5 y 7 y 9 y 10 (captura de datos no válidos/sucios como texto libre — necesitaría una capa de validación por tipo de campo), 13 (propiedad propia/rentada no se pregunta todavía).

Estas limitaciones no son regresiones — son comportamiento preexistente que la auditoría original ya señalaba como parte de un rediseño más amplio (rule #6, estados `missing/captured/inferred/needs_confirmation/confirmed` por campo) que no alcancé a construir completo en este ciclo. Lo honesto es dejarlo documentado para una siguiente fase, no reportarlo como resuelto.
