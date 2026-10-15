# TARA AI Engine Architecture V1

**Fecha:** 2026-10-16
**Estado:** arquitectura + estrategia — cero código tocado, cero datos modificados, cero migraciones, cero despliegues. Espera tu autorización antes de implementar.

---

## Resumen ejecutivo

Segunda sorpresa de esta auditoría, tan importante como la primera: **buena parte de lo que pides como "TARA AI Engine" ya existe, construido en fases anteriores, bajo otros nombres.** No partimos de "una interfaz conectada a OpenAI" — partimos de:

- **Business Memory Core (BMC)** — memoria empresarial persistente con ciclo de vida completo (propuesto → confirmado/rechazado/obsoleto), ya con las barreras de control que pides en tu sección 3 y 6 (confianza mínima, validación humana obligatoria, nunca escribe memoria confirmada sola).
- **Knowledge Consolidation Engine (KCE)** — ya hace exactamente lo que pides en tu sección 6 ("detectar duplicados, contradicciones, obsolescencia... nunca aplicar solo") — por diseño explícito, "el KCE no podrá confirmar, rechazar, fusionar, marcar obsoleto ni modificar memoria confirmada — solo podrá proponer."
- **Modo Operador** — un motor de razonamiento con **tool-calling real e iterativo** (hasta 5 iteraciones, 18 herramientas reales ya registradas), deliberadamente separado del motor conversacional porque resuelve un problema distinto (preguntas abiertas de dirección vs. conversación estructurada con un cliente).
- **AIProvider/AIEngine** — ya es un contrato agnóstico de proveedor, con fallback automático en cadena (primario → respaldo → Mock). Agregar Anthropic hoy es escribir una clase nueva, no rediseñar nada.

Lo genuinamente nuevo que propongo: **unificar estas 3 piezas bajo una sola identidad y gobernanza ("TARA AI Engine")**, conectarlas al Module Engine (para que la IA nunca pueda usar una herramienta que la empresa no tiene contratada), y llenar los huecos reales (medición de costo/consumo, selección de modelo por tipo de tarea, evaluación sistemática) — no reconstruir lo que ya funciona.

---

## 1. Capacidades actuales de inteligencia artificial

| Capacidad que pides | Estado real | Evidencia |
|---|---|---|
| Razonamiento y planificación de tareas | **Parcial** — el motor conversacional (Orchestrator) es de un solo paso por turno (clasifica + decide 1 acción + responde), sin planificación multi-paso. Modo Operador SÍ planifica/itera (hasta 5 ciclos de tool-calling) pero solo para preguntas gerenciales, no conversación con clientes | `modules/orchestrator.js`, `modules/operador-engine.js:MAX_ITERACIONES_TOOLS` |
| Memoria empresarial persistente | **Ya existe, madura** | `modules/business-memory-core.js` |
| Comprensión del contexto | **Ya existe** | `modules/context-builder.js` (no auditado línea por línea en esta pasada, ya confirmado funcional en toda la sesión) |
| Ejecución de herramientas | **Ya existe, dos sabores distintos** — ActionRunner (1 acción fija por turno, conversación con cliente) y tool-calling real iterativo (Modo Operador, solo lectura/escritura de memoria, uso interno gerencial) | `modules/orchestrator.js` (ActionRunner), `modules/operador-tools.js` |
| Automatizaciones inteligentes | **Parcial** — `workflow_seed` por industria + WorkflowEngine ejecuta flujos estructurados predefinidos, no automatizaciones que la IA diseñe sola | `modules/workflow-engine.js` |
| Consulta de información empresarial | **Ya existe** | Modo Operador: `buscar_cliente`, `resumen_pipeline`, `buscar_documentos`, etc. |
| Análisis de datos | **Ya existe, básico** | `tareas_abiertas`, `proyectos_en_riesgo`, `decisiones_recientes` (Modo Operador) |
| Aprendizaje supervisado mediante retroalimentación | **Ya existe el mecanismo de propuesta/confirmación (BMC+KCE)** — lo que NO existe es retroalimentación sobre la CALIDAD de las respuestas conversacionales en sí (ver sección 9) | — |
| Coordinación de procesos | **Ya existe** | Orchestrator + WorkflowEngine |
| Gestión de permisos | **Ya existe, pero NO conectada al uso de herramientas de IA todavía** — `esGerencial()` gatea Modo Operador completo; no hay un chequeo "¿esta empresa tiene el módulo de Inventario activo?" antes de que la IA pueda tocar inventario | `modules/permisos.js` |
| Registro y auditoría de decisiones | **Ya existe, maduro** | `decision_logs`, `modules/audit-logger.js` — cada llamada de IA, cada acción, cada error queda registrado |

