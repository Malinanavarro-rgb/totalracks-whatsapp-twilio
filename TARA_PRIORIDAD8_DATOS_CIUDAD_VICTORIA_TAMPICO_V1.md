# TARA Matrix™ — Prioridad 8: datos preparados para Ciudad Victoria y Tampico
**Fecha:** 2026-10-17 · **Solo preparación — catálogo NO modificado, SQL NO ejecutado, sin push ni despliegue**

---

## 1. Evidencia de fuentes (2 fuentes independientes, con validación cruzada)

### Ciudad Victoria, Tamaulipas (23.7369° N, -99.1411° O)

| Fuente | Periodo | Anual (kWh/m²/día) |
|---|---|---|
| **NASA POWER** (`ALLSKY_SFC_SW_DWN`, API pública oficial de NASA) | ene 2001 – dic 2025 (25 años) | **5.38** |
| **PVGIS-NSRDB** (Comisión Europea, radiación de NSRDB — misma familia de datos que ya usan Monterrey/Hermosillo) | 2005–2015 (11 años) | **5.46** |

Diferencia entre fuentes: 1.5% — alta concordancia.

**Valores mensuales (PVGIS-NSRDB, propuestos como principales por ser la misma línea de datos NSRDB ya usada en el catálogo):**

| Mes | kWh/m²/día | Mes | kWh/m²/día |
|---|---|---|---|
| Enero | 3.81 | Julio | 6.90 |
| Febrero | 4.55 | Agosto | 6.75 |
| Marzo | 5.56 | Septiembre | 5.41 |
| Abril | 6.18 | Octubre | 5.09 |
| Mayo | 6.50 | Noviembre | 4.24 |
| Junio | 6.98 | Diciembre | 3.52 |

### Tampico, Tamaulipas (22.2553° N, -97.8686° O)

| Fuente | Periodo | Anual (kWh/m²/día) |
|---|---|---|
| **NASA POWER** | ene 2001 – dic 2025 (25 años) | **4.89** |
| **PVGIS-NSRDB** | 2005–2015 (11 años) | **5.12** |

Diferencia entre fuentes: 4.5% — concordancia razonable (ambas confirman el mismo orden de magnitud y el mismo patrón estacional).

**Valores mensuales (PVGIS-NSRDB):**

| Mes | kWh/m²/día | Mes | kWh/m²/día |
|---|---|---|---|
| Enero | 3.46 | Julio | 6.40 |
| Febrero | 4.30 | Agosto | 6.35 |
| Marzo | 5.35 | Septiembre | 5.12 |
| Abril | 6.18 | Octubre | 4.95 |
| Mayo | 6.65 | Noviembre | 3.84 |
| Junio | 6.71 | Diciembre | 3.36 |

**Parámetro, unidad y metodología (ambas ciudades):** Irradiación Global Horizontal (GHI — "All Sky Surface Shortwave Downward Irradiance" en NASA POWER; "H(h)" en PVGIS), en kWh/m²/día — la misma magnitud física que ya usan Monterrey/Hermosillo.

**Límite honesto:** estos valores los extraje vía mi herramienta de consulta web, que procesa el JSON de cada API con un modelo de resumen — no son una lectura byte-a-byte del JSON crudo por mi parte. Dada la concordancia entre 2 fuentes independientes, tengo confianza alta, pero recomiendo que antes de insertar definitivamente alguien verifique al menos uno de los 2 totales anuales directamente (las URLs exactas están en la sección 6).

## 2. Compatibilidad metodológica con el HSP del motor

Confirmado: el motor (`calcularPotenciaRequerida`, `modules/motores-ingenieria/paneles-solares.js`) usa HSP como Irradiación Global Horizontal en kWh/m²/día — **exactamente la misma magnitud** que NASA POWER y PVGIS reportan como GHI. No hace falta ninguna conversión de unidad ni de plano (no es irradiancia sobre panel inclinado — consistente con que Monterrey/Hermosillo tampoco lo son). Compatible sin cambios.

