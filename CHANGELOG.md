# Changelog — TARA-OS

Formato inspirado en [Keep a Changelog](https://keepachangelog.com). Organizado por versión de producto ([`docs/roadmap/TARA-OS-ROADMAP.md`](docs/roadmap/TARA-OS-ROADMAP.md)), no por commit — el detalle línea por línea vive en `git log`.

## [v0.2] — Portal del Cliente — 2026-07-21

### Agregado
- Registro público de una empresa (`/registro`): crea cuenta, Organization+Company, detecta el giro, siembra configuración inicial, vincula como *owner*, arranca plan de prueba — todo en una sola operación.
- Recuperación de contraseña (`/recuperar-password` → `/restablecer-password`) sobre Supabase Auth nativo.
- Onboarding corto post-registro (una pantalla, no bloqueante).
- Centro de Conexiones: conectar WhatsApp (Meta) desde el panel, sin terminal.
- Modo Operador — primera versión: motor de razonamiento libre sobre datos de la empresa (Nivel 1 Panel Maestro, Nivel 3 Empresa), con tablas nuevas de memoria institucional (`tareas`, `proyectos`, `bitacora_decisiones`, `documentos`).

### Corregido
- `crearEmpresaConIndustria()` estaba roto desde que `companies.organization_id` se volvió obligatorio — impedía dar de alta cualquier empresa nueva vía script.
- `conectar-empresa-meta.js` dejaba `channel_endpoints` sin registrar — los mensajes de un número recién conectado se perdían en silencio.
- `prompt-builder.js` trataba el placeholder `"Sin nombre"` como nombre real, rompiendo la regla de "pregúntalo una sola vez" en conversaciones nuevas.

## [v0.1] — Infraestructura — hasta 2026-07-20

### Agregado
- Core conversacional (`Orchestrator`, `WorkflowEngine`, `SchedulingEngine`, `ActionRunner`, `ContextBuilder`, `PromptBuilder`, `AIEngine`) — congelado y validado con dos giros de negocio distintos.
- Multi-tenant: `Organization → Company`, autenticación mediada por backend, roles owner/administrador/supervisor/asesor.
- Agenda, CRM (ficha 360°), Conversaciones en tiempo real + intervención humana, Configuración de empresa completa.
- Billing & Suscripciones: planes, suscripciones, métodos de pago, pagos.
- Panel Maestro: Dashboard, Organizaciones, Planes, Centro de Cobro, Auditoría.
- Plantillas de industria (detección automática de giro).

*(Detalle completo de esta ventana en `docs/roadmap/README.md`, conservado como registro histórico.)*

---

## Cómo se agrega una entrada

Al cerrar una versión (ver "Congelamiento" en el roadmap), resume aquí lo agregado/corregido/quitado en 3-8 bullets — no una línea por commit. Fecha en formato `AAAA-MM-DD`.
