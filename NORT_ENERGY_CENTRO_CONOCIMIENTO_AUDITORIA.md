# Auditoría — Centro de Conocimiento Solar Nort Energy

**Fecha:** 2026-09-15. Auditoría únicamente — cero cambios de código, tal como pediste.

**Hallazgo principal, antes de entrar al detalle:** lo que pides como "Modo 2 — personal interno" **ya existe como arquitectura real y probada** — se llama **Modo Operador** (`modules/operador-engine.js` + `modules/operador-tools.js`), ya corre en producción, ya tiene tool-calling real (el modelo consulta datos reales antes de responder, nunca inventa), ya está separado a propósito del motor conversacional de clientes (Core, ADR-005), y ya está expuesto en el panel ("Pregúntale a TARA", en Operaciones.jsx / Panel de Acción). Lo que falta no es construirlo — es **darle más herramientas** y **ampliar quién puede usarlo**. Esto cambia radicalmente el tamaño real del proyecto: es mucho más pequeño de lo que el pedido original sugería.

---

## 1. Arquitectura propuesta

Dos motores de IA que YA EXISTEN y siguen separados a propósito (correcto, no cambiar):

- **Motor conversacional de clientes** (Orchestrator/Core, ADR-005) — WhatsApp, ya enriquecido esta sesión con `catalogo-tecnico.js` y `faq-solar.js`. Es tu **Modo 1 — Cliente/Ventas**.
- **Modo Operador** (`operador-engine.js`, tool-calling libre) — ya es, en esencia, tu **Modo 2 — Personal interno**. Responde con datos reales vía herramientas registradas en un catálogo (`CATALOGO_TOOLS`), con `alcance` (empresa/organización/plataforma) y `usuario` siempre calculados por el servidor — nunca por el modelo.

Lo que se propone es **extender ambos motores con herramientas/datos nuevos**, no construir un tercer sistema:

- Agregar tools nuevas a `operador-tools.js`: `consultarProductoTecnico`, `consultarFaqSolar`, `analizarConversacionParaCoach`, `convertirRespuestaParaCliente`.
- Reusar `catalogo-tecnico.js`/`faq-solar.js` (ya construidos esta sesión) como la MISMA fuente de datos para ambos modos — Modo Cliente los usa en lenguaje sencillo con venta consultiva; Modo Operador los usa con profundidad técnica completa. Una sola base, dos formas de hablar — exactamente lo que pediste ("la misma base técnica debe alimentar ambos modos").
- Reusar `inbox-analisis.js` (ya construido, ya en producción) como base del Sales Coach — ya calcula probabilidad de compra, riesgos, recomendaciones, próxima acción desde una conversación real.

---

## 2. Tablas existentes reutilizables

| Necesidad tuya | Tabla/mecanismo real ya existente |
|---|---|
| Catálogo de productos SOLES con specs, proveedor, fuente | `productos` (ya extendida esta sesión: proveedor, fuente, fecha_fuente, costos internos separados) |
| FAQ de clientes | `solar_faq` (ya construida esta sesión, 44 preguntas cargadas) |
| Motor de ingeniería / validación técnica | `modules/motores-ingenieria/paneles-solares.js` + `calculos_ingenieria` (inmutable, versionado) |
| Preguntas internas del personal, con datos reales | `modules/operador-engine.js` + `operador-tools.js` — YA EXISTE |
| Análisis de conversación (base del Sales Coach) | `modules/inbox-analisis.js` + tabla `analisis_hilo` — YA EXISTE |
| Roles/permisos | `usuarios_empresas.rol` + `modules/permisos.js` (`esGerencial`) |
| Memoria institucional confirmada | `bitacora_decisiones`, `documentos` (texto/markdown), Business Memory Core (`business-memory-core.js`) |
| Almacenamiento de archivos reales | Patrón de Storage ya probado: buckets `inbox-adjuntos`, `cotizaciones-pdf` (`modules/inbox-adjuntos.js`, `modules/cotizacion-pdf.js`) |
| Extracción de datos de un documento (PDF/imagen) sin inventar | `modules/recibo-cfe.js` — mismo patrón aplicable a fichas técnicas de SOLES |
| CRM / cotizaciones / pipeline | Ya construido en fases anteriores (`crm.js`, `cotizaciones.js`, `oportunidades` ya con columnas solares) |

---

## 3. Tablas nuevas necesarias

- **`knowledge_requests`** (tu `NEW_KNOWLEDGE_REQUEST`): question, employee_id, category, created_at, answer_status (pendiente/respondida/rechazada), source_needed, respuesta_validada, validado_por, validado_en.
- **`faq_analytics`** (opcional, fase posterior): faq_id, times_asked, leads_asking (array o tabla puente), conversion_after_question, common_followup, common_objection — requiere decidir cómo se detecta "se preguntó esto" de forma confiable (ver riesgos, sección 11).
- **`documentos_proveedor`** — ya propuesta en la auditoría anterior (especialista solar), sigue pendiente de implementar: PDF/ficha técnica real con extracción asistida, nunca auto-publicada.
- Posible **`sales_coach_sesiones`** si quieres guardar el historial de análisis de conversaciones pegadas manualmente (no seria necesaria si solo se analiza vía `analisis_hilo`, que ya persiste).

