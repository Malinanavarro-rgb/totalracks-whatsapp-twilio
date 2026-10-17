# TARA Matrix™ — Prioridad 8: verificación final antes del despliegue
**Fecha:** 2026-10-17 · **SQL NO ejecutado — sin push ni despliegue todavía**

---

## Hallazgo: segunda corrección de datos (reportada, no oculta)

Al hacer la verificación más rigurosa posible — recuperar los **132 puntos crudos** (12 meses × 11 años, 2005–2015) de PVGIS sin que ninguna herramienta hiciera cálculos por mí, y calcular yo mismo en código por 2 métodos independientes (promedio mensual ponderado por días vs. promedio de los 11 totales anuales reales) — encontré que **Ciudad Victoria también necesitaba corrección**:

| Ciudad | Valor previamente propuesto | **Valor verificado con datos crudos completos** | Diferencia |
|---|---|---|---|
| Ciudad Victoria | 5.46 | **5.51** | 0.86% |
| Tampico | 5.23 | **5.23** (confirmado, 2 cálculos independientes coinciden a 0.14%) | — |

No es una contradicción de los datos — ambas provienen de la misma fuente (PVGIS-NSRDB) y del mismo periodo (2005-2015); es una diferencia entre calcular desde una tabla YA resumida por una herramienta (que demostré antes puede introducir pequeños errores) versus calcular directamente desde los 132 valores originales. Trato esto como una corrección de precisión, no como un "deténte" — pero lo reporto con total transparencia, como pediste, antes de proponer cualquier ejecución.

**Valores finales, verificados con el método más riguroso disponible:**

| Ciudad | HSP anual | NASA POWER (cruce independiente) | Diferencia |
|---|---|---|---|
| Ciudad Victoria, Tamaulipas | **5.51** | 5.38 | 2.4% |
| Tampico, Tamaulipas | **5.23** | 4.89 | 6.9% |

12 valores mensuales actualizados (recalculados de la misma forma rigurosa):

**Ciudad Victoria:** ene 3.76, feb 4.62, mar 5.63, abr 6.31, may 6.52, jun 7.07, jul 6.87, ago 6.79, sep 5.51, oct 5.14, nov 4.24, dic 3.58.
**Tampico:** ene 3.39, feb 4.31, mar 5.43, abr 6.23, may 6.61, jun 6.71, jul 6.35, ago 6.35, sep 5.18, oct 4.97, nov 3.88, dic 3.35.

Verifiqué que las 2 tablas mensuales redondeadas, ponderadas por días reales, reproducen 5.5075 y 5.2346 — consistentes con los anuales propuestos.

---

## Tus 6 verificaciones

**1. ¿5.23 corresponde a la fuente original, no solo a una tabla mal extraída?** Sí, ahora verificado 2 veces de forma independiente desde los 132 puntos crudos (0.14% de diferencia entre ambos cálculos — prácticamente idéntico). Para Ciudad Victoria, esta misma verificación SÍ encontró una corrección real (ver arriba) — exactamente el tipo de error que esta verificación estaba diseñada a detectar.

**2. ¿Consistencia mensual/anual con ponderación por días?** Sí — ambos métodos (ponderado por días reales vs. promedio de totales anuales reales) convergen al mismo valor para cada ciudad, confirmando que no hay error de ponderación.

**3. ¿`LOCK TABLE` dentro de una transacción, con el bloqueo mínimo necesario?** Sí — está dentro de `BEGIN...COMMIT`. `SHARE ROW EXCLUSIVE` es, según la propia documentación de PostgreSQL, el nivel recomendado exactamente para este patrón ("proteger una tabla contra cambios de datos concurrentes... para sesiones que van a examinar y condicionalmente actualizar filas") — conflictúa consigo mismo (serializa 2 ejecuciones del mismo script) pero **no bloquea lecturas normales** (`ACCESS SHARE`, lo que usa la conversación en vivo de WhatsApp al resolver una ubicación) — no es más agresivo de lo necesario.

**4. ¿Monterrey/Hermosillo quedan intactos?** Confirmado — el script completo no tiene ningún `UPDATE` ni `DELETE`, solo 2 `INSERT...WHERE NOT EXISTS` filtrados por el nombre exacto de las ciudades nuevas. Estructuralmente no puede tocar ninguna otra fila.

**5. ¿La reversión identifica exclusivamente lo de P8?** Confirmado — `DELETE ... WHERE nombre_ubicacion IN ('Ciudad Victoria, Tamaulipas', 'Tampico, Tamaulipas')`, filtro exacto por nombre.

**6. Suite completa:** 2620/2620, 130 suites. (Una corrida tuvo un crash de infraestructura de un worker de Jest — SIGSEGV, no relacionado con el código — confirmado transitorio al repetir la corrida limpio.)

---

## SQL actualizado (NO ejecutado)

