# TARA AI — Consulta Empresarial, Fase 1: contexto empresarial seguro en Panel Maestro

**Fecha:** 2026-10-16
**Estado:** implementado y probado localmente. **Sin push, sin despliegue a producción.**

---

## 1. Archivos modificados/nuevos

| Archivo | Cambio |
|---|---|
| `modules/operador-contexto-empresarial.js` | Nuevo — resuelve y valida el `company_id` (existencia + autorización), server-side, antes de tocar el motor. |
| `modules/operador-tools.js` | +`TOOLS_CONSULTA_EMPRESARIAL` — lista blanca explícita de 8 tools auditadas. |
| `modules/operador-engine.js` | `preguntar()` acepta `herramientasPermitidas` opcional (retrocompatible: sin él, comportamiento idéntico a antes). Filtra el catálogo que ve el modelo Y rechaza en el dispatcher cualquier tool fuera de la lista. |
| `server.js` | +`GET /api/admin/empresas-consultables`, +`POST /api/admin/operador/consultar-empresa`. **`POST /api/admin/operador/preguntar` no se tocó.** |
| `frontend/src/admin/adminApi.js` | +`empresasConsultables()`, `preguntarOperadorEmpresa()`. |
| `frontend/src/admin/pages/TaraOperador.jsx` | +Selector de empresa. Cambiar de empresa limpia el historial — nunca se reusa la conversación anterior. |
| `__tests__/operador-contexto-empresarial.test.js` | Nuevo — 11 pruebas. |
| `__tests__/operador-engine.test.js` | +6 pruebas de `herramientasPermitidas`/aislamiento/concurrencia. |
| `__tests__/operador-tools.test.js` | +3 pruebas de invariantes de `TOOLS_CONSULTA_EMPRESARIAL`. |

## 2. Arquitectura del contexto empresarial

```
Super Admin elige "Nort Energy" en el <select>
        │
        ▼
POST /api/admin/operador/consultar-empresa { companyId, pregunta }
        │
        ▼
resolverContextoEmpresarial(supabase, companyId)   ← AQUÍ, y solo aquí, se valida
   1. ¿companyId es string no vacío?           no → 400
   2. ¿existe en `companies`?                  no → 404
   3. ¿estaAutorizada() (estado === 'activo')? no → 403
        │ sí
        ▼
alcance = { nivel: 'empresa', company_id: <validado>, organization_id: <validado> }
        │
        ▼
preguntarOperador({ ..., alcance, herramientasPermitidas: TOOLS_CONSULTA_EMPRESARIAL })
        │
        ▼
El modelo solo VE 8 tools en su schema — nunca ve company_id como parámetro
que pueda rellenar. Cada tool_call pasa, además, por un segundo chequeo en
el dispatcher: si el nombre no está en la lista blanca, se rechaza sin
ejecutar — defensa en profundidad, no confía en que "el modelo no lo vio".
```

**El `company_id` nunca se construye a partir de la pregunta ni de nada que decida el modelo** — se resuelve una sola vez, antes de la primera llamada a OpenAI, y ese mismo objeto `alcance` se reusa sin cambios en las hasta 5 iteraciones de tool-calling de esa petición.

## 3. Herramientas habilitadas y bloqueadas

**Habilitadas (8, auditadas una por una):** `tareas_abiertas`, `proyectos_en_riesgo`, `decisiones_recientes`, `buscar_documentos`, `resumen_pipeline`, `buscar_cliente`, `consultar_catalogo_tecnico`, `consultar_faq_solar` — todas de solo lectura, todas ya filtran por `company_id` vía el mismo mecanismo que usa la ruta de tenant (`_companyIdsDeAlcance`/`_exigirAlcanceEmpresa`, sin cambios).

**Bloqueadas (10, el set completo de `TOOLS_SOLO_GERENCIAL`):** las 5 de Business Memory Core (`registrar_aprendizaje_negocio`, `listar_aprendizajes_pendientes`, `confirmar_aprendizaje`, `rechazar_aprendizaje`, `marcar_aprendizaje_obsoleto`) y las 5 de KCE (`ejecutar_kce`, `listar_alertas_kce`, `aplicar_refuerzo_kce`, `fusionar_aprendizajes`, `resolver_alerta_kce`) — ninguna crea, confirma, rechaza ni modifica memoria desde esta ruta, tal como pediste. Quedan fuera **las 10, sin excepción** — incluí las 2 que solo "listan" (no escriben) porque viven agrupadas en el mismo set de código ya existente (`TOOLS_SOLO_GERENCIAL`) y la intención de tu autorización era clara: nada de BMC/KCE todavía.