Ninguna reemplaza algo existente — todas aditivas.

---

## 4. Sistema de permisos

**Hoy es más simple de lo que tu spec asume**: `usuarios_empresas.rol` es texto libre documentado como `owner|administrador|supervisor|asesor`, sin más granularidad — no existe "instalador", "ingeniería" ni "postventa" como rol real. `esGerencial()` es un binario: gerencial (owner/administrador/supervisor) vs. no-gerencial (asesor). El Modo Operador HOY está gateado **solo a roles gerenciales** — un asesor no puede usarlo todavía.

Esto es una discrepancia real con lo que pides (CUSTOMER/SALES/TECHNICAL/MANAGER). Opciones, de menor a mayor esfuerzo:

- **A (mínimo, recomendado para empezar):** abrir Modo Operador a `asesor` también (no solo gerencial) — quita una condición, sin tocar el modelo de roles.
- **B:** agregar un campo `departamento` (texto libre: ventas/ingeniería/instalación/postventa) a `usuarios_empresas`, sin CHECK, mismo criterio que `rol` — permite filtrar qué tools ve cada quien sin construir un sistema de permisos granular nuevo.
- **C (mayor alcance, no recomendado para esta fase):** sistema de permisos por tool, tabla de permisos explícita — sobre-ingeniería para el tamaño actual del equipo de Nort Energy.

**Separación interno/cliente ya existe y ya se respeta**: `catalogo-tecnico.js::sanearProducto()` YA quita costo_proveedor/margen/costos internos antes de que cualquier dato de producto llegue a un prompt — el mismo saneo debe reutilizarse tal cual para las respuestas de Modo Operador cuando su resultado se vaya a convertir en "respuesta para cliente" (botón que pides en sección 12).

---

## 5. Flujo cliente

Sin cambios de arquitectura — ya construido esta sesión (Fase 1 especialista solar + FAQ):

Mensaje de WhatsApp → Orchestrator → (paralelo, null-safe) catálogo técnico real + FAQ relevante inyectados a `knowledge_base` → modelo responde con venta consultiva, lenguaje sencillo, 3 capas.

**Lo que falta para "cada respuesta clasifica el siguiente paso"** (EDUCAR/OBTENER_RECIBO/CERRAR_VENTA/etc., sección de cierres): hoy `aiOutput.etapa_sugerida` existe en el schema pero es una clasificación de ETAPA DEL CLIENTE (Nuevo/Calificación/Negociación/Cierre), no de INTENCIÓN DE LA RESPUESTA. Se necesitaría un campo nuevo en el schema de salida del modelo (`accion_comercial_sugerida`) — cambio pequeño y aditivo en `prompt-builder.js::bloque_schema_json`, sin tocar el Core.

---

## 6. Flujo empleado

Ya existe el entrypoint (`/api/operador/preguntar` → `operador-engine.preguntar()` → tool-calling → respuesta). Falta:

1. Abrir el acceso más allá de gerencial (sección 4, opción A o B).
2. Agregar tools nuevas al catálogo (`operador-tools.js`): consultar producto técnico (reusa `catalogo-tecnico.js`), consultar FAQ (reusa `faq-solar.js`), analizar conversación de un cliente real (reusa `inbox-analisis.js`/`analisis_hilo`), y una validación de compatibilidad panel+inversor bajo demanda (reusa `motores-ingenieria/paneles-solares.js::seleccionarInversor`/`calcularStrings` con datos que el empleado proporcione).
3. Botón "Convertir en respuesta para cliente" (sección 12) — una llamada adicional simple: toma el texto técnico interno + instrucción de "tradúcelo a lenguaje cliente, sanea cualquier dato interno" — reutiliza el mismo modelo, prompt distinto, no requiere infraestructura nueva.

---

## 7. Integración SOLES

Ya resuelta en la fase anterior (`productos` extendida con proveedor/fuente/costos separados, 55 productos reales cargados). Pendiente, no de esta fase: pipeline real de carga de documentos (PDF/Excel) — sigue siendo carga manual por script. Construirlo es la Fase 3 del plan de la auditoría "especialista solar" ya entregada.

---

## 8. Integración FAQ

Ya resuelta (`solar_faq`, `faq-solar.js`, 44 preguntas). Lo nuevo que pides aquí es la **analítica de frecuencia** (`faq_question`, `times_asked`, `conversion_after_question`) — tabla nueva (sección 3), pero requiere antes decidir CÓMO se detecta confiablemente "esta pregunta se hizo" de forma agregable (hoy el matching es por turno, no se loggea como evento) — ver riesgos.

