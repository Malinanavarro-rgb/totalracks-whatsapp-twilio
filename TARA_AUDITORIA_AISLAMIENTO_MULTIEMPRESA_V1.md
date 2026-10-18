# TARA Matrix™ — Auditoría de aislamiento multiempresa (lead-atribucion.js)
**Fecha:** 2026-10-17 · **Solo lectura — sin cambios de código, sin borrados, sin push, sin despliegue**

---

## Hallazgo principal: SÍ, confirmado — y afecta producción, no solo demo

El mecanismo que te hizo pasar de "Nort Energy" a "TARA-OS" en la prueba de hoy **no es un efecto exclusivo de datos de prueba** — es un comportamiento real del código, activo en ambos webhooks de producción (`/webhook/twilio` y `/webhook/meta`), sin ninguna condición que lo limite a un número específico.

## Tus 5 preguntas

**1. ¿`phone_number_id` determina correctamente el `company_id` en todos los mensajes entrantes?**

No siempre. `channelRouter.enrutar(message.incoming_endpoint)` (`server.js:740` Twilio, `server.js:820` Meta) sí resuelve correctamente y de forma única por número (`channel_endpoints.endpoint` tiene restricción `UNIQUE` — confirmado en la migración 002). Pero ese `company_id` correcto se usa solo como **punto de partida**, no como resultado final.

**2. ¿La atribución de leads puede sobrescribir posteriormente ese `company_id`?**

Sí, siempre se evalúa. `_aplicarAtribucionDeLead()` (`server.js:310-326`) corre sin condición en CADA mensaje entrante, en ambos webhooks (`server.js:754` Twilio, `server.js:835` Meta) — nunca se salta aunque el número receptor sea exclusivo de una sola empresa. La línea `message.company_id = resultado.companyId;` (`modules/lead-atribucion.js:317`) reemplaza el valor ya resuelto por el endpoint sin verificar si ese endpoint es "compartido" o "exclusivo".

**3. ¿Un hilo anterior de otra empresa puede contaminar el contexto, CRM, cotizaciones o respuestas?**

Sí. El Nivel 1 de la jerarquía — `buscarContextoPersistido()` (`modules/lead-atribucion.js:124-144`) — busca el hilo NO cerrado más reciente de ese teléfono **sin filtrar por `company_id` en ningún punto de la consulta**:
```js
const { data: clientes } = await supabase.from('clientes').select('id, company_id').eq('telefono', telefono);
// ... sin .eq('company_id', ...)
const { data: hilo } = await supabase.from('hilos').select('id, company_id, cliente_id')
  .in('cliente_id', clienteIds).neq('estado', 'cerrada') /* ... */
```
Como `procesarMensajeEntrante()` se llama (`server.js:765`/`845`) **después** de esta sobrescritura, todo lo que pasa después —`ContextBuilder` (personalidad, reglas, knowledge_base de la empresa equivocada), la respuesta del modelo de IA, `clientes`, `hilos`, `conversaciones`, `oportunidades`, cotizaciones— se ejecuta bajo el `company_id` equivocado. Esto es exactamente lo que viste hoy: tu mensaje llegó al número exclusivo de Nort Energy, pero como tu teléfono tenía un hilo abierto más reciente con otra empresa demo, la conversación completa se atendió como esa otra empresa.

**4. ¿Esto afecta solo al entorno demo, o también a producción?**

También a producción. No existe ningún gate que diga "solo aplica esto si la empresa es de demo" — corre igual para cualquier `company_id`, incluidas empresas reales con número dedicado exclusivo como Nort Energy. El único control posterior, "Modo Demo en Tiempo Real" (`resolverSesionDemoActiva`, `server.js:762`/`842`), es un mecanismo aparte y explícito — no limita ni reemplaza esta sobrescritura, solo puede volver a cambiar el `company_id` después.

**Caso real con impacto productivo:** si un cliente real contactó a la Empresa A una vez (y ese hilo sigue "abierta", nunca se marcó "cerrada"), y después ese mismo teléfono escribe al número dedicado y exclusivo de la Empresa B, la conversación completa — IA, CRM, cotizaciones — se atendería como si fuera para la Empresa A. No es exclusivo de números de prueba compartidos.

**5. ¿Existen consultas de historial que no filtran por `company_id`?**

Sí, 2 confirmadas en `modules/lead-atribucion.js`:
- `buscarContextoPersistido()` (línea 124-144): el problema central, descrito arriba.
- `resolverContenidoExplicito()` (línea 193-209, Nivel 4): también busca entre TODAS las empresas reales (`es_demo=false`) — pero esto parece intencional por diseño (detectar si el cliente mencionó el NOMBRE de otra empresa), no un descuido como el Nivel 1.

## Contexto importante — esto fue diseñado a propósito, para un caso distinto

El comentario original (`modules/lead-atribucion.js:1-25`, fechado "Alina, 2026-08-14") describe el propósito real: permitir que **un único número compartido** (el ejemplo que da el propio código: "TARA-OS informativo vs. Nort Energy") decida a qué empresa pertenece cada conversación nueva, usando metadata de campaña verificable. Es decir, el mecanismo se diseñó para UN número que de verdad debía poder atender a más de una empresa.

El problema es que, tal como está implementado, **se aplica a todos los números por igual** — incluidos los que (como el de Nort Energy, `channel_endpoints.endpoint = '1135422172997442'`) son exclusivos y no deberían nunca ceder su `company_id` a una conversación de otra empresa.

## Propuesta mínima de corrección (no implementada — solo propuesta)

Agregar una marca explícita de "este número SÍ puede compartirse entre empresas" (ej. una columna `permite_atribucion_cruzada boolean default false` en `channel_endpoints`), y en `server.js` solo llamar a `_aplicarAtribucionDeLead()` cuando `routeResult.permite_atribucion_cruzada === true`. Para cualquier número dedicado exclusivo (Nort Energy y, previsiblemente, toda empresa real que no comparta número), el `company_id` resuelto por `channelRouter.enrutar()` quedaría firme, sin posibilidad de sobrescritura por historial de otro teléfono.

Esto es un cambio de 1 columna de esquema + 1 condición en 2 líneas de `server.js` (antes de las llamadas en `server.js:754` y `server.js:835`) — no toca `modules/lead-atribucion.js` ni su jerarquía interna, que sigue siendo válida para el número que sí deba compartirse.

**No implementé nada de esto. No borré conversaciones ni clientes. No modifiqué código. No hice push ni despliegue.**
