# TARA SaaS Core Architecture V1

**Fecha:** 2026-10-15 (addendum: 2026-10-16)
**Estado:** auditoría + propuesta de arquitectura — cero código tocado, cero migraciones ejecutadas, cero despliegues. Espera tu autorización antes de implementar, tal como pediste.

---

## Addendum (2026-10-16) — nav_labels nunca es autorización, y el puente con TARA AI Engine

Dos correcciones a lo ya escrito abajo, pedidas explícitamente, antes de autorizar programación:

1. **`nav_labels.modulos[].habilitado` queda confirmado, sin ambigüedad, como mecanismo de PRESENTACIÓN únicamente** — nunca de autorización. Esto ya estaba implícito en la sección D ("queda como está — se vuelve un ESPEJO calculado desde `modulos_empresa`, no la fuente de verdad"), pero lo hago explícito aquí porque es una condición dura, no una preferencia de diseño: ningún endpoint, ninguna herramienta de IA, ninguna validación de permiso debe leer `nav_labels` para decidir si algo está permitido. Toda autorización real vive en backend (`requirePermiso` + el `requireModuloActivo` propuesto en la sección C).
2. **El Module Engine y el AI Engine se diseñan como un solo sistema, no dos que luego se conectan.** Ver `TARA_AI_ENGINE_ARCHITECTURE_V1.md`, sección 5 — la cadena real de autorización es: `Empresa → Plan → Módulos activos → Permisos del usuario → Herramientas que TARA AI puede ofrecer/ejecutar`. El catálogo de módulos (`modulos_catalogo`) de la sección C de este documento es el mismo catálogo que el AI Engine consulta antes de proponer o ejecutar una herramienta — una sola fuente de verdad, nunca dos registros paralelos.

---

## Resumen ejecutivo (antes del detalle)

La sorpresa de esta auditoría: **TARA ya es mucho más una plataforma SaaS multiempresa de lo que el pedido original asumía.** No partimos de una app para Nort Energy que hay que generalizar — partimos de un núcleo ya genérico (Motor Universal, construido desde hace meses) que Nort Energy usa como su caso más completo. Lo que genuinamente falta no es "construir el núcleo" — es **construir el Module Engine**: el puente que falta entre "qué plan compró la empresa" y "qué puede realmente usar," con aplicación real en backend, no solo visual.

---

## A. Auditoría actual — qué tenemos realmente construido

Clasificación exacta que pediste, con evidencia de archivo real, no suposición.

### Operativo y probado (usado por empresas reales, con tests)

| Componente | Evidencia |
|---|---|
| Multi-tenant con aislamiento estricto | `company_id` explícito en cada query, RLS deliberadamente no usado como única defensa — verificado exhaustivamente en `NORT_ENERGY_AUDIT_V1.md` sección 10, sin excepciones encontradas en ninguna auditoría de esta sesión |
| **Industry Profiles (ya existen, con otro nombre)** | tabla `plantillas_industria` — **3 industrias reales ya configuradas**: `paneles_solares`, `salon_belleza`, `uniformes_deportivos`. Cada una trae: `personalidad` (seed de IA), `knowledge_base_seed`, `servicios_seed`, `pipeline_etapas_seed`, `workflow_seed`, `dashboard_kpis_seed`, `cotizacion_config`, `ui_config` (nav), `catalogo_productos_seed`, incluso `industria_padre` (herencia entre industrias, sin usar todavía pero ya soportada en el esquema) |
| **Sistema de planes y suscripciones (ya existe, con otro nombre)** | tablas `planes`/`suscripciones`/`organizations`, módulos `modules/planes.js`, `modules/plataforma-billing.js`, `modules/billing-engine/`. **4 planes reales ya cargados**: Launch ($0), Professional ($2,990), Unlimited ($4,490), Enterprise (precio personalizado) — casi idénticos a los precios que propones en la sección 5 de tu pedido, sin que lo supieras. Alta manual de suscripción ya funciona hoy (`crearSuscripcionManual`), Stripe queda listo pero sin conectar (`STRIPE_SECRET_KEY` ausente) |
| CRM, Pipeline, Cotizaciones, Agenda, WhatsApp/Inbox, Centro de Conocimiento, Panel de Acción, Dashboard, Documentos | Todos construidos, probados, en uso real por Nort Energy y otras empresas (Total Racks, Empresa Beta, al menos 3 más en `channel_endpoints`) |
| Roles departamentales (recién construido esta sesión) | `roles_permisos` (migración 124), `requirePermiso()`, **134 rutas reales gateadas** para Nort Energy — backend-enforced, nunca solo visual |
| Clasificación de contacto / anti-contaminación de CRM | `clientes.tipo_contacto` (migración 126, recién construida) |
| Portal del cliente | `modules/portal-cliente.js`, aislamiento cliente-por-cliente verificado en P1.4 |
| Proyecto 360°, Cobranza, Instalaciones, Inventario, Compras, CFE, Garantías, Mantenimiento, Tickets | Construidos y probados en vivo esta sesión (ver `NORT_ENERGY_P1_ENTREGA.md`) |

