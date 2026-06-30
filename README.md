# TARA Matrix™
## Sistema Operativo para Asistentes Empresariales por WhatsApp

**v3.0 — STABLE · Multi-tenant · 29 de junio de 2026**

---

## Estado actual

| Item | Estado |
|------|--------|
| Versión | v3.0.0 |
| FASE 3 | COMPLETA — multi-tenant activo |
| Tests | 349/349 passing |
| Producción | LIVE en Render |
| Empresas activas | 5 validadas |
| Vectores de contaminación | 8/8 PASS |

---

## Qué es TARA Matrix™

Una plataforma SaaS que permite a múltiples empresas operar sus propios asistentes de WhatsApp con personalidad, knowledge base y datos completamente aislados — todo desde un solo servidor.

Cada empresa define:
- El nombre de su asistente
- Su tono y personalidad
- Su knowledge base
- Su número de WhatsApp receptor

El sistema enruta automáticamente cada mensaje a la empresa correcta.

---

## Arquitectura — FASE 3

```
Twilio WhatsApp
      │
      ▼ POST /webhook/twilio
TwilioWhatsAppAdapter      → extrae incoming_endpoint
ChannelRouter              → endpoint → company_id (via channel_endpoints en Supabase)
Orchestrator               → coordina con company_id
  ├── obtenerConfigEmpresa(company_id)
  ├── obtenerOCrearCliente(tel, company_id)
  ├── guardarConversacion(..., company_id)
  └── crearOportunidad(..., company_id)
```

**Invariante:** `company_id` fluye desde el número receptor hasta cada escritura en DB. No existe punto donde se mezclen datos de dos empresas.

---

## Módulos activos

| ID | Módulo | Estado |
|----|--------|--------|
| M1 | TwilioWhatsAppAdapter | Activo |
| M2 | AIEngine (OpenAI + Mock) | Activo |
| M3 | AuditLogger | Activo |
| M4 | ContextBuilder | Activo |
| M6 | PromptBuilder | Activo |
| M7 | Orchestrator | Activo |
| RT | ChannelRouter | Activo — nuevo en FASE 3 |
| M5 | WorkflowEngine | Pendiente — FASE 4 |
| M8 | ActionRunner | Pendiente — FASE 4 |

---

## Registrar una nueva empresa

No se requiere cambio de código. Solo 4 inserts en Supabase:

```sql
-- 1. Empresa
INSERT INTO companies (slug, nombre, descripcion, estado)
VALUES ('mi-empresa', 'Mi Empresa', 'Descripción', 'activo');

-- 2. Personalidad (nombre del asistente, tono, objetivo)
INSERT INTO personalities (company_id, nombre_asistente, ...)
VALUES ('<uuid>', 'NOMBRE_ASISTENTE', ...);

-- 3. Knowledge base
INSERT INTO knowledge_base (company_id, categoria, contenido)
VALUES ('<uuid>', 'Categoría', 'Contenido...');

-- 4. Número de WhatsApp
INSERT INTO channel_endpoints (company_id, endpoint, canal, activo)
VALUES ('<uuid>', 'whatsapp:+521XXXXXXXXXX', 'whatsapp', true);
```

---

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/webhook/twilio` | Entrada de mensajes WhatsApp |
| GET | `/health` | Estado del servidor |
| GET | `/api/diagnostics` | 8 checks detallados de salud |
| GET | `/api/dashboard` | Métricas del pipeline |

---

## Variables de entorno requeridas

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
OPENAI_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=
WEBHOOK_URL_WHATSAPP=
NODE_ENV=production
PORT=3000
```

`COMPANY_SLUG` fue eliminado en FASE 3. El routing es dinámico desde `channel_endpoints`.

---

## Setup local

```bash
git clone https://github.com/Malinanavarro-rgb/totalracks-whatsapp-twilio
cd totalracks-whatsapp-twilio
npm install
cp .env.example .env   # llenar con credenciales reales
npm start
```

Ejecutar migraciones en Supabase (en orden):
1. `migrations/001_schema_inicial.sql`
2. `migrations/002_channel_endpoints.sql`
3. `migrations/003_company_id_en_crm.sql`

---

## Tests

```bash
npm test
```

349 tests — unitarios e integración del Orchestrator, ContextBuilder, PromptBuilder y AIEngine.

---

## Documentación técnica

```
docs/
├── releases/
│   └── v3.0-fase3.md          ← release oficial FASE 3
└── architecture/
    └── phase-3/
        ├── README.md           ← decisiones de arquitectura FASE 3
        ├── T3.0-baseline.md
        ├── T3.1-channel-endpoints.md
        ├── ...
        └── T3.12-validation.md
```

---

## Roadmap

| Fase | Estado | Alcance |
|------|--------|---------|
| FASE 1 | Completa | Bot single-tenant básico |
| FASE 2 | Completa | Arquitectura hexagonal, AIEngine, Orchestrator |
| FASE 3 | **Completa** | **Multi-tenant, routing dinámico, aislamiento validado** |
| FASE 4 | Próxima | WorkflowEngine (M5) + ActionRunner (M8) |

---

## Producción

Desplegado en Render. Auto-deploy desde `main`.
URL: `https://totalracks-whatsapp-twilio.onrender.com`
