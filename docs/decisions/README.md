# Architecture Decision Records — TARA Matrix™

Un ADR documenta una decisión de arquitectura: qué se decidió, por qué, qué alternativas se descartaron y cuáles son las reglas que derivan de esa decisión.

Los ADRs no se borran. Si una decisión cambia, se crea un nuevo ADR que supersede al anterior.

---

## Índice

| ID | Título | Estado | Fase |
|----|--------|--------|------|
| [ADR-001](ADR-001-arquitectura-hexagonal.md) | Arquitectura Hexagonal (Ports and Adapters) | Aceptada | FASE 2 |
| [ADR-002](ADR-002-arquitectura-multiempresa.md) | Arquitectura Multi-empresa (Multi-tenant) | Aceptada | FASE 3 |
| [ADR-003](ADR-003-channel-router.md) | Channel Router: resolución de empresa por número receptor | Aceptada | FASE 3 |
| [ADR-004](ADR-004-memory-engine.md) | Memory Engine (M9): decisión diferida | Diferida | FASE 5+ |

---

## Estados posibles

- **Propuesta** — en discusión, no implementada
- **Aceptada** — implementada y en producción
- **Diferida** — reconocida pero pospuesta deliberadamente
- **Supersedida** — reemplazada por un ADR posterior (ver cuál)
- **Rechazada** — evaluada y descartada con justificación

---

## Cómo agregar un ADR

1. Copiar la plantilla más parecida al caso
2. Nombrar el archivo: `ADR-NNN-titulo-en-kebab-case.md`
3. Agregar la fila a este índice
4. Commitear junto al código que implementa la decisión