### Implementado parcialmente

| Componente | Qué falta |
|---|---|
| Dashboard adaptable por módulos activos | Ya es adaptable por **plantilla de industria** (`dashboard_kpis_seed`) y por configuración manual (`kpis_operativos`/`atencion`, construido esta sesión) — pero no existe el concepto de "módulo activo" como gate de qué KPIs mostrar |
| Automatizaciones | Existe `workflow_seed` por industria y rutas `/api/config/workflows` — pero no hay un catálogo de "automatizaciones" vendibles por separado |

### Construido pero desconectado

| Componente | Evidencia |
|---|---|
| `planes.limites` / `planes.perks` | **Cero referencias en todo el código a estos campos fuera de `modules/planes.js` mismo** (confirmado con `grep` en todo el repositorio) — hoy son datos decorativos para mostrarle precio/beneficios al cliente, nunca se consultan para permitir o bloquear nada |
| `nav_labels.modulos[].habilitado` | Confirmado en sesiones anteriores: un módulo con `habilitado:false` solo oculta el link del menú — la API REST detrás sigue funcionando igual si se llama directamente. Cero enforcement en backend atado a este flag |
| `useSuscripcion()` (frontend) | Solo alimenta un banner/indicador visual (`SuscripcionBanner.jsx`) — nunca decide si una pantalla o botón debe existir |

### Pendiente de desarrollo (esto es lo que de verdad falta)

- **TARA Module Engine real**: registro formal de módulos (tabla), relación módulo↔plan, enforcement en backend.
- Sección "Configuración → Herramientas de mi empresa" (no existe ninguna pantalla así hoy).
- Activación real (backend) de un módulo desde el panel — hoy la única forma de "activar" algo es que yo edite `nav_labels` a mano con un script, uno por uno.
- "REPORTS" como módulo — confirmado en `NORT_ENERGY_AUDIT_V2.md`: no existe ningún componente de Reportes, en ningún lado.

---

## B. Mapa de reutilización — qué de Nort Energy ya es universal

Esto es la noticia más importante de la auditoría: **ya es universal.** Nada de lo construido para Nort Energy vive en código exclusivo de Nort Energy.

- El motor de cotizaciones, el sistema de proyectos, cobranza, inventario, compras, garantías, mantenimiento, tickets — **ninguno tiene un `if (company === 'nort-energy')` en ningún lado.** Se activan/personalizan 100% por datos: `nav_labels`, `plantillas_industria`, seeds de personalidad y KPIs.
- El motor de ingeniería solar (`modules/motores-ingenieria/paneles-solares.js`) es el ÚNICO componente genuinamente específico de energía solar — y está correctamente aislado detrás de `obtenerMotor(industriaSlug)`, un patrón de registro por industria ya diseñado para que otra industria registre su propio motor sin tocar el de paneles solares.
- El sistema de roles departamentales (punto recién construido) usa exactamente el mismo patrón: la matriz vive en `roles_permisos` (dato), el código (`requirePermiso`) es 100% genérico.