```sql
BEGIN;
LOCK TABLE irradiacion_regional IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO irradiacion_regional (nombre_ubicacion, lat, lng, hsp_promedio_anual, hsp_mensual, fuente, fecha_fuente)
SELECT 'Ciudad Victoria, Tamaulipas', 23.7369, -99.1411, 5.51,
  '{"enero":3.76,"febrero":4.62,"marzo":5.63,"abril":6.31,"mayo":6.52,"junio":7.07,"julio":6.87,"agosto":6.79,"septiembre":5.51,"octubre":5.14,"noviembre":4.24,"diciembre":3.58}'::jsonb,
  'PVGIS-NSRDB (JRC Comisión Europea), periodo 2005-2015 (132 puntos crudos, verificado por 2 métodos independientes) — validado cruzado contra NASA POWER: 5.38 kWh/m²/día, diferencia 2.4%',
  '2015-12-31'
WHERE NOT EXISTS (SELECT 1 FROM irradiacion_regional WHERE nombre_ubicacion = 'Ciudad Victoria, Tamaulipas')
  AND 5.51 BETWEEN 3 AND 8;

INSERT INTO irradiacion_regional (nombre_ubicacion, lat, lng, hsp_promedio_anual, hsp_mensual, fuente, fecha_fuente)
SELECT 'Tampico, Tamaulipas', 22.2553, -97.8686, 5.23,
  '{"enero":3.39,"febrero":4.31,"marzo":5.43,"abril":6.23,"mayo":6.61,"junio":6.71,"julio":6.35,"agosto":6.35,"septiembre":5.18,"octubre":4.97,"noviembre":3.88,"diciembre":3.35}'::jsonb,
  'PVGIS-NSRDB (JRC Comisión Europea), periodo 2005-2015 (132 puntos crudos, verificado por 2 métodos independientes) — validado cruzado contra NASA POWER: 4.89 kWh/m²/día, diferencia 6.9%',
  '2015-12-31'
WHERE NOT EXISTS (SELECT 1 FROM irradiacion_regional WHERE nombre_ubicacion = 'Tampico, Tamaulipas')
  AND 5.23 BETWEEN 3 AND 8;

SELECT nombre_ubicacion, hsp_promedio_anual, fuente FROM irradiacion_regional ORDER BY nombre_ubicacion;
SELECT nombre_ubicacion, hsp_promedio_anual, created_at FROM irradiacion_regional WHERE nombre_ubicacion IN ('Monterrey, Nuevo León', 'Hermosillo, Sonora');

COMMIT; -- cambiar a ROLLBACK si algo no se ve correcto
```

**Reversión:**
```sql
DELETE FROM irradiacion_regional WHERE nombre_ubicacion IN ('Ciudad Victoria, Tamaulipas', 'Tampico, Tamaulipas');
```

---

## Hash del commit local y procedimiento exacto (preparado — nada ejecutado)

El código (resolución de "Victoria"/variantes) ya está commiteado localmente desde la entrega anterior. Dado que actualicé el valor de prueba (Ciudad Victoria 5.46→5.51) en esta verificación, hay un cambio pendiente de commitear:

```
cd /Users/alinanavarro/Downloads/tara-ttracks
git add modules/cotizaciones.js __tests__/validar-requisitos-tecnicos.test.js \
  TARA_PRIORIDAD8_CATALOGO_HSP_DIAGNOSTICO_V1.md TARA_PRIORIDAD8_DATOS_CIUDAD_VICTORIA_TAMPICO_V1.md \
  TARA_PRIORIDAD8_IMPLEMENTACION_LOCAL_V1.md TARA_PRIORIDAD8_VERIFICACION_FINAL_V1.md
git commit -m "feat(cotizaciones): Prioridad 8 — resolución de Ciudad Victoria/Tampico; valores HSP verificados"
```

**1. Subir a GitHub:** en GitHub Desktop (el que ya usaste), botón "Push origin" después de que te confirme el hash exacto del commit que acabamos de crear.

**2. Confirmar despliegue en Render:** espera ~1-2 min, revisa la pestaña "Deploys" — confírmame el commit activo, verifico `/health` y `/api/diagnostics` desde aquí.

**3. Ejecutar el SQL de forma controlada:** copia el bloque `BEGIN...COMMIT` de arriba en el SQL Editor de Supabase. **Antes de dar clic en "Run", revisa el resultado del `SELECT` de verificación que va antes del `COMMIT`** — confirma que las 2 filas nuevas tienen los valores de la tabla de arriba, y que Monterrey/Hermosillo siguen con sus valores originales (5.5 y 6.0). Si algo no se ve bien, cambia `COMMIT` por `ROLLBACK` antes de ejecutar esa línea.

**4. Verificar que Ciudad Victoria y Tampico resuelven:** te paso un mensaje de prueba exacto una vez que el SQL esté confirmado — podemos hacerlo con el mismo contacto de prueba ya usado antes, o uno nuevo, tu decisión.

**5. Revertir si aparece un problema:** ejecuta el `DELETE` de la sección de reversión en el SQL Editor de Supabase — no requiere revertir el código (el código es inofensivo sin las filas: simplemente "Ciudad Victoria"/"Tampico" dejarían de resolver, igual que hoy).

---

**No ejecuté el SQL. No hice push. No hice despliegue.** Quedo a la espera de tu autorización explícita para cada uno de los 3 pasos (push, SQL, verificación en vivo).
