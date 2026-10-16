# TARA AI — Consulta Empresarial, Fase 2: conectar las 6 capacidades de análisis

**Fecha:** 2026-10-16
**Estado:** implementado y probado localmente. **Sin push, sin despliegue.**

---

## 1. Las 6 funciones reales — confirmadas antes de implementar (punto 1 de tu autorización)

Todas viven en `modules/dashboard-engine.js::REGLA_TIPOS`, ya en producción alimentando el dashboard visual — se reusan **tal cual**, cero lógica de negocio nueva:

| Función real | Firma | ¿Usa fecha? |
|---|---|---|
| `oportunidad_seguimiento_vencido` | `(supabase, company_id, { estados_excluidos, severidad }, ahora)` | Sí |
| `instalacion_atrasada` | `(supabase, company_id, { severidad, limite }, ahora)` | Sí |
| `cobranza_con_saldo` | `(supabase, company_id, { severidad, limite })` | No |
| `tramite_cfe_sin_actualizacion` | `(supabase, company_id, { severidad, limite }, ahora)` | Sí |
| `garantia_reclamacion_abierta` | `(supabase, company_id, { severidad, limite })` | No |
| `ticket_pendiente` | `(supabase, company_id, { severidad, limite })` | No |

Los valores de `estados_excluidos`/`severidad` que uso son **los mismos reales que ya usa el dashboard de Nort Energy** (`scripts/nort-energy-dashboard-operativo.js`, `scripts/nort-energy-fase1-nav-dashboard.js`) — nunca inventados: `estados_excluidos: ['Cerrado', 'Perdido']`, severidades `critica`/`alta`/`media` según la misma jerarquía que ya usa el dashboard.

**Auditoría de las funciones auxiliares que importan internamente** (punto 2 de tu autorización): `cobranza_con_saldo` usa `modules/cobranza.js::calcularEstadoCobranza()` y `tramite_cfe_sin_actualizacion` usa `modules/tramites-cfe.js::calcularDiasSinActualizacion()`/`requiereAlerta()` — confirmé que **ambas son funciones puras**: no reciben `supabase`, no hacen ninguna consulta propia, solo calculan sobre filas que `REGLA_TIPOS` ya trajo filtradas por `company_id`. Cero riesgo de fuga por esta vía.

## 2. Las 6 herramientas nuevas conectadas

| Tool (nombre OpenAI) | Envuelve | Parámetro visible al modelo |
|---|---|---|
| `clientes_necesitan_seguimiento` | `oportunidad_seguimiento_vencido` | `limite` (opcional) |
| `instalaciones_requieren_atencion` | `instalacion_atrasada` | `limite` |
| `cobranza_pendiente` | `cobranza_con_saldo` | `limite` |
| `tramites_cfe_pendientes` | `tramite_cfe_sin_actualizacion` | `limite` |
| `garantias_abiertas` | `garantia_reclamacion_abierta` | `limite` |
| `tickets_pendientes` | `ticket_pendiente` | `limite` |

**`company_id` nunca es un parámetro visible al modelo en ninguna de las 6** — viene exclusivamente de `alcance.company_id`, resuelto server-side desde la Fase 1 (`modules/operador-contexto-empresarial.js`, sin cambios). Las 6 exigen `alcance.nivel === 'empresa'` vía `_exigirAlcanceEmpresa()` (la misma función que ya usan `consultar_catalogo_tecnico`/`consultar_faq_solar`, sin tocar).

`TOOLS_CONSULTA_EMPRESARIAL` pasó de 8 a 14 nombres — la lista blanca sigue siendo explícita (nunca "todo menos gerencial"), y sigue aplicada en 2 capas: el modelo no ve en su schema ninguna tool fuera de la lista, y el dispatcher de `operador-engine.js` rechaza cualquier intento igual.

## 3. Solo lectura — confirmado

Ninguna de las 6 puede: modificar clientes, crear cotizaciones, cambiar oportunidades, agendar actividades, modificar instalaciones, ejecutar seguimientos, ni alterar memoria empresarial. Prueba explícita (`operador-tools.test.js`, "ausencia de escritura"): les paso un cliente Supabase simulado cuyos métodos `insert`/`update`/`upsert`/`delete` son espías, corro las 6, y confirmo que ninguno se llamó jamás.

## 4. Calidad de respuestas — distinguir hecho confirmado de interpretación

