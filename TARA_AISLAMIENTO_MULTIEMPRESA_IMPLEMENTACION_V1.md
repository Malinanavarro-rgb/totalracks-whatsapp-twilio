# TARA Matrix™ — Aislamiento multiempresa: implementación local
**Fecha:** 2026-10-17 · **Código implementado y probado localmente — migración preparada pero NO ejecutada — sin push ni despliegue**

---

## Diseño de la corrección

Nueva columna `channel_endpoints.permite_atribucion_cruzada boolean default false`. La jerarquía de atribución de leads (`modules/lead-atribucion.js`) ahora exige este flag explícitamente en `true` para evaluar cualquier nivel — si no, devuelve de inmediato el `company_id` del endpoint, sin tocar ninguna tabla.

El guard vive **dentro** de `resolverContextoDeLead()` (no solo en el call site de `server.js`) — así el aislamiento no depende de que nadie recuerde pasar el flag correctamente en el futuro.

## Tus 5 garantías

**1. Un canal dedicado nunca cambia de `company_id` por historial de otro cliente/empresa.**
`resolverContextoDeLead()` ahora empieza con: si `permiteAtribucionCruzada` no es `true`, devuelve `companyIdFallback` (el que resolvió `ChannelRouter`) de inmediato — `resueltoPor: 'canal_dedicado'`. Ningún nivel 1-4 se evalúa. Prueba de regresión exacta del incidente real en `__tests__/lead-atribucion.test.js` (describe "aislamiento multiempresa (canal dedicado)").

**2. La atribución comercial sigue funcionando sin modificar la empresa propietaria del canal.**
La jerarquía completa (niveles 1-5, sin cambios internos) sigue intacta y disponible — simplemente ahora requiere `permiteAtribucionCruzada: true`. Para el número que sí esté diseñado para compartirse (cuando exista), la atribución de campañas/ads sigue funcionando exactamente igual que antes — prueba "canal COMPARTIDO... conserva el comportamiento autorizado".

**3. Los canales compartidos mantienen su comportamiento autorizado, sin acceso indiscriminado a datos de otras empresas.**
Confirmado con pruebas explícitas: un canal dedicado (`permiteAtribucionCruzada: false`) **nunca consulta ninguna tabla** (`expect(db.from).not.toHaveBeenCalled()`), ni siquiera ante un referral de Meta verificable o un token de campaña válido — el endpoint manda, sin excepción.

**4. Las consultas de historial respetan el aislamiento multiempresa.**
El guard corta ANTES de `buscarContextoPersistido()` (la consulta sin filtro de empresa que causó el incidente) — para un canal dedicado, esa consulta simplemente nunca se ejecuta.

**5. Meta y Twilio conservan su funcionamiento.**
`server.js` pasa `routeResult.permite_atribucion_cruzada` (ya resuelto por `ChannelRouter.enrutar()`, idéntico en ambos webhooks) a `_aplicarAtribucionDeLead()` en ambas rutas (`/webhook/twilio` y `/webhook/meta`) — mismo mecanismo, sin divergencia entre proveedores.

## Diff

- **`modules/lead-atribucion.js`** (+27/-1): guard de aislamiento al inicio de `resolverContextoDeLead()`; nuevo parámetro `permiteAtribucionCruzada`; comentario de diseño actualizado.
- **`modules/channel-router.js`** (+12/-2): `enrutar()` ahora selecciona y devuelve `permite_atribucion_cruzada` (default `false` si la columna no existe aún — compatibilidad con pre-migración).
- **`server.js`** (+18/-2): `_aplicarAtribucionDeLead()` recibe y propaga el flag; ambos webhooks lo pasan desde `routeResult.permite_atribucion_cruzada`; comentario de diseño actualizado.
- **`__tests__/lead-atribucion.test.js`** (+97/-8): 8 pruebas existentes actualizadas (`permiteAtribucionCruzada: true`, preservando su cobertura original de la jerarquía) + 5 pruebas nuevas (incidente reproducido, "sin acceso indiscriminado", ignora referral/token, canal compartido sigue funcionando).
- **`__tests__/channel-router.test.js`** (+29/-5): 1 prueba existente actualizada + 4 nuevas (propagación del flag, default seguro pre-migración, caché).
- **`migrations/133_permite_atribucion_cruzada.sql`** (nuevo, NO ejecutado): `ALTER TABLE ... ADD COLUMN ... DEFAULT false`, con nota explícita de orden de despliegue.

Nada de esto toca `WorkflowEngine`, fórmulas solares (`modules/motores-ingenieria/`) ni reglas comerciales (`personalities.reglas`) — confirmado, cero cambios fuera de los 5 archivos listados.

## Pruebas: 130/130 suites, 2628/2628 tests, limpio (8 nuevas, 0 regresiones).

## Riesgos / pendientes

1. **Orden de despliegue obligatorio:** la migración debe ejecutarse ANTES del push/deploy del código. Si el código se despliega primero, el `SELECT` de `channel-router.js` fallaría contra la columna inexistente — `ChannelRouter.enrutar()` ya está escrito para no lanzar en ese caso (devuelve `null`), pero eso significa que **ningún** mensaje entrante encontraría empresa hasta aplicar la migración — webhook caído por completo mientras tanto. Documentado explícitamente en el propio archivo de migración.
2. **Ningún endpoint existente queda marcado como compartido todavía** — confirmé que la empresa "TARA-OS" (slug `tara-os`) no tiene ninguna fila en `channel_endpoints` hoy, así que el escenario "un número sirve a 2 empresas" descrito en el diseño original de 2026-08-14 no está activo en producción actualmente. Si en el futuro se activa un número realmente compartido, se marca con un `UPDATE` explícito (ejemplo ya incluido en la migración) — decisión tuya, no la tomé por ti.
3. El contacto de prueba (`+5218142850036`) sigue teniendo historial legítimo bajo 4 empresas demo distintas (incluida TARA-OS) — eso ya no importa para Nort Energy una vez aplicada esta corrección (su canal queda protegido), pero si retomas pruebas con ese número en OTRAS empresas demo, ese historial cruzado seguirá existiendo ahí (no es parte del alcance de esta corrección).

---

**No ejecuté la migración. No hice push. No hice despliegue. No toqué WorkflowEngine, fórmulas solares ni reglas comerciales.**
