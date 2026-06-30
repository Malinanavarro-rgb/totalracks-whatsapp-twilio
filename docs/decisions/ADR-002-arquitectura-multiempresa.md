# ADR-002 — Arquitectura Multi-empresa (Multi-tenant)

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | Junio 2026 (FASE 3) |
| Autora | Alina Navarro |
| Implementada en | T3.1 – T3.12 |

---

## Contexto

En FASE 2, TARA solo podía servir a una empresa. La empresa estaba hardcodeada mediante la variable de entorno `COMPANY_SLUG`. Para servir a una segunda empresa se necesitaba desplegar un segundo servidor con su propio `COMPANY_SLUG`, sus propias variables de entorno y su propio proceso en Render.

Este modelo no es escalable como SaaS. El objetivo es que un solo servidor sirva a N empresas sin ningún tipo de contaminación entre ellas.

---

## Decisión

Implementar multi-tenancy mediante aislamiento por `company_id` en todas las capas:

**Capa de routing:** `channel_endpoints` tabla en Supabase mapea cada número Twilio a un `company_id`. El `ChannelRouter` resuelve el `company_id` antes de que el Orchestrator toque ningún dato.

**Capa de configuración:** `obtenerConfigEmpresa(companyId)` reemplaza el caché estático de una sola empresa por un `Map` indexado por `company_id`.

**Capa de datos:** Todas las tablas CRM (`clientes`, `conversaciones`, `oportunidades`) tienen columna `company_id NOT NULL`. Las queries siempre filtran por ella.

**Invariante central:**
> `company_id` entra al sistema por el número receptor del mensaje y fluye hacia abajo sin modificarse hasta cada escritura en DB. No existe ningún punto donde se pueda sustituir por el `company_id` de otra empresa.

---

## Modelo de datos

```
organizations          (futuro — nivel corporativo)
  └── companies        (empresa en la plataforma — la unidad de tenancy)
        ├── personalities        (asistente de la empresa)
        ├── knowledge_base       (contenido por empresa)
        ├── channel_endpoints    (números Twilio de la empresa)
        ├── clientes             (contactos de la empresa)
        ├── conversaciones       (historial de la empresa)
        ├── oportunidades        (pipeline de la empresa)
        └── decision_logs        (auditoría de la empresa)
```

---

## Alternativas consideradas

| Alternativa | Razón de rechazo |
|-------------|-----------------|
| Un servidor por empresa | No es SaaS — no escala, costo operativo lineal por empresa |
| Base de datos separada por empresa | Operacionalmente complejo; no justificado hasta volúmenes muy altos |
| Schema de Postgres por empresa | Supabase no soporta schemas dinámicos fácilmente; overhead de gestión |
| RLS (Row Level Security) en Supabase | El backend es server-side y usa service role key — RLS añade latencia sin beneficio de seguridad adicional |

---

## Consecuencias

**Positivas:**
- Agregar una empresa nueva = 4 inserts en Supabase, sin deploy ni cambio de código
- El aislamiento es verificable por query: `SELECT * FROM clientes WHERE company_id = ?`
- La plataforma puede escalar a decenas de empresas sin cambio de arquitectura
- Los 8 vectores de contaminación validan el aislamiento en cada release

**Negativas:**
- Todas las queries deben incluir `company_id` — un olvido es un bug de seguridad
- Las migraciones de schema afectan a todos los tenants simultáneamente
- El onboarding de empresas nuevas es manual (SQL directo) hasta que exista una UI

---

## Regla permanente

> Ninguna función del Kernel puede operar sin `company_id`. Si una función de `crm.js`, `config.js` u `orchestrator.js` acepta datos sin `company_id`, es un error de arquitectura.
