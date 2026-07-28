# ADR-012 — El número principal de TARA-OS como Asistente Oficial de la plataforma

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Julio 2026 |
| Autora | Alina Navarro |
| Archivos | `migrations/081_asistente_oficial_tara_os.sql`, `modules/cuenta-plataforma.js` (nuevo), `modules/orchestrator.js`, `scripts/configurar-tara-os-asistente-oficial.js` |

---

## Contexto

El número de WhatsApp de la empresa "TARA-OS" (company_id `560ffa1d-32ef-462b-90ed-41228f15e444`) se construyó (ver conversación previa, script `crear-empresa-tara-demo-comercial.js`) como un bot de ventas puro — su único objetivo era vender TARA-OS a prospectos. La dueña del producto pidió convertirlo en el **Asistente Oficial de la plataforma**: un único punto de entrada para prospectos, clientes activos y usuarios internos, que dé soporte, facturación, configuración y seguimiento — no solo ventas.

Investigación de código (antes de escribir nada, ver hallazgos completos en la conversación) encontró que gran parte de la infraestructura para "saber quién escribe y qué cuenta tiene" **no existía**: `usuarios` no guardaba teléfono, no había tabla de tickets/soporte, y las integraciones activas estaban dispersas sin vista consolidada. Se decidió, con instrucción explícita de la dueña del producto, construir la arquitectura completa de una vez — interfaces listas para crecer, sin datos inventados donde algo todavía no existe.

## Decisión

### 1. Principio rector: el prompt define comportamiento, los servicios proveen datos

Instrucción explícita: *"Toda nueva capacidad... debe implementarse como un módulo o proveedor de servicios conectado al núcleo de TARA, no embebida dentro del prompt."* Se creó `modules/cuenta-plataforma.js` como la única fuente de datos reales de cuenta — el prompt (`personalities` de la empresa TARA-OS) nunca contiene cifras ni estados de cuenta como texto estático; siempre los consulta en tiempo real.

### 2. Modelo de datos nuevo (migración 081)

- `usuarios.telefono` (nullable, único cuando no es null) — el bridge que faltaba: hoy es el único lugar de toda la plataforma donde un número de WhatsApp entrante se puede resolver a "qué usuario de la plataforma es" (antes solo existía `clientes.telefono`, que son los clientes-finales de cada empresa tenant, un concepto distinto).
- `tickets_soporte` (organization_id, usuario_id, asunto, descripción, estado, prioridad, canal) — no existía ninguna tabla de soporte. `organization_id` (no `company_id`): el ticket pertenece al contrato con TARA-OS (Constitución Art. 9), no a una company operativa específica.
- `personalities.capacidades` (jsonb, nullable) — completa un TODO ya anotado en el propio código (`orchestrator.js`: *"FASE 4 (Action Runner) hará esto dinámico desde empresa_config"*). Nula/vacía para el 100% de las empresas existentes → cero cambio de comportamiento; solo TARA-OS la usa hoy.

### 3. `modules/cuenta-plataforma.js` — capacidades reales vs. interfaces listas

Reales, funcionando hoy (reusan tablas ya existentes, `plataforma-billing.js::obtenerSuscripcionVigente()` en vez de duplicar lógica):
- `resolverCuentaPorTelefono()` — teléfono → usuario + empresas que administra.
- `obtenerResumenSuscripcion()` — plan/estado real vía `suscripciones`/`planes`.
- `obtenerIntegracionesActivas()` — consolida `calendar_credentials` + `meta_whatsapp_credentials` (antes dispersas, sin vista única).
- `listarTicketsAbiertos()` / `crearTicket()` — CRUD real sobre `tickets_soporte`.

Interfaces listas, sin datos todavía (facturación real, estado de implementación, monitoreo — no existen esos módulos en la plataforma): `obtenerFacturas()`, `obtenerEstadoImplementacion()`, `obtenerMonitoreoServicio()` — mismo contrato `{disponible: false, motivo}` que usará la versión real el día que exista, para que activar la capacidad sea implementar la función, nunca tocar el prompt ni el flujo de conversación otra vez.

### 4. Cómo llega esto al modelo sin tocar el Core congelado (2 excepciones documentadas a ADR-005)

**Excepción 1 — `Orchestrator`: dependencia opcional `obtenerEnriquecimientoCuenta`.** Null-safe, mismo patrón ya usado para `workflowEngine`/`actionRunner` en el mismo constructor. Cuando está presente, en el paso 1 de `procesarMensaje()` se llama con `(company_id, message.from)` y su resultado (un array `{categoria, contenido}`, mismo formato que `knowledge_base`) se concatena a `empresaConf.knowledge_base` — antes de que `ContextBuilder` lo procese. Si el teléfono no resuelve a ninguna cuenta (el caso normal, un prospecto), el array viene vacío y el prompt no cambia. Si la dependencia falla, el turno continúa exactamente igual que cualquier otro paso del Orchestrator (mismo `_paso()` con captura de error).

**Excepción 2 — `Orchestrator`: `capacidades` dinámicas por empresa.** `CAPACIDADES_FASE2` (constante hardcodeada, usada para el 100% de las empresas desde siempre) se usa solo si `personalities.capacidades` está vacía o no definida — comportamiento idéntico a hoy para cualquier empresa que no configure esto. TARA-OS es la primera en definir capacidades propias (`['crear_oportunidad', 'crear_ticket_soporte']`), habilitando que su modelo pueda proponer `crear_ticket_soporte` en `acciones_propuestas`.