## 3. Comportamiento del PDF sin `hsp_mensual` — hallazgo importante

Auditando `modules/cotizacion-pdf.js`, encontré algo que cambia la pregunta que hiciste: **el PDF no tiene ningún gráfico de 12 meses.** Solo muestra un único número, "producción mensual promedio" — y ese número se calcula **igual, `anual ÷ 12`, exista o no `hsp_mensual`**. Revisé el código: cuando SÍ hay datos mensuales reales (como Monterrey), `calcularProduccion()` guarda el desglose en `resultados.produccion.mensual`, pero `cotizacion-pdf.js` **nunca lee esa clave** — solo lee `promedioMensual`, que únicamente existe cuando NO hay datos mensuales (`estimacionSimplificada: true`); cuando sí los hay, `promedioMensual` queda `undefined` y el PDF cae al mismo `anual ÷ 12` de todas formas.

**Conclusión:** hoy, con o sin `hsp_mensual`, el PDF muestra exactamente el mismo tipo de cifra para cualquier ubicación — no hay ningún gráfico que "aparente precisión" porque no hay gráfico mensual en absoluto. Agregar Ciudad Victoria/Tampico sin `hsp_mensual` no introduce ningún riesgo nuevo de este tipo — el desglose mensual que sí tengo (sección 1) queda disponible para cuando se decida usarlo, pero no es indispensable ni cambia el comportamiento actual del PDF.

## 4. Resolución de "Victoria", "Cd. Victoria", "Ciudad Victoria", "Tampico" — probado contra el código real

| Texto del cliente | ¿Resuelve hoy? |
|---|---|
| "Ciudad Victoria" | ✅ Sí |
| "ciudad victoria tamaulipas" | ✅ Sí |
| "Tampico" | ✅ Sí |
| **"Victoria"** | ❌ **No** |
| **"Cd. Victoria"** | ❌ **No** |
| **"soy de cd victoria"** | ❌ **No** |

**Hallazgo real:** "Victoria" sola y "Cd. Victoria" — ambas formas muy comunes en que un cliente real escribiría esto — **no resuelven** con la lógica actual (compara solo la primera palabra antes de la coma: "ciudad victoria"). Tampico no tiene este problema (nombre de una sola palabra).

**No implementé ningún cambio de código todavía** (pediste "sin autorización adicional" para tocar Orchestrator/el motor) — la corrección sería agregar "victoria" y "cd victoria"/"cd. victoria" a `ABREVIATURAS_CIUDAD_CONOCIDAS` (`modules/cotizaciones.js`, el mismo mecanismo de Prioridad 3), apuntando a "ciudad victoria". Dentro del catálogo propuesto (solo 4 ciudades) no hay ninguna otra "Victoria" con la que pueda confundirse — sin riesgo de ambigüedad en este caso específico. Lo dejo listo como una línea de código pendiente de tu autorización, no la agregué.

## 5. SQL de inserción — preparado, NO ejecutado

