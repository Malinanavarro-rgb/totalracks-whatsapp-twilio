# Auditoría de arquitectura — Plataforma SaaS TARA Matrix™

| Campo | Valor |
|-------|-------|
| Fecha | 10 de julio de 2026 |
| Alcance | Autenticación, Multiempresa, WhatsApp, Agenda, CRM, Configuración, Workflows/IA, Permisos, Panel (frontend) |
| Objetivo | Identificar decisiones que se conviertan en deuda técnica real al escalar a 100–1,000 empresas, antes de seguir agregando funcionalidades (Reportes) |
| Metodología | Lectura directa de código + verificación de cada hallazgo contra el repo real (no se reportó nada sin confirmar en el código) |

---

## Cómo leer esta tabla

- **Impacto** refleja qué tan grave es el problema *cuando* se manifiesta a escala, no qué tan probable es hoy.
- **Corregir ahora** = tocarlo antes de seguir construyendo funcionalidad nueva, porque cada módulo nuevo que se agrega sobre el patrón actual aumenta el costo de corregirlo después.
- **Diferir** = documentado y monitoreable; se corrige cuando haya evidencia real de que empieza a doler (mismo criterio que ADR-005 para el Core).

---

## Hallazgos — Impacto ALTO

### 1. Row Level Security deshabilitado en todas las tablas multiempresa
**Dónde:** todas las migraciones (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`), 11 tablas confirmadas.
**Riesgo:** el aislamiento entre empresas depende al 100% de que *cada* función de *cada* módulo recuerde agregar `.eq('company_id', ...)`. No hay red de seguridad a nivel de base de datos. Esto no es hipotético — en esta misma sesión aparecieron dos casos reales: el dashboard original de Total Racks sin filtro de empresa (corregido en Fase 2) y `summary.js` sin filtro (corregido en Fase 6). Cada módulo nuevo repite el mismo riesgo humano.
**Por qué está así (contexto, no es un descuido):** está documentado explícitamente en `migrations/001_decision_logs.sql` — la razón es que el backend usa la `anon key` (nunca `service_role`), y activar RLS con políticas de `service_role` haría fallar silenciosamente al `AuditLogger` (fire-and-forget, no lanza excepciones). Fue una decisión consciente en su momento, no un olvido.
**Recomendación:** **corregir antes de tener decenas de empresas reales pagando.** No requiere rediseñar nada — se puede activar RLS con políticas que autoricen por `auth.jwt()` (el usuario autenticado) en vez de por rol de conexión, sin depender de `service_role`. Vale la pena una sesión dedicada solo a esto, es la pieza que más se agrava con el tiempo (cada tabla nueva sin RLS es una tabla nueva con el mismo riesgo).

### 2. Patrón N+1 en los listados de Conversaciones y CRM
**Dónde:** `modules/conversaciones.js` (`listarConversaciones` → `_obtenerUltimoMensaje` por cliente) y `modules/crm-ui.js` (`listarClientes`).
**Riesgo:** por cada cliente en la lista se hacen 2 queries adicionales (conversaciones + mensajes_humanos) en paralelo pero *por cliente*. Con 500 clientes reales, cargar la pantalla de Conversaciones o CRM dispara ~1,000 queries. Esto **no depende de cuántas empresas haya en la plataforma — depende de cuántos clientes tenga UNA empresa exitosa**, y ya es hoy el cuello de botella más cercano.
**Recomendación:** **corregir pronto, antes de que una empresa real crezca su base de clientes.** La solución es una sola consulta agregada (vista o función RPC de Postgres con `DISTINCT ON` para "último mensaje por cliente") en vez de N consultas en el cliente Node.

### 3. Diseño de Reportes en curso: agregación en JS sobre todas las filas
**Dónde:** el módulo que estaba a punto de escribir (`modules/reportes.js`, Fase 7).
**Riesgo:** traer todas las filas de un rango de fechas y agrupar en JavaScript (en vez de `GROUP BY` en SQL) no escala para una empresa con historial grande (miles de conversaciones/citas). A diferencia de los demás hallazgos, este todavía no existe en código — es la oportunidad de no repetir el mismo patrón N+1 una tercera vez.
**Recomendación:** **corregir en el diseño antes de escribir el código** (agregación vía SQL/RPC, no vía JS), ya que estábamos a punto de construirlo.

### 4. Migraciones sin runner ni tracking
**Dónde:** 32 archivos `.sql` en `migrations/`, aplicados manualmente por copy-paste al SQL Editor de Supabase. No existe tabla de control de qué migración ya corrió en qué ambiente (`setup-db.js` es un script de setup inicial de una sola vez, no un migration runner).
**Riesgo:** en cuanto exista más de un ambiente (staging) o más de una persona aplicando cambios, es fácil saltarse una migración, aplicarla dos veces, o aplicarla al ambiente equivocado — ya pasó una vez en esta sesión (migración 021 duplicada).
**Recomendación:** **corregir antes de escalar el equipo/ambientes**, no antes de escalar tenants — es deuda operativa, no de código de producto. Adoptar un runner simple (tabla `schema_migrations` + script que aplica solo lo pendiente) es una tarde de trabajo.

### 5. Rate limit de OpenAI compartido entre todas las empresas
**Dónde:** `modules/clients.js` — una sola `OPENAI_API_KEY` para toda la plataforma.
**Riesgo:** los límites de OpenAI (RPM/TPM) son por cuenta, no por empresa. Con 100+ empresas activas simultáneamente en horario pico, una empresa con mucho tráfico puede consumir el límite y degradar la respuesta de las demás ("vecino ruidoso"). El dato para monitorear esto **ya existe** (`decision_logs.costo_usd` y `decision_logs.tokens_total` se capturan en cada llamada) pero no se usa para nada todavía — ni alertas, ni límites por plan, ni reporte de consumo.
**Recomendación:** no bloquea hoy con el volumen actual. **Corregir cuando haya evidencia real** de throttling (monitorear vía los datos ya capturados), o proactivamente antes de una campaña de adquisición masiva de clientes.

---

## Hallazgos — Impacto MEDIO

### 6. Cachés en memoria por proceso (no compartidas entre instancias)
**Dónde:** `modules/config.js` (personalidad/KB, TTL 5 min) y `modules/channel-router.js` (routing + resolución de número por empresa).
**Riesgo:** si Render escala horizontalmente a más de una instancia, cada instancia cachea por separado — una empresa que edita su configuración puede ver el cambio reflejado en una instancia y no en otra hasta que ambas expiren. Hoy, con una sola instancia, no es un problema.
**Recomendación:** diferir hasta que se agregue una segunda instancia (Render "scale" horizontal). Documentar la limitación para no sorprenderse cuando pase.

### 7. `requireAuth` sin caché — 2 round-trips en cada request autenticado
**Dónde:** `modules/auth.js` → `resolverSesion()`: `supabase.auth.getUser(token)` + query a `usuarios_empresas`, en cada request, sin excepción.
**Riesgo:** suma latencia fija a cada llamada a la API y carga proporcional al tráfico total de la plataforma sobre Supabase Auth y la tabla `usuarios_empresas`.
**Recomendación:** diferir — es optimizable después (ej. cachear la validación de membresía por un par de minutos) sin cambiar el contrato de la API. No urge con el volumen actual.

### 8. Cron de recordatorios procesa citas secuencialmente
**Dónde:** `modules/recordatorios.js` → `enviarRecordatoriosPendientes()`, `for (const cita of citas)` con `await` dentro del loop.
**Riesgo:** con muchas empresas y muchas citas pendientes en la ventana, el job tarda más en completarse cada vez — puede eventualmente no terminar antes de la siguiente ejecución programada.
**Recomendación:** diferir hasta que el volumen de citas/recordatorios lo justifique — es un cambio acotado (paralelizar con límite de concurrencia) cuando haga falta.

### 9. Lógica de permisos por rol duplicada y ligeramente inconsistente
**Dónde:** `ROLES_GERENCIALES` se define de forma independiente en `conversaciones.js`, `crm-ui.js` y `agenda.js`; `server.js` tiene su propio `soloGerencial` con un conjunto de roles *distinto* (Configuración es más restrictiva — sin Supervisor — que Conversaciones/CRM).
**Riesgo:** con más roles o más rutas, es fácil que una ruta nueva se quede sin el chequeo correcto, o que dos módulos definan "quién ve todo" de forma distinta sin que sea intencional.
**Recomendación:** consolidar en un módulo único de permisos (`modules/permisos.js`) la próxima vez que se toque cualquiera de estos módulos — no amerita una sesión dedicada solo para esto, pero sí hacerlo la próxima vez que se edite alguno.

### 10. Sin paginación en ningún listado
**Dónde:** Conversaciones, CRM Clientes, Agenda (citas del día) — todos devuelven la lista completa de la empresa en una sola respuesta.
**Riesgo:** relacionado con el hallazgo #2 — mismo problema de fondo (crece con la cantidad de datos por empresa, no con la cantidad de empresas).
**Recomendación:** corregir junto con el hallazgo #2 (la agregación eficiente y la paginación normalmente se resuelven en el mismo cambio).

### 11. Polling como mecanismo de "tiempo real"
**Dónde:** `Conversaciones.jsx` (12s) y `ConversacionDetalle.jsx` (5s) — simplificación ya aprobada en Fase 3.
**Riesgo:** con cientos de empresas y varios usuarios por empresa con la pantalla abierta, esto se vuelve carga sostenida real sobre la API (cálculo simple: 1,000 empresas × 5 usuarios × 1 request/12s ≈ 400 req/s solo de polling, antes de contar tráfico real de WhatsApp).
**Recomendación:** diferir — fue una decisión correcta para el volumen actual. Revisar cuando el número de empresas activas simultáneamente se acerque a las decenas.

### 12. Sin observabilidad estructurada
**Dónde:** todo el proyecto usa `console.log`/`console.error`; no hay Sentry ni servicio equivalente.
**Riesgo:** con más empresas, diagnosticar un incidente real vía el log crudo de Render se vuelve más lento — no hay forma de buscar "todos los errores de la empresa X en las últimas 24h" sin grep manual.
**Recomendación:** diferir hasta que haya un incidente real que sea difícil de diagnosticar así — es una integración de bajo esfuerzo cuando se decida hacerla.

### 13. Sin CI (integración continua)
**Dónde:** no existe `.github/workflows/` ni ningún pipeline automático. Los 595 tests se corren manualmente antes de cada push, en esta sesión, por mí.
**Riesgo:** si en el futuro alguien más (u otra sesión sin este hábito) hace un push sin correr los tests, código roto puede llegar a producción sin que nadie lo note antes del deploy.
**Recomendación:** corregir con relativamente poco esfuerzo (un workflow de GitHub Actions que corra `npm test` en cada push/PR) — vale la pena antes de que el equipo crezca más allá de esta sesión.

### 14. Cola de procesamiento por teléfono es un Map en memoria
**Dónde:** `server.js` → `processingQueue` (serializa mensajes concurrentes del mismo teléfono).
**Riesgo:** si el servicio escala horizontalmente, dos instancias podrían procesar mensajes del mismo cliente en paralelo sin la serialización esperada, reabriendo el riesgo de condición de carrera que este mecanismo previene hoy.
**Recomendación:** diferir hasta que se planee escalar horizontalmente — en ese momento, revisar junto con los hallazgos #6 y #7 (todos comparten la misma causa raíz: estado en memoria de una sola instancia).

---

## Hallazgos — Impacto BAJO

### 15. Frontend servido desde el mismo proceso Express que la API
Decisión tomada explícitamente en Fase 1 para no generar un segundo servicio de Render. Totalmente reversible — separar el frontend a su propio hosting/CDN es un cambio aislado cuando haga falta.

### 16. Sin rate limiting explícito en endpoints públicos
`/api/auth/login`, `/api/invitaciones/:token`, `/api/invitaciones/:token/aceptar` no tienen throttling. Mitigado parcialmente por tokens largos aleatorios (invitaciones) pero el login no tiene ninguna protección contra fuerza bruta. Bajo impacto hoy por el volumen de tráfico, pero barato de agregar (ej. `express-rate-limit`) cuando se priorice seguridad.

### 17. Secretos en variables de entorno de Render
Suficiente para el estado actual. Si en el futuro se requiere cumplimiento tipo SOC2 u otro compliance formal, revisar un gestor de secretos dedicado.

---

## Resumen ejecutivo — qué haría primero

Si tuviera que priorizar antes de seguir agregando funcionalidad nueva:

1. **RLS (#1)** — es la única pieza donde un solo bug futuro (no hipotético — ya pasó dos veces) se convierte en una fuga de datos entre empresas reales, no solo en un bug funcional.
2. **N+1 en Conversaciones/CRM (#2)** — ya es lento hoy con datos reales de tamaño moderado, no hace falta esperar a tener más empresas para sentirlo.
3. **Diseñar Reportes con agregación SQL desde el inicio (#3)** — evita construir un tercer módulo con el mismo patrón que luego hay que rehacer.
4. **Migraciones con tracking (#4)** y **CI (#13)** — son las dos piezas de higiene operativa más baratas de resolver con mayor beneficio a futuro.

Todo lo demás es razonable dejarlo documentado y revisarlo cuando el volumen real lo exija — no representa deuda que se agrave por seguir construyendo funcionalidad de producto.
