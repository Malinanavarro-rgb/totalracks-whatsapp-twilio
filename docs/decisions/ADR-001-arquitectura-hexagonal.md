# ADR-001 — Arquitectura Hexagonal (Ports and Adapters)

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Enero 2026 (FASE 2) |
| Autora | Alina Navarro |
| Revisión | Junio 2026 — confirmada en FASE 3 |

---

## Contexto

En FASE 1, toda la lógica de negocio vivía en `server.js`: el parsing de Twilio, las llamadas a OpenAI, las escrituras a Supabase y la respuesta HTTP estaban mezcladas en un solo archivo. Agregar un nuevo canal o cambiar de proveedor de IA requería reescribir el servidor completo.

Se necesitaba una estructura que permitiera:
- Cambiar Twilio por otro canal sin tocar la lógica de negocio
- Cambiar OpenAI por otro modelo sin tocar el Orchestrator
- Probar el núcleo del sistema sin levantar HTTP ni conectarse a Supabase

---

## Decisión

Adoptar arquitectura hexagonal (Ports and Adapters):

- **Kernel** — módulos de negocio puros: Orchestrator, ContextBuilder, PromptBuilder, AIEngine, CRM, AuditLogger. No importan nada de Twilio, HTTP ni proveedores de IA.
- **Adapters de entrada** — convierten el mundo externo al lenguaje del Kernel: `TwilioWhatsAppAdapter` convierte un `req` HTTP en un `Message` normalizado.
- **Adapters de salida** — implementan los proveedores: `OpenAIProvider`, `MockProvider`.
- **server.js** — orquesta los adapters, no contiene lógica de negocio.

```
Twilio → TwilioWhatsAppAdapter → Message → Orchestrator → OpenAIProvider → Twilio
                                              ↕
                                        Supabase (vía modules/clients)
```

---

## Alternativas consideradas

| Alternativa | Razón de rechazo |
|-------------|-----------------|
| MVC clásico | Acopla canales y proveedores a los controladores — difícil de probar |
| Todo en server.js (FASE 1) | No escala, no testeable, no extensible |
| Microservicios | Overhead excesivo para el estado actual; la complejidad operativa no está justificada |

---

## Consecuencias

**Positivas:**
- `orchestrator.test.js` prueba el 90% de la lógica sin HTTP, sin Twilio, sin OpenAI real
- Agregar un canal nuevo (SMS, Instagram) = crear un nuevo Adapter, sin tocar el Kernel
- Cambiar de gpt-4o-mini a Claude = crear un nuevo Provider, sin tocar el Orchestrator
- FASE 3 añadió ChannelRouter sin modificar ningún módulo del Kernel

**Negativas:**
- Más archivos y carpetas que un proyecto monolítico simple
- Curva de entrada para colaboradores nuevos que no conocen el patrón

---

## Regla permanente

> El Kernel nunca importa un adapter. Los adapters sí pueden importar módulos del Kernel.
> Si un módulo en `/modules/` tiene un `require` que apunta a `/adapters/`, es un error de arquitectura.