**Conclusión de esta sección: no hay nada que "convertir" en reutilizable — ya lo es.** Lo que falta es administrar esa reutilización desde un panel, en vez de con scripts de Node que corro yo a mano.

---

## C. Arquitectura propuesta

### TARA CORE
No requiere construirse — ya existe, es lo que describí en la sección A como "operativo y probado". La única extensión real necesaria: un **registro formal de capacidades** (ver Module Engine abajo) para que el Core sepa, de forma consultable, qué puede ofrecer.

### TARA MODULE ENGINE (esto SÍ hay que construirlo)

Antes de proponer identificadores nuevos, los comparé contra lo que ya existe (`modules/permisos.js::MODULOS_PERMISOS`, 12 valores reales usados hoy en producción):

| Tu propuesta | Identificador real ya existente | Acción recomendada |
|---|---|---|
| CRM | `crm` | Reusar tal cual |
| QUOTES | `cotizaciones` | Reusar tal cual (mantener español — es el vocabulario real de las migraciones/tablas) |
| SCHEDULING | *(no existe — Agenda nunca se conectó a `requirePermiso`)* | Agregar `agenda` al catálogo |
| INVENTORY | `inventario` | Reusar tal cual |
| PURCHASES | `compras` | Reusar tal cual |
| BILLING | `cobranza` | ⚠️ **Colisión de nombre que hay que resolver antes de programar**: en el vocabulario de Nort Energy "cobranza" es cuentas por cobrar a clientes; en el vocabulario de planes/SaaS "billing" es el cobro de TARA a sus propias empresas clientas (`modules/plataforma-billing.js`). Son dos cosas distintas que ya existen por separado — no se deben fusionar bajo un solo código |
| PROJECTS | `proyectos` | Reusar tal cual |
| WORK_ORDERS | *(sin equivalente directo)* | Para Nort Energy esto ya lo cubren `instalaciones` + `mantenimiento` + `tickets` — antes de crear un módulo nuevo, definir si Gondor (servicios para el hogar) realmente necesita un concepto distinto o si reutiliza `instalaciones` con otro nombre visible |
| WARRANTIES | `garantias` | Reusar tal cual |
| MAINTENANCE | `mantenimiento` | Reusar tal cual |
| TICKETS | `tickets` | Reusar tal cual |
| REPORTS | *(no existe, ni como módulo ni como pantalla)* | Es desarrollo nuevo real, no una conexión pendiente |
| CLIENT_PORTAL | portal del cliente (`modules/portal-cliente.js`) — no está en `MODULOS_PERMISOS` porque es cliente-facing, no empleado-facing | Agregar como módulo de activación (controla si la empresa ofrece portal a SUS clientes), con su propio esquema de permisos |
| AUTOMATIONS | `workflow_seed` (por industria) + rutas `/api/config/workflows` | Formalizar como módulo activable, no solo heredado de la plantilla |
| AI_ASSISTANT | siempre activo hoy (core, no opcional) | Mantener como capacidad siempre presente, no como módulo que se "activa" — lo que SÍ es configurable por plan es cuánto puede usar (ver límites de IA en sección E) |
| *(no estaba en tu lista)* | `configuracion` | Ya existe en `MODULOS_PERMISOS` — probablemente no deba ser "activable/desactivable" nunca, toda empresa necesita configurarse |

**Diseño de la tabla de registro de módulos** (nueva, aditiva):