---

## 9. Sales Coach

**Ya existe el 80% del motor** (`inbox-analisis.js`): de una conversación real ya calcula resumen, intención, sentimiento, probabilidad de compra, riesgos, recomendaciones, próxima acción, tareas sugeridas — SIN inventar, con el mismo criterio anti-alucinación ya validado. Falta:

- Aceptar una conversación PEGADA manualmente (hoy solo analiza hilos ya existentes en `hilos`/`mensajes`) — variante nueva y pequeña de `_armarContexto()`.
- Agregar al prompt existente: "qué hizo bien/mal el asesor", "qué preguntas fueron innecesarias/repetidas", "respuesta recomendada lista para enviar" — extensión aditiva del `SYSTEM_PROMPT` y del schema JSON de salida, mismo mecanismo, cero infraestructura nueva.

---

## 10. Sistema de fuentes

Ya parcialmente resuelto: `productos` (proveedor/fuente/fecha_fuente/verificado_en) y `solar_faq` (source/verified_at) ya guardan procedencia — mismo patrón que `parametros_ingenieria` ya probaba desde antes de esta sesión. Falta únicamente si decides construir `documentos_proveedor` (sección 3) para archivos reales versionados — hoy la fuente se guarda como texto libre, no como referencia a un documento real.

---

## 11. Cómo evitar alucinaciones

Ya implementado y probado en las dos fases anteriores de esta sesión:

- `catalogo-tecnico.js`: nunca presenta specs no confirmadas, marca explícitamente "ficha técnica pendiente de confirmar".
- `faq-solar.js`: banderas explícitas `requires_current_data`/`requires_customer_data`.
- Regla anti-alucinación + reglas de estilo ya agregadas a `personalities.reglas` de Nort Energy.
- Modo Operador YA fuerza tool-calling — "nunca inventes cifras, tareas o clientes que no confirmaste con una herramienta" ya está en su `SYSTEM_PROMPT` desde antes de esta sesión.

Lo único nuevo a reforzar: cuando se agreguen las tools de catálogo/FAQ a Modo Operador, deben devolver el mismo aviso de "ficha pendiente" que ya usa el modo cliente — mismo dato, mismo saneo, sin duplicar la regla.

---

## 12. Interfaz propuesta

- **Botón "Convertir en respuesta para cliente"**: aditivo en la UI donde ya se muestra la respuesta de Modo Operador (Operaciones.jsx / Panel de Acción) — no requiere pantalla nueva, un botón + una llamada adicional.
- **"Ayúdame a cerrar"**: variante de Sales Coach ya con contexto de una oportunidad específica del CRM — reusa `inbox-analisis.js` + datos ya disponibles en `oportunidades`/`cotizaciones`.
- **Centro de Conocimiento como pantalla dedicada** ("Pregúntale a TARA…" con categorías): sí sería una pantalla nueva de frontend — pero es una interfaz sobre el MISMO Modo Operador ya existente, con las tools nuevas — no es un backend nuevo, es UI nueva sobre infraestructura ya construida.

---

## 13. Fases de implementación (propuesta)

**Fase 1** — Abrir Modo Operador más allá de gerencial (sección 4-A) + agregar tools de catálogo/FAQ (reusan `catalogo-tecnico.js`/`faq-solar.js` tal cual). Riesgo bajísimo, mayor impacto inmediato para el equipo interno.

**Fase 2** — Sales Coach: extender `inbox-analisis.js` con "qué hizo bien/mal" + "respuesta recomendada" + variante para conversación pegada manualmente.

**Fase 3** — Botón "Convertir en respuesta para cliente" + "Ayúdame a cerrar" en la UI existente.

**Fase 4** — Pantalla dedicada "Centro de Conocimiento" (categorías, buscador).

**Fase 5** — `knowledge_requests` (aprendizaje del equipo) + analítica de frecuencia de FAQ — requiere antes decidir el mecanismo de detección confiable de "se preguntó esto".

**Fase 6 (más adelante)** — `documentos_proveedor` con extracción asistida de fichas técnicas reales (ya en el plan de la auditoría especialista solar).

---

## Veredicto de esta fase

El hallazgo más importante: **no hay que construir un Centro de Conocimiento desde cero — ya existe (Modo Operador), ya está en producción, ya es seguro (alcance/usuario siempre calculados por el servidor, tool-calling real, cero invención).** Lo que falta es (a) que más gente lo pueda usar, (b) darle las herramientas de catálogo/FAQ que ya construimos esta sesión, y (c) extender el análisis de conversaciones que ya existe para que también entrene y recomiende, no solo diagnostique. Es una ampliación, no una construcción nueva — el tamaño real del trabajo es una fracción de lo que el pedido original sugería.

Quedo a la espera de tu confirmación antes de implementar cualquier fase.
