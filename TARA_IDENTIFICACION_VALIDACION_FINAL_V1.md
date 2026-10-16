# TARA Matrix™ — Validación final previa al despliegue
### Ciclo de identificación "Carlos González" / Nort Energy
**Fecha:** 2026-10-16 · **Estado:** Validado localmente · **NO desplegado**

Esta validación corre sobre lo ya entregado en `TARA_IDENTIFICACION_CICLO_CARLOS_GONZALEZ_ENTREGA_V1.md`. No se agregó ninguna funcionalidad nueva — solo pruebas, una auditoría, y una corrección de alcance encontrada durante la auditoría (ver punto 4).

---

## 1. Verificación del flujo completo (no solo Orchestrator aislado)

Construí `__tests__/integracion-identificacion-workflow.test.js` — una prueba de integración real distinta de `orchestrator.test.js`. Usa:

- **WorkflowEngine real** (`modules/workflow-engine.js`), no mockeado.
- **CRM real** (`modules/crm.js` — `obtenerOCrearCliente`/`guardarConversacion`/`obtenerHistorial`), no mockeado.
- **identificacion-contacto real** (`modules/identificacion-contacto.js`), no mockeado.
- **Orchestrator real**, no mockeado.

Todo esto corre contra una base de datos en memoria que implementa el mismo contrato que usa el código real (`.from().select().eq()...`), sembrada con una copia fiel del workflow real "Cotización directa — ingeniería solar" (mismos 7 nodos, mismo texto, leídos en vivo y solo-lectura de Supabase para esta prueba). Lo único sustituido es la llamada a OpenAI (proveedor con guion fijo, determinista) y la transacción SQL en sí — sin esto no hay forma de integrarlo sin credenciales/base de datos reales.

Lo que SÍ quedó fuera a propósito: la ejecución real de `ejecutar_motor_ingenieria` (productos, irradiación, cálculos) — esa ya tiene su propia suite intacta (`cotizaciones-fase2.test.js`); aquí se usa un ActionRunner espía para observar si la acción fue AUTORIZADA, no para re-probar el motor de ingeniería.

**Confirmado con datos reales de la sesión** (`workflow_sessions.captured_fields`, `clientes.nombre`/`motivo_consulta`): el texto que el cliente ve siempre corresponde al nodo que el workflow de verdad cree estar esperando — no hay forma de que vuelvan a desalinearse, porque ahora es el mismo texto el que determina ambos lados (ver Bug A en la entrega original).

## 2. Identificación en un solo mensaje

Prueba: *"Hola, soy Carlos González y quiero cotizar paneles solares para mi casa"* — **PASA**:
- Nombre identificado y persistido en `clientes.nombre` (fila real de la DB en memoria, no un mock).
- Motivo identificado y persistido en `clientes.motivo_consulta`.
- Ninguna pregunta repetida — el nodo `preguntar_nombre` se saltó porque el dato ya venía en el mismo mensaje.
- Continúa hacia el siguiente dato real (`¿En qué ciudad o municipio está la instalación?`).

**Hallazgo de esta validación, no un defecto de la corrección**: el sistema **no tiene hoy ningún campo ni lógica de "tipo de instalación residencial/comercial"** — ni en el schema del modelo (`prompt-builder.js`), ni en el motor de ingeniería, ni en ningún nodo de workflow. Lo audité directamente (`grep` sobre los 3 módulos, sin resultados). "Para mi casa" queda como texto libre dentro de `motivo_consulta`, nunca como un dato estructurado reconocido o verificable. No implementé nada para simular que existe — lo señalo en vez de reportar un falso positivo. Si quieres esa capacidad, es un desarrollo nuevo, no parte de esta corrección.

## 3. Identificación progresiva

Reproduje una conversación turno a turno (nombre → ubicación → consumo → recibo → cobertura → tipo de alimentación → voltaje) con el mismo patrón del incidente original. Resultado:
- El nombre se pregunta **exactamente una vez** en toda la conversación — nunca se repite después de contestado (esto es, literalmente, la prueba de que el ciclo infinito ya no ocurre).
- `captured_fields` acumula los 7 datos correctamente, sin mezclarse ni perderse.
- El motivo nunca se dio en esta conversación (reproduciendo el incidente real) → la acción comercial queda bloqueada, el motor de ingeniería **nunca se ejecuta** (cero cotizaciones prematuras).
- La sesión permanece **una sola** (nunca se creó una segunda), con `current_node` en el nodo final — nunca se reinició a `preguntar_nombre`.

## 4. Requisitos técnicos — auditoría (con una corrección real)

