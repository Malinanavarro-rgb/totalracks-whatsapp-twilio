# TARA Matrix™ — Prioridad 2: validación técnica integral de ingeniería solar
**Fecha:** 2026-10-17 · **Implementado y probado localmente — NO desplegado** (sin push, per instrucción explícita)

---

## 1. Qué se implementó

Nueva función `validarRequisitosTecnicos(supabase, capturedFields)` en `modules/cotizaciones.js`, async, que distingue **presente / válido / resoluble** reutilizando 100% los normalizadores y catálogos reales del motor — ninguna fórmula ni regla se duplica:

| Verificación | Reutiliza (ya existente) |
|---|---|
| ¿Está presente? | lectura directa de `capturedFields` |
| ¿Es válido sintácticamente? | `mapearCapturedFieldsAInfoTecnica()` (mismos normalizadores que usa `correrCotizacionDesdeWorkflow`) |
| ¿La ubicación resuelve a un HSP real? | `_normalizarUbicacion()` + `resolverHSP()` — mismas funciones, mismo catálogo (`irradiacion_regional`) que usa el motor en producción |

### Los 3 requisitos indispensables (y por qué solo esos 3)
Son **exactamente** las 3 condiciones que `generarAlertas()` (`modules/motores-ingenieria/paneles-solares.js`) trata como bloqueo matemático — sin ellas el motor no puede producir ningún número: `ubicacion` (resoluble, no solo presente), `consumo_mensual_kwh` **o** `historial_consumo_kwh`, `pct_cobertura_deseado`.

### Lo que deliberadamente NO se volvió obligatorio
`tipo_alimentacion`/`voltaje_sitio` — el motor sí puede generar una alerta si faltan (`red_desconocida`), pero es una alerta que el propio diseño del workflow ya acepta como parte de un predimensionamiento **preliminar** (el nodo invita explícitamente a responder "no sé"). Exigirlos aquí habría sido, literalmente, "convertir una cotización sencilla en un interrogatorio técnico" — exactamente lo que pediste evitar.

### La distinción preliminar vs. definitiva que pediste
No hubo que inventar un mecanismo nuevo — **ya existía, separado**: `validarRequisitosTecnicos()` decide si vale la pena **intentar** un cálculo preliminar; `marcarIngenieriaValidada()`/`puedeEnviarCotizacion()` (sin tocar, ya existentes) deciden si ese cálculo puede convertirse en una **propuesta técnica definitiva** — rechazan CUALQUIER alerta de bloqueo, incluida `red_desconocida`. Las dos capas ya convivían en el código; solo faltaba que la primera fuera real.

### Tu ejemplo de Roberto Gzz, verificado campo por campo

| Campo | Valor | Evaluación de `validarRequisitosTecnicos()` |
|---|---|---|
| Nombre | Roberto Gzz | (fuera de esta función — ya gobernado por `puedeEjecutarseAccionComercial`, sin cambios) |
| Motivo | Cotizar paneles solares | (ídem) |
| Ubicación | "en mty" | **presente:true, resoluble:false** → bloquea, pide aclaración |
| Consumo | 3000 kWh | presente:true, válido:true |
| Cobertura | 90% | presente:true, válido:true |
| Tipo de alimentación | No proporcionado | **no evaluado como requisito** — preliminar no lo exige |
| Voltaje | No proporcionado | **no evaluado como requisito** — preliminar no lo exige |

Probado exactamente así — `suficientePreliminar: false`, único campo faltante: `ubicacion`.

### Gap documentado, no resuelto (unidades/periodos de consumo)
Auditando el código confirmé que **hoy no existe ningún campo ni normalizador determinista para el período de consumo** ("3000 kWh ¿mensuales o bimestrales?") — la conversión depende enteramente de que el modelo la haga bien al extraer el dato, sin ninguna verificación posterior (`frecuencia_recibo` se extrae pero nunca se usa en ningún lado del código). No inventé una validación nueva sin catálogo que la respalde — lo documento como vacío conocido.

---

## 2. Diff exacto

**`modules/cotizaciones.js`** (+80): nueva función `validarRequisitosTecnicos()`, exportada.

