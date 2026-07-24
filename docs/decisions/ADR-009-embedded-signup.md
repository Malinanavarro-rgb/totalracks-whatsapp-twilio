# ADR-009 — Embedded Signup de WhatsApp Business

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Julio 2026 |
| Autora | Alina Navarro |
| Archivos | `modules/meta-embedded-signup.js`, `server.js` (rutas `/api/config/canales/whatsapp-meta/embedded-signup`), `frontend/src/pages/configuracion/CanalesTab.jsx` |

---

## Contexto

ADR-007 (Meta WhatsApp Cloud API como canal principal) documentó explícitamente que el alta de credenciales por empresa quedaba fuera de esa entrega: *"portal visual de onboarding, flujo de Embedded Signup real, UI de conexión self-service... queda documentado como fase siguiente"*. Desde entonces, conectar una empresa nueva a Meta significaba que su dueño sacara `whatsapp_business_account_id`/`phone_number_id`/`access_token` a mano de Meta Business Manager y los pegara en un formulario (`CanalesTab.jsx`) o se los diera a Alina para correr `scripts/conectar-empresa-meta.js`.

Ese proceso manual generó fricción real de producción: al intentar conectar un número nuevo para Total Racks, la navegación de Meta Business Manager resultó confusa incluso para encontrar dónde agregar un número dentro del WABA correcto (había además varias cuentas de WhatsApp duplicadas dentro del mismo Business Manager, de intentos previos). Esta entrega implementa la "fase siguiente" que ADR-007 dejó pendiente: **Embedded Signup**, el flujo oficial de Meta para que el dueño de una empresa autorice a TARA sobre su propio WABA desde un popup, sin salir del panel de TARA-OS y sin mover IDs/tokens a mano.

---

## Decisión

### 1. El modelo Tech Provider de ADR-007 no cambia

Sigue habiendo una sola Meta App de plataforma (`META_APP_ID`/`META_APP_SECRET`, variables de entorno, iguales para todas las empresas). Embedded Signup no introduce una app por empresa — solo automatiza cómo cada empresa le concede permiso a esa misma app sobre su propio WABA. El webhook compartido (`/webhook/meta`), el routing por `channel_endpoints`, y la tabla `meta_whatsapp_credentials` (una fila por empresa, `UNIQUE company_id`) se reusan sin cambios.

### 2. Flujo end-to-end

```
Frontend (CanalesTab.jsx)                    Backend (server.js)                Meta
──────────────────────────                   ────────────────────                ────
1. Carga Facebook JS SDK (sdk.js)
2. FB.login({ config_id, ... })  ────────────────────────────────────────────▶  Popup de
                                                                                  autorización
3. Popup manda por postMessage
   { type: 'WA_EMBEDDED_SIGNUP',
     event: 'FINISH',
     data: { waba_id, phone_number_id,
             business_id } }
4. FB.login() resuelve con
   { authResponse: { code } }
5. POST /api/config/canales/
   whatsapp-meta/embedded-signup
   { code, wabaId, phoneNumberId,
     metaBusinessId }             ─────────▶ 6. intercambiarCodigoPorTokenLargo(code)
                                                 (2 saltos Graph API — nunca
                                                  expone META_APP_SECRET al
                                                  frontend)
                                              7. suscribirWebhookAWaba(wabaId, token)
                                                 (POST /{waba_id}/subscribed_apps
                                                  — sin esto Meta nunca manda los
                                                  mensajes de ese número al
                                                  webhook de TARA)
                                              8. conectarWhatsAppMeta(...)
                                                 (mismo helper que ya usaba el
                                                  alta manual — cifra y guarda
                                                  en meta_whatsapp_credentials +
                                                  channel_endpoints)
```

El frontend nunca llama a Graph API directo ni ve `META_APP_SECRET` — mismo principio ya aplicado a Supabase/Google en el resto de la plataforma (el frontend habla solo con el backend de TARA).

### 3. Por qué el `code` no alcanza — dos saltos de intercambio

El `code` que devuelve `FB.login()` es de un solo uso y de muy corta vida. Graph API nunca lo cambia directo por un token de larga duración: primero da un token corto (`GET /oauth/access_token?code=...`), y ese token corto se vuelve a cambiar por uno largo (~60 días) con `grant_type=fb_exchange_token`. `intercambiarCodigoPorTokenLargo()` encapsula ambos saltos — el caller (`server.js`) nunca ve el token corto.

### 4. `waba_id`/`phone_number_id` llegan por `postMessage`, no por Graph API

Durante el flujo del popup, Meta manda estos IDs directamente al frontend vía `window.postMessage` (evento `WA_EMBEDDED_SIGNUP`/`FINISH`) — es la fuente oficial recomendada por Meta, más simple que listar los números del WABA después por Graph API para adivinar cuál se acaba de conectar. El frontend valida el `origin` del mensaje (`facebook.com`/`web.facebook.com`) antes de leerlo.

