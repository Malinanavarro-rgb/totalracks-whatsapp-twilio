# NORT_ENERGY_P1_ENTREGA.md
### Corrección de los 4 P1 encontrados en NORT_ENERGY_AUDIT_V1.md
**Fecha:** 2026-09-29 · Complementa la auditoría — no la reemplaza. Aquí solo se documenta lo que cambió en esta pasada (P1.1-P1.4) y el resultado de volver a correr el flujo end-to-end completo después de los 4 cambios.

---

## 1. Qué cambió en cada P1

| # | Problema (auditoría) | Solución | Commit |
|---|---|---|---|
| P1.1 | `registrarAbono` permitía sobrepago bajo carrera (lectura y escritura en dos pasos, sin lock) | RPC atómico `registrar_abono_cliente()` con `SELECT...FOR UPDATE` sobre `pagos_cliente` — mismo patrón que inventario | `5a8cd51` |
| P1.2 | `reservarMaterialInstalacion`/`consumirMaterialInstalacion` existían en el backend, sin ningún botón real que los llamara | Nuevo componente `MaterialInstalacion` dentro de cada instalación en Proyecto 360° — reserva, consumo, liberación, todo contra el backend ya existente | `7d82557` |
| P1.3 | El dashboard no mostraba nada de proyectos/cobranza/instalaciones/CFE/postventa | 13 KPIs operativos + sección "Requiere tu atención" (5 reglas, una tarjeta por registro real) — mundo COMERCIAL intacto, mundo OPERACIÓN nuevo y separado | `ed222aa` |
| P1.4 | `obtenerProyectoDeCliente` colapsaba a un solo proyecto (el más reciente) | `listarProyectosDeCliente` (todos) + `obtenerProyectoDelCliente` (valida cliente_id) — los 4 consumidores reales actualizados, portal rediseñado para múltiples sistemas | `4dbfbbe` |

---

## 2. Migraciones realizadas

**Una sola migración nueva esta ronda:**

- `migrations/123_abono_atomico.sql` — función `registrar_abono_cliente()`. Ejecutada y verificada en producción (P1.1).

P1.2, P1.3 y P1.4 **no requirieron ninguna migración** — se apoyan 100% en tablas/columnas que ya existían (`inventario_movimientos`, `dashboard_kpis_seed` vía `nav_labels` jsonb, `proyectos`/`instalaciones` ya existentes).

---

## 3. Endpoints modificados

| Endpoint | Cambio |
|---|---|
| `POST /api/proyectos/:id/cobranza/abonos` | Sin cambio de contrato — internamente ahora usa el RPC atómico |
| `POST /api/instalaciones/:id/inventario/reservar` | Sin cambio — ahora tiene un consumidor real en el frontend |
| `POST /api/instalaciones/:id/inventario/consumir` | Sin cambio — ídem |
| `GET /api/dashboard` | Respuesta extendida: `kpisOperativos` y `atencion` (arreglos nuevos, opcionales — una empresa sin configurarlos no ve cambio) |
| `GET /api/crm/clientes/:id/proyecto` → **`GET /api/crm/clientes/:id/proyectos`** | Renombrado, ahora devuelve un arreglo |
| `GET /api/portal/mi-proyecto` → **`GET /api/portal/mis-proyectos`** | Renombrado, devuelve la lista completa |
| `GET /api/portal/mis-equipos` → **`GET /api/portal/proyectos/:proyectoId/equipos`** | Ahora parametrizado por proyecto, con verificación de propiedad |
| `GET /api/portal/mi-cobranza` → **`GET /api/portal/proyectos/:proyectoId/cobranza`** | Ídem |
| *(nuevo)* `GET /api/portal/proyectos/:proyectoId` | Detalle de un proyecto específico del portal |

---

## 4. Componentes modificados

`modules/cobranza.js`, `modules/inventario.js` (sin cambios de código, solo nuevo consumidor), `modules/dashboard-engine.js`, `modules/proyectos.js`, `server.js`, `frontend/src/pages/ProyectoDetalle.jsx`, `frontend/src/pages/Operaciones.jsx`, `frontend/src/pages/CrmClienteDetalle.jsx`, `frontend/src/lib/api.js`, `portal-demo/index.html`, `scripts/nort-energy-dashboard-operativo.js` (nuevo).