```sql
CREATE TABLE modulos_catalogo (
  codigo text PRIMARY KEY,              -- 'crm', 'inventario', 'agenda', etc. — mismo vocabulario de MODULOS_PERMISOS
  nombre text NOT NULL,
  descripcion text,
  categoria text,                       -- 'ventas' | 'operacion' | 'postventa' | 'plataforma'
  estado text NOT NULL DEFAULT 'disponible', -- 'disponible' | 'beta' | 'descontinuado'
  dependencias text[] DEFAULT '{}',     -- ej. garantias depende de proyectos
  planes_compatibles text[] DEFAULT '{}', -- claves de `planes`
  precio_adicional_centavos int,        -- NULL = incluido en el plan, no se vende aparte
  version text DEFAULT '1.0',
  disponible_comercialmente boolean DEFAULT false
);

CREATE TABLE modulos_empresa (
  company_id uuid REFERENCES companies(id),
  modulo_codigo text REFERENCES modulos_catalogo(codigo),
  activo boolean NOT NULL DEFAULT false,
  activado_en timestamptz,
  activado_por uuid,
  PRIMARY KEY (company_id, modulo_codigo)
);
```

**El enforcement real** (lo que hoy no existe en ningún lado): un nuevo middleware `requireModuloActivo(codigo)`, compuesto CON `requirePermiso()` (nunca en su lugar) — primero verifica que el módulo esté activo para la empresa, luego que el rol tenga el permiso específico. Mismo patrón de capas ya usado (gerencial bypassa, empresa sin configurar = comportamiento actual sin romper nada).

### TARA INDUSTRY PROFILES
Ya construido (`plantillas_industria`). La única extensión real: usar el campo `industria_padre` (ya existe en el esquema, nunca poblado) para que una plantilla nueva (ej. "mantenimiento_hogar" para Gondor) pueda heredar de una más genérica sin duplicar seeds completos.

---

## D. Modelo de datos

**Tablas existentes que se reutilizan tal cual:** `companies`, `organizations`, `usuarios_empresas`, `roles_permisos`, `plantillas_industria`, `planes`, `suscripciones`, `nav_labels` (columna JSON de `companies`).

**Tablas nuevas, estrictamente necesarias (2, ambas aditivas):**
1. `modulos_catalogo` — registro de módulos (ver sección C).
2. `modulos_empresa` — qué empresa tiene qué módulo activo (ver sección C).

**Extensiones a tablas existentes:**
- `planes.limites` (JSON, ya existe) — agregar claves `modulos_incluidos: string[]` y `modulos_adicionales_permitidos: string[]`, sin tocar las claves actuales (`api`, `webhooks`, `max_usuarios`, `max_sucursales` siguen igual).

**Nada se elimina. Nada se renombra.** `nav_labels.modulos[].habilitado` queda como está — se vuelve un ESPEJO calculado desde `modulos_empresa`, no la fuente de verdad, para no romper el render del menú mientras se migra (ver sección G).

---

## E. Sistema de planes

Ya existe el 80% (planes, suscripciones, organizations, billing-engine con máquina de estados trial/active/past_due/suspended/cancelled/expired). Lo que falta:

1. Poblar `planes.limites.modulos_incluidos` para los 4 planes reales ya existentes (Launch/Professional/Unlimited/Enterprise) — dato, no código.
2. Límites de consumo de IA y WhatsApp — hoy **no existen en ningún lado** (confirmado: `limites` solo tiene `api`/`webhooks`/`max_usuarios`/`max_sucursales`). Esto es desarrollo nuevo real: contar tokens/mensajes por organización y compararlos contra un límite del plan. Requiere decidir ANTES de programar: ¿se corta el servicio al llegar al límite, se cobra excedente, o solo se alerta? Esta es una decisión de negocio, no técnica — la dejo explícitamente para tu autorización, no la asumo.
3. UI de auto-servicio para cambiar de plan — `SuscripcionTab.jsx` ya existe (176 líneas) pero lo tengo que revisar a detalle en la fase de implementación para confirmar si ya soporta upgrade/downgrade o solo visualización.

---

## F. Experiencia de usuario