**Lo que genuinamente falta:** (a) planificación multi-paso en la conversación con clientes (hoy solo Modo Operador itera), (b) automatización "de diseño propio" más allá de workflows predefinidos, (c) retroalimentación sobre calidad conversacional, (d) medición de costo/consumo agregada, (e) selección de modelo por tipo de tarea, (f) la conexión Module Engine ↔ qué puede usar la IA.

---

## 2. Componentes reutilizables (no se tocan sin justificar)

`Orchestrator`, `WorkflowEngine`, `ContextBuilder`, `PromptBuilder`, `ActionRunner`, `AIProvider`/`AIEngine`, `business-memory-core.js`, `kce.js`, `operador-engine.js`/`operador-tools.js`, `audit-logger.js`/`decision_logs`. Ninguno se reemplaza en esta propuesta.

---

## 3. Arquitectura propuesta — TARA AI Engine como paraguas, no como reemplazo

```
                    ┌─────────────────────────────────┐
                    │         TARA AI ENGINE           │  ← nombre/identidad unificada,
                    │  (gobernanza, selección de       │     no un motor nuevo desde cero
                    │   modelo, costo, auditoría)       │
                    └───────────────┬─────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
   ┌────────▼────────┐    ┌─────────▼─────────┐   ┌─────────▼─────────┐
   │   Orchestrator    │    │   Modo Operador    │   │  Business Memory   │
   │  (conversación     │    │  (razonamiento      │   │  Core + KCE         │
   │   con clientes,     │    │   gerencial, tool-   │   │  (memoria,           │
   │   ActionRunner)     │    │   calling iterativo) │   │   propuesta→humano) │
   └────────┬────────┘    └─────────┬─────────┘   └─────────────────────┘
            │                       │
            └───────────┬───────────┘
                         │
              ┌──────────▼──────────┐
              │   AIEngine / AIProvider  │  ← ya agnóstico de proveedor
              │  (OpenAI hoy, Anthropic/ │
              │   abierto mañana)        │
              └──────────────────────────┘
```

**No propongo fusionar Orchestrator y Modo Operador en un solo agente.** Son dos superficies con reglas de seguridad distintas (uno habla con el cliente final, el otro solo con gerencia) y mezclarlos aumentaría el riesgo sin necesidad real. Lo que sí propongo: que AMBOS consulten el mismo Module Engine antes de ofrecer una herramienta (sección 5), y que ambos reporten a la misma capa de métricas/costo (sección 11).

---

## 4. Estrategia de independencia de modelos

`AIProvider` ya es el contrato correcto — confirmado en el propio código: *"Para agregar un proveedor nuevo: 1. Crear clase que extienda AIProvider, 2. Implementar procesar() y calcularCosto(), 3. Registrar en AIEngine... El Core no cambia."* Esto ya es exactamente lo que pides en tu sección 2 — no hay que diseñarlo, hay que **usarlo más**:

| Función (tu tabla) | Estrategia recomendada | Proveedor/modelo sugerido hoy |
|---|---|---|
| Conversaciones sencillas | Modelo económico | `gpt-4o-mini` (ya es el default) |
| Ventas complejas | Modelo con mayor capacidad | `gpt-4o` (ya soportado, solo falta usarlo selectivamente) |
| Análisis empresarial (Modo Operador) | Modelo de razonamiento | Evaluar modelo de razonamiento extendido cuando el caso de uso lo justifique — no cambiar hoy sin medir calidad/costo real primero |
| Clasificación de mensajes | Modelo pequeño/clasificador | Ya usamos `gpt-4o-mini` para esto — es correcto, no tocar |
| Extracción de documentos | Modelo compatible con documentos | Ya resuelto (`modules/adjuntos-ia.js::describirDocumento`, `pdf-parse` + visión — construido esta sesión, 2026-10-05) |
| Procesos internos | Modelo local cuando sea viable | Evaluar en Fase 3 (ver sección 12) — no antes, requiere infraestructura propia |