```sql
-- TARA Matrix™ — Prioridad 8: alta de Ciudad Victoria y Tampico
-- Idempotente: usa WHERE NOT EXISTS porque irradiacion_regional NO tiene
-- restricción UNIQUE en nombre_ubicacion (confirmado en migración 088) —
-- un INSERT directo repetido crearía filas duplicadas y ambigüedad en la
-- resolución de ubicación. Validación inline: rechaza si el HSP está
-- fuera de un rango físicamente razonable para México (3-8 kWh/m²/día).

BEGIN;

INSERT INTO irradiacion_regional (nombre_ubicacion, lat, lng, hsp_promedio_anual, hsp_mensual, fuente, fecha_fuente)
SELECT 'Ciudad Victoria, Tamaulipas', 23.7369, -99.1411, 5.46,
  '{"enero":3.81,"febrero":4.55,"marzo":5.56,"abril":6.18,"mayo":6.50,"junio":6.98,"julio":6.90,"agosto":6.75,"septiembre":5.41,"octubre":5.09,"noviembre":4.24,"diciembre":3.52}'::jsonb,
  'PVGIS-NSRDB (JRC Comisión Europea), periodo 2005-2015, GHI kWh/m²/día — validado cruzado contra NASA POWER (ALLSKY_SFC_SW_DWN, 2001-2025): 5.38 kWh/m²/día, diferencia 1.5%',
  '2015-12-31'
WHERE NOT EXISTS (SELECT 1 FROM irradiacion_regional WHERE nombre_ubicacion = 'Ciudad Victoria, Tamaulipas')
  AND 5.46 BETWEEN 3 AND 8;

INSERT INTO irradiacion_regional (nombre_ubicacion, lat, lng, hsp_promedio_anual, hsp_mensual, fuente, fecha_fuente)
SELECT 'Tampico, Tamaulipas', 22.2553, -97.8686, 5.12,
  '{"enero":3.46,"febrero":4.30,"marzo":5.35,"abril":6.18,"mayo":6.65,"junio":6.71,"julio":6.40,"agosto":6.35,"septiembre":5.12,"octubre":4.95,"noviembre":3.84,"diciembre":3.36}'::jsonb,
  'PVGIS-NSRDB (JRC Comisión Europea), periodo 2005-2015, GHI kWh/m²/día — validado cruzado contra NASA POWER (ALLSKY_SFC_SW_DWN, 2001-2025): 4.89 kWh/m²/día, diferencia 4.5%',
  '2015-12-31'
WHERE NOT EXISTS (SELECT 1 FROM irradiacion_regional WHERE nombre_ubicacion = 'Tampico, Tamaulipas')
  AND 5.12 BETWEEN 3 AND 8;

-- Verificación post-inserción (ejecutar y revisar antes de COMMIT):
SELECT nombre_ubicacion, hsp_promedio_anual, fuente, fecha_fuente FROM irradiacion_regional ORDER BY nombre_ubicacion;

COMMIT; -- cambiar a ROLLBACK si la verificación anterior no se ve correcta
```

### Procedimiento de reversión
```sql
DELETE FROM irradiacion_regional WHERE nombre_ubicacion IN ('Ciudad Victoria, Tamaulipas', 'Tampico, Tamaulipas');
```
Sin dependencias (ninguna cotización existente referencia estas filas todavía) — reversión limpia e inmediata.

## 6. URLs exactas consultadas (para tu propia verificación)

- Ciudad Victoria: `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=-99.1411&latitude=23.7369&format=JSON`
- Tampico: mismo endpoint con `longitude=-97.8686&latitude=22.2553`
- PVGIS: `https://re.jrc.ec.europa.eu/api/v5_2/MRcalc?lat=<lat>&lon=<lon>&horirrad=1&outputformat=json`

## 7. Pruebas necesarias (cuando se autorice implementar, no escritas todavía)

1. `_normalizarUbicacion`/`validarRequisitosTecnicos` resuelven "Ciudad Victoria, Tamaulipas" y "Tampico, Tamaulipas" contra el catálogo real tras el INSERT.
2. Una vez agregadas las abreviaturas "victoria"/"cd victoria": "Victoria", "Cd. Victoria", "cd victoria" resuelven correctamente; "gdl"/otras abreviaturas no agregadas siguen sin resolver (sin falsos positivos).
3. Cálculo real para cada ciudad nueva no produce `hsp_faltante` (confirma que el HSP se resuelve correctamente end-to-end).
4. El PDF sigue mostrando el mismo formato de "producción mensual promedio" para estas 2 ciudades — sin regresión.

---

**No se modificó el catálogo. El SQL de arriba no se ejecutó. No se tocó código de Orchestrator/motor. No hay push ni despliegue.** Quedo a la espera de tu autorización para ejecutar el INSERT (y, por separado, para agregar las abreviaturas de "Victoria").