**"Configuración → Herramientas de mi empresa"** — pantalla nueva, dos pestañas como pediste:
- **Mis herramientas**: lee `modulos_empresa` + `modulos_catalogo`, muestra activos/disponibles.
- **Explorar herramientas**: lee `modulos_catalogo` completo, cruza contra `planes.limites.modulos_incluidos` del plan actual de la organización para decidir qué botón mostrar (Activar / Mejorar mi plan / Agregar a mi suscripción).

El botón "Activar módulo" llama a un endpoint nuevo (`POST /api/config/modulos/:codigo/activar`) que:
1. Verifica permiso (`soloGerencial`, mismo criterio que el resto de Configuración).
2. Verifica que el plan de la organización lo incluya (o lo permita como adicional).
3. Verifica dependencias (`modulos_catalogo.dependencias`).
4. Escribe en `modulos_empresa`.
5. Actualiza `nav_labels.modulos[].habilitado` como espejo (para que el menú existente, sin tocarlo, refleje el cambio de inmediato).

**No implemento cobro automático** — confirmaste que no hay proveedor de pagos autorizado todavía (Stripe sin conectar). "Agregar a mi suscripción" por ahora registra la intención y notifica, no cobra.

---

## G. Plan de migración (sin tocar Nort Energy)

Coexistencia, nunca big-bang:

**Fase 0 (preparación, sin riesgo):** crear `modulos_catalogo`/`modulos_empresa` vacías, poblar el catálogo con los módulos ya identificados en la sección C. Cero efecto — nada las consulta todavía.

**Fase 1 (espejo, sin riesgo):** para Nort Energy específicamente, poblar `modulos_empresa` con exactamente lo que YA está `habilitado:true` en su `nav_labels` actual — una copia fiel del estado real de hoy, no un cambio.

**Fase 2 (enforcement opcional):** agregar `requireModuloActivo()` a las rutas, pero con el mismo fallback de siempre: empresa sin fila en `modulos_empresa` para ese módulo = comportamiento actual (todo permitido), igual que el diseño de `roles_permisos`. Nort Energy, ya con su espejo de la Fase 1, sigue funcionando exactamente igual.

**Fase 3 (UI real):** construir "Herramientas de mi empresa" — en este punto activar/desactivar ya tiene efecto real, pero Nort Energy ya tiene todo activado desde la Fase 1, así que no hay interrupción.

**Fase 4 (comercial):** conectar planes↔módulos de verdad para empresas NUEVAS — Nort Energy, como cliente ya migrado, queda excluido de cualquier restricción retroactiva salvo que tú decidas explícitamente asignarle un plan y límites.

---

## H. Riesgos

- **Colisión de nombres "BILLING"** (cobranza de Nort Energy vs. billing de la plataforma) — ya señalada en la sección C, resolver antes de escribir una sola línea de código de Module Engine.
- **Límites de consumo de IA/WhatsApp** — decisión de negocio pendiente (cortar vs. cobrar excedente vs. solo alertar), no debe inferirse.
- **Doble fuente de verdad temporal** (`nav_labels.modulos[].habilitado` como espejo de `modulos_empresa` durante la migración) — mientras dure la Fase 1-3, cualquier cambio manual directo a `nav_labels` (como los scripts que he corrido toda esta sesión) desincroniza el espejo. Hay que congelar esa práctica en cuanto arranque la Fase 1.
- **Stripe sin conectar** — todo lo de autoservicio de pago queda bloqueado hasta que exista `STRIPE_SECRET_KEY` y se autorice explícitamente (ya hay un guard de código para esto, `requerirStripe()`, no hace falta nada nuevo ahí).
- **No se toca la arquitectura congelada** — Orchestrator, WorkflowEngine, ContextBuilder, AIProvider: cero cambios de contrato. El Module Engine vive enteramente en la capa de plataforma (rutas + middleware), igual que `roles_permisos`.

---

## I. Fases de desarrollo (orden recomendado y estimación)

