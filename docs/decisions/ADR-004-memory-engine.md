# ADR-004 — Memory Engine (M9): decisión diferida

| Campo | Valor |
|-------|-------|
| Estado | Diferida — pendiente de decisión |
| Fecha | Junio 2026 |
| Autora | Alina Navarro |
| Revisión recomendada | Al inicio de FASE 5 |

---

## Contexto

TARA actualmente gestiona el historial de conversación de dos formas:

1. **Historia reciente:** Los últimos N turnos de la tabla `conversaciones` se pasan directamente al prompt de OpenAI como contexto.
2. **Resumen comprimido:** El `ContextBuilder` tiene capacidad de comprimir historia cuando supera un umbral de tokens.

Este sistema funciona para conversaciones dentro de una sesión, pero no resuelve el problema de memoria a largo plazo:

- Un cliente que habló con TARA hace 3 meses y vuelve hoy — TARA no "recuerda" nada relevante de esa interacción pasada.
- Datos capturados en el pasado (presupuesto, tipo de rack preferido, nombre del comprador) no se recuperan automáticamente en conversaciones futuras.
- No existe un perfil persistente del cliente que TARA pueda consultar.

---

## Problema a resolver

¿Cómo debe TARA recordar a un cliente entre conversaciones separadas en el tiempo?

Esto implica tres sub-problemas:

1. **¿Qué recordar?** — No todo el historial es útil. ¿Preferencias? ¿Presupuesto? ¿Nombre? ¿Decisiones tomadas?
2. **¿Cómo indexarlo?** — Búsqueda semántica (embeddings) vs. campos estructurados en DB.
3. **¿Cuándo recuperarlo?** — En cada conversación, solo cuando sea relevante, o cuando el cliente lo referencia explícitamente.

---

## Opciones bajo evaluación

### Opción A — Campos estructurados en `clientes`
Agregar columnas a la tabla `clientes`: `presupuesto_estimado`, `tipo_rack_preferido`, `nombre_contacto`, etc. TARA los actualiza cuando los captura y los lee al inicio de cada conversación.

- Ventaja: simple, sin dependencias externas, queryable por SQL
- Desventaja: schema rígido — cada tipo de dato nuevo requiere una migración

### Opción B — JSONB de perfil en `clientes`
Una columna `perfil jsonb` en `clientes` donde TARA escribe lo que considera relevante en formato libre.

- Ventaja: flexible, sin migraciones por cada dato nuevo
- Desventaja: no queryable fácilmente, difícil de auditar

### Opción C — Embeddings + búsqueda semántica
Guardar fragmentos de conversación como embeddings en pgvector. Al inicio de cada conversación, recuperar los N fragmentos más similares al mensaje actual.

- Ventaja: recuperación semántica — "ya me dijiste que tienes 500m²" se recupera aunque no sea una búsqueda exacta
- Desventaja: requiere pgvector en Supabase, costos adicionales de OpenAI Embeddings, latencia

### Opción D — Resumen periódico por LLM
Al final de cada conversación, un proceso asíncrono pide a OpenAI que genere un resumen de lo aprendido sobre el cliente y lo guarda en `clientes.resumen`.

- Ventaja: legible por humanos, flexible
- Desventaja: costo de API por cada conversación cerrada, calidad depende del modelo

---

## Decisión actual

**Diferida.** No se implementa en FASE 3 ni está en alcance de FASE 4.

Razones:
- El problema de memoria a largo plazo no es bloqueante para las empresas actuales en producción
- Las opciones B y D son las más probables, posiblemente combinadas
- La decisión debe tomarse con datos reales de uso — saber qué tipo de información es más útil recordar requiere observar conversaciones reales durante semanas

---

## Condición para reactivar

Este ADR debe revisarse cuando se cumpla alguna de estas condiciones:
- Un cliente de Total Racks reporta que TARA "no lo recuerda" y eso afecta la conversión
- El volumen de conversaciones por empresa supera los 500 turnos mensuales
- Se inicia FASE 5 o una fase explícitamente dedicada a personalización

---

## Restricción de diseño confirmada

Independientemente de la opción elegida, el Memory Engine deberá:
- Filtrar por `company_id` — los recuerdos de un cliente de Total Racks no son accesibles desde SPAZIO
- Ser asíncrono — no puede bloquear la respuesta al usuario
- Tener una interfaz limpia hacia el Orchestrator: `memoryManager.recuperar(clienteId, companyId, mensajeActual)`