Agregué `instruccionesAdicionales` como parámetro **opcional y aditivo** a `operador-engine.js::preguntar()` — nunca toca `SYSTEM_PROMPT` (compartido con `/api/operador/preguntar` del tenant, que debía quedar intacto). Solo la ruta nueva de Panel Maestro pasa esta instrucción extra:

> *"Cuando reportes resultados de las herramientas de análisis empresarial... distingue siempre: (1) datos confirmados — cita la referencia/recurso cuando la tengas; (2) tu interpretación o prioridad sugerida — nunca la presentes como un hecho ya registrado; (3) si una herramienta no devolvió resultados, dilo explícitamente."*

Cada resultado de las 6 reglas ya trae un campo `recurso` real (ej. `/proyectos/123`, `/tickets/45`) — esa es la referencia al registro real que puede citarse.

## 5. Archivos modificados

| Archivo | Cambio |
|---|---|
| `modules/operador-tools.js` | +6 funciones wrapper, +6 entradas en `CATALOGO_TOOLS`/`IMPLEMENTACIONES`, `TOOLS_CONSULTA_EMPRESARIAL` ahora 14 nombres, +require de `dashboard-engine.js` (sin modificarlo). |
| `modules/operador-engine.js` | +parámetro opcional `instruccionesAdicionales` (retrocompatible). |
| `server.js` | La ruta `/api/admin/operador/consultar-empresa` (Fase 1) ahora pasa `instruccionesAdicionales`; `TOOLS_CONSULTA_EMPRESARIAL` ya trae las 14 automáticamente (misma importación de antes). **Ninguna otra ruta se tocó.** |
| `__tests__/operador-tools.test.js` | +20 pruebas nuevas. |
| `__tests__/operador-engine.test.js` | +2 pruebas de `instruccionesAdicionales`. |

`modules/dashboard-engine.js` **no se modificó** — se importó `REGLA_TIPOS` tal cual.

## 6. Resultados de pruebas

123/123 suites, 2442/2442 tests (22 nuevas). `vite build` limpio.

Cobertura exacta de tu lista:

| Caso pedido | Resultado |
|---|---|
| Consultas individuales para Nort Energy | ✅ |
| Consultas individuales para Total Racks | ✅ |
| Empresas sin información | ✅ (arreglo vacío, nunca inventa) |
| Empresas con datos incompletos | ✅ (`garantiasAbiertasTool`, datos parciales se propagan tal cual) |
| Intentos de acceder a otra empresa | ✅ ("company_id nunca puede venir de los argumentos del modelo") |
| Prompt injection | ✅ (`ejecutarTool()`, argumento `company_id` del modelo se ignora) |
| Consultas concurrentes | ✅ (`Promise.all` con 2 empresas distintas, sin mezcla) |
| Herramientas no autorizadas | ✅ (heredado de Fase 1: BMC/KCE siguen bloqueadas, ninguna de las 6 nuevas se agregó ahí) |
| Ausencia de modificaciones en base de datos | ✅ (espías en insert/update/upsert/delete, nunca llamados) |

Todas las pruebas usan Supabase **simulado** (mocks) — cero datos productivos tocados para probar, tal como pediste.

## 7. Riesgos pendientes

- Los mismos de la Fase 1 (sin RLS en toda la plataforma, autorización binaria de Super Admin) — nada nuevo que esta fase agregue, porque reusa exactamente el mismo mecanismo de alcance.
- `severidad` quedó fija por herramienta (no configurable por el modelo) — decisión deliberada para evitar que el modelo invente una etiqueta sin sentido de negocio; si prefieres que sea configurable, es un cambio menor.
- Sigue pendiente la validación en navegador real (ninguna fase la ha tenido todavía).

## 8. Checklist de despliegue (preparado, NO ejecutado)

1. `git push` (3 commits de esta sesión relacionados a TARA AI: Fase 1 + esta Fase 2, más los docs).
2. Confirmar que Render completa el deploy (`/health` 200).
3. Confirmar que `/api/admin/operador/consultar-empresa` sigue respondiendo (401 sin sesión → luego probarlo con sesión real).
4. Validación visual real en Panel Maestro: seleccionar Nort Energy, preguntar "¿qué necesita mi atención hoy?", confirmar que la respuesta cita referencias reales y no mezcla con otra empresa.
5. Revisar costo real vía `ia_consumo_logs` tras las primeras consultas reales (ya instrumentado, `registrarConsumo` sigue llamándose igual).

No autorizado para ejecutar todavía — a la espera de que confirmes que quieres desplegar Fase 1+2 juntas, como mencionaste que querías revisar primero.

---

Sin push, sin despliegue.
