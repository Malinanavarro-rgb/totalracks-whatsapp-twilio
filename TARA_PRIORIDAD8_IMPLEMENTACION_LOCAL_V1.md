# TARA Matrix™ — Prioridad 8: implementación local (catálogo HSP + resolución de ubicaciones)
**Fecha:** 2026-10-17 · **Código implementado y probado localmente — SQL preparado pero NO ejecutado — sin push ni despliegue**

---

## 1. Validación final de fuentes — corrección real encontrada

Al verificar que el promedio anual fuera consistente con los 12 valores mensuales (lo que pediste), **encontré un error real en mi propia entrega anterior**: el anual que propuse para Tampico (5.12) no coincidía con el promedio de mis propios 12 valores mensuales (que da ≈5.23). Investigué la causa: **5.12 es, de hecho, el valor de septiembre** en mi tabla mensual — mi herramienta de extracción tomó la fila equivocada al resumir el "promedio anual" de PVGIS.

**Corregido con cálculo propio, sin intervención de IA en la aritmética** (recuperé los 12 valores mensuales crudos y sumé/dividí yo mismo en código):

| Ciudad | Anual original (incorrecto) | **Anual corregido** | Verificación |
|---|---|---|---|
| Ciudad Victoria | 5.46 | **5.46** (sin cambio — ya era consistente) | Suma mensual ÷365 = 5.4623 ✓ |
| Tampico | ~~5.12~~ | **5.23** | Suma mensual ÷365 = 5.2273 ✓ |

Metodología confirmada: GHI (Irradiación Global Horizontal) en kWh/m²/día — NASA POWER (`ALLSKY_SFC_SW_DWN`, ene 2001–dic 2025) y PVGIS-NSRDB (`H(h)`, 2005–2015), ambas coordenadas documentadas en la entrega anterior. Con el valor corregido, Tampico queda a 6.9% de NASA POWER (4.89) — un poco más separado que Ciudad Victoria (1.5%), lo documento sin ocultarlo.

Esto confirma exactamente por qué pediste esta verificación — encontró un error real antes de tocar producción.

## 2. Catálogo solar — valores finales propuestos

| Ciudad | HSP anual | Fuente primaria | Periodo |
|---|---|---|---|
| Ciudad Victoria, Tamaulipas | **5.46** kWh/m²/día | PVGIS-NSRDB | 2005–2015 |
| Tampico, Tamaulipas | **5.23** kWh/m²/día | PVGIS-NSRDB | 2005–2015 |

(12 valores mensuales de cada una, sin cambios respecto a la entrega anterior — ya verificados consistentes con el anual corregido.)

## 3. Resolución de ubicaciones — implementado y probado

Nuevo bloque en `modules/cotizaciones.js::_normalizarUbicacion()` — `PATRONES_CON_CONTEXTO_OBLIGATORIO`: solo resuelve "Victoria" cuando el texto trae "Cd."/"Ciudad" ANTES o "Tamaulipas" DESPUÉS — nunca la palabra sola. Probado exactamente contra tus 4 variantes + 4 casos de "Victoria" sin contexto:

| Entrada | Resultado |
|---|---|
| "Ciudad Victoria" / "Cd. Victoria" / "Cd Victoria" / "Victoria, Tamaulipas" / "victoria tamaulipas" | ✅ Resuelven a "Ciudad Victoria, Tamaulipas" |
| "Tampico" | ✅ Resuelve a "Tampico, Tamaulipas" |
| "Victoria" / "vivo en Victoria" / "soy de victoria" / "Victoria es mi nombre" | ❌ **Nunca resuelven** (confirmado, incluso con el catálogo ya ampliado) |

Sin coincidencias parciales nuevas — el mecanismo exige el calificador geográfico completo en el mismo texto, nunca una palabra suelta.

## 4. Seguridad

**SQL actualizado — ahora con bloqueo explícito contra ejecuciones simultáneas** (como pediste verificar: `WHERE NOT EXISTS` por sí solo NO evita una condición de carrera si el script corriera 2 veces al mismo tiempo, porque la tabla no tiene restricción UNIQUE):

