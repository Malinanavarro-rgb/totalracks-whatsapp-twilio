# TARA Matrix™ — Prioridad 3: normalización inteligente de ubicaciones
**Fecha:** 2026-10-17 · **Implementado y probado localmente — NO desplegado**

---

## Hallazgo previo a implementar (importante)

Antes de diseñar nada, consulté el catálogo real de `irradiacion_regional` en producción. **Tiene solo 2 ciudades: Monterrey, Nuevo León y Hermosillo, Sonora.** De tus 4 ejemplos, 2 no existen en los datos en absoluto:

| Tu ejemplo | ¿Resuelve? | Por qué |
|---|---|---|
| "Estoy en Mty" | **Sí, con este cambio** | Monterrey está en el catálogo |
| "Es para Monterrey" | Ya funcionaba antes | Coincidencia directa de texto |
| "En San Pedro, NL" | **No, y no puede** | San Pedro no está en el catálogo — no hay HSP real para esa ciudad |
| "En Ciudad Victoria" | **No, y no puede** | Ciudad Victoria no está en el catálogo |

Ningún nivel de normalización de texto resuelve una ciudad que no tiene datos de irradiancia reales detrás — hacerlo significaría inventar un HSP, exactamente lo que pediste evitar. San Pedro y Ciudad Victoria son un vacío de **datos**, no de **normalización**. Si quieres que Lucía las reconozca, hace falta agregar esas ciudades (y su HSP real) al catálogo — una decisión de datos, no de código, y no la tomé por mi cuenta.

## Qué se implementó

`_normalizarUbicacion()` (`modules/cotizaciones.js`) ahora intenta, en orden:
1. **Coincidencia directa** (ya existía) — el nombre de la ciudad aparece tal cual en el texto.
2. **Abreviatura inequívoca conocida** (nuevo) — una lista pequeña y conservadora de abreviaturas de uso extendido (mty, gdl, cdmx, hmo, slp, qro, pue, tj, mid, león, mxli), con coincidencia de **palabra completa** (no substring — "administy" nunca matchea "mty"). Solo se usa si, tras expandir la abreviatura, **encuentra una coincidencia real en el catálogo** — si no, el resultado es "no resuelve", exactamente igual que hoy.

Nunca se inventa una ubicación ni un HSP. La lista de abreviaturas puede incluir ciudades que todavía no están en el catálogo (ej. "gdl"/Guadalajara) — eso es intencional y seguro: simplemente no encuentran coincidencia y no cambian nada, preparando el reconocimiento para cuando esas ciudades se agreguen a los datos en el futuro.

## Diff
`modules/cotizaciones.js`: +37/-6 — nueva constante `ABREVIATURAS_CIUDAD_CONOCIDAS` + extensión de `_normalizarUbicacion()`. Ningún otro archivo tocado.

## Pruebas
15 pruebas en `__tests__/validar-requisitos-tecnicos.test.js` (7 de la Prioridad 2, sin cambios de comportamiento salvo una actualizada deliberadamente — "en mty" ahora SÍ resuelve, que es justo el objetivo de P3) + 8 nuevas de Prioridad 3:
- "Estoy en Mty" → resuelve a Monterrey.
- "Es para Monterrey" → sigue resolviendo directo (sin regresión).
- "En Hmo" → resuelve a Hermosillo (confirma que no es solo Monterrey).
- "En San Pedro, NL" / "En Ciudad Victoria" → **no resuelven**, confirmando el hallazgo de catálogo de arriba.
- Límite de palabra completa: "administy" no matchea "mty".
- Abreviatura de una ciudad fuera del catálogo ("gdl") → no resuelve, nunca inventa el dato.

**Resultado global: 2550/2550, 128 suites, 0 regresiones.**

## Riesgos
- La lista de abreviaturas es manual — si aparece una ciudad nueva con una abreviatura común no listada, simplemente no se reconoce (mismo comportamiento seguro de "no resuelve", nunca inventa).
- El vacío real es el catálogo de solo 2 ciudades — cualquier cliente fuera de Monterrey/Hermosillo seguirá sin poder obtener un predimensionamiento automático hasta que se agreguen más ciudades con HSP real.

## Siguiente paso
Mencionaste continuar con P5 (evitar que Lucía comunique cifras no validadas) después de P3. Quedo a la espera de tu autorización para ese diseño/implementación, y de tu decisión sobre si quieres agregar más ciudades al catálogo de `irradiacion_regional` (sería una migración de datos, no de código).

**No hice push ni despliegue.**
