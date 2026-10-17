# TARA Matrix™ — Prioridad 8: ampliación del catálogo de irradiación solar
## Diagnóstico — SOLO diagnóstico, sin catálogo modificado, sin migraciones, sin push

**Fecha:** 2026-10-17

---

## 1. Estructura actual de `irradiacion_regional`

Confirmada en vivo (solo lectura) y contra la migración original (`migrations/088_ingenieria_cotizacion_fase1.sql`):

```sql
CREATE TABLE irradiacion_regional (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_ubicacion    text NOT NULL,
  lat                 numeric(9,6),
  lng                 numeric(9,6),
  hsp_promedio_anual  numeric(5,2) NOT NULL,
  hsp_mensual         jsonb,  -- {"enero": 4.8, ...} — nullable
  fuente              text NOT NULL,  -- ej. "NREL NSRDB", "SENER Atlas Solar"
  fecha_fuente        date,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

Comentario original de diseño (2026-08-04): *"Guarda fuente y fecha explícitas porque un predimensionamiento sin saber de dónde salió el HSP no es auditable."* — el esquema ya fue pensado para esto; **no hace falta ninguna columna nueva**.

**Datos actuales (las 2 únicas filas que existen):**

| Ubicación | HSP anual | HSP mensual | Fuente | Fecha fuente |
|---|---|---|---|---|
| Monterrey, Nuevo León | 5.5 | Sí (12 meses) | NREL NSRDB | 2024-01-01 |
| Hermosillo, Sonora | 6.0 | No (null) | NREL NSRDB | 2024-01-01 |

`lat`/`lng` están guardados pero **nunca se consultan** en ningún lado del código — confirmé por grep que `resolverHSP()`/`_normalizarUbicacion()` solo comparan por `nombre_ubicacion` (texto), nunca por cercanía geográfica. Es metadata reservada para una función futura que no existe todavía.

## 2. Resolución de ubicaciones (cómo encuentra el motor una ciudad)

`_normalizarUbicacion()` (`modules/cotizaciones.js`): compara el texto libre del cliente contra `nombre_ubicacion` de forma directa, y desde Prioridad 3 (2026-10-17) también contra una lista pequeña de abreviaturas conocidas ("mty", "hmo", etc.) — **ninguna de las dos formas inventa una ciudad que no esté en la tabla**. Agregar Ciudad Victoria/Tampico solo requiere que sus nombres (o abreviaturas obvias) coincidan con lo que el cliente escriba — cero cambio de código.

## 3. Metodología del motor — ¿valor anual o estacional?

**Hallazgo central, responde directamente tu pregunta:**

`calcularPotenciaRequerida()` (`modules/motores-ingenieria/paneles-solares.js`, la fórmula que decide CUÁNTOS PANELES recomendar) usa **ÚNICAMENTE `hsp.valor` — el promedio ANUAL**. Nunca consulta `hsp_mensual` para esto. Esto es así **incluso para Monterrey**, que sí tiene los 12 meses cargados.

`hsp_mensual` solo lo usa `calcularProduccion()` — una función **secundaria**, para estimar cuánta energía producirá el sistema mes a mes (útil para el gráfico de ahorro del PDF, mostrar que en enero se produce menos que en julio). Si no hay datos mensuales, cae a una estimación uniforme (`anual ÷ 12`) marcada explícitamente como `estimacionSimplificada: true` — nunca se presenta como dato preciso sin que quede identificado como tal.

**Consecuencia comercial concreta:** el tamaño del sistema recomendado (número de paneles, kWp) para Ciudad Victoria/Tampico sería **igual de confiable con solo un HSP anual** que con un desglose mensual completo. Lo único que se pierde sin datos mensuales es el detalle fino del gráfico de producción estacional — no la recomendación técnica central. Esto reduce significativamente la barra de entrada para agregar estas 2 ciudades.

## 4. Qué datos se necesitan — propuesta técnicamente verificable

Mínimo indispensable por ciudad (mismo esquema, cero columnas nuevas):
- `nombre_ubicacion`: formato idéntico al existente, ej. `"Ciudad Victoria, Tamaulipas"` / `"Tampico, Tamaulipas"`.
- `hsp_promedio_anual`: HSP real de una fuente verificable (ver sección 5) — **no lo propongo yo mismo sin una fuente citable real**.
- `lat`/`lng`: coordenadas públicas de cada ciudad (dato no controvertido, fácil de verificar).
- `fuente`: texto describiendo la fuente exacta.
- `fecha_fuente`: fecha del dataset de origen (no la fecha en que se carga a TARA).
- `hsp_mensual`: deseable pero NO indispensable (ver sección 3) — puede agregarse después sin romper nada, es un campo nullable.

## 5. Cómo documentar fuente/periodo/metodología/unidad (sin columnas nuevas)

Propongo una **convención de texto estructurado** dentro del campo `fuente` ya existente (cero migración), consistente con el ejemplo que el propio diseño original ya anticipaba:

```
"NREL NSRDB PSM v4 — TMY (periodo de referencia 1998-2022) — kWh/m²/día"
```
o, si se usa la fuente mexicana oficial:
```
"SENER — Atlas Solar de México — kWh/m²/día"
```

`unidad` (kWh/m²/día = Hora Solar Pico) es el estándar universal de la industria y de HECHO ya es lo que `hsp_promedio_anual`/`hsp_mensual` representan hoy — nunca ha sido ambiguo, solo nunca estuvo escrito explícitamente. Documentarlo en el texto de `fuente` lo deja auditable sin tocar el esquema.

**Alternativa (si prefieres campos consultables en vez de texto libre):** agregar columnas `metodologia text`, `periodo_referencia_inicio date`, `periodo_referencia_fin date` — esto SÍ requeriría una migración nueva. Lo presento como opción, no como mi recomendación por defecto (la opción de texto estructurado logra el mismo objetivo de auditabilidad sin ampliar el esquema).

## 6. Fuentes propuestas (intento real, con un límite honesto)

Intenté obtener valores reales de HSP para Ciudad Victoria y Tampico directamente desde NREL (la misma fuente que ya usan Monterrey/Hermosillo) para esta investigación. **Mi entorno no tiene acceso de red a los dominios de NREL** (`developer.nrel.gov`, `pvwatts.nrel.gov` — fallo de resolución DNS, confirmado con 2 intentos distintos) — no pude completar la consulta. No voy a inventar ni aproximar un valor sin esa verificación.

**Dos fuentes candidatas legítimas, ambas ya contempladas en el diseño original de la tabla:**

1. **NREL NSRDB / PVWatts Calculator** (`https://pvwatts.nrel.gov`) — misma fuente que Monterrey/Hermosillo, consistencia total con el catálogo existente. Requiere acceso de red que mi entorno actual no tiene, o una API key de NREL (tienen una "DEMO_KEY" pública, limitada en tasa de uso, documentada en `developer.nrel.gov/docs/solar/pvwatts/v8/`).
2. **SENER — Atlas Solar de México** (`atlassolar.energia.gob.mx` o equivalente oficial del Sistema de Información Energética) — fuente mexicana oficial, el propio comentario de la migración original ya la nombra como alternativa válida. Potencialmente más citable/autorizada para ubicaciones específicamente mexicanas que una fuente estadounidense.

