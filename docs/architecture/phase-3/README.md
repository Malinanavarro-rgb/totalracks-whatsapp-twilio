# TARA Matrix™ — FASE 3: Multiempresa Real

**Estado:** En implementación  
**Inicio:** 2026-06-29  
**Cierre:** Pendiente  
**Responsable:** Alina Navarro + Claude (Sonnet 4.6)

---

## Contexto

Hasta FASE 2, TARA operaba con una sola empresa fija definida por la variable de entorno `COMPANY_SLUG`. Eso funcionó para lanzar Total Racks, pero hace imposible servir a una segunda empresa en el mismo servidor sin duplicar toda la infraestructura.

FASE 3 resuelve eso. El objetivo es que un solo servidor en Render pueda atender cualquier número de empresas simultáneamente, enrutando cada mensaje entrante al asistente correcto basándose en el número de Twilio receptor, no en una variable de entorno.

---

## La decisión central

En lugar de saber qué empresa sirve por configuración (`COMPANY_SLUG=totalracks`), el servidor pregunta a la base de datos: "¿quién es el dueño del número que acaba de recibir este mensaje?"

Esto convierte agregar una nueva empresa en un `INSERT` en Supabase, sin tocar código y sin redeploy.

Este principio está documentado en la Constitución TARA Matrix v3 como **Principio P2 — Configuración sobre código**.

---

## Qué cambia en esta fase

| Capa | Antes | Después |
|---|---|---|
| Routing | Variable de entorno `COMPANY_SLUG` | Tabla `channel_endpoints` en Supabase |
| Config | Cache de un valor, clave implícita | `Map<companyId, config>`, clave explícita |
| CRM | Sin aislamiento por empresa | `company_id` en `clientes`, `conversaciones`, `oportunidades` |
| Adapter | Lee solo `From` (quién envía) | Lee `From` + `To` (quién envía + quién recibe) |
| Servidor | Carga config al inicio, estática | Carga config por mensaje, dinámica |

---

## Qué NO cambia

El Kernel completo (Orchestrator, ContextBuilder, PromptBuilder, AIEngine, AuditLogger) no se modifica estructuralmente. Este fue un criterio de diseño explícito: la arquitectura hexagonal garantiza que el Kernel sea agnóstico de routing y tenancy.

---

## Tareas

| # | Tarea | Tipo | Archivo |
|---|---|---|---|
| T3.0 | Preparación y baseline | Infraestructura | [T3.0-baseline.md](T3.0-baseline.md) |
| T3.1 | Tabla `channel_endpoints` | DB migration | [T3.1-channel-endpoints.md](T3.1-channel-endpoints.md) |
| T3.2 | Sembrar número de Total Racks | DB seed | [T3.2-seed-totalracks.md](T3.2-seed-totalracks.md) |
| T3.3 | `company_id` en tablas CRM | DB migration | [T3.3-company-id-crm.md](T3.3-company-id-crm.md) |
| T3.4 | Exponer `incoming_endpoint` en adapter | Código | [T3.4-adapter-endpoint.md](T3.4-adapter-endpoint.md) |
| T3.5 | Nuevo módulo `channel-router.js` | Código | [T3.5-channel-router.md](T3.5-channel-router.md) |
| T3.6 | Refactor `config.js` dinámico | Código | [T3.6-config-dynamic.md](T3.6-config-dynamic.md) |
| T3.7 | Refactor `crm.js` con aislamiento | Código | [T3.7-crm-isolation.md](T3.7-crm-isolation.md) |
| T3.8 | Refactor mínimo `orchestrator.js` | Código | [T3.8-orchestrator.md](T3.8-orchestrator.md) |
| T3.9 | Refactor `server.js` con routing | Código | [T3.9-server-routing.md](T3.9-server-routing.md) |
| T3.10 | Cleanup `render.yaml` + `.env.example` | Configuración | [T3.10-cleanup.md](T3.10-cleanup.md) |
| T3.11 | Prueba con segunda empresa | Validación | [T3.11-second-company.md](T3.11-second-company.md) |
| T3.12 | Validación completa 3 empresas | Validación | [T3.12-validation.md](T3.12-validation.md) |

---

## Criterios de éxito de la fase

FASE 3 cierra cuando todos estos criterios se cumplen sin excepción:

1. **Routing funcional:** dos números distintos → dos personalidades distintas, sin cambio de código
2. **Datos aislados:** `company_id` presente y correcto en toda fila de `clientes`, `conversaciones`, `oportunidades`
3. **Número desconocido manejado:** TwiML vacío + log, sin crash
4. **Total Racks sin regresión:** comportamiento idéntico al de FASE 2
5. **Diagnósticos 7/7 OK:** con el nuevo routing activo
6. **`COMPANY_SLUG` irrelevante:** servidor funciona sin esa variable de entorno
7. **Tres empresas simultáneas:** SPAZIO, OLY NAILS, GREEN LUX operando en paralelo
8. **Ocho vectores de contaminación:** todos pasan, resultado documentado en T3.12

---

## Decisiones que no se tomaron (y por qué)

**¿Por qué no un Orchestrator por empresa?**  
Crear y cachear una instancia de Orchestrator por empresa requeriría gestionar el ciclo de vida de instancias (cuándo crearlas, cuándo destruirlas, cómo manejar empresas que se activan/desactivan). En cambio, el Orchestrator recibe `company_id` como dato del mensaje, delega a funciones que ya saben usarlo, y él mismo no cambia. Un proceso, N empresas.

**¿Por qué no mantener `COMPANY_SLUG` como fallback permanente?**  
Un fallback permanente crea ambigüedad: si un mensaje llega sin match en `channel_endpoints`, ¿responde con Total Racks? Eso sería una filtración de datos entre empresas. El comportamiento correcto ante un número desconocido es silencio, no una respuesta de la empresa por defecto.

**¿Por qué `channel_endpoints` y no `phone_numbers`?**  
Porque un "endpoint" es agnóstico de canal: puede ser un número de WhatsApp, una dirección de email o un webhook. `phone_numbers` cierra la puerta a Instagram DM, Telegram y email antes de construirlos. El nombre correcto describe la abstracción, no la implementación actual.

---

## Bitácora de la fase

| Fecha | Evento |
|---|---|
| 2026-06-29 | Plan aprobado. Documentación creada. Inicio de implementación. |