**Selección de modelo por tarea — diseño propuesto, no implementado:** un `SelectorDeModelo` ligero (nueva pieza, pequeña) que decida `modelo` antes de armar el `AIInput` — hoy `modelo` viene fijo de `personality.modelo` por empresa; la propuesta es que, además, cada TIPO DE LLAMADA (clasificación, conversación, Modo Operador, extracción de documento) pueda tener su propio override, sin que la empresa tenga que configurar cada uno a mano. Mecanismo de respaldo: ya existe (`AIEngine`, fallback en cadena) — se reutiliza tal cual.

**Anthropic/modelos abiertos — qué evaluar antes de elegir, sin comprometer una decisión hoy:**
- Anthropic (Claude): mejor para razonamiento/instrucciones largas y seguimiento de reglas complejas (relevante para Modo Operador y para el volumen de reglas que ya tiene la personalidad de Lucía). Vía API — mismo patrón de adapter.
- Llama/Qwen/Mistral (abiertos): viables para clasificación/tareas de bajo riesgo si se ejecutan en infraestructura propia o contratada (reduce costo marginal, aumenta complejidad operativa). Qwen y Mistral tienen licencias permisivas (Apache 2.0 en varias versiones); Llama tiene licencia propia con condiciones de uso comercial a revisar según volumen. **No recomiendo decidir el modelo abierto específico en este documento** — es una decisión que depende de resultados de prueba reales, no de la arquitectura.

---

## 5. Memoria empresarial y conexión con el Module Engine

El BMC **ya resuelve** la mayoría de tu sección 3 y 6: categorías de memoria, ciclo de vida completo, validación humana obligatoria, nunca sobrescribe memoria confirmada sola. Lo confirmo explícitamente aquí porque es la pieza más madura de todas las auditadas.

**La conexión nueva, genuinamente pendiente — el punto que pediste como "especialmente importante":**

```
Empresa → Plan contratado → modulos_empresa (activo=true) → permisos del usuario (roles_permisos)
       → catálogo de herramientas que TARA AI puede OFRECER a ese turno/esa sesión
       → al ejecutar, se revalida TODO de nuevo (nunca solo al construir el prompt)
```

Propuesta concreta: una función `resolverHerramientasAutorizadas(companyId, usuarioOClienteContext)` (nueva, pequeña, capa de plataforma) que:
1. Consulta `modulos_empresa` (del Module Engine) — qué módulos están activos.
2. Cruza con `roles_permisos` — qué puede hacer ESE rol específico.
3. Devuelve la lista de `acciones_propuestas`/tools permitidas para ESTE turno — nunca una lista estática por empresa.

Esta función alimenta TANTO `bloque_capacidades()` (lo que el prompt le dice al modelo que puede proponer) COMO una segunda validación dentro de `ActionRunner.ejecutar()`/`ejecutarTool()` antes de correr la acción de verdad — exactamente tu requisito de la sección 4: *"La autorización debe validarse nuevamente al ejecutar la acción, no solamente al mostrar la herramienta a la IA."* Hoy el ActionRunner YA valida permisos de negocio dentro de cada handler (ej. `requirePermiso` en las rutas) — lo que falta es el filtro de MÓDULO ACTIVO antes de eso, que es exactamente lo que construye el Module Engine.