**Recomendación concreta:** tú (o alguien con acceso de red sin restricciones) consulta directamente PVWatts o el Atlas Solar de SENER para las coordenadas de Ciudad Victoria (~23.74° N, -99.14° O) y Tampico (~22.26° N, -97.87° O), y me compartes los 2 valores (anual, y mensual si está disponible) junto con la captura/cita de la fuente — yo preparo el INSERT exacto con ese dato real, documentado, sin tocar ninguna fórmula.

## 7. Propuesta de implementación (sin modificar fórmulas)

**Esto es, literalmente, un cambio de DATOS, no de código.** Una vez que tengas los valores reales verificados:

```sql
INSERT INTO irradiacion_regional (nombre_ubicacion, lat, lng, hsp_promedio_anual, hsp_mensual, fuente, fecha_fuente)
VALUES
  ('Ciudad Victoria, Tamaulipas', <lat>, <lng>, <hsp_real>, <hsp_mensual_o_null>, '<fuente_citada>', '<fecha_del_dataset>'),
  ('Tampico, Tamaulipas',         <lat>, <lng>, <hsp_real>, <hsp_mensual_o_null>, '<fuente_citada>', '<fecha_del_dataset>');
```

**Cero cambios a:**
- `modules/motores-ingenieria/paneles-solares.js` (fórmulas) — ya funciona para cualquier HSP válido.
- `modules/cotizaciones.js::resolverHSP()`/`_normalizarUbicacion()` — ya resuelven por nombre, funcionan automáticamente en cuanto la fila exista.
- `modules/orchestrator.js` — nada relacionado con ubicaciones se tocó en P7/P8.

**Único paso real:** un `INSERT` de 2 filas (no requiere migración de esquema — la tabla ya existe con todas las columnas necesarias).

## 8. Riesgos

- **No tengo forma de verificar un valor HSP yo mismo en este entorno** — cualquier número que se use debe venir de ti o de alguien con acceso directo a NREL/SENER, citado con fuente real.
- Sin `hsp_mensual` (aceptable, ver sección 3), el PDF de esas 2 ciudades mostrará producción mensual uniforme en vez de estacional — una limitación menor, no bloqueante, y ya existe hoy para Hermosillo.
- `lat`/`lng` reales de estas ciudades son dato público no controvertido — bajo riesgo ahí.
- El texto de `_normalizarUbicacion` compara por la PRIMERA palabra antes de la coma (ej. "Ciudad Victoria" vs. "Victoria" a secas) — debo confirmar que el formato exacto de `nombre_ubicacion` que se use sea reconocible por el texto libre típico de un cliente (ej. si alguien escribe solo "Victoria", ¿matchea "Ciudad Victoria, Tamaulipas"? Hoy NO, porque la comparación usa la palabra ANTES de la coma completa — sería "ciudad victoria", y el cliente probablemente solo escriba "victoria". Este es un caso real a resolver en la implementación, no inventado — lo marco para cuando se autorice la carga real.

---

**No se modificó el catálogo, no hay migraciones, no hice push ni despliegue.** Quedo a la espera de los valores reales verificados (o de que me autorices a intentar obtenerlos yo mismo si me das acceso de red o una API key de NREL) antes de proponer el INSERT exacto.