---

## 5. Tests nuevos

| Archivo | Tests nuevos |
|---|---|
| `__tests__/cobranza.test.js` | 6 reescritos (mecanismo RPC) |
| `__tests__/dashboard-engine.test.js` | 19 nuevos |
| `__tests__/proyectos.test.js` | Sección completa reescrita (0/1/2+ proyectos, `obtenerProyectoDelCliente`) |
| `__tests__/aislamiento-multiempresa-2a.test.js` | 2 actualizados/nuevos |
| `__tests__/aislamiento-multiempresa-portal-cliente.test.js` | 3 nuevos (aislamiento ENTRE CLIENTES de la misma empresa — la superficie genuinamente nueva de P1.4) |

## 6. Resultado total de tests

**113/113 suites, 2273/2273 tests — 0 fallos.**

---

## 7. Resultado de la prueba de concurrencia de cobranza (obligatoria)

Contra Postgres real (no simulable con mocks):

- Saldo $10,000, dos abonos simultáneos de $7,000 (`Promise.allSettled`) → **1 exitoso, 1 rechazado (409)**, `total_pagado` final = **$7,000** (nunca $14,000).
- Abono exacto al saldo restante → acepta, liquida.
- Abono superior al saldo → rechaza (409).
- Doble submit simultáneo del saldo exacto restante → solo 1 de 2 pasa, liquida en $10,000 exactos.
- Retry tras saldo en $0 → rechaza.
- Mismo proyecto "desde dos sesiones" → cubierto por la misma prueba de concurrencia (2 llamadas paralelas = 2 sesiones).
- Proyecto de otra empresa real (Total Racks) sobre un proyecto de Nort Energy → 404, aislamiento intacto.

## 8. Prueba instalación → reserva → consumo → inventario

Contra Supabase real: instalación real creada, existencia inicial 10 paneles → reserva de 6 (disponible: 4) → intento de reservar 5 más rechazado ("Disponible insuficiente") → consumo de los 6 reservados genera el par liberación+salida esperado → saldo final correcto (existencia 4, reservado 0, disponible 4) → `VER MATERIAL` (ledger filtrado por proyecto) muestra los 3 movimientos en orden correcto.

## 9. Lista exacta de KPIs operativos nuevos

`conteo_proyectos_activos`, `conteo_instalaciones_atrasadas` (proyectos/instalaciones atrasados), `suma_saldo_pendiente_cobranza`, `conteo_proyectos_con_saldo`, `conteo_instalaciones_proximas` (×2: 7 y 30 días), `conteo_tramites_cfe_abiertos`, `conteo_tramites_cfe_sin_actualizacion`, `conteo_garantias_vigentes`, `conteo_mantenimientos_proximos`, `conteo_mantenimientos_vencidos`, `conteo_tickets_abiertos`, `conteo_tickets_urgentes` — **13 KPIs**. Más 5 reglas de "Requiere tu atención": `instalacion_atrasada`, `cobranza_con_saldo`, `tramite_cfe_sin_actualizacion`, `garantia_reclamacion_abierta`, `ticket_pendiente`.

**Deliberadamente omitido:** KPI de inventario crítico/faltante — no existe columna de stock mínimo en `productos`; agregarlo habría sido inventar una métrica, justo lo que se pidió no hacer.

## 10. Cliente con 2+ proyectos — funcionando

Validado en vivo: cliente real con 2 proyectos (Casa / Negocio, distintas ubicaciones) → `listarProyectosDeCliente` los devuelve ambos, cada uno con su propia ubicación intacta, nunca mezclados. `CrmClienteDetalle.jsx` muestra ambos en la nueva sección "Proyectos / Sistemas", cada uno abre su propio Proyecto 360°.

## 11. Portal cliente con 2+ proyectos — funcionando

Sesión OTP real creada para el mismo cliente de prueba → `/api/portal/mis-proyectos` devolvió los 2 sistemas → el detalle de CADA proyecto (equipos, cobranza) se resolvió correctamente por separado, sin mezclarse. `portal-demo/index.html` muestra un selector de "mis sistemas" cuando hay más de uno.

