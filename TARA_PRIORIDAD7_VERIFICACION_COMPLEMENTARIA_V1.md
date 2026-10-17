# TARA Matrix™ — Prioridad 7: verificación complementaria (resultados concretos)
**Fecha:** 2026-10-17 · **NO desplegado**

---

## 1. ¿El autoavance puede introducir consumo no validado al motor?

**Antes de esta verificación: sí.** `_avanzarSaltandoRespondidos()` (`modules/orchestrator.js`) tomaba `datos_extraidos[campo]` directamente para CUALQUIER campo que se saltara, incluidos `consumo_mensual_kwh`/`importe_promedio_recibo` — la misma ruta sin validar que ya había cerrado en el turno normal.

**Corregido.** Ahora, dentro de ese mismo bucle, si el campo es uno de los 2 de consumo, se interpreta con `interpretarConsumoDeclarado()` (la misma función del turno normal) — si no resuelve de forma inequívoca para ESE campo específico, el auto-avance **se detiene ahí** (nunca avanza con un valor sin confirmar) y el nodo queda pendiente para el turno normal, que pedirá la aclaración correspondiente.

**Ruta exacta:** `modules/orchestrator.js::_avanzarSaltandoRespondidos()`, invocada desde `_manejarWorkflow()` en sus 2 puntos de uso (nodo intermedio y sesión nueva).

## 2. ¿Se distingue consumo mensual confirmado / estimado desde bimestral / calculado desde recibo CFE?

**Antes: no se persistía esa distinción** (se calculaba y se descartaba en el mismo turno). **Corregido ahora** — se agregó `<campo>_fuente` (jsonb existente, sin migración) con 3 valores posibles:
- `'directo_mensual'` — el cliente declaró un periodo mensual explícito.
- `'estimado_bimestral'` — se derivó con la regla ÷2 documentada (periodo bimestral explícito).
- `'recibo_cfe'` — vino de una foto de recibo (`modules/recibo-cfe.js`, factor de conversión real por fechas).

Verificable en campos reales: `clientes`/`workflow_sessions.captured_fields.consumo_mensual_kwh_fuente` e `importe_promedio_recibo_fuente`.

## 3. Archivos modificados en esta verificación complementaria (además de la entrega original)

- `modules/orchestrator.js` — `_avanzarSaltandoRespondidos()` ahora valida los 2 campos de consumo; se persiste `<campo>_fuente` en los 2 puntos donde se resuelve un valor.
- `modules/recibo-cfe.js` — agrega `consumo_mensual_kwh_fuente`/`importe_promedio_recibo_fuente: 'recibo_cfe'`.
- `__tests__/orchestrator.test.js` — 3 pruebas nuevas (autoavance ambiguo se detiene, autoavance inequívoco sí avanza, persistencia de `_fuente`).
- `__tests__/recibo-cfe.test.js` — 1 prueba nueva (`_fuente: 'recibo_cfe'`).

## 4. Pruebas nuevas y resultado de la suite completa

**4 pruebas nuevas** en esta verificación (sobre las 35 ya entregadas antes). **Resultado: 2607/2607, 130 suites, 0 regresiones.**

## 5. ¿Queda alguna ruta capaz de generar una cotización con consumo ambiguo?

Hice un grep exhaustivo de **todos** los lugares del código que escriben `consumo_mensual_kwh`/`importe_promedio_recibo`. Solo hay 3 orígenes reales:

| Origen | Estado |
|---|---|
| Turno normal de workflow (`_manejarWorkflow`) | ✅ Ya corregido (entrega original) |
| Auto-avance (`_avanzarSaltandoRespondidos`) | ✅ Corregido en esta verificación |
| Foto de recibo CFE (`recibo-cfe.js`) | ✅ Ya era correcto desde 2026-08-10 |

`modules/crm.js::_mapearCapturedFieldsAOportunidad()` copia estos valores a `oportunidades` para el CRM — es una lectura/copia downstream, no un origen independiente; hereda la garantía automáticamente.

Los únicos lugares restantes que construyen `capturedFields` con valores de consumo son `scripts/validar-*.js`/`scripts/generar-pdf-ejemplo.js` — herramientas manuales de un solo uso que un desarrollador invoca desde la terminal con datos hardcodeados, llamando a `correrCotizacionDesdeWorkflow` directamente. Mismo criterio ya aceptado para los 2 endpoints manuales del CRM (incidente cotización 83) — no son una ruta de producción.

**Respuesta: no, con un matiz honesto** — cualquier dato de consumo escrito a partir de HOY pasa por una de las 3 rutas validadas. Sesiones que ya tenían un `consumo_mensual_kwh` guardado ANTES de este fix (de la conversión silenciosa del modelo) siguen tal cual en la base de datos — eso es la compatibilidad histórica que pediste conservar, no una ruta abierta nueva.

---

**No hice push ni despliegue.** Esperando tu revisión.
