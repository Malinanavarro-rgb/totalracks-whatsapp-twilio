# TARA Matrix™ — Aislamiento multiempresa: verificación final
**Fecha:** 2026-10-17 · **Migración NO ejecutada — sin push ni despliegue todavía**

---

## 1. Migración — verificación punto por punto

**¿Puede ejecutarse sin eliminar información?** Sí — el único statement es `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Cero `DROP`, `DELETE`, `UPDATE` en todo el archivo.

**¿Establece `false` para los registros existentes?** Sí — `NOT NULL DEFAULT false`. Postgres aplica el default a cada fila ya existente como parte de la misma operación (metadata-only en Postgres 11+, no reescribe la tabla).

**¿No modifica los `company_id` actuales?** Confirmado — la columna nueva es independiente; ningún `company_id` se toca.

**¿No afecta otros endpoints?** Confirmado — es un `ALTER TABLE` uniforme: agrega la misma columna con el mismo default a todas las filas por igual, sin distinguir ni afectar la configuración (`endpoint`, `activo`, `company_id`) de ninguna fila en particular.

**¿Se puede verificar con una consulta de solo lectura?** Sí, incluida en el propio archivo de migración (sección siguiente).

## 2. Compatibilidad — migración aplicada, Render con código anterior

Revisé específicamente este escenario intermedio: **es seguro.** El código ANTERIOR (el que hoy está en Render):
- `modules/channel-router.js` (versión actual en producción) hace `SELECT company_id, proveedor, companies(slug)` — **no** pide la columna nueva, así que no le importa que exista.
- `server.js` (versión actual) llama `_aplicarAtribucionDeLead(message, req.body, proveedor)` con 3 argumentos — un 4º argumento ausente simplemente no se pasa, sin error.
- `modules/lead-atribucion.js` (versión actual) no tiene el guard nuevo — sigue evaluando la jerarquía completa como siempre lo ha hecho (el comportamiento de ANTES de esta corrección, no roto, solo todavía no corregido).

Es decir: aplicar la migración primero y desplegar el código después deja una ventana donde el bug original sigue presente (como ya lo está hoy) pero **nada se cae ni genera error** — exactamente el orden seguro. El escenario inverso (código nuevo + migración pendiente) sí es el riesgo real, ya documentado: el `SELECT` del código nuevo fallaría contra la columna inexistente.

## 3. Seguridad — ningún endpoint puede activarse por accidente

Audité los 2 únicos lugares donde el código escribe en `channel_endpoints`:
- `modules/meta-auth.js:81-89` (`registrarChannelEndpointMeta`, la ruta real de conexión de un número de Meta vía Embedded Signup) — hace `upsert({ company_id, endpoint, canal, proveedor, activo })`, **sin mencionar `permite_atribucion_cruzada`**. Para una fila nueva, Postgres aplica el default (`false`); para una fila existente, el campo simplemente no se incluye en el `SET` del upsert — queda como estaba, nunca se activa solo.
- Todas las demás referencias a `channel_endpoints` en el código (`server.js`, `modules/configuracion.js`) son `SELECT`, no escriben nada.

Conclusión: no existe ningún camino de código que pueda poner `permite_atribucion_cruzada = true` — solo un `UPDATE` manual explícito (como el que yo mismo documenté como ejemplo, sin ejecutar) podría activarlo. Confirmado: **todos los endpoints reales quedarán en `false`.**

## 4. Pruebas

Corrí la suite completa de nuevo: **130/130 suites, 2628/2628 tests, limpio.**

La prueba que reproduce exactamente tu segundo requisito ("que el webhook de Nort Energy mantenga su `company_id` aunque el remitente tenga historial en otra empresa") ya existe en `__tests__/lead-atribucion.test.js`, describe "aislamiento multiempresa (canal dedicado)":
```js
test('incidente reproducido: canal dedicado (permiteAtribucionCruzada ausente) → NUNCA se pierde el company_id del endpoint, aunque exista un hilo abierto en otra empresa', async () => {
  const db = crearMockDbPorTabla({
    clientes: { data: [{ id: 177, company_id: COMPANY_TARA_OS }], error: null },
    hilos:    { data: { id: 'hilo-tara-os', company_id: COMPANY_TARA_OS, cliente_id: 177 }, error: null },
  });
  const resultado = await resolverContextoDeLead(db, {
    telefono: TELEFONO, reqBody: {}, proveedor: 'meta', mensajeTexto: 'soy de Ciudad Victoria',
    companyIdFallback: COMPANY_NORT, // el endpoint SÍ es exclusivo de Nort Energy
  });
  expect(resultado.companyId).toBe(COMPANY_NORT); // nunca cede a COMPANY_TARA_OS
});
```

## 5. Entrega

### SQL exacto de la migración
```sql
ALTER TABLE channel_endpoints
  ADD COLUMN IF NOT EXISTS permite_atribucion_cruzada boolean NOT NULL DEFAULT false;
```
(archivo completo con comentarios en `migrations/133_permite_atribucion_cruzada.sql`)

### Consulta de verificación (solo lectura)
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'channel_endpoints' AND column_name = 'permite_atribucion_cruzada';
-- Esperado: 1 fila — boolean, default 'false', NO (not nullable)

SELECT endpoint, company_id, permite_atribucion_cruzada FROM channel_endpoints;
-- Esperado: TODAS las filas con permite_atribucion_cruzada = false
```

### Procedimiento de reversión
```sql
ALTER TABLE channel_endpoints DROP COLUMN IF EXISTS permite_atribucion_cruzada;
```
Elimina únicamente la columna nueva — ningún otro dato de `channel_endpoints` se toca. **Importante:** si ya desplegaste el código nuevo cuando reviertas la migración, revierte el código primero (o simultáneamente) — el código nuevo depende de que la columna exista.

### Comandos de push
Commit local ya creado: **`6aa4efa`** — "fix(lead-atribucion): aislamiento multiempresa — canal dedicado nunca cede su company_id por historial de otra empresa"
```
cd /Users/alinanavarro/Downloads/tara-ttracks
git push origin main
```
(o el botón "Push origin" en GitHub Desktop, como las veces anteriores)

### Plan de verificación de Render
1. **Antes de pushear:** ejecuta la migración (sección SQL arriba) en Supabase — este orden es el seguro, confirmado en la sección 2.
2. Corre la consulta de verificación — confirma 1 fila boolean/false/not-null y que todos los endpoints existentes muestran `false`.
3. Push a GitHub (comando arriba).
4. Espera 1-2 min, revisa la pestaña "Deploys" de Render — confírmame el commit `6aa4efa` como Live.
5. Verifico `/health` y `/api/diagnostics` desde aquí.
6. Prueba real: manda un mensaje al número dedicado de Nort Energy desde el teléfono de prueba (que sigue teniendo historial con TARA-OS) — debe permanecer como Nort Energy, no saltar a otra empresa.

---

**No ejecuté la migración. No hice push. No hice despliegue.**