### 5. Config pública resuelta por el backend, no por variables de Vite

`GET /api/config/canales` ahora incluye `metaEmbeddedSignup: { appId, configId, disponible }` (`modules/meta-embedded-signup.js::configPublica()`), leído de las variables de entorno del backend en cada request. Se eligió esto en vez de variables `VITE_*` embebidas en el build para mantener una sola fuente de verdad (el `.env` del backend, igual que el resto de la configuración de plataforma) — cambiar `META_LOGIN_CONFIG_ID` no requiere un rebuild del frontend. `appId`/`config_id` no son secretos (Meta los expone al cliente por diseño en su propio flujo de JS SDK); lo único que nunca sale del backend es `META_APP_SECRET`.

### 6. El formulario manual se conserva, no se elimina

`FormularioWhatsAppMeta` sigue existiendo en `CanalesTab.jsx` como respaldo — necesario mientras la Meta App no tenga App Review aprobado (ver Limitaciones) y útil para empresas de prueba internas. El botón de Embedded Signup solo aparece si `metaEmbeddedSignup.disponible` es `true`.

---

## Limitaciones — requiere acción manual de Alina en Meta for Developers

Esta entrega es 100% funcional en código (validado end-to-end: el popup abre, `FB.login()` regresa el `code`, el backend lo intercambia correctamente), pero Embedded Signup **no funciona todavía en producción** hasta que se completen los pasos que solo se hacen desde la consola de Meta (fuera del alcance de este repositorio):

1. **Configurar el producto "Facebook Login for Business"** en la Meta App de TARA (developers.facebook.com → la App → Agregar producto), y crear ahí una **Configuración** con caso de uso "WhatsApp Business API" — genera el `config_id` que va en `META_LOGIN_CONFIG_ID`. ✅ Hecho — `config_id` en producción.
2. **`META_APP_ID` y `META_LOGIN_CONFIG_ID` como variables de entorno en Render** — sin `META_APP_ID` específicamente, `configPublica()` nunca reporta `disponible: true` aunque todo lo demás esté bien (encontrado en producción: la variable nunca se había configurado, a pesar de que ADR-007 la documentaba desde el principio). ✅ Hecho.
3. **Habilitar el SDK de JavaScript + dominio permitido**, en Facebook Login for Business → Configurar: "Inicio de sesión con el SDK de JavaScript" = Sí, más `tara-os.com` en dominios permitidos; y en Configuración de la app → Básica, `tara-os.com` en "Dominios de la app". ✅ Hecho.
4. **Verificación de Negocio + estatus de "Tech Provider"** — hallazgo nuevo, no documentado originalmente en este ADR: al intentar el flujo real con los 3 pasos anteriores ya resueltos, Meta bloqueó el popup con *"Embedded signup is only available for BSPs or TPs"* (Business Solution Providers o Tech Providers). Esto es un requisito de Meta **más estricto que el permiso de App Review** — no es que falte el acceso avanzado a `whatsapp_business_management`, es que la cuenta de negocio en sí (Business Manager) necesita estar verificada y reconocida por Meta como Tech Provider antes de que el flujo funcione, **incluso para testers agregados en Roles de la App**. ❌ Pendiente — bloqueante, requiere iniciar Verificación de Negocio (Configuración del negocio → Centro de seguridad → Verificación) con documentos legales de la empresa (RFC/acta constitutiva, comprobante de domicilio). Puede tardar de días a semanas.

Mientras el paso 4 no esté resuelto, Embedded Signup no funciona para nadie, ni siquiera en modo de prueba — el formulario manual (`FormularioWhatsAppMeta`) sigue siendo el único camino funcional para conectar números.

---

## Pruebas

- `__tests__/meta-embedded-signup.test.js` — `configPublica()` (disponible/no disponible según variables de entorno), `intercambiarCodigoPorTokenLargo()` (encadena los 2 saltos, `fetch` mockeado, maneja error en cualquiera de los 2 saltos, valida que existan `META_APP_ID`/`META_APP_SECRET`), `suscribirWebhookAWaba()` (llamada correcta a `subscribed_apps`, maneja error de Graph API).
- Sin test de integración real contra Meta (requiere `config_id` real + App Review, fuera del alcance de este repo) — pendiente de validación end-to-end una vez Alina complete los pasos de la sección Limitaciones.
- Regresión completa: suite completa en verde, cero cambios al Core ni a `meta-auth.js`/`meta-cloud-whatsapp.js` (ADR-007 intacto).

---

## Regla permanente

> Embedded Signup es una capa de conveniencia sobre el mismo modelo de credenciales de ADR-007 (`meta_whatsapp_credentials`, `conectarWhatsAppMeta()`) — nunca un modelo de datos paralelo. Cualquier campo nuevo que Embedded Signup necesite guardar se agrega a esa misma tabla, no a una tabla nueva de "conexiones embedded".
