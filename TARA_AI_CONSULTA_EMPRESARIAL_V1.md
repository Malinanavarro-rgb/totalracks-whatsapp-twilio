# TARA AI — consulta y análisis empresarial en modo lectura (diagnóstico + propuesta)

**Fecha:** 2026-10-16
**Estado:** diagnóstico + propuesta técnica — **cero código escrito.** Responde a tu caso de uso: *"TARA, revisa Nort Energy y dime qué clientes necesitan seguimiento, qué cotizaciones siguen pendientes y qué instalaciones requieren atención."*

---

## 1. Lo que ya existe — no se reconstruye

Dos piezas maduras ya resuelven el 80% de esto:

- **Modo Operador** (`modules/operador-engine.js`/`modules/operador-tools.js`): motor de tool-calling real (hasta 5 iteraciones), 18 herramientas ya registradas, ya en producción vía `/api/operador/preguntar` — y ya tiene una regla de seguridad "no negociable" explícita en el código: **el alcance (qué empresa puede ver) siempre lo calcula el servidor desde la sesión autenticada, nunca el modelo ni el body de la petición.**
- **Las funciones exactas que pide tu ejemplo ya existen y son reusables**, en `modules/dashboard-engine.js` — no hay que calcular nada nuevo:
  - "clientes que necesitan seguimiento" → `conteo_oportunidades_seguimiento_vencido()` / `oportunidad_seguimiento_vencido()`
  - "instalaciones que requieren atención" → `conteo_instalaciones_atrasadas()` / `instalacion_atrasada()`
  - "cotizaciones pendientes" → vive en el pipeline (`resumen_pipeline`, ya es una tool de Modo Operador)
  - además ya hay funciones listas para trámites CFE, garantías y tickets (`tramite_cfe_sin_actualizacion`, `garantia_reclamacion_abierta`, `ticket_pendiente`).
- **BMC/KCE** ya son 100% por-empresa, con ciclo de vida `propuesto→confirmado/rechazado/obsoleto` enforced por constraints de base de datos, no solo por código.

## 2. El hueco real — por qué "revisa Nort Energy" no funciona hoy

Hay exactamente 2 rutas fijas a Modo Operador, cada una con un alcance hardcodeado, nunca elegible:

| Ruta | Alcance | Qué puede ver |
|---|---|---|
| `/api/operador/preguntar` (tenant) | `{ nivel: 'empresa', company_id: req.usuario.company_id }` | Solo la empresa de quien pregunta — nunca otra |
| `/api/admin/operador/preguntar` (Panel Maestro) | `{ nivel: 'plataforma' }` — **sin `company_id`** | Las tools genéricas de lectura devuelven filas de **todas las empresas mezcladas**; las 12 tools de catálogo/FAQ/BMC/KCE ni siquiera corren (exigen `nivel==='empresa'`, y plataforma nunca lo es) |

Es decir: hoy, ni siquiera desde el Panel Maestro (Super Admin) se puede pedir "analiza específicamente Nort Energy" — el motor no tiene manera de apuntar a una sola empresa elegida en el momento.

**Y las funciones de `dashboard-engine.js` que sí calculan exactamente lo que pides no están conectadas a Modo Operador** — viven solo del lado del dashboard visual, nunca se expusieron como tools de OpenAI.

## 3. El riesgo que hay que diseñar con cuidado

No hay red de seguridad en la base de datos: **RLS está deshabilitado en el 100% de las tablas de la plataforma** (confirmado: 42 migraciones lo deshabilitan, 0 lo habilitan). El aislamiento multiempresa depende enteramente de que el servidor calcule bien el `company_id` antes de tocar cualquier tabla — nunca de una política de Postgres.

Esto es seguro hoy porque el alcance siempre lo arma `server.js` desde la sesión, nunca el modelo. **La única forma incorrecta de resolver tu caso de uso sería agregar una tool nueva donde el LLM reciba "Nort Energy" como texto y él mismo resuelva el `company_id` dentro de la tool call** — eso rompería la regla no negociable ya documentada en el código, y al no haber RLS de respaldo, cualquier error de resolución (ambigüedad de nombre, alucinación) filtraría datos de una empresa a otra sin ningún freno.