Audité `modules/motores-ingenieria/paneles-solares.js::generarAlertas()` — las condiciones de bloqueo REALES del motor son:
- `consumo_faltante`: requiere `consumoMensualKwh` **O** `historialConsumo` (alternativa válida, no ambos).
- `hsp_faltante`: requiere que `ubicacion` resuelva a una región conocida.
- `potencia_requerida_error`: requiere `pctCoberturaDeseado` válido.

**Encontré que mi primera versión exigía también `importe_promedio_recibo` como obligatorio — esto era incorrecto.** El motor real nunca lo exige para el cálculo base (solo alimenta `calcularAhorro()`, un dato complementario). Lo corregí: `CAMPOS_TECNICOS_REQUERIDOS_COTIZACION` ahora es `['ubicacion', 'pct_cobertura_deseado']` + una verificación de `consumo_mensual_kwh` **O** `historial_consumo_kwh` (≥12 meses, mismo umbral que ya usa `_historialConsumoOrNull`) — igual que el motor real, nunca más estricto. Agregué 7 pruebas nuevas que fijan este comportamiento (incluida la alternativa de historial y la NO-obligatoriedad del importe de recibo), para que una futura regresión no vuelva a sobre-restringir esto.

`tipo_alimentacion`/`voltaje_sitio` siguen fuera del requisito — el motor sí los marca con alerta de bloqueo si faltan, pero el propio nodo invita a responder "no sé" porque la empresa decidió resolverlo en la visita técnica; exigirlos aquí sería una regla nueva que bloquearía cotizaciones legítimas, exactamente lo que pediste evitar.

## 5. Integridad de datos

| Requisito | Resultado |
|---|---|
| No se crean cotizaciones prematuras | Verificado en la prueba de integración: 0 llamadas al ActionRunner mientras falta cualquier requisito (identificación o técnico) |
| No se generan cálculos persistentes sin requisitos suficientes | Mismo mecanismo — `ejecutar_motor_ingenieria` nunca corre si `camposTecnicosFaltantes()` encuentra huecos |
| No se duplican oportunidades | Cubierto por la guarda de idempotencia ya existente (Prioridad 5, incidente 83) — sin cambios en este ciclo |
| No se sobrescriben nombres válidos | `actualizarIdentificacionAutomatica` nunca sobreescribe con menor confianza (sin cambios — módulo no tocado) |
| No se mezclan empresas | Prueba de integración nueva: mismo teléfono en 2 empresas distintas nunca comparte nombre ni sesión |
| No se reinician workflows | Prueba de integración: 1 sola sesión en toda la conversación, `current_node` nunca vuelve al inicio |

## 6. Revisión del despliegue

- **Commit exacto:** no existe todavía — estos cambios están **sin commitear** en la rama `main` (el último commit real es `183e432`, ya confirmado en producción). No crearé el commit ni haré push sin tu autorización explícita.
- **Archivos modificados:** `adapters/ai/openai-provider.js`, `adapters/ai/mock-provider.js`, `modules/orchestrator.js`, más 3 archivos de prueba nuevos/ampliados (`__tests__/orchestrator.test.js`, `__tests__/openai-provider.test.js`, `__tests__/integracion-identificacion-workflow.test.js`).
- **Migraciones pendientes:** ninguna. Ningún cambio de esquema — todo usa columnas ya existentes (migración 132, ya corrida).
- **Pruebas aprobadas:** 2529/2529, 126 suites, cero regresiones (incluye las 6 pruebas nuevas de esta validación).
- **Compatibilidad con código productivo:** no se tocó `WorkflowEngine`, `ActionRunner` (clase), `modules/identificacion-contacto.js`, `modules/cotizaciones.js`, ni los 2 endpoints manuales del CRM.
- **Procedimiento de reversión:** revert de un solo commit, sin dependencia de migración — restaura el comportamiento anterior íntegro (incluyendo el bug del ciclo, que ya está activo en producción desde antes).

---

## Riesgos que podrían afectar a clientes actuales

- **Sesiones de workflow ya corrompidas antes de este fix** (captured_fields mezclados de conversaciones previas al despliegue) no se reparan solas — este fix evita que vuelva a pasar, no corrige datos históricos.
- **Sin reanudación automática**: un cliente que complete el workflow mientras falta su identificación necesita volver a pedir la cotización en un mensaje posterior — el sistema no retoma la acción bloqueada solo. Gap conocido, documentado, no resuelto (requeriría un mecanismo nuevo).
- **Validación semántica de nodos no implementada** — una respuesta fuera de orden todavía podría capturarse en el campo equivocado, aunque el mecanismo que lo causó en el incidente real (Bug A) ya está cerrado.
- **"Tipo de instalación residencial/comercial"** no existe como dato estructurado — si esperabas que ya funcionara, es una capacidad nueva por desarrollar, no parte de esta corrección.

**No se hizo push ni se desplegó nada.** Quedo a la espera de tu autorización.