```sql
-- TARA Matrix™ — Prioridad 8: alta de Ciudad Victoria y Tampico
-- Valores corregidos tras verificación de consistencia (ver sección 1).
BEGIN;

-- Bloqueo explícito: serializa cualquier ejecución concurrente de este
-- mismo script contra sí misma — sin esto, 2 ejecuciones simultáneas
-- podrían ambas pasar el WHERE NOT EXISTS antes de que la otra confirme
-- (la tabla no tiene restricción UNIQUE en nombre_ubicacion, confirmado
-- en migración 088 — agregar una sería un cambio de esquema, fuera de
-- alcance de esta fase).
LOCK TABLE irradiacion_regional IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO irradiacion_regional (nombre_ubicacion, lat, lng, hsp_promedio_anual, hsp_mensual, fuente, fecha_fuente)
SELECT 'Ciudad Victoria, Tamaulipas', 23.7369, -99.1411, 5.46,
  '{"enero":3.81,"febrero":4.55,"marzo":5.56,"abril":6.18,"mayo":6.50,"junio":6.98,"julio":6.90,"agosto":6.75,"septiembre":5.41,"octubre":5.09,"noviembre":4.24,"diciembre":3.52}'::jsonb,
  'PVGIS-NSRDB (JRC Comisión Europea), periodo 2005-2015, GHI kWh/m²/día — validado cruzado contra NASA POWER (ALLSKY_SFC_SW_DWN, 2001-2025): 5.38 kWh/m²/día, diferencia 1.5%',
  '2015-12-31'
WHERE NOT EXISTS (SELECT 1 FROM irradiacion_regional WHERE nombre_ubicacion = 'Ciudad Victoria, Tamaulipas')
  AND 5.46 BETWEEN 3 AND 8;

INSERT INTO irradiacion_regional (nombre_ubicacion, lat, lng, hsp_promedio_anual, hsp_mensual, fuente, fecha_fuente)
SELECT 'Tampico, Tamaulipas', 22.2553, -97.8686, 5.23,
  '{"enero":3.46,"febrero":4.30,"marzo":5.35,"abril":6.18,"mayo":6.65,"junio":6.71,"julio":6.40,"agosto":6.35,"septiembre":5.12,"octubre":4.95,"noviembre":3.84,"diciembre":3.36}'::jsonb,
  'PVGIS-NSRDB (JRC Comisión Europea), periodo 2005-2015, GHI kWh/m²/día — recalculado por suma mensual÷365 (corrige un error de extracción previo); validado cruzado contra NASA POWER (ALLSKY_SFC_SW_DWN, 2001-2025): 4.89 kWh/m²/día, diferencia 6.9%',
  '2015-12-31'
WHERE NOT EXISTS (SELECT 1 FROM irradiacion_regional WHERE nombre_ubicacion = 'Tampico, Tamaulipas')
  AND 5.23 BETWEEN 3 AND 8;

-- Verificación post-inserción — revisar ANTES de confirmar:
-- 1) Las 2 filas nuevas existen con los valores esperados:
SELECT nombre_ubicacion, hsp_promedio_anual, fuente, fecha_fuente FROM irradiacion_regional ORDER BY nombre_ubicacion;

-- 2) Monterrey/Hermosillo NO se modificaron (el script nunca los toca —
--    cero UPDATE/DELETE en todo el script — esta consulta es solo para
--    confirmar visualmente que sus valores siguen siendo los originales):
SELECT nombre_ubicacion, hsp_promedio_anual, fuente, created_at
FROM irradiacion_regional WHERE nombre_ubicacion IN ('Monterrey, Nuevo León', 'Hermosillo, Sonora');

COMMIT; -- cambiar a ROLLBACK si alguna verificación no se ve correcta
```

**Por qué Monterrey/Hermosillo quedan garantizados intactos:** el script completo no contiene ningún `UPDATE` ni `DELETE` — solo 2 `INSERT...WHERE NOT EXISTS` filtrados por nombre exacto de las ciudades NUEVAS. Es estructuralmente imposible que toque las filas existentes.

### Procedimiento de reversión (elimina EXCLUSIVAMENTE lo agregado por P8)
```sql
DELETE FROM irradiacion_regional
WHERE nombre_ubicacion IN ('Ciudad Victoria, Tamaulipas', 'Tampico, Tamaulipas');
```
Filtro exacto por nombre — no puede alcanzar ninguna otra fila.

## 5. Pruebas

28 pruebas en `__tests__/validar-requisitos-tecnicos.test.js` (nuevo bloque "Prioridad 8"):
- Las 4 variantes de Victoria/Tampico resuelven correctamente (simulando el catálogo ya ampliado).
- 4 variantes de "Victoria" sin contexto — **nunca** resuelven, ni siquiera con el catálogo ampliado.
- **Regresión explícita:** Monterrey y Hermosillo siguen resolviendo exactamente igual con el catálogo ampliado.
- Dimensionamiento: ubicación de Ciudad Victoria resuelta + consumo + cobertura → `suficientePreliminar: true`.
- Con el catálogo de PRODUCCIÓN real de HOY (solo Monterrey/Hermosillo, sin las 2 nuevas todavía) — "Ciudad Victoria"/"Tampico" correctamente NO resuelven, confirmando que el código ya está listo pero el catálogo real sigue sin tocar.

**Resultado global: 2620/2620, 130 suites, 0 regresiones.**

## 6. Diff
`modules/cotizaciones.js` (+24): nuevo `PATRONES_CON_CONTEXTO_OBLIGATORIO` + su uso en `_normalizarUbicacion()`. `__tests__/validar-requisitos-tecnicos.test.js` (+61): 10 pruebas nuevas. Ningún otro archivo tocado — WorkflowEngine, Orchestrator y fórmulas solares sin cambios.

## 7. Riesgos pendientes

- El SQL sigue sin ejecutarse — hasta que corra, Ciudad Victoria/Tampico no resuelven en producción (confirmado por la última prueba de la sección 5).
- Los valores de PVGIS/NASA POWER los obtuve vía una herramienta de resumen con IA — ya encontré y corregí un error real de extracción (sección 1); recomiendo que alguien verifique al menos un total anual directamente contra las URLs ya documentadas antes de ejecutar el INSERT.
- Diferencia entre fuentes para Tampico (6.9%) es mayor que para Ciudad Victoria (1.5%) — ambas razonables, pero lo marco para que decidas si quieres una tercera fuente de confirmación antes de insertar.

---

**No ejecuté el SQL, no hice push, no hice despliegue.** El código de resolución de ubicaciones SÍ está implementado y probado localmente, listo para cuando autorices el push — pero sin la fila en el catálogo, no tiene ningún efecto observable todavía (confirmado por la prueba de la sección 5).