**`modules/orchestrator.js`** (+34/-19, dentro del registro de `ejecutar_motor_ingenieria` en `crearOrchestrator()`): reemplaza la llamada a `_camposTecnicosFaltantes()` (síncrona, solo presencia) por `await validarRequisitosTecnicos()` (async, presencia+validez+resolución). `_camposTecnicosFaltantes`/`CAMPOS_TECNICOS_REQUERIDOS_COTIZACION` **se dejaron intactos** (siguen exportados, sus pruebas existentes no se tocaron) — ya no gobiernan la decisión real, pero no se eliminaron para no romper nada que ya los usa.

**`server.js`** (+13/-12, dentro del bloque de disparo anticipado, **actualmente desactivado** por `DISPARO_ANTICIPADO_INGENIERIA_ACTIVO = false`): mismo reemplazo, dejando el camino C preparado con la validación correcta para cuando se reactive — pedido explícito tuyo.

## 3. Pruebas

Nuevo archivo `__tests__/validar-requisitos-tecnicos.test.js` — 8 pruebas, con un fake de Supabase que reproduce fielmente las 2 formas reales en que el código consulta `irradiacion_regional` (no un mock genérico que las confunda):

- **Reproducción exacta del caso real** ("en mty" presente pero irresoluble) → bloquea, pide ubicación.
- Ubicación que sí resuelve + consumo + cobertura → `suficientePreliminar: true` (**confirma que un cliente con datos suficientes sí obtiene su predimensionamiento**).
- Ubicación ausente por completo → bloquea (nunca se inventa ni se intenta resolver nada).
- Sin consumo ni historial → bloquea.
- `historial_consumo_kwh` (≥12 meses) como alternativa válida → pasa.
- Cobertura ausente → bloquea.
- Tipo de alimentación/voltaje ausentes → **no afectan el resultado** (confirma que no se volvieron obligatorios).
- `capturedFields` vacío → bloquea con los 3 motivos, nunca lanza.

**Resultado global: 2543/2543, 128 suites, 0 regresiones** (incluye las 8 nuevas).

## 4. Aislamiento multiempresa

`irradiacion_regional` es un catálogo **global**, no por empresa (confirmé que `resolverHSP()` nunca filtra por `company_id` — el HSP de una región es el mismo sin importar qué empresa pregunte). `validarRequisitosTecnicos()` no recibe ni necesita `companyId`. La identificación comercial (que SÍ es por empresa) sigue gobernada exclusivamente por `puedeEjecutarseAccionComercial()`, sin ningún cambio.

## 5. Riesgos pendientes

- **Cobertura de pruebas del wiring real**: el cambio en `crearOrchestrator()`/`server.js` no tiene una prueba de integración que ejecute la función REAL dentro del ActionRunner/disparo-anticipado completo (mismo límite ya documentado: ninguno de los 2 tiene arnés de pruebas propio) — las 8 pruebas nuevas verifican `validarRequisitosTecnicos()` directamente, no el camino completo end-to-end.
- **La pregunta de aclaración reutiliza el texto existente** ("¿en qué ciudad o municipio está la instalación?") — es la MISMA pregunta que ya se hizo, no un mensaje que explique que la ubicación anterior no se reconoció. Funciona (vuelve a pedir el dato, no crea nada), pero no es la aclaración más clara posible — mejora de texto pendiente, no implementada.
- **Gap de unidades/periodos de consumo** — documentado, no resuelto (ver sección 1).
- **WorkflowEngine y el sistema de mensajería compartido no se tocaron**, confirmado por el diff.

## 6. Propuesta de despliegue (para tu aprobación — no se hizo nada todavía)

1. Commit solo de los 4 archivos listados arriba.
2. Push + verificación de Render (commit exacto).
3. **Esto NO reactiva el disparo anticipado** — sigue desactivado (Prioridad 1). Esto solo mejora la validación que usan los caminos A/B (conversación libre y finalización normal del workflow), que siguen activos todo el tiempo.
4. Validación funcional sugerida (sin datos de clientes reales): un cliente de prueba que complete el workflow con una ubicación real (ej. "Monterrey") debe recibir su predimensionamiento normalmente; uno con una ubicación no reconocible debe recibir la pregunta de ubicación de nuevo, sin que se cree ninguna cotización.

**No hice push ni despliegue de esta fase, como pediste.** Quedo a la espera de tu revisión.
