# TARA Module Engine — Validación funcional (Fase 3.1–3.4 en producción)

**Fecha:** 2026-10-16
**Estado:** validación completa, solo lectura. Cero cambios sobre planes/suscripciones/módulos reales.

---

## 1. Qué se validó y cómo

Toda la validación se hizo contra Supabase real de producción, **vía las mismas funciones que usan las rutas HTTP** (`modules/planes.js`, `modules/modulos-catalogo.js`, `modules/modulos-empresa.js`, `modules/solicitudes-ampliacion.js`, `modules/plataforma-billing.js`) — no mocks. No ejecuté ninguna escritura real (ni `activarModulo()` ni `revisarSolicitud()` contra datos reales): esa lógica ya tiene 16 pruebas unitarias dedicadas (todas pasando) que cubren sus ramas de validación (404/403/409/éxito) — repetirlo en vivo hubiera significado escribir sobre `modulos_empresa` de una empresa real sin necesidad, así que lo evité a propósito.

No tuve credenciales de una sesión real de Super Admin ni de un administrador de empresa para probar por HTTP con cookies reales — la validación de aislamiento de permisos (punto 3) se hizo por lectura directa del código de los 2 middlewares, que es evidencia más fuerte que un solo request de prueba.

## 2. Rutas nuevas — funcionan

Confirmado por código (los handlers llaman exactamente a estas funciones, ya verificadas en vivo abajo) + por HTTP (401 sin sesión, no 404 — ya confirmado ayer tras el deploy):

- `GET /api/admin/planes`, `POST/PATCH /api/admin/planes/:id` → `listarPlanes`/`crearPlan`/`actualizarPlan`.
- `GET /api/admin/modulos-catalogo` → `listarModulosCatalogo`.
- `GET /api/config/modulos`, `POST /api/config/modulos/:codigo/activar`, `POST /api/config/modulos/:codigo/solicitar-ampliacion` → `modules/modulos-empresa.js` / `modules/solicitudes-ampliacion.js`.
- `GET /api/admin/solicitudes-ampliacion`, `PATCH /api/admin/solicitudes-ampliacion/:id` → `modules/solicitudes-ampliacion.js`.

## 3. Aislamiento Super Admin vs. administrador de empresa — confirmado por código, no es solo un chequeo de rol

- `requireAdmin` (`modules/admin-auth-middleware.js`) solo lee la cookie `tara_admin_session`, nunca `tara_session`/`tara_company`. La resuelve `resolverSesionAdmin()` exigiendo una fila activa en **`plataforma_admins`** (`modules/admin-auth.js:83-98`).
- `requireAuth`+`soloGerencial` (tenant) lee `tara_session`+`tara_company`, resuelta por `resolverSesion()` exigiendo una fila activa en **`usuarios_empresas`** para esa empresa (`modules/auth.js:136-151`).
- Son 2 tablas distintas, 2 cookies distintas, 2 funciones de resolución distintas. Un administrador de empresa (owner/administrador en `usuarios_empresas`) **no tiene ninguna fila en `plataforma_admins`** — no es que falle una verificación de rol, es que la tabla que `requireAdmin` consulta ni siquiera lo conoce. Mismo patrón ya documentado desde Fase 1 ("dos superficies de autorización distintas, nunca comparten código").

## 4. Módulos por plan — se consultan correctamente, configuraciones intactas

Leído en vivo con `listarPlanes()` real:

| Plan | Módulos | api | webhooks | max_usuarios | max_sucursales |
|---|---|---|---|---|---|
| launch | 13 | false | false | null | 2 |
| professional | 13 | false | false | null | 2 |
| unlimited | 13 | true | true | null | null |
| enterprise | 13 | true | true | null | null |

Idéntico a lo verificado antes de correr la Fase 3.2 (mismos `api`/`webhooks`/`max_usuarios`/`max_sucursales` que ya habíamos confirmado) — **ninguna configuración existente se modificó**, solo se agregó `modulos.incluidos` como se autorizó.

`listarModulosCatalogo()`: 13 módulos reales, coincide con el catálogo de la migración 128.

