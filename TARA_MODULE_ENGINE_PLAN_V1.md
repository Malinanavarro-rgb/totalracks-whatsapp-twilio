# TARA Module Engine — plan de implementación (Fase 0-1)

**Fecha:** 2026-10-16
**Estado:** propuesta concreta, lista para autorizar — cero código escrito todavía. Responde a tu instrucción de cierre de la Fase 1: *"propón la implementación del TARA Module Engine y su integración con las herramientas de inteligencia artificial."*

Alcance de esta propuesta: **Fase 0-1 únicamente** (catálogo + espejo de Nort Energy, sin enforcement todavía) — las fases de enforcement real (2), UI de activación (3) y planes↔módulos comercial (4) quedan para una autorización posterior, una vez que esto esté funcionando y validado, tal como describe `TARA_SAAS_CORE_ARCHITECTURE_V1.md` sección G.

---

## 1. Lo que ya tengo confirmado, sin volver a investigar

- `MODULOS_PERMISOS` (`modules/permisos.js`) ya es, de facto, el catálogo real de módulos departamentales: `crm, cotizaciones, proyectos, cobranza, instalaciones, inventario, compras, tramites_cfe, garantias, mantenimiento, tickets, configuracion` — 12 valores, ya en producción.
- `companies.nav_labels.modulos[]` de Nort Energy **ya trae un campo `modulo`** en cada entrada (lo agregué yo misma el 2026-10-01 para el filtrado de menú por rol, `scripts/nort-energy-nav-modulo-permisos.js`) — coincide exactamente con los valores de `MODULOS_PERMISOS` donde aplica. Esto significa que el "espejo" de la Fase 1 no requiere inventar un mapeo nuevo: ya existe, dato por dato, en la base real.
- `requirePermiso(modulo, accion)` (middleware ya en producción, 134 rutas reales) es el patrón exacto a imitar para `requireModuloActivo(modulo)` — mismo criterio de fallback de dos niveles, misma forma de componerse en una ruta.
- Agenda es el único módulo "huérfano" — no tiene identificador en `MODULOS_PERMISOS` todavía. Lo agrego a este catálogo (aditivo, valor nuevo) como parte de esta propuesta.

---

## 2. Migración propuesta (aditiva, una sola, Fase 0)

```sql
CREATE TABLE IF NOT EXISTS modulos_catalogo (
  codigo text PRIMARY KEY,
  nombre text NOT NULL,
  descripcion text,
  categoria text,
  estado text NOT NULL DEFAULT 'disponible',
  dependencias text[] NOT NULL DEFAULT '{}',
  disponible_comercialmente boolean NOT NULL DEFAULT false,
  version text NOT NULL DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modulos_empresa (
  company_id uuid NOT NULL REFERENCES companies(id),
  modulo_codigo text NOT NULL REFERENCES modulos_catalogo(codigo),
  activo boolean NOT NULL DEFAULT false,
  activado_en timestamptz,
  activado_por uuid,
  PRIMARY KEY (company_id, modulo_codigo)
);

CREATE INDEX IF NOT EXISTS idx_modulos_empresa_company ON modulos_empresa (company_id);
```

**Datos iniciales (parte de la misma migración, no un paso aparte):** 13 filas en `modulos_catalogo` — los 12 de `MODULOS_PERMISOS` + `agenda` — con `nombre`/`categoria` descriptivos, `dependencias` solo donde son reales (`garantias` depende de `instalaciones`; `cobranza`, `instalaciones`, `tramites_cfe`, `mantenimiento` dependen de `proyectos`). `configuracion` queda marcada `disponible_comercialmente: false` (toda empresa la necesita, nunca se vende/activa por separado — mismo criterio que ya aplicamos al dejarla fuera del gating de lecturas en la re-auditoría del 2026-10-14).

---

## 3. El "espejo" de Nort Energy (Fase 1, dentro de la misma migración o un script separado — tu preferencia)

Un script, mismo patrón que los `scripts/nort-energy-*.js` ya usados toda la sesión:

```js
// Lee companies.nav_labels.modulos de Nort Energy, agrupa por el campo
// `modulo` ya presente, y marca activo=true en modulos_empresa exactamente
// donde hoy nav_labels ya dice habilitado=true — una copia fiel del
// estado actual, no un cambio. Los módulos sin habilitado=true (ej.
// Reportes, que ni siquiera existe) no se activan.
```

