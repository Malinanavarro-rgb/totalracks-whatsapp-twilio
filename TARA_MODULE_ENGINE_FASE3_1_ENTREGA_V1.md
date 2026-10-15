# TARA Module Engine — Fase 3.1 (administración de planes), entrega

**Fecha:** 2026-10-17
**Estado:** implementado, probado, **sin desplegar, sin migración corrida, sin tocar los 4 planes reales.**

---

## 1. Lo que se construyó

`Planes.jsx` pasó de ser una vista de catálogo de solo lectura a una herramienta funcional: crear plan, editar plan, asignar módulos por plan con checkboxes agrupados por categoría, editar los límites ya existentes (`max_usuarios`, `max_sucursales`, `api`, `webhooks`), con confirmación antes de guardar y mensajes claros de éxito/error.

**Cero backend reconstruido** — se confirmó primero (como pediste) que `GET/POST /api/admin/planes` y `PATCH /api/admin/planes/:id` ya funcionaban; solo se agregó la llamada de auditoría a los dos handlers existentes, sin tocar `modules/planes.js`.

## 2. Archivos modificados/nuevos

| Archivo | Cambio |
|---|---|
| `migrations/130_audit_log_acciones_planes.sql` | Nuevo — aditivo, agrega `'crear_plan'`/`'editar_plan'` al CHECK de `plataforma_audit_log` (mismo patrón que la migración 072). **No corrida.** |
| `modules/modulos-catalogo.js` | Nuevo — `listarModulosCatalogo()`, lectura pura de `modulos_catalogo` (sin lógica nueva, mismo estilo que `listarPlanes()`). |
| `server.js` | +`GET /api/admin/modulos-catalogo` (passthrough). Los handlers existentes `POST`/`PATCH /api/admin/planes` ahora llaman `registrarEventoAdmin(..., accion: 'crear_plan'/'editar_plan')` tras guardar — mismo patrón ya usado en las rutas de suscripciones. |
| `frontend/src/admin/adminApi.js` | +`modulosCatalogo()`. |
| `frontend/src/admin/pages/Planes.jsx` | Reescrito: formulario de creación, formulario de edición inline por tarjeta, selector visual de módulos, edición de límites. |
| `frontend/src/admin/admin.css` | +clases nuevas (`pm-modulo-chip`, `pm-modulos-selector`, `pm-form-acciones`, etc.), reutilizando las variables de color/espaciado ya existentes — ningún estilo existente se modificó. |
| `__tests__/modulos-catalogo.test.js` | Nuevo — 2 pruebas para `listarModulosCatalogo()`. |

## 3. Estructura versionada en `planes.limites` (documentada, no una tabla nueva)

```json
{
  "max_usuarios": null,
  "max_sucursales": 2,
  "api": false,
  "webhooks": false,
  "modulos": { "schema_version": 1, "incluidos": ["crm", "tickets", "..."] }
}
```

No se creó tabla nueva: confirmé que `actualizarPlan()` ya acepta `limites` como JSON libre, así que el único riesgo real era que esa función hace **reemplazo ciego** de toda la columna `limites` (no hace merge en el servidor). Por eso el frontend **siempre parte del objeto `limites` completo ya cargado** del plan y solo sustituye la clave `modulos` — nunca reconstruye el objeto desde cero. Verifiqué esto con 4 casos manuales (claves hermanas no se pierden al asignar módulos, plan nuevo sin `limites` no truena, lectura seguro cuando `modulos` no existe todavía, dos ediciones sucesivas no se pisan entre sí) — los 4 pasaron.

## 4. Auditoría

`plataforma_audit_log` (el mecanismo ya existente, no uno nuevo) registrará `crear_plan`/`editar_plan` con `planId`, `clave` y, en edición, qué campos cambiaron — en cuanto la migración 130 se corra. Hasta entonces, si alguien usara el endpoint ya editado, el INSERT de auditoría fallaría por el CHECK — por eso **la migración debe correr antes de cualquier uso real de esta pantalla**, aunque el código ya esté listo.

## 5. Por qué no hay pruebas de frontend

Confirmé que este repo no tiene infraestructura de pruebas de frontend (cero archivos `*.test.jsx`, sin Vitest/Jest configurado para Vite) — añadir ese andamiaje completo solo para 2 funciones puras no estaba autorizado y hubiera sido una modificación de herramientas de build fuera del alcance de esta fase. En su lugar: verifiqué manualmente la lógica de fusión de `limites` (sección 3) y corrí `npx vite build` sobre el frontend real — compiló sin errores. El backend sí sigue la convención existente de pruebas (120/120 suites, 2382/2382 tests, incluyendo las 2 nuevas).

## 6. Compatibilidad confirmada

- Los 4 planes reales (Launch/Professional/Unlimited/Enterprise) no se tocaron — esta entrega es solo código.
- Un plan sin `limites.modulos` todavía (los 4 reales, hoy) se muestra como "Sin módulos asignados todavía" — ningún checkbox marcado por defecto, nunca se infiere nada.
- `requireAdmin` sigue siendo el único guardián de estas rutas — ningún cambio de permisos.
- `modulos_empresa` / `modulo-engine.js` / el piloto de observación de Tickets no se tocaron.

## 7. Actualización 2026-10-17 — Fase 3.2 completada

Autorizaste la Fase 3.2 el mismo día. Se corrió contra producción, por ti, el SQL con fusión aditiva (`limites || jsonb_build_object(...)`) — verificado antes (lectura real de los 4 planes + catálogo real de 13 módulos) y después (los 4 planes muestran `modulos.incluidos` con los 13 códigos, `schema_version: 1`, y **ningún otro valor de `limites` cambió** respecto a la lectura previa). Los 4 planes reales (Launch/Professional/Unlimited/Enterprise) ya tienen el catálogo completo asignado, consistente con la decisión comercial confirmada.

Migración 130 también corrida en producción (con la corrección: incluye `'demo_activar'`/`'demo_finalizar'`, que la primera versión había omitido). Commits de Fase 3.1 (`5fafe5c` y anteriores) ya están en `origin/main`.

## 8. Pendiente, sin autorizar todavía

- Conectar `HerramientasTab.jsx` / `POST /api/config/modulos/:codigo/activar` (Fase 3.3 de la propuesta) — UI de empresa para "Mi empresa → Explorar herramientas".
- Tabla `solicitudes_ampliacion` (Fase 3.4).
- Cambiar `requireModuloActivo()` de observación a bloqueo real (requiere revisar datos reales de `modulo_enforcement_observaciones` primero, Fase 2).

---

Fase 3.1 y 3.2 completas, en producción, sin tocar nada fuera de lo autorizado explícitamente en cada paso.
