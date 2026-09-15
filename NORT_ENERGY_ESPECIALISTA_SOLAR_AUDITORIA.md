# Auditoría — TARA como especialista técnica y comercial en energía solar (Nort Energy)

**Fecha:** 2026-09-15. Auditoría únicamente — cero cambios de código en este documento, tal como pediste.

---

## A. LO QUE YA EXISTE

Es más de lo que parece. El motor de ingeniería fotovoltaica (`modules/motores-ingenieria/paneles-solares.js`, 544 líneas) ya es genuinamente sofisticado — no es un cálculo superficial:

- **Selección de inversor por ficha técnica real**, no solo watts: valida `tipo_red`, `voltaje_salida_v` (±5%), `potencia_dc_max_kw`, y usa el ratio DC/AC como criterio de desempate entre candidatos ya compatibles — exactamente lo que pediste en tu sección 3.
- **Validación eléctrica de strings**: Voc corregido por temperatura del sitio, paneles por string dentro del rango MPPT (min y max), corriente total por MPPT contra el límite del inversor. Si falta cualquier dato técnico, marca `incompleto` — nunca asume.
- **HSP con fuente estructurada** (`irradiacion_regional`: valor, HSP mensual opcional, fuente, fecha_fuente) — nunca un número mágico.
- **Parámetros configurables con procedencia** (`parametros_ingenieria`: performance_ratio, factor_emision_co2, ratio_dc_ac_objetivo, factor_separacion_filas) — override por empresa si existe, si no cae a un default global, y cada valor guarda `organismo_fuente`, `anio_fuente`, `documento_fuente`. **Esto ya es, en miniatura, exactamente el patrón de trazabilidad de fuente que pides en tu sección 17** (`source`, `provider`, `updated_at`, `effective_from`, `version`) — solo que hoy solo existe para parámetros de ingeniería, no para productos.
- **Ahorro y retorno con lenguaje honesto ya integrado**: "ahorro **estimado**", "periodo **simple** de recuperación" (nunca "ROI financiero"), "aproximación basada en el costo efectivo actual — no simula la estructura escalonada completa de la tarifa CFE". Tu sección 12 (seguridad comercial) ya está resuelta a nivel de motor.
- **Cálculos inmutables y versionados** (`calculos_ingenieria`, nunca UPDATE, siempre INSERT con `version+1`) — tu sección 17 ("no reprogramar cuando cambien los datos") ya aplica aquí: un cambio de ficha técnica no borra el cálculo anterior, genera uno nuevo.
- **Catálogo de productos real** (`productos`: tipo, marca, modelo, sku, specs JSONB, `ficha_tecnica_completa` boolean, precio, garantia_meses, ficha_tecnica_url). Nort Energy tiene 5 productos reales: 2 inversores con ficha técnica completa (Growatt MIN 4000TL-X, Huawei SUN2000-40KTL-M3), 1 panel completo (Jinko Tiger Neo 550), y 2 **explícitamente incompletos/demo** (un microinversor Hoymiles sin precio ni ficha completa, y un panel OSDA marcado en su propia descripción como "datos de demostración").
- **Recibo CFE**: `modules/recibo-cfe.js` ya extrae por visión/texto (nunca inventa, `es_recibo_cfe: false` si no está claro), normaliza a mensual, y alimenta el motor — tu sección 7 ya funciona, con la limitación de determinismo que ya corregimos en la auditoría anterior (2026-09-15, mismo día).
- **PDF comercial que traduce ingeniería a lenguaje de venta** (`resumenEjecutivoParaPdf`): tarjetas con `disponible: true/false` — nunca rellena con un placeholder si el dato no existe. Ya resuelve buena parte de tu sección 9.
- **Motor Universal por industria** (`motores-ingenieria/index.js`, `obtenerMotor(industriaSlug)`): agregar una industria nueva es un archivo nuevo, no tocar el existente — mismo patrón que ya usa `dashboard-engine.js`/`KPI_TIPOS`. Este mecanismo es exactamente donde extender microinversores/baterías sin romper nada.

---

## B. LO QUE DEBEMOS MODIFICAR