**Ejemplo concreto con tus propias empresas A/B:** hoy, si Nort Energy desactivara (hipotéticamente) el módulo de Inventario, el ActionRunner seguiría pudiendo proponer `reservar_material` porque `bloque_capacidades()` no sabe nada de módulos — solo de `personality.capacidades`. Con `resolverHerramientasAutorizadas()`, esa acción simplemente no aparecería en el prompt, y si por algún motivo igual llegara (ej. un turno con memoria de conversación vieja), la revalidación en `ActionRunner` la rechazaría antes de tocar la tabla real.

---

## 6. Herramientas y ejecución de acciones — estado real, no aspiracional

- **ActionRunner (conversación con clientes):** 1 acción por turno, catálogo fijo por empresa (`personality.capacidades`, default `['crear_oportunidad']`). Robusto, probado, pero deliberadamente simple — no itera.
- **Modo Operador (gerencial):** tool-calling real, iterativo (hasta 5 ciclos), 18 herramientas ya registradas, mezcla de lectura (`buscar_cliente`, `resumen_pipeline`) y escritura controlada (las 5 tools de BMC: proponer/confirmar/rechazar/marcar obsoleto — nunca una escritura directa sin ciclo de propuesta).

**Propuesta:** ampliar gradualmente el catálogo de `ActionRunner` (más acciones disponibles por turno conversacional: agendar cita, consultar precio de servicio — ya posible hoy con `personality.capacidades`, solo falta poblarlo) antes de intentar que el motor conversacional itere como Modo Operador. Es un cambio de alcance (más herramientas) antes que un cambio de arquitectura (planificación multi-paso) — más seguro, más barato, y resuelve el 90% de los casos reales (ver `NORT_ENERGY_LUCIA_DIAGNOSTICO.md`).

---

## 7. Sistema de agentes especializados — evaluación honesta

Siguiendo tu instrucción explícita de evaluar primero si un solo agente basta: **sí basta, con el diseño actual, para el volumen de hoy.**

- La "especialización" que describes (SALES/OPERATIONS/FINANCE/SUPPORT/MANAGEMENT) ya existe, pero como **configuración de personalidad por contexto**, no como agentes separados: Lucía (ventas, conversación con clientes) y Modo Operador (gerencial, multi-rol) ya son, de facto, dos "agentes" con propósitos distintos, compartiendo el mismo núcleo (AIEngine, BMC, decision_logs) — exactamente tu requisito de que no se vuelvan aplicaciones independientes.
- Introducir 5 agentes con nombre propio hoy multiplicaría prompts, costos de mantenimiento y superficie de prueba sin un beneficio medible — ningún caso de uso real de Nort Energy hasta ahora necesita que "TARA FINANCE" razone distinto de "TARA OPERATIONS" dentro de la misma conversación.
- **Recomendación:** mantener un núcleo con DOS superficies (conversación + Modo Operador), cada una con sus propias herramientas autorizadas por el Module Engine — y revisar la necesidad de agentes adicionales solo si aparece un caso real donde una sola superficie no alcance (ej. un proceso que necesite planificar 10 pasos encadenados sin intervención humana — no existe ese caso hoy).

---

## 8. Seguridad y aislamiento multiempresa

Sin cambios al mecanismo ya auditado exhaustivamente esta sesión (company_id explícito en cada query, nunca confiar en el frontend). Lo nuevo que agrega el AI Engine: el `alcance` que ya usa Modo Operador (`{ nivel, organization_id?, company_id? }`, calculado SIEMPRE por el servidor desde la sesión autenticada, nunca por el LLM) es el patrón correcto a **replicar**, no a rediseñar, para cualquier herramienta nueva que se agregue al catálogo.

---

## 9. Estrategia de aprendizaje y evaluación — distinciones que pides, sin confundir conceptos

- **Memoria** (BMC): hechos de negocio confirmados por humanos. Ya existe.
- **Recuperación de información** (RAG básico ya presente: `catalogo-tecnico.js`, `faq-solar.js`, el nuevo `servicios-relevantes.js` propuesto): inyectar datos reales al prompt. Ya existe.
- **Optimización de instrucciones** (lo que de verdad falta): hoy nadie mide sistemáticamente si una respuesta de Lucía fue buena o mala — no hay conjunto de evaluación, no hay puntaje de calidad por conversación. Propuesta: usar `decision_logs` (ya captura cada `aiOutput` completo) como semilla de un conjunto de evaluación — marcar manualmente un lote de conversaciones reales como "buena respuesta" / "oportunidad perdida" (exactamente lo que detectamos a mano en el diagnóstico de Lucía) y usarlas para iterar reglas de `personality.reglas`, nunca para reentrenar nada automáticamente.
- **Entrenamiento de modelos** (fine-tuning o modelo propio): **no existe ni se recomienda todavía** — ver sección 10. Nunca presentar lo anterior como si fuera esto.

