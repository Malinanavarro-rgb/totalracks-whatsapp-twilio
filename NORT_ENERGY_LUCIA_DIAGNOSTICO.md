# Lucía (Nort Energy) — Diagnóstico y propuesta de implementación

**Fecha:** 2026-10-15
**Estado:** diagnóstico + propuesta — cero código tocado. Espera tu autorización antes de implementar, tal como pediste.

---

## 1. Diagnóstico del comportamiento actual

### El caso real, encontrado y confirmado palabra por palabra

Busqué la conversación exacta que describiste. Existe, cliente real (id 258), hilo `4cbdd833-...`:

```
[cliente] Vi su anuncio y quería preguntar si hacen mantenimiento o limpieza de los paneles?
[Lucía]   El mantenimiento de los paneles solares es mínimo. Principalmente, se trata de una
          limpieza periódica para evitar que el polvo afecte su rendimiento. No tienen partes
          móviles que se desgasten, por lo...
[cliente] Quiera saber el precio de la limpieza
[Lucía]   Por lo general, la limpieza de paneles no tiene un costo fijo, ya que depende del
          tamaño del sistema y la frecuencia de la limpieza. Sin embargo, es un servicio que
          suele realizarse de forma periódica...
```

**Resultado confirmado:** cero oportunidad creada para este cliente (`oportunidades` vacío para el id 258), a pesar de que la palabra "precio" está en la lista de triggers que normalmente dispara una oportunidad.

### La causa raíz — no es un bug, es un vacío de instrucciones

Revisé `personalities` (tabla real, no código) para Nort Energy. "Lucía" ya existe, con una configuración cuidada: 16 reglas, tono bien definido, nivel de iniciativa, longitud de respuesta — todo pensado. **El problema es que el 100% de esas reglas, el `objetivo` completo y los `campos_requeridos` están diseñados para UNA sola cosa: calificar un prospecto para la venta de un sistema solar nuevo.**

El campo `objetivo` dice textualmente: *"Calificar al prospecto por completo... y agendar una visita técnica gratuita para cotizar **su sistema solar**."* No hay una sola palabra sobre mantenimiento, limpieza, garantías, trámites CFE o financiamiento como motivos de contacto independientes. Cuando un cliente real pregunta por limpieza, Lucía no tiene ninguna instrucción que le diga qué hacer — cae al conocimiento general de `knowledge_base` (la sección GARANTIA, que dice casi literalmente lo que respondió) en vez de activar un comportamiento comercial.

### El segundo hallazgo — el precio real existía y nunca llegó al modelo

Encontré algo que cambia la propuesta: **ya existe una tarifa real para este servicio.** La tabla `servicios` (la misma que usa el motor de agenda para reservar citas) tiene:

| Servicio | Precio | Duración |
|---|---|---|
| mantenimiento paneles | **$500 MXN** | 30 min |
| instalación sistema fotovoltaica | $800 MXN* | 360 min |
| Visita técnica residencial/comercial | $0 (gratuita) | 60-90 min |

*(nota: este precio de "instalación" en `servicios` parece ser el costo de la visita de instalación, no el sistema completo — el sistema completo lo calcula el motor de ingeniería, no esta tabla.)*

**El precio de $500 por mantenimiento nunca llegó a la conversación** porque esta tabla `servicios` solo la consulta el motor de agenda (`SchedulingEngine`, al momento de reservar una cita) — nunca se inyecta al contexto conversacional libre. Es exactamente el mismo tipo de hueco que ya se cerró en septiembre para el catálogo técnico de productos (`modules/catalogo-tecnico.js`) — y la solución es reutilizar el mismo patrón, no inventar uno nuevo.

### El tercer hallazgo — el catálogo de intenciones es demasiado genérico

El schema que el modelo debe llenar (`modules/prompt-builder.js`, bloque `FORMATO DE RESPUESTA`) limita `intenciones` a 7 valores, todos genéricos y reutilizados por cualquier empresa de TARA: `interes_compra | solicitud_cotizacion | solicitud_visita_tecnica | soporte | seguimiento | cancelar_flujo | consulta_general`. Una consulta real de mantenimiento, garantía, financiamiento o seguimiento CFE cae por defecto en `soporte` o `consulta_general` — categorías demasiado amplias para disparar un comportamiento comercial diferenciado.

### Lo que SÍ funciona y no requiere ningún cambio

