# ADR-007 — Meta WhatsApp Cloud API como canal principal, Twilio como fallback temporal

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Julio 2026 |
| Autora | Alina Navarro |
| Archivos | `adapters/channels/meta-cloud-whatsapp.js`, `modules/meta-auth.js`, `modules/channel-router.js`, `modules/crypto-util.js`, `server.js` (`/webhook/meta`), `migrations/039_meta_whatsapp.sql` |

---

## Contexto

TARA operaba con Twilio WhatsApp Sandbox como único canal, con una cuenta y un número compartidos entre todas las empresas (solo el número "from" variaba por empresa vía `channel_endpoints`). Esto es adecuado para pruebas pero no para producción multiempresa real: cada empresa cliente necesita su **propio número de WhatsApp Business** y su **propia cuenta de Meta Business/WABA**, con control y aislamiento reales sobre su canal.

Se decide construir **Meta WhatsApp Cloud API** (WhatsApp Business Platform directo, sin intermediario) como canal principal de producción. Twilio Sandbox no se elimina — queda como canal temporal de pruebas hasta que Meta esté validado en producción con al menos una empresa real.

---

## Decisión

### 1. Modelo Meta "Tech Provider"

TARA usa **una sola Meta App** (la app de la plataforma, no una por empresa). `app_id`, `app_secret` y `verify_token` son variables de entorno de plataforma (`META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`), iguales para todas las empresas. Cada empresa solo conecta su propio WABA/`phone_number_id`/`access_token` a esa misma app compartida.

Esto es lo que hace viable conectar 5, 50 o 500 empresas sin multiplicar apps de Meta, webhooks o verify_tokens — un solo webhook (`/webhook/meta`) recibe los mensajes de todas las empresas, y el routing por empresa se resuelve igual que ya se resolvía para Twilio: vía `channel_endpoints`.

**Alternativa rechazada:** una Meta App por empresa (aislamiento más fuerte a nivel de infraestructura de Meta, pero no es el modelo que Meta ofrece para plataformas SaaS — el modelo Tech Provider/Embedded Signup asume una sola app "distribuidora"). Se documenta la superficie de riesgo de esta decisión en la sección de seguridad.

### 2. `ChannelAdapter` extendido, no reemplazado

El contrato ya existente (`adapters/channels/channel-adapter.js`) se extendió con dos métodos nuevos — sin romper la implementación de Twilio:

```js
class ChannelAdapter {
  get canal()
  parseIncoming(rawRequest)
  formatOutgoing(text, originalMessage)   // Twilio (TwiML); Meta lanza — no lo soporta
  validateSignature(request)
  async sendProactive(text, identificador, from)
  async enviarMensaje(destinatario, texto, from)  // respuesta principal, envío asíncrono explícito
  verificarWebhook(request)                        // handshake GET; default no-op, Meta lo implementa
}
```

`MetaCloudWhatsAppAdapter` implementa los mismos 6 métodos que `TwilioWhatsAppAdapter` — el Core (`Orchestrator`, `WorkflowEngine`, `SchedulingEngine`, `ActionRunner`, `crm.js`, `agenda.js`, `conversaciones.js`) nunca sabe cuál proveedor entregó o entregará un mensaje.

### 3. Modelo de envío unificado y asíncrono

Twilio podía responder de forma síncrona dentro del webhook (TwiML). Meta no soporta esto — toda respuesta es una llamada explícita a Graph API. En vez de mantener dos modelos distintos, **ambos proveedores se unificaron al modelo asíncrono**: el webhook solo acusa recibo (`res.status(200).end()`), y la respuesta real se envía con `adapter.enviarMensaje()`. Este cambio se hizo primero para Twilio (ver commits `13d1bbe`/`3ef7c29`), antes de tocar nada de Meta, precisamente para que ambos proveedores compartieran un solo modelo de flujo en `server.js` (`procesarMensajeEntrante()`).

### 4. Instanciación: cuenta compartida (Twilio) vs. credenciales por empresa (Meta)

Twilio usa una sola instancia de adapter para toda la plataforma (una cuenta, un Auth Token; solo el número "from" cambia por empresa). Meta es distinto: el `access_token` es propio de cada empresa (cada cliente autoriza a TARA sobre su propio WABA). Por eso:

- `metaAdapterCompartido` (una instancia sin credenciales) se usa solo para `parseIncoming`/`validateSignature`/`verificarWebhook` — operaciones que dependen únicamente de las variables de plataforma.
- `obtenerAdapterMetaParaEmpresa(supabase, company_id)` (`modules/meta-auth.js`) construye una instancia nueva **por empresa** para `enviarMensaje`/`sendProactive`, con las credenciales de esa empresa descifradas — mismo patrón ya usado en `modules/google-auth.js::obtenerProviderParaEmpresa()` para Google Calendar.

### 5. Esquema de base de datos (`migrations/039_meta_whatsapp.sql`)

```sql
ALTER TABLE channel_endpoints
  ADD COLUMN proveedor text NOT NULL DEFAULT 'twilio'; -- 'twilio' | 'meta'
-- Para filas de Meta, `endpoint` = phone_number_id (la clave de routing que
-- Meta manda en cada payload de webhook), no un número humano.

CREATE TABLE meta_whatsapp_credentials (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    uuid NOT NULL REFERENCES companies(id),
  whatsapp_business_account_id  text NOT NULL,
  phone_number_id               text NOT NULL,
  meta_business_id              text,
  credenciales                  jsonb NOT NULL,  -- { access_token } cifrado (AES-256-GCM)
  estado                        text NOT NULL DEFAULT 'pendiente',
  activo                        boolean NOT NULL DEFAULT true,
  created_at                    timestamptz DEFAULT now(),
  updated_at                    timestamptz DEFAULT now(),
  UNIQUE (company_id),
  UNIQUE (phone_number_id)
);
```

Deliberadamente **no incluye** `app_id`/`app_secret`/`verify_token` por fila — esos son variables de entorno de plataforma, no datos por empresa (ver punto 1).

**Cifrado con clave dedicada:** `modules/crypto-util.js` (ya existente, usado para tokens OAuth de Google) se generalizó para aceptar el nombre de la variable de entorno a usar como clave (`cifrar(obj, nombreVariable)` / `descifrar(paquete, nombreVariable)`, con default `CALENDAR_CREDENTIALS_KEY` para no romper el uso existente). Meta usa su propia clave, `META_CREDENTIALS_KEY` — dominios de secreto separados: una clave filtrada no compromete a la otra.

### 6. Webhook (`server.js`)

```
GET  /webhook/meta   → handshake de verificación (hub.mode/hub.verify_token/hub.challenge)
POST /webhook/meta   → mensajes entrantes + estados de entrega (delivered/read/failed)
```

El body crudo (`req.rawBody`) se captura globalmente en el middleware `express.json({ verify })` — necesario porque Meta firma `X-Hub-Signature-256` sobre el buffer sin parsear, a diferencia de Twilio (que firma sobre URL+parámetros ya parseados).

**Lógica de negocio compartida:** los guards de intervención humana (`atendido_por='humano'`), horario de atención, y el post-proceso de bienvenida/firma se extrajeron a una función común, `procesarMensajeEntrante(message, enviar)`, invocada desde ambos webhooks (Twilio y Meta) con una closure `enviar` que ya conoce cómo mandar el mensaje con las credenciales/proveedor correctos. Esto evita que ambos webhooks diverjan silenciosamente entre sí.

### 7. Normalización de formato de número — hallazgo del test de contrato

Al escribir el test de contrato compartido (`__tests__/whatsapp-provider-contract.test.js`), se detectó que Meta entrega `from` en E.164 **sin** el prefijo `+` (solo dígitos), mientras que Twilio lo entrega **con** `+` (tras quitarle el prefijo `whatsapp:`). Como `modules/crm.js::obtenerOCrearCliente` empareja clientes por igualdad exacta de string sobre `telefono`, esta diferencia habría creado un cliente duplicado por proveedor para la misma persona física, según por cuál canal escribiera primero.

**Corrección:** `MetaCloudWhatsAppAdapter.parseIncoming()` normaliza `from` agregando `+` si Meta no lo trae (adoptando la convención que ya existe en `clientes.telefono` desde Twilio). `enviarMensaje()` le quita el `+` antes de llamar a Graph API (que lo exige sin él) — mismo patrón que `TwilioWhatsAppAdapter.sendProactive()` ya usa para su prefijo `whatsapp:`.

### 8. `raw_metadata.MessageSid` — mismo nombre de campo entre proveedores

`orchestrator.js` lee `message.raw_metadata?.MessageSid`. En vez de tocar el Core para aceptar un nombre de campo distinto por proveedor, `MetaCloudWhatsAppAdapter` puebla ese mismo nombre (`MessageSid`) con el `id` nativo del mensaje de Meta. Es el único punto donde el nombre de un campo de Twilio se preserva deliberadamente fuera del adapter — documentado aquí para que no se interprete como acoplamiento accidental.

