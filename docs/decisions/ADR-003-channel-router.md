# ADR-003 — Channel Router: resolución de empresa por número receptor

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Junio 2026 (FASE 3 — T3.5) |
| Autora | Alina Navarro |
| Archivo | `modules/channel-router.js` |

---

## Contexto

Para implementar multi-tenancy, el sistema necesita saber a qué empresa pertenece cada mensaje entrante. Twilio envía el mensaje con dos campos relevantes: `From` (número del cliente) y `To` (número receptor — el número de Twilio de la empresa).

El campo `To` es el identificador natural de la empresa: cada empresa tiene su propio número de WhatsApp registrado en Twilio. La pregunta es: ¿cómo convertir ese número en un `company_id`?

---

## Decisión

Crear un módulo `ChannelRouter` que:

1. Recibe el `endpoint` (valor del campo `To` con prefijo `whatsapp:`)
2. Consulta la tabla `channel_endpoints` en Supabase: `WHERE endpoint = ? AND activo = true`
3. Hace JOIN con `companies` para obtener `company_id` y `company_slug`
4. Cachea el resultado en un `Map` con TTL de 5 minutos
5. Devuelve `{ company_id, company_slug }` o `null` si no existe

Si devuelve `null`, `server.js` responde con `<Response></Response>` vacío y no procesa el mensaje.

```js
const routeResult = await channelRouter.enrutar(message.incoming_endpoint);
if (!routeResult) {
  console.warn('⚠️  Endpoint sin empresa registrada:', message.incoming_endpoint);
  return res.type('text/xml').send('<Response></Response>');
}
message.company_id = routeResult.company_id;
```

---

## Por qué el campo `To` y no `From`

`From` es el número del cliente — cambia en cada conversación y no identifica la empresa.
`To` es el número receptor — es fijo por empresa y es exactamente el dato que registramos en `channel_endpoints`.

---

## Alternativas consideradas

| Alternativa | Razón de rechazo |
|-------------|-----------------|
| Variable de entorno `COMPANY_SLUG` | Single-tenant por definición — requiere un servidor por empresa |
| Subdomain en la URL del webhook (`empresa.tara.com/webhook`) | Requiere infraestructura de DNS y proxy por empresa |
| Header HTTP personalizado | Twilio no permite agregar headers arbitrarios al webhook |
| Primer segmento del path (`/webhook/twilio/totalracks`) | Requiere registrar una URL diferente por empresa en Twilio Console |
| Lookup en memoria fijo (hardcoded) | No escala — agregar empresa = cambiar código y redeploy |

---

## Decisión sobre caché

Se eligió `Map` en memoria con TTL de 5 minutos porque:
- El número de endpoints activos es pequeño (decenas, no millones)
- La latencia de una query a Supabase por cada mensaje sería ~100-200ms adicionales
- Los cambios en `channel_endpoints` son raros (onboarding de empresa nueva)
- Si el TTL expira, la siguiente query refresca el caché automáticamente
- `invalidarCache(endpoint)` está disponible para casos donde se necesita invalidación inmediata

---

## Consecuencias

**Positivas:**
- Agregar una empresa = 1 insert en `channel_endpoints`, efecto inmediato en <5 minutos
- Número desconocido → respuesta segura sin crash ni exposición de datos
- El Channel Router es el único punto donde se resuelve la empresa — fácil de auditar
- Testeable de forma aislada sin levantar servidor HTTP

**Negativas:**
- Si `channel_endpoints` está vacío o tiene un error, ninguna empresa puede recibir mensajes
- El caché en memoria se pierde en cada redeploy (aceptable — se reconstruye en la primera consulta)

---

## Regla permanente

> El `company_id` solo puede asignarse al `message` en `server.js`, inmediatamente después de la llamada a `ChannelRouter.enrutar()`. Ningún otro módulo debe asignar o modificar `message.company_id`.