- El mecanismo de crear oportunidades (`crear_oportunidad`, ya disponible por defecto — `CAPACIDADES_FASE2`) — el modelo simplemente nunca lo propuso para esta conversación, no porque no pudiera, sino porque nada en sus instrucciones le dijo que debía.
- La deduplicación de oportunidades, la clasificación de contacto (punto 8, recién implementado), el aislamiento multiempresa — todo esto ya corre por debajo sin cambios.
- El `SchedulingEngine` real para agendar citas — ya consulta disponibilidad real, nunca inventa horarios.
- El motor de ingeniería para paneles nuevos — ya no se toca, sigue siendo la única fuente de cálculo de sistemas.

---

## 2. Arquitectura — dónde vive cada pieza (sección 11 de tu pedido)

| Pieza | Archivo | Es código o dato | Se toca |
|---|---|---|---|
| Prompt del system/personalidad de Lucía | tabla `personalities` (leída por `modules/prompt-builder.js`) | **DATO**, no código | Sí — solo datos |
| Construcción del prompt final | `modules/prompt-builder.js` | Código | No — ya soporta todo lo que se necesita |
| AIProvider (llamada a OpenAI) | `adapters/ai/openai-provider.js` | Código | Mínimo — ampliar `INTENCIONES_VALIDAS` (catálogo global) |
| Orchestrator | `modules/orchestrator.js` | Código | No |
| WorkflowEngine | `modules/workflow-engine.js` | Código | No — el flujo de mantenimiento/limpieza NO necesita un workflow estructurado, es una consulta simple de 2-3 datos, la conversación libre ya alcanza |
| Knowledge Base | tabla `knowledge_base` | Dato | No, se complementa con el nuevo módulo de servicios |
| Catálogo de servicios con precio | tabla `servicios` | Dato (ya existe) | No — solo falta EXPONERLO a la IA |
| CRM / oportunidades | `modules/crm.js` | Código | No — ya construido en el punto 8, solo necesita que el modelo proponga la acción |
| Clasificación de intenciones | `modules/clasificacion-contexto.js` + schema del prompt | Código (catálogo global) | Sí — ampliar, aditivo |
| Sistema de cotizaciones | `modules/cotizaciones.js`, `modules/cotizacion-lineas.js` | Código | No |
| SchedulingEngine | `modules/scheduling-engine.js` | Código | No |

**Conclusión de la auditoría de arquitectura: el 90% de lo que pides es un cambio de DATOS (la fila de `personalities` de Nort Energy), no de código.** El único código nuevo real es un módulo de 100 líneas que expone `servicios` a la conversación — mismo patrón ya probado para `productos`.

---

## 3. Prompt conversacional mejorado (propuesta de DATOS — tabla `personalities`)

No reconstruyo el prompt desde cero — **amplío** el `objetivo` y agrego reglas nuevas a las 16 que ya existen, en el mismo formato que ya usa el sistema.

### `objetivo` — propuesta de redacción ampliada
> "Identificar qué necesita el cliente — un sistema solar nuevo, mantenimiento o limpieza de un sistema existente, una reparación, información de garantía, seguimiento de un trámite CFE, o financiamiento — y avanzarlo hacia el siguiente paso comercial correspondiente: cotización y visita técnica para sistemas nuevos, o agendar el servicio con precio real para mantenimiento/limpieza."

### Reglas nuevas (se agregan a las 16 existentes, no las reemplazan)