---

## Riesgos de seguridad

| Riesgo | Mitigación |
|---|---|
| `access_token` de una empresa filtrado = control total de su WhatsApp Business | Cifrado AES-256-GCM con clave dedicada (`META_CREDENTIALS_KEY`), nunca se loguea el valor descifrado |
| Verificación de firma mal implementada (body crudo vs. parseado) deja el webhook abierto a payloads falsificados | Raw body capturado explícitamente vía middleware global; tests con vectores de firma válidos/inválidos/con secreto equivocado |
| Cruce de datos entre empresas (mensaje de la Empresa A procesado con el token de la Empresa B) | `phone_number_id` es `UNIQUE` en `channel_endpoints` y en `meta_whatsapp_credentials` — imposible resolver dos empresas para el mismo `phone_number_id` |
| Un solo `META_APP_SECRET`/`META_VERIFY_TOKEN` comprometido afecta a todas las empresas conectadas | Aceptado por diseño (modelo oficial Tech Provider de Meta) — mismo nivel de confianza que ya existe hoy en `TWILIO_AUTH_TOKEN` (una cuenta, todas las empresas) |
| Reintentos de Meta (reenvía el mismo evento si no se confirma 200 a tiempo) generan mensajes duplicados | El `id` nativo del mensaje ya viaja en `raw_metadata.MessageSid`, disponible para deduplicar si se detecta necesidad real en producción |

---

## Qué se conserva de Twilio, qué se agrega

**Se conserva intacto:**
- `TwilioWhatsAppAdapter` y la ruta `/webhook/twilio` — sin cambios funcionales más allá del modelo asíncrono ya migrado antes de esta entrega.
- `channel_endpoints` como tabla de routing única para ambos proveedores (columna `proveedor` agregada, default `'twilio'` — cero impacto en filas existentes).
- Todo el Core: `Orchestrator`, `WorkflowEngine`, `SchedulingEngine`, `ActionRunner`, `crm.js`, `agenda.js`, `conversaciones.js`, `crm-ui.js`, Knowledge Base, frontend.

**Se agrega:**
- `MetaCloudWhatsAppAdapter`, `modules/meta-auth.js`, tabla `meta_whatsapp_credentials`, rutas `/webhook/meta` (GET+POST), variables de entorno de plataforma (`META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, `META_CREDENTIALS_KEY`, `WEBHOOK_URL_META`).
- Parametrización de `modules/crypto-util.js` para soportar múltiples claves por dominio de secreto (retrocompatible — default preserva el uso existente de Google Calendar).

**Explícitamente fuera de esta entrega:** portal visual de onboarding, flujo de Embedded Signup real, UI de conexión self-service. El alta de credenciales por empresa se hace manualmente (SQL/script) por ahora, igual que el bootstrap de cada empresa/usuario hasta hoy — queda documentado como fase siguiente.

---

## Pruebas

- `__tests__/meta-cloud-whatsapp.test.js` — parseo de texto/interactivo/solo-status, verificación de firma, handshake GET, envío y manejo de error de Graph API, normalización de `+`.
- `__tests__/meta-auth.test.js` — cifrado antes de guardar, aislamiento por empresa (`company_id` + `activo=true`), `null` si no hay credenciales o hay error de DB.
- `__tests__/channel-router.test.js` — `enrutar()` devuelve `proveedor`, default `'twilio'` para filas previas a la migración.
- `__tests__/whatsapp-provider-contract.test.js` — Twilio y Meta producen un `Message` con exactamente la misma forma y el mismo `from`/`content` para el mismo mensaje lógico (este test encontró el hallazgo de la sección 7).
- `__tests__/crypto-util.test.js` — cifrado/descifrado con clave dedicada por dominio, y que una clave no puede descifrar el paquete de otra.
- Regresión completa: 653/653 tests, cero cambios en el Core.

**Pendiente (requiere credenciales reales de prueba, fuera del alcance de esta entrega):** validación end-to-end con un WABA de test de Meta — handshake GET real, un mensaje de texto real de punta a punta, verificación de que Twilio (Total Racks) sigue funcionando idéntico en paralelo.

---

## Regla permanente

> El proveedor de WhatsApp (Twilio o Meta) se resuelve exclusivamente por `channel_endpoints.proveedor`, nunca por variables globales ni por inferencia de formato de payload. Ningún módulo del Core puede depender de cuál proveedor entregó un mensaje.