---

## 10. Viabilidad de modelos propios

| Opción | Costo | Infraestructura | Cuándo tendría sentido |
|---|---|---|---|
| A. API comercial (hoy) | Variable por uso, sin inversión fija | Ninguna propia | Situación actual — correcta mientras el volumen no justifique lo contrario |
| B. Modelo abierto en infraestructura propia/contratada | Fijo (servidor/GPU) + mantenimiento | Requiere equipo de MLOps o proveedor gestionado | Cuando el volumen de llamadas de bajo riesgo (clasificación, extracción simple) sea alto y constante — reduce costo marginal pero sube costo fijo |
| C. Fine-tuning de un modelo abierto | Medio (cómputo de entrenamiento + datos) | Requiere conjunto de datos de calidad (sección 9) | Después de tener un conjunto de evaluación real de varios meses — no antes |
| D. Entrenar desde cero | Muy alto (millones de pesos, equipo especializado) | Alta | **No recomendado** — ninguna ventaja económica o técnica demostrable frente a A-C con el volumen actual de TARA |

Coincido con tu propia conclusión: no invertir en modelo fundacional ahora. La secuencia correcta es A (hoy) → evaluar B/C cuando exista suficiente volumen y un conjunto de evaluación real (sección 9) → D solo si B/C demuestran un techo real que lo justifique, algo que hoy no se puede afirmar con evidencia.

---

## 11. Costos estimados

No existe hoy ninguna agregación de costo real (confirmado: `AIProvider.calcularCosto()` existe pero nunca se invoca ni se guarda en ningún lado) — es el primer hueco a cerrar, antes de cualquier decisión de modelo propio, porque sin esto cualquier comparación de costos es una suposición.

**Propuesta mínima:** cada llamada ya trae `tokens_entrada`/`tokens_salida`/`modelo_utilizado` en `aiOutput` y se audita en `decision_logs` — agregar un cálculo de costo en el mismo punto donde hoy se loguea (no una tabla nueva, un cálculo sobre un dato que ya se guarda), y una vista/consulta que lo sume por organización/mes. Esto alimenta directamente los "límites de consumo de IA" que quedaron pendientes en `TARA_SAAS_CORE_ARCHITECTURE_V1.md` sección E.

---

## 12. Fases de implementación

| Fase | Contenido | Depende de |
|---|---|---|
| 1 | Medición de costo real por organización (sección 11) — sin esto, nada de lo comercial se puede decidir con datos | Nada — se puede hacer en paralelo al Module Engine |
| 2 | `resolverHerramientasAutorizadas()` — conecta Module Engine ↔ ActionRunner/Modo Operador (sección 5) | Module Engine Fase 0-2 (`TARA_SAAS_CORE_ARCHITECTURE_V1.md`) |
| 3 | Ampliar catálogo de `ActionRunner` para conversación con clientes (agendar, consultar precio real — sección 6) | Fase 2 |
| 4 | Conjunto de evaluación real + optimización de instrucciones (sección 9) | Fase 1 (necesita datos de costo/volumen para priorizar qué evaluar primero) |
| 5 | Evaluación de modelos abiertos/fine-tuning (solo si Fase 4 demuestra volumen y necesidad) | Fase 4 |

---

## 13. Riesgos y dependencias