**Resultado esperado para Nort Energy (verificable antes de aplicar, con los datos reales que ya leí esta sesión):** `crm, cotizaciones, agenda, tramites_cfe, inventario, compras, garantias, mantenimiento, tickets, configuracion` activos; `instalaciones` y `cobranza` **inactivos** (coinciden con `habilitado:false` en su nav actual — Instalaciones/Cobranza siguen siendo accesibles solo vía Proyecto 360°, consistente con el diseño ya existente, no es una regresión nueva).

**Cero riesgo:** esta tabla no la consulta todavía ningún middleware — es puro registro, sin efecto observable hasta la Fase 2.

---

## 4. `requireModuloActivo()` — diseño, no implementado todavía (Fase 2, requiere tu autorización aparte)

```js
async function empresaTieneModuloActivo(supabase, companyId, moduloCodigo) {
  const { data } = await supabase
    .from('modulos_empresa').select('activo').eq('company_id', companyId).eq('modulo_codigo', moduloCodigo).maybeSingle();
  // Sin fila = empresa nunca migrada a este sistema → comportamiento actual, sin restricción
  // (mismo criterio de "cero regresión" que roles_permisos).
  if (!data) return true;
  return data.activo === true;
}

function requireModuloActivo(modulo) {
  return async function (req, res, next) {
    try {
      const activo = await empresaTieneModuloActivo(req.supabase, req.usuario.company_id, modulo);
      if (!activo) return res.status(403).json({ error: 'Este módulo no está activo para tu empresa.' });
      next();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  };
}
```

Se compone ANTES de `requirePermiso`, nunca en su lugar: `app.get('/api/inventario/...', requireAuth, requireModuloActivo('inventario'), requirePermiso('inventario', 'ver'), ...)`. Con el espejo de la Fase 1 ya aplicado, Nort Energy no notaría ningún cambio el día que esto se active — todo lo que hoy usa ya quedaría marcado `activo=true`.

**Esto NO se implementa en esta entrega** — queda diseñado y listo, a la espera de que autorices la Fase 2 por separado, igual que pediste para el resto.

---

## 5. Integración con las herramientas de inteligencia artificial

Esta es la pieza que pediste explícitamente conectar desde el diseño, no después.

```js
/**
 * Resuelve qué módulos puede OFRECER/EJECUTAR la IA para esta empresa+rol,
 * cruzando Module Engine (¿está contratado?) con roles_permisos (¿este rol
 * puede usarlo?). Sin fila en modulos_empresa = módulo disponible (mismo
 * fallback de siempre). Sin matriz de roles configurada = permiso disponible
 * (mismo fallback de siempre, roles_permisos.js).
 */
async function resolverModulosAutorizadosParaIA(supabase, { companyId, rol }) {
  const [activos, visibles] = await Promise.all([
    listarModulosActivos(supabase, companyId),      // nuevo, trivial: SELECT sobre modulos_empresa
    modulosVisibles(supabase, { companyId, rol }),   // YA EXISTE, modules/permisos.js — reutilizado tal cual
  ]);
  return visibles.filter((m) => activos.has(m) || !activos.size /* empresa sin migrar */);
}
```

Esta función alimenta DOS puntos, nunca uno solo (tu requisito explícito de la sección 4 de tu prompt — "la autorización debe validarse nuevamente al ejecutar, no solo al mostrar"):
1. `bloque_capacidades()` (`modules/prompt-builder.js`) — qué `acciones_propuestas` ve el modelo como disponibles.
2. Dentro de `ActionRunner.ejecutar()` / `ejecutarTool()` (Modo Operador) — revalidación antes de tocar la tabla real, no solo antes de mostrarle la opción al modelo.

**Tampoco se implementa en esta entrega** — es el diseño que conecta Module Engine + AI Engine, para tu autorización junto con la Fase 2.

---

## 6. Lo que SÍ propongo autorizar ahora (Fase 0-1 completa)

- Migración de `modulos_catalogo` + `modulos_empresa` (sección 2).
- Agregar `agenda` a `MODULOS_PERMISOS` (aditivo, no rompe nada — ningún código existente itera ese arreglo esperando exactamente 12 valores).
- Script de espejo para Nort Energy (sección 3).
- Pruebas: catálogo poblado correctamente, espejo de Nort Energy coincide exactamente con su `nav_labels` real, aislamiento multiempresa de `modulos_empresa`, y confirmación de que ningún endpoint cambia de comportamiento (sin `requireModuloActivo` en ninguna ruta todavía).

**No incluye:** `requireModuloActivo()` en ninguna ruta real, `resolverModulosAutorizadosParaIA()` conectada al prompt/ActionRunner, ni ningún cambio a planes/precios. Eso es Fase 2, con su propia autorización.

---

Quedo a la espera de tu autorización para la Fase 0-1 descrita arriba.
