# TARA Module Engine — Fase 2 (propuesta, no implementada)

**Fecha:** 2026-10-17
**Estado:** propuesta — cero código escrito. Responde a tu instrucción de cierre de la Fase 0-1: *"prepara la propuesta de la Fase 2: conexión de módulos con planes, permisos y herramientas de TARA AI."*

---

## 1. Lo que la Fase 0-1 ya dejó listo

- `modulos_catalogo` (13 módulos reales) y `modulos_empresa` (Nort Energy: 8 `activo` + 2 `integrado`, las otras 16 empresas sin fila = pendientes).
- `companies.module_engine_configurado_en` — ya distingue "nunca migrada" de "migrada".
- Todo esto es **puro registro hoy** — ningún middleware ni ruta lo consulta todavía.

## 2. Las 3 piezas de la Fase 2 (en el orden que recomiendo)

### 2.1 `requireModuloActivo(modulo)` — enforcement real en backend
Middleware nuevo, se compone ANTES de `requirePermiso` (nunca en su lugar):
```js
app.get('/api/inventario/...', requireAuth, requireModuloActivo('inventario'), requirePermiso('inventario', 'ver'), ...)
```
Regla de fallback (idéntica en espíritu a `roles_permisos`): sin fila en `modulos_empresa` para esa empresa+módulo → **activo** (cero regresión — las 16 empresas sin migrar siguen funcionando exactamente igual). Con fila `'inactivo'` → 403 claro. Con fila `'integrado'` o `'activo'` → pasa.

**Decisión pendiente de tu autorización:** ¿se aplica a las 134 rutas del bloque operativo de una sola vez (mismo volumen mecánico que ya hicimos con `requirePermiso`), o se empieza por un subconjunto pequeño para validar en producción antes de generalizar? Recomiendo lo segundo — 1 módulo (ej. Inventario) como piloto.

### 2.2 Planes ↔ Módulos — la conexión comercial real
Hoy `planes.limites` (JSON) no tiene ningún campo de módulos. Propuesta aditiva:
```json
{ "api": false, "webhooks": false, "max_usuarios": null, "max_sucursales": 2,
  "modulos_incluidos": ["crm", "cotizaciones", "agenda", "proyectos", "cobranza"] }
```
Al activar un módulo (Fase 3, UI), el backend valida que `modulo` esté en `planes.limites.modulos_incluidos` del plan de la organización antes de escribir en `modulos_empresa` — esto SÍ requiere decidir primero qué módulos trae cada uno de los 4 planes reales (Launch/Professional/Unlimited/Enterprise), una decisión comercial tuya, no técnica. **No propongo valores por ahora** — necesito tu definición antes de escribir esto.

### 2.3 Conexión con las herramientas de IA — `resolverHerramientasAutorizadas()`
Ya diseñada en `TARA_AI_ENGINE_ARCHITECTURE_V1.md` sección 5. Revalida en DOS puntos, nunca uno solo:
1. `bloque_capacidades()` (`modules/prompt-builder.js`) — qué le dice el prompt al modelo que puede proponer.
2. Dentro de `ActionRunner.ejecutar()` / `ejecutarTool()` (Modo Operador) — antes de tocar la tabla real, sin importar lo que el modelo haya propuesto.

Ningún cambio a `Orchestrator`, `WorkflowEngine`, `AIProvider` ni `ActionRunner` como clases — se conecta vía la misma inyección de dependencias opcional que ya usamos para `actualizarClasificacion`/`registrarConsumoIA`.

## 3. Pruebas que propongo para la Fase 2 (antes de autorizar)

- Empresa sin módulo activo → la ruta responde 403, la IA nunca propone esa acción, y si de alguna forma llegara a proponerla, `ActionRunner` la rechaza igual.
- Empresa sin fila (no migrada) → comportamiento idéntico a hoy, en ruta y en IA.
- Nort Energy, con el espejo ya aplicado → cero cambio observable (todo lo que usa hoy sigue activo/integrado).
- Cambio de plan → módulos fuera del nuevo plan quedan `inactivo`, nunca se borra el historial de lo que ya existía en las tablas operativas.

## 4. Lo que necesito de ti antes de implementar

1. Autorización para el piloto de `requireModuloActivo()` en 1 módulo (sugiero Inventario) o para los 134 de una vez.
2. Qué módulos incluye cada uno de los 4 planes reales — decisión comercial.
3. Confirmación de que `resolverHerramientasAutorizadas()` se implementa en esta misma fase o en una posterior.

No avanzo a implementar nada de esto hasta tu autorización explícita.