- **No fusionar prematuramente Orchestrator y Modo Operador** — son seguros por estar separados; unificarlos sin necesidad real aumentaría la superficie de ataque (un cliente final nunca debe poder alcanzar las herramientas de BMC/KCE).
- **Medir antes de migrar a modelo abierto** — sin datos reales de costo (Fase 1), cualquier decisión de infraestructura propia es una apuesta, no una decisión informada.
- **No vender "IA independiente de OpenAI/Anthropic" mientras se siga dependiendo de ellos** — coincido con tu propia nota: la propiedad tecnológica real está en la orquestación, la memoria, las herramientas y las automatizaciones — no en el modelo de lenguaje subyacente. Documentado explícitamente en la sección 14.
- **El Module Engine es una dependencia dura de la sección 5** — sin él, "la IA solo usa lo autorizado por plan" sigue siendo una promesa, no una garantía backend.

---

## 14. Propiedad tecnológica — qué es nuestro, qué es de terceros

**Tecnología propia de TARA (reutilizable, documentable como propiedad intelectual):**
- Orchestrator, WorkflowEngine, ActionRunner, ContextBuilder, PromptBuilder — la orquestación completa.
- Business Memory Core + KCE — el sistema de memoria con ciclo de vida y gobernanza humana.
- Modo Operador — el motor de razonamiento gerencial con tool-calling.
- `plantillas_industria` — el sistema de especialización por industria.
- El futuro Module Engine (`modulos_catalogo`/`modulos_empresa`) y `resolverHerramientasAutorizadas()`.
- Los adapters de canal (Twilio/Meta WhatsApp) y de calendario.
- El motor de ingeniería solar y cualquier motor de industria futuro.

**De terceros, bajo licencia/contrato, nunca propiedad de TARA:**
- Los modelos de lenguaje en sí (OpenAI, Anthropic, o cualquier modelo abierto usado vía API o self-hosted bajo su licencia original).
- Supabase, Render, Twilio, Meta Cloud API, Stripe — infraestructura y servicios contratados.

---

## 15. Pruebas (antes de implementar cualquier fase)

- `resolverHerramientasAutorizadas()`: empresa sin módulo activo → herramienta ausente del prompt Y rechazada si se intenta ejecutar igual.
- Aislamiento: alcance de Modo Operador nunca cruza organización/empresa (ya hay cobertura — ampliar con el nuevo filtro de módulos).
- Selector de modelo: cada tipo de tarea resuelve al modelo esperado; fallback en cadena sigue funcionando si el proveedor primario falla (regresión sobre tests ya existentes de `AIEngine`).
- Medición de costo: el cálculo coincide con `calcularCosto()` ya probado en cada provider; la agregación por organización suma correctamente sobre un período.

---

## 16. Decisiones que requieren tu autorización

1. Confirmar que "TARA AI Engine" es el nombre paraguas de lo ya existente + las piezas nuevas — no un motor construido desde cero (evita expectativas equivocadas hacia el equipo/inversionistas).
2. Autorizar la Fase 1 (medición de costo) — es la base de toda decisión comercial posterior, bajo riesgo, sin tocar producción.
3. Confirmar el orden de fases de la sección 12, o ajustar prioridad.
4. Decidir explícitamente NO entrenar modelo propio por ahora (ya parece ser tu posición — lo dejo para tu confirmación formal, ya que condiciona cómo se puede comunicar comercialmente).
5. Autorizar la ampliación del catálogo de `ActionRunner` para conversación con clientes (Fase 3) — es la mejora de mayor impacto inmediato para Nort Energy (conecta directo con `NORT_ENERGY_LUCIA_DIAGNOSTICO.md`).

---

## Recomendación final — qué implementar primero

**Fase 1 de este documento (medición de costo) + Fase 0-1 del Module Engine (`TARA_SAAS_CORE_ARCHITECTURE_V1.md`), en paralelo.** Ninguna de las dos toca producción, ninguna depende de una decisión de negocio todavía pendiente (como la política de límites de consumo), y ambas son la base factual que necesitas antes de prometer nada comercialmente — "qué cuesta de verdad" y "qué puede usar cada empresa" son las dos preguntas que hoy no se pueden responder con datos, solo con intención de diseño.

No se tocó ningún archivo de código, ninguna migración, ningún dato. Quedo a la espera de tu autorización.
