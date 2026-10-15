# TARA Module Engine — Fase 3: administración comercial desde el panel (propuesta)

**Fecha:** 2026-10-17
**Estado:** propuesta técnica — cero código escrito. Responde a tu visión de cierre: *"construir la administración comercial desde el panel... crear y modificar planes, asignar módulos, establecer límites y gestionar ampliaciones sin depender de cambios de código."*

---

## 1. Lo que ya existe — no se reconstruye

La sorpresa de esta pieza: **el backend de administración de planes ya está construido y funcionando**, solo nunca se conectó a una interfaz real.

- `GET/POST /api/admin/planes` + `PATCH /api/admin/planes/:id` (`server.js:4051-4076`) — ya llaman a `crearPlan()`/`actualizarPlan()` (`modules/planes.js`), ya gateadas por `requireAdmin`.
- `actualizarPlan()` ya acepta `limites` (JSON libre) como campo editable — **agregar `modulos_incluidos` ahí no requiere ninguna migración ni cambio de backend**, es el mismo campo que ya existe.
- `frontend/src/admin/pages/Planes.jsx` — existe, pero es **solo una vista de catálogo** (tarjetas de marketing), nunca un editor, a pesar de que su propio texto dice "editable, sin tocar código".

Lo que genuinamente falta es la UI de edición (un formulario), no el backend.

---

## 2. Lo que sí falta construir

### 2.1 Super Admin → "Planes y módulos"
- Extender `Planes.jsx` (o una pestaña nueva dentro de esa misma pantalla) con un formulario de edición: nombre, precio, perks, `limites` (incluyendo usuarios/sucursales/API/webhooks, ya existentes) y — la pieza nueva — una sección de checkboxes con los 13 módulos del catálogo (`modulos_catalogo`), marcando cuáles trae incluidos cada plan.
- Nuevo endpoint de solo lectura: `GET /api/admin/modulos-catalogo` (lista los 13 módulos reales, para poblar los checkboxes — reutiliza `modulos_catalogo` tal cual, cero lógica nueva).
- Guardar la selección escribe en `planes.limites.modulos_incluidos` (arreglo de códigos) — vía el `PATCH /api/admin/planes/:id` que **ya existe**.

### 2.2 Empresa → "Configuración → Herramientas de mi empresa"
Nueva pestaña (`HerramientasTab.jsx`, mismo patrón que `SuscripcionTab.jsx`/`PipelineTab.jsx` ya existentes), con 2 secciones:
- **Mis herramientas** — lee `modulos_empresa` (estado real: activo/integrado/inactivo) cruzado con `modulos_catalogo`.
- **Explorar herramientas** — lee `modulos_catalogo` completo, compara contra `planes.limites.modulos_incluidos` del plan de la organización:
  - Incluido en el plan + no activo todavía → botón **"Activar"**.
  - No incluido en el plan → botón **"Mejorar mi plan"** (enlaza a `SuscripcionTab`) o **"Agregar a mi suscripción"** si se vende por separado (`disponible_comercialmente`).

**Nuevo endpoint:** `POST /api/config/modulos/:codigo/activar` — valida (a) el módulo está en `modulos_incluidos` del plan vigente, (b) `soloGerencial`, (c) dependencias (`modulos_catalogo.dependencias`) ya están activas — y entonces sí escribe en `modulos_empresa` (`estado: 'activo'`, `activado_en`, `activado_por`). Si el módulo NO está incluido en el plan: no activa nada, responde con un mensaje claro — **nunca cobra, nunca factura**, tal como pediste.

### 2.3 "Ampliaciones" sin cobro automático
Para un módulo que se vende por separado o requiere mejorar de plan: el botón registra una **solicitud** (tabla nueva, pequeña: `solicitudes_ampliacion` — company_id, modulo_codigo o tipo_ampliacion, estado, created_at) en vez de activar nada — el Super Admin la revisa manualmente desde Panel Maestro y decide (mismo criterio que `crearSuscripcionManual()` ya existente, sin gateway de pago conectado). Esto cubre tu punto 3 ("comprar ampliaciones de capacidad") sin tocar Stripe.

### 2.4 Cambiar de plan
`SuscripcionTab.jsx` ya muestra la suscripción vigente — falta confirmar si ya tiene un flujo de cambio de plan o solo lectura (pendiente de revisar esa pantalla en detalle antes de tocarla, no lo asumo). Si es de solo lectura, el cambio de plan en autoservicio se agrega ahí, no en la pestaña nueva de Herramientas — son responsabilidades distintas.

---

## 3. Separación que pediste explícitamente: módulos ≠ permisos de empleados

Ya está resuelta por diseño, sin construir nada nuevo: **`modulos_empresa` decide si la EMPRESA contrató el módulo; `roles_permisos` decide qué puede hacer CADA ROL dentro de un módulo ya contratado.** Son dos tablas independientes, ya construidas en fases distintas — una empresa puede tener Inventario activo y, aun así, que solo Almacén lo use (ya es exactamente el comportamiento de hoy, sin cambiar nada).

---

## 4. Lo que NO se construye en esta propuesta

- Cobro automático / Stripe — confirmado explícitamente fuera de alcance.
- Cambiar el enforcement de observación a bloqueo real (sigue pendiente de la Fase 2, con su propia autorización).
- Conexión de `resolverModulosAutorizadosParaIA()` a producción (sigue reservada, sin cambios).

---

## 5. Fases de implementación, si autorizas

| Fase | Contenido | Riesgo |
|---|---|---|
| 3.1 | `GET /api/admin/modulos-catalogo` + formulario de edición en `Planes.jsx` (asignar módulos a cada plan) | Bajo — solo Super Admin, no toca empresas reales todavía |
| 3.2 | `modulos_incluidos` poblado para los 4 planes reales, según la decisión ya confirmada (los 13 en los 4 planes) | Cero riesgo — coincide exactamente con el uso real de hoy |
| 3.3 | `HerramientasTab.jsx` + `POST /api/config/modulos/:codigo/activar` | Bajo — Nort Energy ya tendría los 13 "incluidos", así que activar cualquiera sería un no-op visible (ya están activos/integrados) |
| 3.4 | Tabla `solicitudes_ampliacion` + flujo de revisión manual en Panel Maestro | Bajo — tabla nueva, aditiva |

Recomiendo 3.1+3.2 primero (cero riesgo, deja el catálogo correctamente poblado) antes de construir la UI de empresa (3.3).

---

Quedo a la espera de tu autorización antes de implementar cualquier fase de esta propuesta.
