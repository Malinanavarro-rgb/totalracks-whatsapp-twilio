# ADR-011 — Ritmo de conversación casual dentro de "contexto insuficiente"

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Julio 2026 |
| Autora | Alina Navarro |
| Archivos | `modules/prompt-builder.js` |

---

## Contexto

ADR-010 resolvió que TARA no venda a mensajes que no son prospectos. Al validar en producción (22–27 julio), quedó una "zona gris" sin resolver: conversaciones casuales sin intención clara (saludos, "ey", "qué pedo") donde TARA correctamente no vendía, pero tampoco hacía nada útil — se quedaba charlando indefinidamente sin rumbo (ver caso real +52 181 1765691 9, 8 turnos de charla casual sin avanzar a nada).

## Decisión

Dentro de la categoría `contexto_insuficiente` ya existente (sin agregar categorías nuevas al catálogo de ADR-010), se agrega un ritmo de 3 etapas:

1. **Turnos 1–2 sin intención clara**: TARA responde de forma natural y breve, como cualquier persona ante un saludo. Nunca hace preguntas comerciales por un simple "hola".
2. **Turno 3 sin intención clara**: TARA intenta reencauzar UNA sola vez con una pregunta breve, natural y no comercial (ejemplos calibrados por la dueña del producto: "Jajaja, entiendo 😄 ¿Buscabas ayuda con algo en particular?", "Va, te sigo. ¿En qué te puedo ayudar?", "¿Este mensaje era para alguien en específico o necesitas información de la empresa?").
3. **Turno 4+ si sigue sin intención**: TARA cierra de forma breve y amable, sin ser cortante ("Cuando necesites ayuda con algo específico, aquí estoy."), y no repite la pregunta de reencauce.

Si en cualquier momento aparece una intención comercial real, TARA abandona este ritmo y responde como "prospecto" de inmediato — el ritmo nunca bloquea ni retrasa una venta real.

Para `conversacion_personal`/`numero_equivocado` (buscan a una persona específica, mensajes románticos, número equivocado confirmado): se aclara y cierra en el **mismo turno**, sin esperar ningún conteo — es contenido, no ritmo, lo que decide el cierre inmediato.

### Por qué sigue sin requerir excepción a ADR-005

Mismo módulo que ADR-010 (`modules/prompt-builder.js::bloque_clasificacion_contexto()`), no listado en la tabla congelada de ADR-005. Cero cambios a `orchestrator.js`. El conteo de turnos lo hace el modelo directamente sobre el historial de conversación que ya recibe (`memoria_corta`) — no se agregó ningún estado nuevo al Core ni a la base de datos.

### El número exacto vive en código, no solo en prosa

`TURNOS_CASUALES_ANTES_DE_REENCAUZAR = 2` (exportado, testeable) — el prompt interpola este valor (`primeros 2 turnos`, `turno 3`) en vez de tener el número escrito dos veces por separado, para que ajustar el ritmo en el futuro sea cambiar una sola constante.

---

## Hallazgo de calibración (validación en vivo, no bloqueante)

Al validar con conversaciones reales de varios turnos, el modelo reencauzó y cerró **un turno antes** de lo especificado (reencauzó en el turno 2 en vez del 3, cerró en el turno 3 en vez del 4) en 2 de 3 escenarios de conversación casual prolongada. El orden cualitativo (casual → reencauce → cierre → nunca bloquea intención real) fue correcto en el 100% de los escenarios probados; el conteo exacto de turnos no fue perfectamente literal — comportamiento esperable de una instrucción en prompt (probabilística), no de una máquina de estados determinística. Documentado aquí para que quede explícito, no oculto — no se ajustó la redacción del prompt para forzar mayor precisión porque no se pidió explícitamente y el comportamiento observable ya cumple el objetivo real (no vender, no cerrar de golpe, no sostener charla indefinida).

---

## Pruebas

- `__tests__/prompt-builder.test.js` — `TURNOS_CASUALES_ANTES_DE_REENCAUZAR === 2`; el bloque instruye tolerancia en "primeros 2 turnos" y reencauce "a partir del turno 3"; incluye los 3 ejemplos exactos de pregunta de reencauce; incluye el ejemplo de cierre; incluye el ejemplo de aclaración cuando buscan a una persona específica; prohíbe explícitamente inventar intención comercial, preguntas comerciales ante un saludo simple, repetir la pregunta de reencauce, y fingir ser la persona buscada; instruye cierre inmediato (mismo turno) para personal/número equivocado; instruye volver a "prospecto" sin importar el turno si aparece intención real.
- Regresión completa: 1269/1269 tests, cero cambios en `orchestrator.js` ni en el catálogo de categorías de ADR-010.
- Validación en vivo: 7 escenarios pedidos explícitamente (saludo→comercial, casual prolongada, pregunta por Alina, número equivocado, comentarios románticos, intención tardía válida, no-cierre-prematuro-tras-un-saludo) — los 7 muestran el comportamiento correcto (ver hallazgo de calibración arriba para el matiz de conteo de turnos). Datos de prueba eliminados de Supabase al terminar.

---

## Regla permanente

> Dentro de "contexto_insuficiente", TARA tolera conversación casual sin intención por un número limitado de turnos (constante en código, no mágico en prosa), intenta reencauzar como máximo una vez, y cierra con amabilidad si no hay avance — pero una intención comercial real, en cualquier turno, siempre tiene prioridad sobre este ritmo.
