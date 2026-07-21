# ADR-008 — Freeze: adjuntos reales + comprensión de audio/imágenes (Inbox Inteligente)

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | 21 de julio de 2026 |
| Autora | Alina Navarro |
| Archivos | `adapters/channels/meta-cloud-whatsapp.js`, `adapters/channels/twilio-whatsapp.js`, `modules/inbox-adjuntos.js`, `modules/adjuntos-ia.js`, `server.js` (`procesarMensajeEntrante`, `GET /api/inbox/mensajes/:id/adjunto`), bucket de Supabase Storage `inbox-adjuntos` |

---

## Contexto

Desde el fix de crash de ContextBuilder (mensajes no-texto quedaban con `content` vacío), TARA solo sabía decirle a la clienta "no puedo ver/escuchar esto, descríbemelo con palabras" — un placeholder, no comprensión real. Se construyó la pieza que faltaba: descargar el archivo real del proveedor, guardarlo de forma persistente y hacer que TARA lo entienda de verdad (transcripción de audio, descripción de imágenes) antes de responder.

Validado en producción con Salud y Belleza (empresa real, Meta Cloud API): un audio real transcrito y una imagen real descrita, ambos con respuesta coherente de TARA en el mismo turno — confirmado en vivo por la dueña del producto ("ya funciona perfecto"), no solo por tests sintéticos.

## Decisión

Se congela como **estable, no se modifica por iniciativa propia**, lo siguiente:

| Componente | Ubicación | Evidencia de validación |
|---|---|---|
| `media` en el `Message` universal + `descargarMedia()` | `adapters/channels/meta-cloud-whatsapp.js`, `adapters/channels/twilio-whatsapp.js` | `__tests__/meta-cloud-whatsapp.test.js`, `__tests__/twilio-whatsapp.test.js`, `__tests__/whatsapp-provider-contract.test.js` — contrato idéntico entre proveedores |
| Storage de adjuntos (bucket privado, path guardado — nunca URL) | `modules/inbox-adjuntos.js` | `__tests__/inbox-adjuntos.test.js`; bucket `inbox-adjuntos` creado y verificado en Supabase producción (`scripts/crear-bucket-adjuntos.js`) |
| Ruta de servido con URL firmada de vida corta (60s), verificando `company_id` del usuario autenticado antes de firmar | `server.js` — `GET /api/inbox/mensajes/:mensajeId/adjunto` | Consistente con el resto de rutas de `/api/inbox` (mismo `requireAuth` + scoping por empresa) |
| Transcripción de audio (Whisper) y descripción de imágenes (visión `gpt-4o-mini`) | `modules/adjuntos-ia.js` | `__tests__/adjuntos-ia.test.js`; llamada real a la API de OpenAI verificada de punta a punta; **validado en vivo por Alina con audio e imagen reales en Salud y Belleza** |
| Orden de operación en `procesarMensajeEntrante`: descargar → subir a Storage → transcribir/describir → `message.content` se sustituye antes de llegar al Core | `server.js` | El Core (`orchestrator.js`/`ContextBuilder`/`PromptBuilder`) recibe texto plano, cero cambios — mismo criterio que ADR-005 |

**Diseño clave que se congela junto con el código:** el Core nunca "ve" un adjunto. Toda la comprensión multimedia ocurre en la capa de plataforma, mutando `message.content` **antes** de invocar `orchestrator.procesarMensaje()` — el Core sigue creyendo que recibe un mensaje de texto normal. Esto es lo que permitió construir toda esta pieza sin tocar una sola línea del Core (ADR-005).

**Nunca se guarda una URL de Meta/Twilio ni una URL firmada en la base de datos** — `mensajes.adjunto_url` guarda solo el *path* dentro del bucket privado; toda URL firmada se genera al vuelo, por petición, después de verificar que el mensaje pertenece a la empresa del usuario que la pide. Esto es una propiedad de seguridad deliberada, no un detalle de implementación incidental.

## Regla de cambio (vigente a partir de este ADR)

No se modifica ningún componente de la tabla anterior salvo:
1. **Bugs** — con reproducción clara y test de regresión.
2. **Evidencia proveniente de uso real** — un caso real (no sintético) que exponga una limitación concreta (ej. un tipo de audio/imagen que Whisper/visión no maneje bien, un límite de tamaño de archivo real).
3. Explícitamente, **no** por: "ya que estoy aquí, lo mejoro", cambio de modelo de IA por preferencia sin evidencia, o generalización especulativa (ej. soporte de video/ubicación) sin que se haya pedido.

Cualquier cambio a estos componentes, aun justificado, se documenta explícitamente en este ADR (tabla de excepciones) — no se hace en silencio dentro de un commit de otra pieza del Inbox.

## Explícitamente fuera de esta entrega (no congelado, sigue abierto)

- **Video y ubicación**: siguen usando el placeholder de texto — no se descargan ni se interpretan. No forma parte de este freeze; se puede construir después sin reabrir este ADR (es una extensión aditiva, no una modificación de lo ya congelado).
- **Costo/límites de uso**: no se implementó ningún control de cuota o alerta de gasto de Whisper/visión — aceptado por ahora, documentado como conocido.
- **`META_APP_ID`/`META_APP_SECRET` del `.env` del servidor**: se detectó que no coinciden con la app que emitió el token de Salud y Belleza (la llamada de `debug_token` falló con "Invalid application ID"), aunque el envío de mensajes funciona igual. Pendiente de revisar, no bloqueante, no forma parte de este freeze.

## Excepciones documentadas (cambios posteriores a este freeze, con justificación)

*(ninguna todavía — se agregan aquí conforme ocurran, mismo formato que ADR-005/ADR-007)*

## Condición para reabrir

Este ADR se revisa si:
- Un caso real expone un límite genuino de Whisper o de la visión de `gpt-4o-mini` (ej. calidad de transcripción con acentos/ruido de fondo, o descripciones de imagen poco útiles) que no se resuelve ajustando el prompt.
- Se decide agregar comprensión real de video o ubicación — eso es una extensión aditiva sobre este mismo patrón, pero debe pasar por este proceso, no implementarse por iniciativa propia.
- Se decide cambiar el modelo de almacenamiento (ej. mover de Supabase Storage a otro proveedor) o el mecanismo de servido (ej. URLs firmadas de más duración, CDN).