1. *"Si el cliente pregunta por mantenimiento, limpieza o reparación de un sistema YA instalado (no una venta nueva), es una oportunidad comercial distinta — nunca la trates como calificación de venta de paneles nuevos. Usa el bloque CATÁLOGO DE SERVICIOS REAL de este turno si está disponible — nunca inventes un precio ni digas que 'no tiene costo fijo' si el catálogo real sí tiene una tarifa."*
2. *"Para cotizar mantenimiento o limpieza, solo necesitas 2 datos: cuántos paneles tiene instalados y en qué ciudad — nunca repitas el cuestionario completo de calificación de venta nueva (consumo, tipo de techo, etc.), eso es solo para sistemas nuevos."*
3. *"Nunca uses frases como 'será un placer asistirte', 'estoy aquí para ayudarte en lo que necesites', 'permíteme brindarte información detallada' ni 'nuestro compromiso es ofrecer soluciones innovadoras' — suena a robot. Habla como lo haría una asesora real por WhatsApp."*
4. *"Nunca termines un mensaje con '¿en qué más puedo ayudarte?' — ya está como regla de estilo, pero además: termina con la pregunta comercial específica que corresponda a la intención detectada (ver reglas de flujo)."* (refuerzo explícito — la regla ya existe pero no estaba vinculada específicamente a mantenimiento/limpieza)
5. *"Si detectas interés en garantía, responde con las condiciones reales del CATÁLOGO/KNOWLEDGE BASE (25 años paneles, 10 años inversor) y pregunta el número de serie o la fecha aproximada de instalación para ubicar su registro — nunca prometas una cobertura sin verificarla."*
6. *"Si detectas interés en financiamiento, usa el bloque FINANCIAMIENTO de la base de conocimiento (planes a 12/24/36 meses) y pregunta el monto aproximado que buscan financiar — nunca inventes una tasa ni una mensualidad exacta."*
7. *"Si el cliente pregunta por el estado de su trámite CFE, es una conversación de POSTVENTA de un cliente ya existente — no repitas el discurso de ventas; si no tienes el dato exacto, dile que un asesor lo va a revisar y registra la solicitud."*

**Nota importante sobre contenido inventado:** no armé ninguna regla con precios o condiciones que no estén ya en `servicios`/`knowledge_base` real — exactamente la misma disciplina "nunca inventes" que ya rige las 16 reglas actuales.

