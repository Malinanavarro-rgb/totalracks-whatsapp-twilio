# TARA Module Engine — Fase 3.3 + 3.4, entrega

**Fecha:** 2026-10-17
**Estado:** implementado y probado. **Migración 131 sin correr, sin tocar producción.**

---

## 1. Fase 3.3 — "Mi empresa → Explorar herramientas"

Nueva pestaña en Configuración (`HerramientasTab.jsx`), gateada igual que Suscripción (`soloGerencial`, owner/administrador — misma sensibilidad: cambia la capacidad operativa contratada). Muestra el catálogo completo agrupado por categoría, con el estado real de la empresa y si el módulo está incluido en su plan vigente:

- **Incluido en el plan + no activo** → botón "Activar" (escribe en `modulos_empresa`, nunca cobra).
- **No incluido en el plan** → botón "Solicitar ampliación" (crea una fila en `solicitudes_ampliacion`, no activa nada).
- **Ya activo/integrado** → solo el indicador, sin botón.

Backend: `modules/modulos-empresa.js` (`listarModulosEmpresa`, `activarModulo`) + 2 rutas nuevas bajo `/api/config/modulos` (mismo patrón que `/api/billing/*`: `requireAuth, soloGerencial`, resuelven `organization_id` con la función `_organizationIdDeUsuario` ya existente).

`activarModulo()` valida, en este orden, antes de escribir: el módulo existe en el catálogo (404 si no) → está incluido en el plan vigente de la organización, leído de `planes.limites.modulos.incluidos` vía `obtenerSuscripcionVigente()` ya existente (403 si no) → sus dependencias no están explícitamente `'inactivo'` (409 si falta alguna). Sin fila de dependencia = activa por default, mismo criterio de fallback que `modulo-engine.js`.

## 2. Fase 3.4 — Solicitudes de ampliación

Nueva tabla `solicitudes_ampliacion` (migración 131) + `modules/solicitudes-ampliacion.js`. Una empresa pide un módulo que su plan no incluye → el Super Admin la aprueba o rechaza manualmente desde Panel Maestro (`/superadmin/solicitudes-ampliacion`, nueva página) — mismo criterio que `crearSuscripcionManual()`: **sin gateway de pago, nunca cobra ni factura automáticamente.**

Aprobar con `modulo_codigo` activa el módulo **solo para esa empresa** (una excepción puntual en `modulos_empresa`) — nunca modifica `planes.limites`, para no afectar a las demás empresas de ese plan. Rechazar, o aprobar una ampliación sin módulo específico (ej. "más sucursales"), nunca toca `modulos_empresa`.

Auditoría: la migración 131 también agrega `'aprobar_solicitud_ampliacion'`/`'rechazar_solicitud_ampliacion'` al CHECK de `plataforma_audit_log` — verifiqué el catálogo vigente completo (el que confirmaste al correr la 130) antes de escribirlo, para no repetir el error de la primera versión de esa migración.

## 3. Archivos

| Archivo | Cambio |
|---|---|
| `migrations/131_solicitudes_ampliacion.sql` | Nuevo — tabla `solicitudes_ampliacion` + CHECK de auditoría ampliado. **No corrida.** |
| `modules/modulos-empresa.js` | Nuevo — lectura/activación tenant-facing (distinto de `modulo-engine.js`, que es el middleware de enforcement para Super Admin/IA). |
| `modules/solicitudes-ampliacion.js` | Nuevo — crear/listar/revisar. |
| `server.js` | +3 rutas tenant (`GET/POST /api/config/modulos...`) junto a `/api/billing/*`, +2 rutas admin (`/api/admin/solicitudes-ampliacion`) junto a `/api/admin/planes`. |
| `frontend/src/lib/api.js` | +`modulosEmpresa`, `activarModulo`, `solicitarAmpliacion`. |
| `frontend/src/pages/configuracion/HerramientasTab.jsx` | Nuevo tab tenant. |
| `frontend/src/pages/Configuracion.jsx` | Registra el tab (`soloGerencial`). |
| `frontend/src/admin/adminApi.js` | +`solicitudesAmpliacion`, `revisarSolicitudAmpliacion`. |
| `frontend/src/admin/pages/SolicitudesAmpliacion.jsx` | Nueva página admin (lista + aprobar/rechazar con confirmación). |
| `frontend/src/admin/AdminApp.jsx` / `AdminShell.jsx` | Registra la ruta y el link de navegación. |
| `__tests__/modulos-empresa.test.js`, `__tests__/solicitudes-ampliacion.test.js` | 16 pruebas nuevas. |

## 4. Pruebas

122/122 suites, 2398/2398 tests (16 nuevas). `npx vite build` del frontend completo (tenant + admin) sin errores — 109 módulos transformados.

## 5. Compatibilidad confirmada

- `planes.limites.modulos` (Fase 3.1/3.2) se lee, nunca se escribe desde aquí.
- `modulo-engine.js` (observación en Tickets) no se tocó.
- Ninguna empresa real tiene hoy un módulo en `'inactivo'`, así que el botón "Activar" no tendría ningún caso real que mostrar todavía — consistente con lo ya anticipado en la propuesta de Fase 3 ("sería un no-op visible").

## 6. Actualización 2026-10-17 — Migración 131 corrida

Confirmada en producción: la tabla `solicitudes_ampliacion` existe y el CHECK de `plataforma_audit_log` ya incluye `'aprobar_solicitud_ampliacion'`/`'rechazar_solicitud_ampliacion'` junto con el catálogo completo anterior (verificado con la definición real del constraint después de correrla).

## 7. Pendiente de tu autorización separada

1. Push de estos commits (`cabc7ac` y anteriores).

---

Código, pruebas y migración completos — Fase 3.3/3.4 lista para usarse en cuanto hagas el push.