- **El motor solo conoce inversores de string — nunca microinversores.** `productos.tipo = 'microinversor'` ya existe como dato (Hoymiles cargado), pero `calcularPredimensionamiento()` nunca lo consulta ni lo compara contra un inversor string. Tu sección 4 (cuándo recomendar microinversores vs. string) no tiene ningún soporte técnico hoy — la decisión, si TARA la da, sería inventada.
- **`knowledge_base` es texto genérico, no datos estructurados por marca/modelo.** Las 4 entradas de Nort Energy (BENEFICIOS, PROCESO, FINANCIAMIENTO, GARANTIA) son párrafos genéricos sin ninguna especificidad técnica — nada de esto ayuda a responder "¿este inversor aguanta 12 paneles?" con datos reales.
- **La conversación libre (fuera del workflow estructurado) no tiene acceso a `productos.specs`.** El motor de ingeniería SÍ los usa, pero solo se ejecuta al completar el workflow "Cotización directa". Si un cliente pregunta a media conversación "¿qué panel manejan?" o "¿aguanta 12 paneles este inversor?", el prompt que ve el modelo (`bloque_knowledge_base`) solo tiene el texto genérico de `knowledge_base` — **cero acceso programático a la ficha técnica real**. Aquí es donde hoy existe el riesgo real de alucinación que te preocupa.
- **`paquetes_solares` tiene datos de referencia, no reales.** 5 de 6 paquetes de Nort Energy tienen `componentes_incluidos: []` vacío; el único con contenido referencia el panel OSDA marcado como demo. Confirma lo que ya sabías: falta cargar el catálogo comercial real.
- **`productos` no distingue "confirmado por SOLES" de "cargado a mano/demo".** `ficha_tecnica_completa` (boolean) es la única señal de confiabilidad que existe hoy — no hay proveedor, no hay fecha de actualización, no hay versión.

---

## C. LO QUE FALTA

- **Ninguna tabla o campo asocia un producto a un proveedor (SOLES u otro).** `productos` no tiene columna `proveedor`.
- **Ninguna trazabilidad de origen del dato en `productos`** (a diferencia de `parametros_ingenieria`, que sí la tiene) — no hay `fuente`, `fecha_actualizacion`, `version`, `documento_fuente`.
- **Ningún pipeline de ingesta de documentos de proveedor** (PDF de ficha técnica, lista de precios, catálogo, Excel). `recibo-cfe.js` demuestra que la extracción por visión/texto de PDF/imagen YA es técnicamente viable en este proyecto (usa `pdf-parse` + visión GPT-4o-mini) — pero es un módulo narrow, específico de recibos CFE, no reutilizable directo para fichas técnicas de producto.
- **Ninguna interfaz de administración para `productos`/`paquetes_solares`.** Confirmé por grep: no existe ningún endpoint `/api/config/productos` ni pantalla en el panel — hoy solo se cargan por script directo a Supabase. Es el mismo patrón que ya usaste para cargar los 5 productos de Nort Energy.
- **Ninguna separación de precios** (costo proveedor / precio interno / precio lista / margen) — `productos.precio` es un solo campo, sin distinguir qué nivel de precio es.
- **Ningún bloque de prompt que exponga catálogo técnico estructurado a la conversación libre** — solo el texto plano de `knowledge_base`.
- **Ningún estado de dato por campo** (`CONOCIDO / FALTANTE / PENDIENTE DE VALIDACIÓN / NO APLICA`, tu sección 10/18) a nivel de conversación — existe una versión parcial equivalente a nivel de motor (`incompleto: true/false` con `motivo`), pero no como un estado explícito y consultable por campo del cliente.
- **Ningún soporte para baterías, sistemas híbridos, ni bombeo solar** en el motor — ni como tipo de producto, ni como lógica de cálculo.
- **Ninguna tabla para diagnóstico postventa** (tu sección 14: baja producción, fallas de inversor, códigos de error) — no existe hoy en ninguna forma.

---

## D. ARQUITECTURA PROPUESTA (alto nivel, sin implementar todavía)

Extender, no reemplazar — el motor y el patrón de trazabilidad de `parametros_ingenieria` ya son el modelo correcto:

1. **`productos` gana columnas de procedencia** (aditivo, nullable): `proveedor`, `fuente_documento`, `actualizado_en`, `vigente_desde`, `version` — mismo patrón que `parametros_ingenieria` ya prueba que funciona.
2. **Nueva tabla `documentos_proveedor`** (o extender `documentos` si se decide que vale la pena, aunque hoy es explícitamente texto/markdown — mejor una tabla nueva, más limpia): PDF/Excel subido, con `proveedor`, `tipo_documento` (ficha_tecnica/lista_precios/catalogo/garantia), `producto_id` relacionado si aplica, `procesado_en`, `datos_extraidos` (jsonb crudo antes de curar a `productos`).
3. **Un extractor de fichas técnicas** (mismo patrón que `recibo-cfe.js`: prompt estricto "nunca inventes, si no está claro devuelve null") que lee un PDF/imagen de ficha técnica y propone un borrador de `productos.specs` — **nunca se auto-publica**: queda pendiente de que un humano de Nort Energy confirme antes de que TARA lo use con un cliente real. Esto resuelve tu regla de oro (sección 18) al nivel de infraestructura, no solo de prompt.
4. **Nuevo bloque de prompt `bloque_catalogo_tecnico`** (o una acción tipo `consultar_ficha_tecnica`) que, cuando la conversación menciona una marca/modelo/tipo de equipo reconocible, consulta `productos` real y expone SOLO los campos que existen — nunca rellena huecos. Esto cierra el hueco más importante de la sección C.
5. **Motor extendido para microinversores**: nueva función `seleccionarMicroinversor()` (paralela a `seleccionarInversor()`) + una regla de decisión explícita (sombras declaradas → preferir microinversores si hay catálogo; sin sombras y proyecto grande → preferir string) — como tabla de reglas configurable, no un `if` fijo, siguiendo el mismo criterio de "config sobre código" del resto del proyecto.
6. **Separación de precios**: `productos` gana `costo_proveedor` (interno, nunca expuesto al cliente) separado de `precio` (ya existente, customer-facing) — o una tabla `precios_producto` si se necesita historial de cambios de precio con fecha.
7. **Interfaz mínima de administración** para que tu equipo cargue/edite productos sin tocar la base de datos a mano — puede ser tan simple como una tabla en Configuración, reusando el patrón ya existente de `crearServicio`/`crearKnowledgeBase`.

---

## E. TABLAS/CAMPOS NUEVOS NECESARIOS (propuesta, pendiente de tu confirmación)

- `productos`: + `proveedor text`, `fuente_documento text`, `actualizado_en timestamptz`, `vigente_desde date`, `version integer default 1`, `costo_proveedor numeric` (nunca expuesto al cliente).
- Nueva tabla `documentos_proveedor`: id, company_id, proveedor, tipo_documento, archivo_url (Storage, mismo patrón que `cotizaciones-pdf`/`inbox-adjuntos`), producto_id (nullable), datos_extraidos jsonb, confirmado_por, confirmado_en, created_at.
- `motores-ingenieria/paneles-solares.js`: nuevas funciones puras (`seleccionarMicroinversor`, `compararStringVsMicroinversor`) — sin tabla nueva, es código del motor.
- Opcional, fase posterior: tabla `diagnosticos_postventa` para tu sección 14 (fuera del alcance inmediato de esta fase, la marco para no perderla).

---

## F. FLUJO DE CONVERSACIÓN (con el conocimiento real disponible)

No cambia la arquitectura de workflows (nodos) que ya existe — el conocimiento técnico se vuelve accesible en **conversación libre**, antes/durante/después del workflow estructurado:

1. Cliente pregunta algo técnico ("¿qué panel manejan?", "¿este inversor aguanta 12 paneles?").
2. El nuevo bloque de prompt/acción consulta `productos` real por marca/modelo/tipo mencionado.
3. Si hay match con ficha completa → responde con datos reales, en lenguaje comercial (tu sección 9), ofreciendo detalle técnico solo si el cliente lo pide.
4. Si hay match pero ficha incompleta, o no hay match → "necesito confirmar esa ficha técnica con nuestro proveedor, te confirmo en breve" (tu regla de oro, sección 18) — **nunca inventa el dato**.
5. El workflow estructurado (dirección, recibo CFE, dimensionamiento) sigue exactamente como está — esto es aditivo, no lo reemplaza.

---