## 5. Integración planes ↔ suscripciones ↔ modulos_empresa — confirmada, sin activar restricciones

`obtenerSuscripcionVigente()` resuelve correctamente el plan vigente de las 6 organizaciones reales que existen hoy (no solo las 2 que veníamos siguiendo de cerca):

| Organización | Plan | Estado suscripción |
|---|---|---|
| Nort Energy | professional | active |
| Total Racks | professional | active |
| Salud y Belleza | professional | active |
| my pallets solutions (×3 registros) | launch | trial |

`listarModulosEmpresa()` para Nort Energy: los 13 módulos del catálogo se cruzan correctamente contra su plan (`incluido_en_plan: true` en los 13) y contra su estado real en `modulos_empresa` (cobranza/instalaciones = `integrado`, el resto = `activo`) — exactamente el espejo que se escribió en Fase 0-1, sin alteración.

`requireModuloActivo()` sigue enganchado **únicamente** en las 6 rutas originales de Tickets (verificado por grep sobre `server.js`) — ninguna ruta nueva quedó bajo enforcement, ni siquiera en modo observación. `modulo_enforcement_observaciones` tiene **0 filas** — el piloto sigue sin tráfico real que evaluar, dato pendiente para cuando se decida si pasar a bloqueo real.

`solicitudes_ampliacion`: tabla alcanzable, 0 filas — nadie la ha usado todavía (`HerramientasTab.jsx` recién desplegado).

## 6. Lo que falta validar (honesto, no hice clic real en la UI)

No hay navegador disponible en este entorno — no pude hacer clic real en "Explorar herramientas" ni en el formulario de edición de `Planes.jsx` como lo haría una persona. La validación de arriba prueba que el backend y los datos son correctos extremo a extremo; la validación del frontend se apoyó en `vite build` limpio + lectura de código, no en una sesión de navegador real. Si quieres, puedo pedirte que lo abras tú y me confirmes, o levantar el dev server para probarlo juntos.

---

## 7. Siguiente fase que pediste — "que cada empresa administre sus módulos desde su propio panel"

Antes de proponer algo nuevo: **esto ya está construido y desplegado — es exactamente la Fase 3.3/3.4 que acabamos de validar arriba.** Hoy, una empresa ya puede, sin intervención técnica:
- Entrar a Configuración → **Suscripción y Facturación** (`SuscripcionTab.jsx`, ya existía) → ver su plan vigente.
- Entrar a Configuración → **Explorar herramientas** (`HerramientasTab.jsx`, Fase 3.3) → ver las 13 herramientas, cuáles usa, activar las que su plan incluye, o solicitar ampliación de las que no.
- Esa solicitud llega a Panel Maestro → **Solicitudes** (Fase 3.4) para revisión manual.

Lo que SÍ falta, identificado en esta validación, para que la experiencia esté completa (propuesta, sin implementar todavía):

1. **La empresa no puede ver el estado de sus propias solicitudes.** `solicitarAmpliacion()` crea la fila, pero no hay ningún `GET` tenant-facing para que la empresa vea "tengo 1 solicitud pendiente / fue aprobada / fue rechazada" — hoy solo el Super Admin las ve. Necesitaría: 1 endpoint de lectura (`GET /api/config/solicitudes-ampliacion`, filtrado por su propia `company_id`) + una sección en `HerramientasTab.jsx`.
2. **Sin notificación cuando se aprueba/rechaza.** Hoy `revisarSolicitud()` actualiza la base, pero nadie le avisa a la empresa — se enterarían solo si vuelven a entrar al panel. Podría ser un WhatsApp/email simple reusando el canal ya existente de notificaciones de la plataforma (si existe uno) o quedarse solo en "se refleja al recargar", a decidir contigo.
3. **Validación con usuario real en navegador** (punto 6) — para confirmar que el flujo completo (activar/solicitar) se siente bien de principio a fin, no solo que el código esté correcto.

No implico ninguno de estos tres todavía — quedo a la espera de qué priorizas.
