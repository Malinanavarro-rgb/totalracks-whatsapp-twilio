# TARA Matrix™ — Prioridad 5: impedir que Lucía comunique cifras técnicas no validadas
**Fecha:** 2026-10-17 · **Implementado y probado localmente — NO desplegado**

---

## 1. Diagnóstico

`_textoDesdeResultadoDeAgenda()` (`modules/orchestrator.js`) — la función que SIEMPRE decide qué responder cuando una acción real corrió este turno — ya protegía `agendar_cita`/`agendar_cita_con_horario_solicitado` (nunca deja pasar una confirmación del modelo sin respaldo real), pero **nunca reconocía el resultado de `ejecutar_motor_ingenieria`**. Cuando el motor corría, la función devolvía `null` (resultado no reconocido) y el código caía al texto libre del modelo — exactamente donde "~10 kWp" se filtró en el incidente real, sin ninguna relación con el cálculo real (que quedó `bloqueado`, sin ningún número).

## 2. Qué se implementó

`_textoDesdeResultadoDeAgenda()` ahora reconoce el resultado de `ejecutar_motor_ingenieria` — se distingue por tener `estado_calculo` + `motor` (una fila real de `calculos_ingenieria`; ninguna otra acción del sistema produce esa forma, lo confirmé con un grep del resto del código):

- **`estado_calculo: 'completo'`** → la respuesta usa las cifras REALES de `calculo.resultados` (`numero_paneles.valor`, `potencia_instalada_kwp`, `cobertura_pct`) — nunca el texto del modelo.
- **`'bloqueado'` o `'incompleto_faltan_datos'`** → reutiliza `textoSeguimientoIngenieria()` (antes `_textoSeguimientoIngenieria`, ahora exportada desde `modules/cotizaciones.js` para no duplicar el texto) — el mismo mensaje honesto que ya usa el seguimiento proactivo, explicando que falta información sin presentar nada como confirmado.

Cuando el motor corrió este turno, su resultado **siempre** gobierna la respuesta — el texto libre del modelo nunca se deja pasar, mismo criterio que ya existía para agenda.

## 3. Las 6 condiciones, una por una

| # | Condición | Cómo se cumple |
|---|---|---|
| 1 | Impedir que invente potencias/paneles/cobertura/ahorros | Cubierto — cualquier estado que no sea `'completo'` usa el texto honesto, sin cifras |
| 2 | Resultados técnicos solo si hay cálculo válido | Cubierto — las cifras reales solo se muestran con `estado_calculo==='completo'` |
| 3 | Si está bloqueado, explicar qué falta sin confirmar nada | Cubierto — reutiliza `textoSeguimientoIngenieria('bloqueado')`, ya escrito para esto |
| 4 | No confundir respuestas educativas con cotizaciones | Por construcción: esta lógica solo se activa cuando `ejecutar_motor_ingenieria` corrió de verdad este turno — una pregunta general ("¿cómo funcionan los paneles?") nunca produce ese resultado, así que nunca se toca (probado) |
| 5 | Proteger conversaciones libres Y workflows | `_textoDesdeResultadoDeAgenda()` es la MISMA función que ya llaman el paso 9 (camino A) y `_finalizarWorkflow` (camino B) — un solo cambio protege ambos caminos (probado en los 2) |
| 6 | No afectar a Gondor/Total Racks/otras empresas | El discriminador (`estado_calculo`+`motor`) solo lo produce `ejecutar_motor_ingenieria`, acción exclusiva de los 3 workflows solares ya auditados — confirmé que ningún otro módulo del sistema usa esos nombres de campo |

No se tocaron las fórmulas del motor, `WorkflowEngine` ni el sistema de mensajería — confirmado por el diff (solo 2 archivos de código).

## 4. Reproducción del incidente real

Prueba nueva que reproduce EXACTAMENTE el caso Roberto Gzz: cálculo real `bloqueado` (mismas alertas reales: `hsp_faltante`) + el modelo generando el mismo texto real que dijo en producción ("...estimamos que necesitarías un sistema de aproximadamente 10 kWp"). **La prueba confirma que "10 kWp" nunca llega al cliente** — la respuesta final es el mensaje honesto real.

## 5. Diff
- `modules/cotizaciones.js` (+10/-4): `_textoSeguimientoIngenieria` → `textoSeguimientoIngenieria`, exportada.
- `modules/orchestrator.js` (+31/-4): nuevo caso en `_textoDesdeResultadoDeAgenda()`.
- `__tests__/orchestrator.test.js` (+135): 5 pruebas nuevas.

## 6. Pruebas
1. **Reproducción exacta del incidente** (bloqueado) → nunca "10 kWp", sí el mensaje honesto.
2. Cálculo completo con resultado real → usa las cifras reales (18 paneles, 9.9 kWp), nunca el número que el modelo inventó (25).
3. Conversación educativa general (sin acción este turno) → sin cambios.
4. `estado_calculo: 'incompleto_faltan_datos'` → mismo texto honesto, nunca cifras parciales.
5. Camino A (conversación libre, sin workflow) → mismo comportamiento que camino B.

**Resultado global: 2555/2555, 128 suites, 0 regresiones.**

## 7. Riesgos pendientes
- El mensaje para `'completo'` es nuevo texto (antes nunca se usaba esta rama) — vale la pena que lo leas con calma antes de aprobar el despliegue, ya que es lo que el cliente verá literalmente.
- Sigue sin resolverse el gap de unidades/periodos de consumo (documentado desde P2).
- P6 (trazabilidad) sigue pendiente, como acordamos.

**No hice push ni despliegue.** Quedo a la espera de tu revisión.
