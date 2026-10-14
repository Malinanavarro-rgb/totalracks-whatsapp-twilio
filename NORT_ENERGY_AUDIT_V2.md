# Nort Energy — Auditoría V2 (operación real, no teórica)

**Fecha:** 2026-10-14
**Alcance:** auditoría sobre datos reales de producción (Nort Energy, company_id `0affb234-3dc7-431f-862b-3230664962fb`). Cero cambios de código en este documento — es el entregable de Fase 9, tal como se pidió. Nada de lo descrito aquí se ha tocado: ni se borró, ni se reinició, ni se reemplazó dato real por demo.

---

## 0. El hallazgo que explica casi todo lo demás

**Hoy existen 0 proyectos y 0 instalaciones reales en la base de Nort Energy.**

No es un bug de visualización — son ceros reales en las tablas `proyectos` e `instalaciones`. Y la razón es verificable con precisión quirúrgica:

- El único camino en todo el sistema para crear un proyecto es `marcarCotizacionAceptadaYCrearProyecto()` ([modules/proyectos.js:160](modules/proyectos.js#L160)), invocado únicamente desde `POST /api/cotizaciones/:id/marcar-aceptada` ([server.js:2685](server.js#L2685)).
- Ese endpoint SÍ tiene un botón real en el frontend — **"Marcar como aceptada"** ([CotizacionDetalle.jsx:243](frontend/src/pages/CotizacionDetalle.jsx#L243)) — así que no es un caso de "existe pero está desconectado". Es un caso más sutil: **existe, está conectado, pero nunca se ha usado.**
- De las 16 cotizaciones reales, 14 nunca pasaron por "calcular" (quedan en `borrador`, `total: null` — ver sección 2). El botón "Marcar como aceptada" SÍ aparece incluso para esas 14 (la condición en el JSX es `estado !== 'rechazada' && estado !== 'vencida'`, no excluye `borrador`), pero un usuario real difícilmente va a confirmar la aceptación de algo que no muestra ningún precio.
- Las 2 cotizaciones que SÍ tienen total real (`enviada`, folios 30 y 32) tampoco fueron nunca aceptadas. El botón además dispara un `window.confirm()` con el texto "no se puede deshacer desde aquí" ([CotizacionDetalle.jsx:133](frontend/src/pages/CotizacionDetalle.jsx#L133)) — fricción adicional razonable para no hacerlo sin estar segura, pero fricción al fin.

**Consecuencia en cadena, confirmada con datos reales, no inferida:**

```
cotización nunca calculada (14/16)
        → "Marcar como aceptada" se ve arriesgado de confirmar sin precio
        → nunca se confirma (ni siquiera en las 2 que sí tienen precio)
        → marcarCotizacionAceptadaYCrearProyecto() nunca se ejecuta
        → 0 proyectos
        → 0 instalaciones (requieren un proyecto tipo='venta' existente)
        → 0 cobranza (vive dentro del proyecto)
        → Dashboard operativo: todo en 0 (correcto, no es un bug — ver sección 5)
        → Instalaciones/Cobranza en el menú siguen marcados "próximamente"
          (sección 6) — y aunque no lo estuvieran, no habría nada que listar
```

Todo lo que se construyó este trimestre (Instalaciones, Cobranza, Inventario-reserva, Trámites CFE, Garantías, Mantenimiento — ver `NORT_ENERGY_P1_ENTREGA.md`) fue validado en vivo con datos **temporales creados y borrados por mí** durante cada entrega. Nunca se ha ejercido con un dato real de Nort Energy, porque el dato real nunca cruzó la puerta de entrada (`marcar-aceptada`).

---

## 1. Auditoría por módulo (FRONTEND → API → SERVICIO → BASE DE DATOS → RESPUESTA → UI)

Clasificación: **A** funciona completo · **B** existe pero desconectado · **C** existe parcial · **D** solo interfaz · **E** no existe · **F** no verificable con el acceso disponible.

| Módulo | Clasificación | Evidencia |
|---|---|---|
| CRM / Clientes | **A** | `listarClientes()` ([modules/crm-ui.js:44](modules/crm-ui.js#L44)) funciona correctamente; 69 clientes reales listados y filtrados sin error. El problema no es el módulo — es la calidad del dato que entra (sección 2). |
| Pipeline / Oportunidades | **C** | Lista y crea oportunidades correctamente, pero el `estado` nunca avanza más allá de "Nuevo" para ninguna de las 6 reales — no hay ningún punto del código que actualice `oportunidades.estado` cuando la cotización asociada avanza. El pipeline visual es fiel al dato, pero el dato nunca se mueve. |
| Conversaciones / Inbox | **A** | Confirmado funcionando en vivo esta sesión — transcripción de audio, descripción de imágenes y lectura de PDFs validadas contra mensajes reales de clientes (ver commits `6a49538`, histórico de P1). |
| Cotizaciones | **C** | Crear/listar/editar funciona. El paso "calcular" (`POST /:id/calcular`) existe y funciona cuando se invoca (folios 30/32 lo demuestran), pero 14/16 cotizaciones reales nunca lo ejecutaron — ver sección 2 para hipótesis de causa. |
| Ingeniería solar / Catálogo técnico | **F** | No verificado en esta pasada — no hay registros de `oportunidades` con `kwp_estimado`/`paneles_estimados` poblados para confirmar que el motor de predimensionamiento se haya ejecutado alguna vez con datos reales. |
| Catálogo / Paquetes | **F** | No auditado en esta pasada (fuera del flujo crítico identificado). |
| Agenda | **F** | No auditado en esta pasada. |
| **Proyectos** | **B** | El modelo de datos, las 60+ rutas gateadas por rol, el expediente 360° (`ProyectoDetalle.jsx`) — todo existe y fue probado en vivo con datos temporales. Pero la única puerta de entrada real (`marcar-aceptada`) nunca se cruzó — ver sección 0. **0 registros reales.** |
| **Instalaciones** | **B** | Backend completo (CRUD, checklist, evidencias, equipos, reserva/consumo de material — todo construido y probado en P1.2). Nav marcado `habilitado: false` ("próximamente") — doble desconexión: ni hay nav, ni hay proyecto del cual colgar una instalación real. |
| **Cobranza** | **B** | RPC atómica anti-race-condition (`registrar_abono_cliente`, migración 123) probada con concurrencia real. Nav marcado `habilitado: false`. Vive dentro del proyecto — sin proyecto, no hay cobranza que mostrar. |
| Inventario | **A**, con una nota | El mecanismo (RPC atómica, migración 116) funciona. Hay 1 movimiento huérfano de un producto marcado explícitamente `"datos de demostración"` ([ver sección 3](#3-auditoría-de-datos-reales)) — no es dato real de Nort Energy, es residuo de prueba de plantilla. |
| Compras | **A** | El pedido de compra real que registraste hoy (Growatt + Aluminext, folio `a04a6641...`) existe correctamente con sus 2 líneas — simplemente se quedó en `borrador`, nunca se avanzó a "recibida". Dato íntegro, solo incompleto en su ciclo de vida. |
| CFE / Trámites | **A** | Construido y probado en P1 (2E). Sin proyectos reales, no hay trámites reales que mostrar — mismo patrón que Instalaciones/Cobranza. |
| Garantías | **A** (con fix reciente) | El botón "Ver garantía" tenía un bug de permisos corregido el 2026-10-14 (commit `d87dfb3`) — bloqueaba con 403 a roles de solo lectura. Ya corregido y desplegado. |
| Mantenimiento | **A** | Construido en P1 (2I), probado en vivo. |
| Tickets | **A** | Construido en P1 (2I), probado en vivo. |
| Dashboard | **A** | Ver sección 5 — refleja fielmente la realidad operativa (que hoy es, honestamente, vacía). No es un bug. |
| Centro de Conocimiento | **F** | No re-auditado en esta pasada (auditado en fases anteriores, ver `NORT_ENERGY_CENTRO_CONOCIMIENTO_AUDITORIA.md`). |
| Panel de Acción | **F** | No re-auditado en esta pasada. |
| Portal del cliente | **A** | Aislamiento multiempresa y multi-cliente verificado exhaustivamente en P1.4 — pero sin proyectos reales, el portal no tiene nada que mostrarle a un cliente real todavía. |
| **Reportes** | **E** | No existe. Cero componentes en `frontend/src/pages` con ese nombre. El nav lo marca honestamente como "próximamente" — es el único de los 3 "próximamente" que no es una desconexión, es la verdad: no se ha construido. |

---

## 2. Auditoría de datos reales — hallazgos con evidencia

### 2.1 "Clientes sin nombre"
**Causa confirmada, no especulada.** `modules/crm.js:30` crea cada cliente nuevo con el placeholder literal `nombre: 'Sin nombre'` — nunca `null`. Existe un mecanismo de auto-reparación (`modules/nombre-cliente.js::calcularCambiosNombreEmpresa`, invocado en [server.js:500](server.js#L500)) que actualiza el nombre real en cuanto la IA lo extrae de la conversación (`datos_extraidos.nombre`).

**El problema:** de 69 clientes reales, **60 (87%) siguen con el placeholder "Sin nombre"** — incluyendo **5 de los 10 clientes que ya llegaron a tener una cotización**. La IA conversacional rara vez logra extraer el nombre del cliente en el flujo real de WhatsApp. Esto no es un bug de guardado — es que el dato nunca llega a `datos_extraidos.nombre` para empezar. Requiere revisar el prompt/instrucciones de la IA (fuera del alcance de "no programar todavía" de esta entrega).

### 2.2 "Cotizaciones sin importe"
**Confirmado con conteo exacto:** de 16 cotizaciones reales, **14 (87.5%) tienen `total: null`** — se crearon pero nunca se ejecutó el paso "calcular" (`POST /api/cotizaciones/:id/calcular`). Solo los folios 30 y 32 tienen totales reales ($62,640 y $62,628.40 respectivamente). Adicionalmente, **9 de 16 cotizaciones no tienen `oportunidad_id`** — se crearon sin engancharse al pipeline.

### 2.3 "El pipeline no refleja avances"
Las 6 oportunidades reales están **las 6** en `estado: 'Nuevo'`, con `probabilidad: 45` idéntica en todas, y todos los campos de predimensionamiento (`kwp_estimado`, `paneles_estimados`, `consumo_mensual_kwh`, `direccion`, `ciudad`) en `null`. No hay ningún punto del código que actualice el `estado` de una oportunidad cuando su cotización asociada avanza — son dos objetos que viven desconectados en la práctica, aunque el modelo de datos sí los relaciona (`cotizaciones.oportunidad_id`).

### 2.4 "Instalaciones/Cobranza/Reportes aparecen como próximamente"
Confirmado en `companies.nav_labels.modulos`: los 3 tienen `habilitado: false` hoy mismo. Para Instalaciones y Cobranza es una desconexión de navegación sobre un backend que sí funciona (sección 1). Para Reportes, es honesto — no existe.

### 2.5 "Leads con score cero"
De 69 clientes, **63 (91%) tienen `score_interes: 0`**. Solo 6 tienen un score distinto de cero. Sugiere que el mecanismo de scoring tampoco se está ejecutando de forma consistente para leads reales — mismo patrón que 2.1 (depende de que la IA extraiga/infiera señales de la conversación real, y rara vez lo logra con el volumen y tipo de mensajes reales que llegan).

### 2.6 "Inventario con movimientos históricos pero existencias diferentes"
Hay exactamente **1 movimiento de inventario real** en toda la base de Nort Energy: una "entrada" de 10 unidades de un producto cuya propia descripción dice *"datos de demostración para la primera plantilla premium"* ([verificado contra la tabla `productos`](#)). El saldo actual de ese producto es 0. La explicación más probable (no confirmable con certeza sin más contexto histórico) es que este es residuo de una validación en vivo de una fase anterior de este proyecto, donde se creó, reservó y consumió material de prueba — y la limpieza posterior no eliminó esta fila específica. **No se tocó nada de esto en esta auditoría**, conforme a tu instrucción explícita de no borrar información. Recomendación: confirmar contigo si se puede limpiar esta fila huérfana antes de empezar a usar Inventario con datos reales, para no arrancar con un dato ya inconsistente.

### 2.7 "¿Los proyectos son accesibles desde la navegación normal?"
No aplica hoy (0 proyectos reales), pero la respuesta arquitectónica es: **no directamente**. No existe un ítem de navegación "Proyectos" — se llega a un proyecto únicamente a través de Clientes → ficha del cliente → sección "Proyectos/Sistemas". Es una decisión de diseño deliberada (Proyecto 360° vive dentro del expediente del cliente, no como lista independiente), pero es poco descubrible para alguien que no sepa que ese es el camino.

---

## 3. Mapa de relaciones de datos (resumen)

```
clientes (69, 60 con "Sin nombre")
  └─ oportunidades (6, todas en "Nuevo")
       └─ cotizaciones (16, 14 sin total, 9 sin oportunidad_id)
            └─ [BLOQUEADO AQUÍ] marcar-aceptada nunca se confirmó
                 └─ proyectos (0)
                      ├─ instalaciones (0)
                      │    └─ equipos_instalados (0) → garantias (0)
                      ├─ pagos_cliente / cobranza (0)
                      ├─ tramites_cfe (0)
                      └─ mantenimientos (0)

ordenes_compra (1, real, en "borrador", íntegra) ─┐
proveedores, productos                            ├─ independientes del bloqueo de arriba
inventario_movimientos (1, residuo de prueba) ────┘
```

---

## 4. Procesos que realmente funcionan hoy (sin ambigüedad)

- Captación de clientes vía WhatsApp → registro en `clientes` (aunque con el problema de nombre de 2.1).
- Creación y listado de oportunidades, cotizaciones, órdenes de compra.
- Cálculo de cotización cuando se invoca (folios 30/32 lo prueban).
- Envío de cotización.
- Sistema completo de roles departamentales (134 rutas, 7 roles, matriz de permisos) — construido y validado en vivo esta sesión.
- Comprensión de adjuntos de WhatsApp (audio, imágenes, PDFs) — validado contra mensajes reales.
- Aislamiento multiempresa — sin excepciones encontradas en ninguna auditoría de esta sesión.

## 5. El dashboard no está roto — es honesto

Los KPIs comerciales y operativos se calculan correctamente contra datos reales (`obtenerMetricas()` ejecutado en vivo para este reporte). Muestran ceros porque **hoy no hay ninguna venta cerrada ni proyecto activo** — no porque el cálculo falle. El riesgo real no es técnico: es que un dashboard en ceros, sin contexto, se lee como "el sistema no sirve" en vez de "todavía no hemos cerrado ninguna venta en el sistema".

## 6. Riesgos de seguridad

Ninguno nuevo encontrado en esta pasada. Aislamiento multiempresa, roles departamentales y protección del portal del cliente ya fueron auditados exhaustivamente en fases anteriores de esta sesión (`NORT_ENERGY_AUDIT_V1.md` sección 10, `NORT_ENERGY_P1_ENTREGA.md`) sin excepciones encontradas.

---

## 7. Backlog priorizado

### P0 — bloquea toda la operación real
1. **Facilitar/garantizar que "calcular" se ejecute siempre antes de enviar una cotización** — hoy es un paso manual separado y omisible; 14/16 cotizaciones reales lo omitieron. Posible solución: que "enviar" ya no esté disponible hasta que exista un total, o que "calcular" se dispare automáticamente al agregar/editar líneas.
2. **Hacer evidente y seguro el camino "cotización → proyecto"** — hoy depende de un botón de un solo uso con una advertencia de "no se puede deshacer", sobre una cotización que casi nunca muestra un total confiable. Revisar si debe ser menos intimidante, o si debe reforzarse con una confirmación en dos pasos con resumen claro (cliente, total, anticipo esperado) en vez de un `window.confirm()`.
3. **Conectar el `estado` de la oportunidad al avance real de su cotización** — hoy son dos objetos que nunca se sincronizan.

### P1 — importante pero no bloqueante
4. Habilitar en el nav las entradas de Instalaciones y Cobranza (el backend ya existe) — aunque sea apuntando al flujo vía Proyecto 360°, para que dejen de leerse como "no construido".
5. Limpiar el movimiento de inventario huérfano de producto demo (pendiente de tu confirmación — ver 2.6).
6. Investigar por qué `score_interes` y la extracción de nombre casi nunca se completan con datos reales — probablemente ajuste de prompt, no de código estructural.

### P2
7. Agregar un ítem de navegación directo a "Proyectos" en vez de depender únicamente del camino Cliente → Proyecto.
8. Construir Reportes — hoy es honestamente inexistente, no desconectado.

### P3
9. Completar la ficha de predimensionamiento técnico (kwp/paneles estimados) para que el pipeline cuente con datos de ingeniería desde etapas tempranas.

---

## 8. Lo que NO se tocó en esta auditoría

Ningún dato se borró, se reinició ni se reemplazó. El pedido de compra real, los 69 clientes, las 16 cotizaciones y el movimiento de inventario huérfano siguen exactamente como estaban antes de empezar esta auditoría. No se desplegó nada. No se programó nada.

---

## 9. Prueba operativa completa (Fase 8) — pendiente de tu autorización

No se ejecutó todavía, conforme a "DETENTE Y ESPERA MI APROBACIÓN". El escenario que pediste (cliente "PRUEBA INTEGRAL NORT ENERGY", 8 paneles, $67,377 MXN, 50%/50%) es exactamente el tipo de recorrido que confirmaría o refutaría la hipótesis central de este documento (sección 0) con un caso controlado y aislado. Recomiendo ejecutarlo junto contigo, en vivo, la primera vez — para que veas con tus propios ojos dónde el flujo se siente incompleto o confuso, en vez de que yo lo valide sola y solo te entregue un reporte.

---

## 10. Conclusión directa

El sistema no está tan roto como parece desde el panel. Lo que está roto es un solo paso — la confirmación de que una cotización fue aceptada — y como ningún dato real ha cruzado ese paso todavía, todo lo que depende de él (Proyectos, Instalaciones, Cobranza, CFE, Garantías, Mantenimiento, el Dashboard operativo, el Portal del cliente) se ve vacío o "próximamente" aunque está construido y ya fue probado en vivo con datos temporales esta misma sesión.

**No recomiendo reconstruir ninguno de esos módulos.** Recomiendo arreglar el embudo de entrada (P0, arriba) y correr la Fase 8 contigo para confirmarlo con un caso real.

Quedo a la espera de tu aprobación antes de tocar código, tal como pediste.