## 12. Pruebas de aislamiento

- **Entre empresas** (ya existente, reverificado): intacto en los 4 P1.
- **Entre clientes de la MISMA empresa** (superficie NUEVA de P1.4): cliente real 214 no puede ver el proyecto de otro cliente real (161) aunque cambie el `:proyectoId` en la URL del portal → `null`/404. Probado en unit tests y en vivo.
- **Cobranza bajo concurrencia**: cubierta arriba (sección 7).

## 13. Commits

```
bf2f17f docs: auditoría integral de Nort Energy como producto terminado (V1)
5a8cd51 fix(cobranza): make customer payments concurrency-safe
7d82557 feat(instalaciones): connect inventory reservation and consumption
ed222aa feat(dashboard): add operational Nort Energy KPIs
4dbfbbe fix(clientes): support multiple projects per customer
```

## 14. Bugs nuevos encontrados (y corregidos antes de producción)

1. `conteo_instalaciones_proximas` llamaba `.toISOString()` sobre un valor que `_enHoras()` ya devolvía como string — encontrado por el test, corregido antes de comitear.
2. `conteo_tramites_cfe_sin_actualizacion`/`tramite_cfe_sin_actualizacion`/`conteo_garantias_vigentes` no recibían el parámetro `ahora` y usaban el `new Date()` real por default — no determinista, hubiera dado resultados distintos según el momento exacto en que corre el dashboard. Corregido para siempre recibir `ahora` explícito.

Ninguno de los dos llegó a producción — ambos se encontraron con los tests nuevos de esta misma ronda.

---

## 15. Recorrido end-to-end — vuelto a correr después de los 4 P1

| Paso | Antes (auditoría) | Ahora |
|---|---|---|
| Lead → WhatsApp → CRM → Calificación → Cliente → Oportunidad | Completo | Sin cambio |
| Recibo CFE / datos energéticos | Parcial | Sin cambio (mismo caveat: el "levantamiento técnico" SÍ tiene formulario real en `CrmClienteDetalle.jsx` tab "Proyecto solar" — corrección a la auditoría original, que lo daba por no confirmado) |
| Ingeniería | Parcial / riesgo | Sin cambio — sigue sin confirmar si el motor de ingeniería LEE esos datos técnicos del inmueble al calcular |
| Cotización → PDF → Seguimiento → Aceptación | Completo | Sin cambio |
| **Proyecto** | Completo | Completo — **reforzado**: ahora soporta correctamente N proyectos por cliente |
| **Cobranza / Anticipo** | Parcial / riesgo (race condition) | **Completo** — race condition corregida y probada bajo concurrencia real |
| **Material / Reserva de inventario** | Existía pero desconectado | **Completo** — conectado end-to-end, probado en vivo |
| Instalación → Evidencias → Equipos | Completo | Sin cambio |
| Trámite CFE | Completo | Sin cambio (ahora también visible desde el dashboard) |
| Liquidación | Completo (derivado) | Sin cambio |
| Entrega | Parcial / riesgo (sin gate de cobranza) | **Sin cambio — no era uno de los 4 P1 autorizados esta ronda** |
| Garantía | Parcial (manual, no automática) | **Sin cambio — no era uno de los 4 P1 autorizados esta ronda** |
| Mantenimiento → Ticket/postventa | Completo | Sin cambio (ahora también visibles desde el dashboard) |
| **Portal del cliente** | Completo (alcance limitado a 1 proyecto) | **Completo — reforzado**: ahora soporta correctamente N proyectos, aislamiento entre clientes probado |

### P1 que quedan después de esta ronda

De los 5 P1 originales, **4 quedaron resueltos** (inventario desconectado, race condition de cobranza, dashboard ciego, cliente con un solo proyecto). El único que sigue abierto es el que tú misma pediste NO tocar todavía:

- **Permisos binarios** (gerencial/no-gerencial) en un sistema con 8+ perfiles operativos reales — deliberadamente diferido, no es un olvido.

**Ningún P1 nuevo apareció** como consecuencia de estos 4 cambios. Dos candidatos a P2 quedan sin tocar (por decisión, no por descubrimiento nuevo): "Entrega" sin gate de cobranza, y creación de garantía todavía manual (no automática al registrar el equipo).