### `campos_requeridos` — sin cambios
Los campos actuales (consumo, tipo de techo, etc.) son correctos para venta nueva. El flujo de mantenimiento/limpieza usa sus propios 2 datos (paneles + ciudad), capturados vía `datos_extraidos` libre, sin necesitar una lista de campos obligatorios nueva — exactamente como ya funciona para preguntas directas de precio (regla existente #14: "no hagas un interrogatorio").

---

## 4. Cambios de código necesarios (mínimos, aditivos)

### 4.1 Nuevo módulo: `modules/servicios-relevantes.js`
Copia exacta del patrón de `modules/catalogo-tecnico.js` (mismo criterio de coincidencia de palabras ya usado en 3 lugares distintos del código, sin IA, sin dependencias nuevas): busca en `servicios` (la misma tabla que ya usa el agendado) los servicios cuyo nombre coincide con el mensaje del cliente, y los agrega a `knowledge_base` como:

```
## CATÁLOGO DE SERVICIOS REAL (coincide con este mensaje)
Usa ÚNICAMENTE estos precios — nunca digas "no tiene costo fijo" si aquí hay una tarifa.
- mantenimiento paneles: $500 MXN (30 min)
```

Se engancha en `modules/orchestrator.js` exactamente como ya está enganchado `obtenerCatalogoTecnicoRelevante` — dependencia opcional, null-safe, cero cambio de comportamiento para empresas sin tabla `servicios` poblada.

### 4.2 `adapters/ai/openai-provider.js` + `modules/prompt-builder.js`
Ampliar el catálogo global de `intenciones` con: `solicitud_mantenimiento`, `solicitud_limpieza`, `solicitud_reparacion`, `solicitud_garantia`, `consulta_financiamiento`, `seguimiento_tramite`. Es un catálogo **global** (compartido por todas las empresas de TARA) — aditivo y de bajo riesgo: una empresa que nunca use estos valores simplemente nunca los ve en sus respuestas (el modelo solo usa lo que tiene sentido para el giro de cada empresa, guiado por `knowledge_base`/`reglas` de cada una).

### 4.3 Nada más
`modules/crm.js`, `modules/orchestrator.js`, `modules/workflow-engine.js`, el motor de cotizaciones y el `SchedulingEngine` — **cero cambios**. Ya hacen lo que se necesita; solo les faltaba que el modelo decidiera usarlos para este tipo de conversación, y eso se resuelve con el prompt (sección 3) + el dato real disponible (sección 4.1).

---

## 5. Pruebas — antes (real, ya capturado) y después (esperado)

**ANTES (real, capturado arriba, sección 1):** respuesta genérica, sin precio real, sin pregunta de datos, sin oportunidad creada.

**DESPUÉS (esperado, una vez implementado — pendiente de probarse en vivo tras tu autorización):**
```
[cliente] Vi su anuncio y quería preguntar si hacen mantenimiento o limpieza de los paneles?
[Lucía]   ¡Claro! Sí hacemos limpieza y mantenimiento de sistemas instalados.
          ¿Cuántos paneles tienes y en qué ciudad?
[cliente] Tengo 12 paneles, en Monterrey
[Lucía]   Perfecto. El mantenimiento tiene un costo de $500 — ¿te gustaría que agendemos
          la visita? Tengo disponibilidad esta semana.
```
Con oportunidad creada (`categoria_principal: "Mantenimiento"`, clasificación `prospecto`), sin reconstruir nada del CRM — mismo mecanismo del punto 8.

---

## 6. Los 12 casos de prueba (sección 12 de tu pedido) — comportamiento esperado

| Caso | Entrada | Comportamiento esperado tras la implementación |
|---|---|---|
| A | Solicita limpieza | Reconoce el servicio, pregunta paneles + ciudad (regla nueva #2) |
| B | Pide precio de limpieza | Responde con el precio real de `servicios` ($500), no "no tiene costo fijo" |
| C | Tiene 12 paneles | Dato capturado en `datos_extraidos`, no se vuelve a preguntar (regla de memoria, ya existente) |
| D | Instalación de 6 paneles | Flujo de venta nueva sin cambios — motor de ingeniería, campos de calificación actuales |
| E | Envía recibo CFE | Sin cambios — ya funciona (`modules/recibo-cfe.js`, validado esta sesión) |
| F | Pregunta financiamiento | Usa bloque FINANCIAMIENTO real de knowledge_base (regla nueva #6) |
| G | Mantenimiento correctivo (reparación) | Mismo flujo que A/B, categoría "Reparación" |
| H | Pregunta por garantía | Usa condiciones reales (25/10 años), pide dato para ubicar registro (regla nueva #5) |
| I | Seguimiento CFE | Trato como postventa, no como venta nueva (regla nueva #7) |
| J | Cambia de limpieza a instalación | La clasificación se re-evalúa cada turno (ya construido en punto 8) — cambia de flujo sin reiniciar la conversación |
| K | Repite la misma pregunta | Deduplicación ya construida (punto 8) — no crea oportunidad doble |
| L | Llega de Facebook | Atribución ya construida (`lead-atribucion.js`, sin tocar) — se conserva igual |

**Honestidad sobre esta tabla:** es el comportamiento que el diseño predice, no una prueba ya ejecutada contra el modelo real — eso requiere implementar primero. En la entrega de implementación (si la autorizas) incluiré las 12 conversaciones simuladas de verdad, con la respuesta real del modelo, antes y después.

---

## 7. Integración con CRM y cotizaciones

Sin cambios de código — se apoya 100% en lo que ya se construyó en el punto 8 de la auditoría:
- `crearOportunidadSiCorresponde` ya crea una oportunidad con `tipo_rack: categoria_principal` — si el modelo devuelve "Mantenimiento" en vez de "Paneles solares", la oportunidad queda naturalmente etiquetada distinto, sin tocar el código.
- El bloqueo por clasificación (`conversacion_personal`/`numero_equivocado`/`spam`) sigue aplicando igual — un cliente real interesado en limpieza se clasifica `prospecto`, nunca se bloquea.
- La deduplicación existente evita oportunidades repetidas si el cliente insiste con el mismo tema.

---

## 8. Riesgos

- **Catálogo de intenciones global:** aditivo y de bajo riesgo, pero es compartido por todas las empresas de TARA — cualquier cambio ahí se revisa con cuidado antes de tocar el archivo real (no solo para Nort Energy).
- **Cambiar el `objetivo`/reglas de personalidad:** es un cambio de comportamiento real de la IA en producción — se debe probar con conversaciones simuladas antes de aplicarlo a tráfico real, igual que cualquier cambio de prompt.
- **Costo:** el nuevo bloque de servicios agrega texto al prompt solo cuando hay coincidencia real — mismo patrón de costo marginal que ya tiene el catálogo técnico, no es un aumento significativo.
- **No se toca la arquitectura congelada** — ningún cambio en Orchestrator, WorkflowEngine ni ContextBuilder. No se afecta a ninguna otra empresa de TARA salvo por el catálogo global de intenciones (aditivo, invisible para quien no lo use).

---

Quedo a la espera de tu autorización antes de implementar.