La lista blanca es explícita (no "todo menos gerencial") — si mañana se agrega una tool nueva al catálogo, NO queda habilitada aquí automáticamente; hay que decidirlo a mano, uno por uno.

## 4. Identidad de Super Admin — sin simular ser empleado

Esta ruta **nunca pasa `usuario`** al motor. Como ninguna tool gerencial-only es alcanzable desde la lista blanca, el gate `esGerencial()` nunca se evalúa para una tool que realmente se ejecute — así que no hizo falta inventar un rol ficticio ni tocar `roles_permisos`. El día que se habilite alguna tool de BMC/KCE para Super Admin (fase futura, no autorizada todavía), ahí sí habrá que diseñar explícitamente qué identidad usar — lo dejo pendiente, documentado, no resuelto a medias.

## 5. Resultados de pruebas

123/123 suites, 2424/2424 tests (20 nuevas). `vite build` limpio.

Cobertura exacta de tu lista de pruebas obligatorias:

| Caso pedido | Dónde se prueba | Resultado |
|---|---|---|
| Selección válida de empresa | `operador-contexto-empresarial.test.js` | ✅ |
| Empresa inexistente | ídem (404) | ✅ |
| Empresa no autorizada | ídem (403, empresa suspendida) | ✅ |
| Petición sin empresa seleccionada | ídem (400, nunca consulta la DB) | ✅ |
| Intento de cambiar de empresa vía instrucciones al modelo | `operador-engine.test.js`, "AISLAMIENTO" | ✅ — arquitectónicamente imposible, no solo "no pasó en la prueba" |
| Cambio de empresa entre 2 consultas consecutivas | ídem | ✅ |
| Conversaciones concurrentes de empresas distintas | ídem (`Promise.all`) | ✅ |
| Acceso a herramientas que no respeten el alcance | ídem, "CRÍTICO: un tool_call fuera de la lista blanca..." | ✅ — rechazado en el dispatcher, nunca ejecuta |
| Rutas empresariales existentes mantienen su comportamiento | regresión completa (123/123 suites) + `/api/admin/operador/preguntar` sin tocar | ✅ |

## 6. Riesgos pendientes

- **No hay RLS** (ya documentado en el diagnóstico previo) — este diseño sigue siendo seguro porque el alcance lo calcula siempre el servidor, nunca el modelo, pero sigue sin existir una segunda capa de defensa en la base de datos para TODA la plataforma, no solo esta ruta.
- **Autorización hoy es binaria**: cualquier Super Admin autenticado puede consultar cualquier empresa activa — no existe (ni se pidió) un ACL granular admin→empresa. `estaAutorizada()` es el punto de extensión si algún día se necesita.
- **Decisión de producto sin confirmar contigo**: una empresa suspendida queda 403 (no consultable) en esta fase — lo elegí como el comportamiento conservador por default; si prefieres que Super Admin sí pueda consultar empresas suspendidas (ej. para dar soporte de cobranza), es un cambio de una línea en `estaAutorizada()`.
- **Validación de navegador real**: igual que en la entrega anterior, no tengo acceso a un navegador en este entorno — no declaro la UI del selector probada con clic real.

## 7. Plan para conectar las seis herramientas de `dashboard-engine.js` (sin implementar todavía)

1. Envolver cada función pura (`oportunidad_seguimiento_vencido`, `instalacion_atrasada`, `cobranza_con_saldo`, `tramite_cfe_sin_actualizacion`, `garantia_reclamacion_abierta`, `ticket_pendiente`) como una nueva entrada de `CATALOGO_TOOLS`/`IMPLEMENTACIONES` en `operador-tools.js` — mismo patrón exacto que las 8 ya auditadas, reusando las funciones tal cual, sin reescribir lógica de negocio.
2. Agregar cada nombre nuevo a `TOOLS_CONSULTA_EMPRESARIAL` solo después de confirmar, una por una, que ya filtra por `company_id` correctamente (todas lo hacen hoy, reciben `company_id` como segundo parámetro posicional).
3. Ninguna de las 6 depende de la config de industria (`plantillas_industria.dashboard_kpis_seed`) para ejecutar — se pueden exponer directo, sin esa capa intermedia.
4. Pruebas: mismo patrón que las 8 actuales (mock de Supabase + verificación de que el alcance se respeta).
5. Esto es trabajo nuevo, acotado, de bajo riesgo — no toca nada de lo construido en esta Fase 1.

---

Sin push, sin despliegue — a la espera de tu autorización para ambos.