---

## 16. Los 5 porcentajes, recalculados

### A. % de cobertura funcional: **92%** *(antes: 90%)*
Recontando los 25 pasos del flujo: 21 ahora "completo" (+2 respecto a la auditoría: material/inventario y cobranza/anticipo), 4 "parcial", 0 "desconectado". `(21 + 4×0.5) / 25 = 92%`.

### B. % de integración end-to-end: **90%** *(antes: 75%)*
Recupera los 10 puntos de inventario (ahora conectado) y 8 de los 10 de dashboard (el dashboard ya ve operación real, pero Proyecto 360° individual todavía NO consolida Documentos/Actividad/Tickets en una sola pantalla — ese hallazgo de la auditoría no se tocó esta ronda, así que el "clic final" para ver todo de un proyecto sigue exigiendo salir a otras pantallas en esos 3 casos). Proyecto 360° incompleto se mantiene como el único descuento real: `100 - 5 (Proyecto 360° incompleto) - 5 (visibilidad del dashboard todavía no cierra el loop hasta el detalle completo) = 90%`.

### C. % de preparación para operación real: **82%** *(antes: 65%, el más bajo de la auditoría — con razón)*
Dos de los tres bloqueos reales identificados ("nadie ve qué está atrasado sin entrar módulo por módulo" y "inventario requiere confiar en un número que nadie actualiza") están resueltos. Sigue faltando: reportes agregados (sin tocar), gate de entrega-antes-de-liquidar (sin tocar), garantía todavía manual (sin tocar), permisos binarios (deliberadamente diferido). Sube de forma importante pero no a la zona alta porque estos 4 pendientes son reales y afectan la operación diaria.

### D. % de seguridad/aislamiento verificado: **96%** *(antes: 95%)*
Sube porque esta ronda agregó y validó en vivo una cobertura MÁS granular que antes no se había probado explícitamente: aislamiento entre CLIENTES de la misma empresa (no solo entre empresas) en el portal, la superficie de ataque genuinamente nueva que introdujo soportar múltiples proyectos. El límite estructural sigue siendo el mismo que ya estaba documentado (RLS deshabilitado, disciplina de código como única barrera) — no es un hallazgo nuevo, así que no baja el número, pero tampoco permite llegar a 100%.

### E. % de experiencia del empleado terminada: **62%** *(antes: 55%)*
Sube de forma moderada: "Requiere tu atención" en el dashboard es, en la práctica, la primera vista real de "mis pendientes de hoy" que existe en todo el sistema — pero beneficia principalmente a Gerencia/Dirección, no a los 7 perfiles operativos restantes (instalador, almacén, CFE, postventa siguen sin menú diferenciado ni pantallas propias optimizadas). Móvil/tablas siguen sin envolver para scroll horizontal — sin tocar esta ronda.

---

## Conclusión concreta

**¿Nort Energy ya puede completar el ciclo comercial → operativo → postventa sin depender de Excel para estos procesos?**

**Para el ciclo transaccional (cotizar → vender → cobrar → instalar → entregar equipos): sí, con evidencia.** Los 4 P1 corregidos esta ronda eran precisamente los que impedían confiar en el sistema como única fuente de verdad para dinero (cobranza) e inventario — ambos ahora están probados bajo concurrencia real, no solo "construidos". Un cliente con múltiples sistemas ya no pierde visibilidad de ninguno.

**Para el ciclo completo de dirección/gerencia (saber qué requiere atención sin recorrer módulo por módulo): parcialmente sí, recién habilitado.** El dashboard operativo es nuevo en esta misma entrega — todavía no ha sido usado en producción real por un ser humano tomando decisiones con él; hoy está probado con datos sintéticos temporales, no con el patrón real de uso diario de Nort Energy (que hoy tiene 0 proyectos reales en el sistema).

**Para la operación diaria de los 8 perfiles no-gerenciales (instalador, almacén, CFE, postventa, etc.): todavía no.** El permiso binario gerencial/no-gerencial sigue siendo la única distinción de acceso, y es exactamente el punto que dejaste para la siguiente autorización, no para esta.

No se implementó el sistema de roles departamentales. Quedo a la espera de tu autorización para continuar.