## G. SISTEMA DE CONOCIMIENTO DE SOLES (propuesta)

Jerarquía **PROVEEDOR → CATEGORÍA → MARCA → MODELO → FICHA TÉCNICA**, viviendo en `productos` (extendida) + `documentos_proveedor`, no en el prompt ni hardcodeada en código — mismo principio "config sobre código" de todo el proyecto. Cuando SOLES actualice un dato, se actualiza la fila de `productos` (o se sube un documento nuevo que un humano confirma) — cero cambio de código, cero redeploy, igual que agregar una industria nueva hoy es un INSERT en `plantillas_industria`.

---

## H. REGLAS ANTI-ALUCINACIÓN (a nivel de prompt + código)

- El motor de ingeniería ya las tiene en el cálculo (nunca inventa specs faltantes). Falta llevarlas a la conversación libre:
- Instrucción explícita en el prompt: "si el cliente pregunta una especificación técnica que no está en el bloque CATÁLOGO TÉCNICO, responde que necesitas confirmarlo, nunca la inventes ni la completes con conocimiento general."
- El bloque de catálogo técnico (D.4) es la única fuente que el modelo puede citar como "confirmado" — todo lo demás debe presentarse como conocimiento general fotovoltaico, nunca como specs de un modelo específico.
- `ficha_tecnica_completa = false` en un producto debe bloquear que TARA lo presente como oferta cerrada al cliente (mismo criterio que ya usa el motor con `estado_calculo: 'incompleto'`).

---

## I. PLAN DE IMPLEMENTACIÓN POR FASES (propuesta, para tu autorización)

**Fase 1 — Exponer el catálogo real a la conversación** (menor riesgo, mayor impacto inmediato): bloque de prompt/acción que consulta `productos` real. Sin tablas nuevas, sin tocar el motor. Cierra el hueco de alucinación más urgente.

**Fase 2 — Trazabilidad de origen en `productos`**: columnas aditivas (proveedor, fuente, fecha, versión). Sin romper nada existente.

**Fase 3 — Ingesta de documentos SOLES**: tabla `documentos_proveedor` + extractor de fichas técnicas (draft, nunca auto-publicado).

**Fase 4 — Motor: microinversores + comparación string vs. micro**.

**Fase 5 — Separación de precios (costo proveedor vs. cliente) + interfaz mínima de administración de productos.**

**Fase 6 (más adelante, fuera de alcance inmediato):** baterías/híbridos/bombeo solar, diagnóstico postventa.

---

## J. ARCHIVOS DEL PROYECTO QUE SE MODIFICARÍAN (por fase, estimado)

- Fase 1: `modules/prompt-builder.js` (nuevo bloque), `modules/context-builder.js` (pasar el catálogo relevante), posiblemente un nuevo `modules/catalogo-tecnico.js` (consulta a `productos`, mismo patrón que `modules/paquetes-solares.js`).
- Fase 2: migración SQL aditiva sobre `productos`.
- Fase 3: migración SQL para `documentos_proveedor`, nuevo módulo `modules/documentos-proveedor.js` (subida + extracción, reusando `modules/adjuntos.js`/patrón de Storage ya existente).
- Fase 4: `modules/motores-ingenieria/paneles-solares.js` (funciones nuevas, aditivas).
- Fase 5: migración SQL sobre `productos` (costo_proveedor), nueva pantalla en `frontend/src/pages/Configuracion.jsx` o similar.

**Ninguna fase toca WorkflowEngine, Orchestrator, ContextBuilder (salvo pasar un dato nuevo), PromptBuilder (salvo agregar un bloque), ni ningún archivo de otra empresa** — todo aditivo, todo aislado por `company_id`/`industria_slug`, mismo patrón que el resto del proyecto ya usa.

---

## Veredicto de esta fase

El motor de ingeniería es mucho más sólido de lo que la petición original sugería que temías — no hay que reconstruirlo, hay que **conectarlo a la conversación libre** y darle datos reales con procedencia. El riesgo de alucinación real y concreto hoy es uno solo, bien delimitado: preguntas técnicas fuera del workflow estructurado no tienen ningún acceso a la ficha técnica real. Ese es el punto de mayor impacto para la Fase 1.

Quedo a la espera de tu confirmación antes de implementar cualquier fase.
