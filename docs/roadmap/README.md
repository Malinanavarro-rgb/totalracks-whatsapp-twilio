# Roadmap — TARA Matrix™

---

## Estado actual

**v3.0 — FASE 3 COMPLETA** · 29 de junio de 2026

Multi-tenant activo. Un solo servidor sirve a N empresas con aislamiento completo.

---

## Fases

| Fase | Nombre | Estado | Fecha |
|------|--------|--------|-------|
| FASE 1 | Bot single-tenant básico | Completa | Ene 2026 |
| FASE 2 | Arquitectura hexagonal — Orchestrator, AIEngine, ContextBuilder | Completa | Mar 2026 |
| FASE 3 | Multi-tenant — routing dinámico, aislamiento validado | **Completa** | Jun 2026 |
| FASE 4 | WorkflowEngine (M5) + ActionRunner (M8) | Próxima | — |
| FASE 5 | Memory Engine (M9) + personalización a largo plazo | Futura | — |
| FASE 6 | UI de onboarding, dashboard por empresa, API pública | Futura | — |

---

## FASE 4 — WorkflowEngine + ActionRunner

**Objetivo:** TARA pasa de responder a actuar.

Hoy TARA recibe mensajes y genera respuestas de texto. En FASE 4, podrá:
- Seguir flujos estructurados definidos por la empresa (formularios, cotizaciones, agendas)
- Ejecutar acciones concretas al terminar un flujo: enviar email, disparar webhook, crear registro

**Módulos:** M5 WorkflowEngine, M8 ActionRunner
**Ver plan completo:** `docs/releases/v3.0-fase3.md` → sección "Plan Maestro FASE 4"

---

## FASE 5 — Memory Engine

**Objetivo:** TARA recuerda a sus clientes entre conversaciones.

Un cliente que habló hace 3 meses vuelve y TARA recupera contexto relevante: presupuesto, preferencias, decisiones tomadas.

**Módulos:** M9 MemoryManager
**Ver decisión:** `docs/decisions/ADR-004-memory-engine.md`

---

## FASE 6 — Plataforma

**Objetivo:** Empresas pueden onboardearse sin SQL.

UI web para que cada empresa configure su asistente, vea sus conversaciones y métricas, y gestione su knowledge base sin intervención técnica.

---

## Lo que no está en el roadmap (y por qué)

| Item | Razón |
|------|-------|
| Multi-idioma | No hay demanda actual; la arquitectura lo soporta cuando sea necesario |
| SMS como canal | `channel_endpoints.canal` ya tiene el campo; es un adapter nuevo cuando haya demanda |
| Integración con CRMs externos (HubSpot, Salesforce) | FASE 4+ — ActionRunner lo habilitará vía webhook |
| ML propio para predicción de cierre | Overhead innecesario; OpenAI cubre el caso de uso actual |