**La forma correcta**, que preserva el diseño actual intacto: el nombre de empresa se resuelve y se fija **antes** de llamar al motor — en `server.js`, nunca dentro de una tool, nunca por el modelo.

## 4. Propuesta (sin implementar)

### 4.1 Selector de empresa en Panel Maestro (no texto libre)
Un `<select>` con las empresas reales (ya existe el listado en `Organizaciones.jsx`/`adminApi.organizaciones()`) antes de la pregunta — el Super Admin elige la empresa de una lista validada, nunca la escribe dentro del mensaje a la IA. El backend resuelve ese `company_id` ANTES de construir el alcance:

```js
// server.js — /api/admin/operador/preguntar, con companyId opcional en el body
const alcance = companyId
  ? { nivel: 'empresa', company_id: await validarCompanyIdReal(companyId) }  // valida contra `companies`, nunca confía ciego
  : { nivel: 'plataforma' };
```

Esto NO es una tool nueva ni un cambio de `operador-tools.js` — es un cambio de 3-4 líneas en el handler de la ruta, reusando el motor tal cual.

### 4.2 Conectar las funciones de `dashboard-engine.js` como tools nuevas de solo lectura
Envolver (no reescribir) un subconjunto reusando las funciones puras existentes:
- `clientes_necesitan_seguimiento` → `oportunidad_seguimiento_vencido()`
- `instalaciones_requieren_atencion` → `instalacion_atrasada()`
- `cobranza_pendiente` → `cobranza_con_saldo()`
- `tramites_cfe_pendientes` → `tramite_cfe_sin_actualizacion()`
- `garantias_abiertas` → `garantia_reclamacion_abierta()`
- `tickets_pendientes` → `ticket_pendiente()`

Mismo patrón exacto que las 18 tools ya existentes: reciben `(supabase, alcance)`, exigen `alcance.nivel === 'empresa'` vía `_exigirAlcanceEmpresa()` (ya existe, se reusa sin tocar), nunca aceptan `company_id` como argumento del modelo. Cero lógica nueva de negocio — son las mismas funciones que ya alimentan el dashboard visual.

### 4.3 El `usuario` que falta en la ruta admin
Encontré que `/api/admin/operador/preguntar` hoy ni siquiera le pasa `usuario` al motor — así que las tools gerenciales (BMC/KCE) tampoco podrían correr para un Super Admin aunque se arreglara el alcance. Hay que decidir contigo qué `usuario`/rol usar ahí (ej. tratar a cualquier Super Admin autenticado como equivalente a `rol: 'owner'` para efectos de ese gate) antes de implementar.

### 4.4 Explícitamente NO en esta fase
- Ninguna tool ejecuta acciones — todas las nuevas son de solo lectura, igual que pediste.
- No se toca `/api/operador/preguntar` (tenant) — sigue exactamente igual, cada empresa solo ve lo suyo.
- No se resuelve nombre de empresa dentro de una tool ni por el modelo — siempre por selector + validación server-side.
- No se modifica BMC/KCE, Orchestrator, ni ningún flujo conversacional de clientes.

## 5. Riesgos pendientes de tu decisión

- **Ausencia de RLS es un riesgo estructural de toda la plataforma**, no solo de esta propuesta — lo señalo porque esta fase amplía la superficie de Modo Operador para Super Admin, y vale la pena que sepas que el único freno real sigue siendo disciplina de código, no la base de datos.
- Qué `usuario`/rol asignarle al Super Admin para el gate `TOOLS_SOLO_GERENCIAL` (punto 4.3).
- Si quieres que el selector de empresa también quede disponible para algún rol intermedio (ej. un futuro "Account Manager" que vea varias empresas pero no todas) — hoy la propuesta es binaria: una empresa específica, o toda la plataforma mezclada (Super Admin).

---

Quedo a la espera de tu autorización antes de implementar cualquier parte de esta propuesta.