| Fase | Contenido | Dependencias | Estimación |
|---|---|---|---|
| 0 | Catálogo de módulos (tabla + datos) | Ninguna | 1 sesión |
| 1 | Espejo para Nort Energy | Fase 0 | 1 sesión, incluye validación en vivo |
| 2 | `requireModuloActivo()` + wiring opcional en rutas | Fase 1 | 2-3 sesiones (es volumen, no complejidad — mismo patrón mecánico que las 134 rutas de `roles_permisos`) |
| 3 | UI "Herramientas de mi empresa" | Fase 2 | 2 sesiones |
| 4 | Planes↔módulos real + límites de consumo IA/WhatsApp | Fase 3 + decisión de negocio pendiente (sección H) | 3+ sesiones, depende de la decisión |
| — | REPORTS como módulo nuevo real | Independiente, puede ir en paralelo | Fuera de este alcance — es una funcionalidad nueva, no una conexión |

**Recomiendo empezar por la Fase 0-1** — son de bajo riesgo, no afectan nada en producción, y dejan a Nort Energy formalmente registrada en el nuevo sistema sin cambiar su comportamiento ni un bit.

---

## J. Evaluación comercial

**Listo para vender hoy, sin cambios:** CRM, Cotizaciones, Agenda, WhatsApp/Inbox, el bloque operativo completo de Nort Energy (Proyectos/Instalaciones/Cobranza/Inventario/Compras/CFE/Garantías/Mantenimiento/Tickets) — para una empresa de un giro similar (servicios con instalación/mantenimiento), probablemente reutilizable con una nueva plantilla de industria en 1-2 sesiones, no un desarrollo desde cero.

**Necesita validación adicional antes de vender:** Reportes (no existe), portal del cliente como producto independiente (probado solo con Nort Energy), el propio Module Engine (hasta que exista, "activar módulos" es una promesa, no una función real).

---

## Respuestas directas a tus 7 preguntas

**1. ¿Qué porcentaje del núcleo SaaS ya tenemos construido?**
El núcleo operativo (CRM/Cotizaciones/Agenda/WhatsApp/Industry Profiles/Planes-Suscripciones/Roles): **~85%**, con evidencia real de uso multiempresa, no estimado por líneas de código. Lo que falta no es el núcleo — es la capa de activación comercial (Module Engine): **~15% construido** (solo el nav JSON manual, sin enforcement).

**2. ¿Qué componentes podemos reutilizar inmediatamente?** Todo lo listado en la sección A como "operativo y probado" — cero trabajo adicional, ya es multiempresa.

**3. ¿Qué necesitamos desarrollar?** El Module Engine completo (tablas + middleware + UI), límites de consumo de IA/WhatsApp, y Reportes como funcionalidad real.

**4. ¿Riesgos principales?** La colisión de nombres BILLING, la decisión de negocio pendiente de límites de consumo, y la sincronización temporal del "espejo" durante la migración (sección H).

**5. ¿Cuánto trabajo por fase?** Ver sección I — Fases 0-1 son rápidas y de bajo riesgo; Fase 2 es volumen mecánico (ya hicimos exactamente este patrón 134 veces esta sesión); Fase 4 depende de una decisión tuya antes de poder estimarse con precisión.

**6. ¿Qué fase recomiendo implementar primero?** Fase 0-1 (catálogo + espejo de Nort Energy) — cero riesgo, deja la base lista, y tú puedes ver el nuevo sistema funcionando sin que nada cambie para Nort Energy todavía.

**7. ¿Qué decisiones requieren tu autorización?**
- Resolver el nombre de colisión BILLING antes de tocar código.
- La política de límites de IA/WhatsApp (cortar / cobrar excedente / solo alertar).
- Si "Reportes" se construye ahora o se deja fuera de este esfuerzo (es trabajo nuevo real, no parte del Module Engine).
- El orden de fases propuesto en la sección I, o uno distinto si prefieres otra prioridad.

---

No se tocó ningún archivo de código, ninguna migración, ningún dato. Quedo a la espera de tu autorización antes de implementar cualquier fase.