Ambas son adiciones puramente aditivas y opcionales (nunca cambian el comportamiento de una empresa que no las usa), siguiendo el mismo criterio ya usado en la excepción de `_mapearPersonalidad()` documentada en el propio ADR-005.

**Nueva acción registrada (zona de wiring de `crearOrchestrator()`, no la lógica de `Orchestrator`, mismo patrón que `agendar_cita`/`consultar_disponibilidad` de TA.6/TA.9):** `crear_ticket_soporte` — resuelve `organization_id` de la empresa y `usuario_id` de quien escribe (vía `resolverCuentaPorTelefono`), y llama a `crearTicket()`. Nunca crea el ticket el modelo directamente — solo lo propone; el servicio es quien escribe en la base de datos.

### 5. Por qué no se toca `filtrarKnowledgeBase()` (ContextBuilder)

`filtrarKnowledgeBase()` (no frozen, pero tampoco se tocó) solo recorta secciones de `knowledge_base` cuando hay MÁS secciones que `kb_max_secciones` — si hay igual o menos, las devuelve todas sin filtrar. `kb_max_secciones` de TARA-OS se configuró en `10` (script de configuración), por encima de las 6 secciones estáticas + la sección dinámica `CUENTA_REAL_DEL_CONTACTO` — garantiza que la información de cuenta real **nunca se recorte** por relevancia, sin tener que tocar la lógica de filtrado.

### 6. Identidad y honestidad — vive en `personalities`, no en el Core

Todo lo pedido sobre identidad ("Asistente Oficial", nunca chatbot, presentación breve solo la primera vez, clasificación silenciosa de tipo de conversación, no vender a clientes existentes, modo soporte inmediato, honestidad cuando un dato no está disponible) se implementó como `reglas`/`objetivo`/`cargo` de la empresa TARA-OS (`scripts/configurar-tara-os-asistente-oficial.js`) — **no** en `prompt-builder.js` ni en ningún bloque universal del Core. A diferencia de ADR-010/011 (universales, para cualquier empresa), esta es configuración específica de una sola empresa — el mecanismo (bloques de PromptBuilder, `reglas` por empresa) ya existía, no se agregó nada nuevo ahí.

### 7. Knowledge base — datos reales, nunca inventados

Las 6 secciones estáticas sembradas (qué es TARA-OS, planes y precios, integraciones, usuarios/roles/organizaciones, soporte/onboarding, facturación/suscripciones) usan los datos **reales** de `migrations/064_planes.sql` (TARA Launch $0/30 días prueba, Professional $2,990 MXN/mes, Unlimited $4,490 MXN/mes, Enterprise precio personalizado) — nunca cifras inventadas.

---

## Pendiente de acción manual (Alina)

1. Aplicar `migrations/081_asistente_oficial_tara_os.sql` en Supabase + `NOTIFY pgrst, 'reload schema';`.
2. Correr `node scripts/configurar-tara-os-asistente-oficial.js` (actualiza personalidad + siembra knowledge_base de la empresa TARA-OS ya existente).
3. Opcional, para probar la personalización real de cuenta: asignar un `usuarios.telefono` a un usuario real de prueba y vincularlo a una empresa con suscripción activa.

---

## Pruebas

- `__tests__/cuenta-plataforma.test.js` (nuevo, 24 tests) — cada función real (resolución de cuenta, suscripción, integraciones, tickets) y cada interfaz-todavía-no-construida (siempre `disponible:false` con motivo honesto, nunca inventa datos).
- `__tests__/orchestrator.test.js` (+8 tests) — la dependencia opcional es null-safe (sin ella, comportamiento idéntico; con ella, se llama con los argumentos correctos; su resultado llega al `system_prompt`; si falla, el turno no se rompe); capacidades dinámicas (con override usa las de la empresa, sin override o vacías cae al default histórico, nunca "sin acciones").
- Regresión completa antes de este ADR: sin cambios en ningún otro flujo (Total Racks, Sugar Salon, cualquier otra empresa) porque ambas extensiones de Orchestrator son estrictamente opcionales y con fallback idéntico al comportamiento previo.

**Validación en vivo (encontró y corrigió un problema real):** la primera versión de `REGLAS` no se presentaba en el primer contacto cuando el mensaje era un simple "Hola" — la instrucción universal de ADR-011 ("responde de forma natural y breve ante un saludo casual") le ganaba prioridad a la presentación de TARA-OS, y el modelo reusó literalmente un ejemplo de reencauce de ADR-011 (pensado para el turno 3+) en el turno 1. Se corrigió marcando la regla de presentación como "de máxima prioridad, incluso por encima de cualquier instrucción sobre tono casual", explícita en que aplica aunque el mensaje sea solo "hola". Revalidado: la presentación breve ya aparece de forma consistente en el primer mensaje de una conversación nueva, sin repetirse en los turnos siguientes, y sin romper el ritmo de ADR-011 para conversaciones casuales posteriores.

---

## Regla permanente

> Cualquier capacidad nueva de la plataforma (facturación, licencias, monitoreo, lo que sea) se construye como una función más en `modules/cuenta-plataforma.js` con el contrato `{disponible, motivo}` — nunca como texto embebido en un prompt, y nunca inventando un dato que el sistema todavía no tiene. El Core (`Orchestrator`/`PromptBuilder`) no vuelve a tocarse para agregar esas capacidades — el punto de integración (`obtenerEnriquecimientoCuenta`) ya está listo para recibir lo que sea que este módulo devuelva.
