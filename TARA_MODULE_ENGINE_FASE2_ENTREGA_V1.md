# TARA Module Engine — Fase 2 (piloto), entrega

**Fecha:** 2026-10-17
**Estado:** piloto en modo observación implementado y validado contra Supabase real. Sin bloqueo activo, sin push todavía.

---

## 1. Matriz propuesta de módulos por plan

Antes de proponer valores, comparé contra `planes.perks`/`planes.limites` reales y las 2 suscripciones activas que existen hoy (Nort Energy y Total Racks, **ambas en Professional** — ninguna empresa real está en Launch, Unlimited ni Enterprise todavía).

**Hallazgo que debes resolver antes de aplicar cualquier matriz:** tu mensaje propone *"Professional incorporará herramientas operativas"* (sugiriendo un conjunto intermedio) y *"Unlimited tendrá acceso ampliado"* — pero Nort Energy, en Professional, **ya usa activamente las 8 herramientas operativas completas** (Inventario, Compras, Garantías, Mantenimiento, Trámites CFE, Tickets, Proyectos, Cobranza vía integrado). Si la matriz de Professional fuera más angosta que eso, estaría restringiendo retroactivamente a tu único cliente real de ese plan — lo cual contradice tu propia condición de "no modificar... suscripciones existentes".

También encontré 2 inconsistencias en el texto comercial ya existente (`planes.perks`), para tu conocimiento, no las cambié:
- **Launch** dice *"Acceso completo a Professional"* en sus propios perks — sugiere que Launch es un trial temporal de Professional, no un plan restringido en funciones.
- **Professional** y **Unlimited** mencionan *"Reportes"*/*"Reportes ejecutivos"* como beneficio — ese módulo no existe todavía (confirmado en auditorías previas).

**Propuesta, con esos hechos ya incorporados** (no aplicada a `planes.limites` todavía — es para tu revisión):

| Plan | Módulos propuestos | Diferenciador real (ya existe en `limites`) |
|---|---|---|
| Launch | crm, cotizaciones, agenda, configuracion | Igual que Professional en funciones (coincide con su propio texto de perks) — se diferencia por `max_sucursales`/duración de prueba, no por módulos |
| Professional | Los 13 completos (coincide con el uso real de Nort Energy/Total Racks) | `api:false`, `webhooks:false`, `max_sucursales:2` — ya existente |
| Unlimited | Los 13 completos | `api:true`, `webhooks:true`, `max_sucursales:null` (ilimitadas) — ya existente |
| Enterprise | Los 13 completos + lo que se negocie por contrato | Personalizado, sin límites — ya existente |

En otras palabras: con la evidencia real, **la diferenciación entre planes ya vive en `limites` (sucursales, API, webhooks), no en qué módulos se pueden usar** — los 13 módulos del catálogo son, hoy, parte de la operación básica de cualquier empresa de este giro. Si quieres que SÍ exista una diferenciación real por módulo (ej. que Launch no incluya Inventario), dime explícitamente cuáles — no lo voy a inferir ni a aplicar solo.

---

## 2. Resultado del middleware en modo observación

Validado en vivo contra Supabase real (no un mock): simulé una petición con Tickets marcado deliberadamente `'inactivo'` para Nort Energy — `next()` sí se llamó (la petición pasó igual) y quedó registrada la fila:
```json
{ "modulo_codigo": "tickets", "rol": "ventas", "estado_modulo_encontrado": "inactivo", "hubiera_bloqueado": true }
```
Estado de prueba revertido a `'activo'` (el real) y la fila de prueba borrada después. **Ningún dato de producción quedó alterado.**

## 3. Módulo seleccionado para el piloto: Tickets

Justificación con evidencia, no intuición: 0 dependencias en `modulos_catalogo` (ningún otro módulo se apoya en él), 6 endpoints (el bloque más pequeño del catálogo), **0 tickets reales hoy** para Nort Energy, y no es financiero ni afecta inventario — el menor radio de impacto posible.

## 4. Pruebas de aislamiento multiempresa

Test dedicado: la observación siempre queda etiquetada con el `company_id` real del usuario autenticado — nunca se mezcla ni se infiere de otra empresa (`__tests__/modulo-engine.test.js`).

## 5. Compatibilidad con módulos integrados

Confirmado con test explícito: un módulo en estado `'integrado'` (como Instalaciones/Cobranza) **nunca** se registra como `hubiera_bloqueado: true` — el modo observación respeta la distinción de 3 estados de la Fase 0-1 revisada.

## 6. Diseño de integración con TARA AI

`resolverModulosAutorizadosParaIA()` — implementada y probada (3 tests), **NO conectada** a `Orchestrator` ni a `modules/operador-engine.js` todavía. Reutiliza `modulosVisibles()` (ya existente, sin cambios) y resta solo lo marcado `'inactivo'` — un módulo `'integrado'` o sin fila nunca se excluye. Lista para conectarse en una fase posterior, con su propia autorización, en los 2 puntos ya diseñados en `TARA_AI_ENGINE_ARCHITECTURE_V1.md` sección 5 (prompt + revalidación en ActionRunner).

## 7. Riesgos detectados

- La inconsistencia de "Professional vs. Unlimited" en tu propuesta de matriz original vs. el uso real de tus 2 clientes activos — requiere tu decisión antes de que cualquier matriz se aplique a `planes.limites`.
- Los 2 perks ya existentes que mencionan funciones inexistentes (Launch "acceso completo a Professional", Reportes) — cosmético, pero visible comercialmente si alguien lee el detalle del plan.
- Ninguno nuevo de seguridad/aislamiento — confirmado con pruebas.

## 8. Pasos necesarios para activar el enforcement real (futuro, no en esta entrega)

1. Revisar los resultados reales de `modulo_enforcement_observaciones` durante un periodo de tráfico real (hoy: 0 filas, porque el piloto no se ha desplegado a producción todavía).
2. Decidir la matriz de planes↔módulos definitiva (sección 1).
3. Cambiar `requireModuloActivo()` de modo observación a bloqueo real — requiere tu autorización explícita y separada, nunca un cambio de flag silencioso.
4. Expandir el piloto a más módulos, uno a la vez, con el mismo criterio de riesgo creciente.

---

Todo lo anterior está implementado, probado (2380/2380) y validado en vivo — **sin desplegar** (commits `c9ea301`/`48f49d5` siguen solo locales, a la espera de tu confirmación de push dado el aviso de la sección de checklist).
