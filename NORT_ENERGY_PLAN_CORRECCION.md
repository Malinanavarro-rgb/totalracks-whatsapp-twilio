# Nort Energy — Plan de corrección funcional

**Fecha:** 2026-10-14
**Estado:** plan de implementación — **nada de esto se ha programado todavía.** Cero cambios de código, cero datos modificados, cero despliegues. Espera tu autorización explícita punto por punto antes de implementar, tal como pediste.

Este documento responde, en el orden que indicaste, a los 7 puntos de tu mensaje original, más el punto 8 agregado después (clasificación de conversaciones). Cada uno trae: qué encontré (con evidencia nueva, no repetida de `NORT_ENERGY_AUDIT_V2.md`), qué propongo, archivos afectados, riesgos y la prueba de aceptación.

---

## 1. Cotizador — por qué 14 de 16 cotizaciones no se calcularon

### Causa raíz confirmada (no es captura, no son validaciones, no es el motor de ingeniería)

El motor de ingeniería **sí funciona**. El problema es que "calcular" en realidad son **dos pasos separados**, y solo el primero es obvio:

1. **Paso 1 — predimensionamiento técnico** (`NuevaCotizacion.jsx` → `crearYCalcular()` → `POST /:id/calcular` → `correrCalculoCotizacionManual()`, [modules/cotizaciones.js:556](modules/cotizaciones.js#L556)). Corre el motor, guarda el resultado en `calculos_ingenieria`, recomienda un paquete (`paquete_recomendado_id`). **Nunca toca `cotizaciones.total`.**
2. **Paso 2 — convertir el cálculo en precio real** (botones "Usar este paquete" / "Usar BOM desglosado", [CotizacionDetalle.jsx:345](frontend/src/pages/CotizacionDetalle.jsx#L345) y [:355](frontend/src/pages/CotizacionDetalle.jsx#L355)). Solo esto crea líneas reales (`cotizacion_lineas`) y dispara `recalcularTotales()` ([modules/cotizacion-lineas.js:30](modules/cotizacion-lineas.js#L30)) — el único lugar en todo el código que escribe `cotizaciones.total`.

El flujo de creación navega directo a la página de detalle después del Paso 1, sin forzar el Paso 2. Y el Paso 2 está presentado como un link de texto secundario dentro de una frase explicativa técnica ("...arma la cotización con las líneas reales del panel y el inversor... Usar BOM desglosado") — fácil de no reconocer como "todavía me falta algo" después de ya haber hecho clic en "Crear y calcular".

**Verificación:** las 14 cotizaciones sin total tienen `calculo_ingenieria_id` (no verifiqué esto exactamente en V2, lo confirmo como parte de la implementación) pero cero filas en `cotizacion_lineas` — consistente con la hipótesis.

### Propuesta

- **No tocar el motor de ingeniería ni sus validaciones** — funciona correctamente.
- Unir visualmente los dos pasos en un solo flujo: que "Crear y calcular" en `NuevaCotizacion.jsx` deje claro que falta un paso, o mejor, que el propio flujo ofrezca aplicar el paquete recomendado automáticamente cuando hay uno claro, dejando "Usar BOM desglosado" como alternativa explícita (nunca automática, para no inventar precios sin que el asesor lo confirme).
- Subir la jerarquía visual del Paso 2 en `CotizacionDetalle.jsx` (botón primario, no link de texto) cuando `estado === 'borrador'` y no hay líneas todavía.
- Nunca inventar información técnica: si el motor no pudo calcular paneles (`numero_paneles` nulo), no se debe ofrecer ningún paquete ni BOM — debe quedar explícito que falta información del sitio (consumo, ubicación) antes de poder cotizar.

### Archivos afectados
- `frontend/src/pages/NuevaCotizacion.jsx` — mensaje/redirección tras calcular.
- `frontend/src/pages/CotizacionDetalle.jsx` — jerarquía visual del paso 2.
- Ningún cambio en `modules/cotizador.js`, `modules/cotizaciones.js` ni `modules/cotizacion-lineas.js` (el motor y el cálculo de totales ya son correctos).

### Riesgo
Bajo — es un cambio de presentación/flujo, no de lógica de cálculo. Riesgo real: que el botón "primario" se confunda con un compromiso de venta — por eso el texto debe dejar claro que esto es "fijar el precio", no "aceptar la venta" (eso es el punto 2, un paso después y deliberadamente separado).

### Prueba de aceptación
Crear una cotización de prueba (datos ficticios) de principio a fin; confirmar que, sin tocar ninguna cotización real, el camino desde "Nueva cotización" hasta tener un `total` numérico es evidente sin que yo tenga que explicarlo.

---

## 2. Aceptación comercial — mecanismo de conversión a proyecto

### Lo que ya funciona bien (no se toca)

- `_crearORecuperarProyectoDeVenta()` ([modules/proyectos.js:103](modules/proyectos.js#L103)) **ya previene duplicados** con el mismo patrón atómico que usa cobranza: busca si ya existe un proyecto para esa cotización antes de crear, y si dos clics simultáneos chocan, el índice único (`23505`) resuelve la carrera y ambos devuelven el mismo proyecto. **No hay riesgo de duplicación hoy — no es necesario corregir esto, solo confirmarlo con una prueba.**
- Ya pide confirmación (`window.confirm`, [CotizacionDetalle.jsx:133](frontend/src/pages/CotizacionDetalle.jsx#L133)).

### Lo que propongo mejorar

- El botón "Marcar como aceptada" aparece incluso cuando `cotizacion.total` es `null` — permite "aceptar" una venta sin precio. Propongo ocultarlo (o deshabilitarlo con una nota) hasta que exista un total real.
- Reemplazar el `window.confirm()` genérico por un resumen explícito antes de confirmar: cliente, total, folio — para que la persona vea exactamente qué está a punto de convertir en proyecto, no un cuadro de diálogo genérico del navegador.

### Archivos afectados
- `frontend/src/pages/CotizacionDetalle.jsx` únicamente. Cero cambios en `modules/proyectos.js` — la lógica de creación/recuperación de proyecto ya es correcta y segura.

### Riesgo
Ninguno nuevo — es restringir un botón que hoy es demasiado permisivo, nunca al revés.

### Prueba de aceptación
Con una cotización de prueba sin total: confirmar que el botón no aparece o está deshabilitado. Con una cotización de prueba con total: confirmar que el resumen muestra los datos correctos antes de poder confirmar, y que un segundo clic sobre el mismo botón (ya aceptada) no crea un segundo proyecto — reutiliza el existente.

---

## 3. CRM — por qué 60 clientes permanecen "Sin nombre"

### Hallazgo nuevo e importante (no estaba en V2): la mayoría no son leads de energía solar

Revisé el contenido real de las conversaciones de los 60 clientes con el placeholder "Sin nombre". Resultado:

- **Solo 5 de 60** tienen alguna mención relacionada con energía solar, paneles, CFE o instalación.
- **55 de 60** son conversaciones sobre temas completamente ajenos: fletes/logística ("¿sigues con el servicio de fletes?"), Mercado Libre, verificación de domicilio, mensajes personales dirigidos a ti por tu nombre ("hola Alina, ¿puedes tomarme una llamada?").
- Confirmé que el número de WhatsApp de Nort Energy (vía Meta, `channel_endpoints`) es dedicado — no está compartido con ninguna otra empresa dentro de TARA. No es un bug de enrutamiento del sistema.
- La explicación más probable es mundana: el número telefónico tiene contactos previos de un uso anterior (personal o de otro de tus negocios) que te siguen escribiendo ahí.

**Esto cambia la respuesta correcta.** No es, en su mayoría, un problema de "la IA no supo extraer el nombre" — es que la mayoría de estos 60 registros **no son prospectos reales de Nort Energy**, y tratar de "recuperarles un nombre" sería resolver el síntoma equivocado.

### Causa técnica confirmada para los que SÍ son leads reales

`modules/crm.js:30` crea cada cliente con el placeholder literal `'Sin nombre'`. Existe un mecanismo de auto-reparación (`modules/nombre-cliente.js`) que lo actualiza en cuanto la IA extrae `datos_extraidos.nombre` de la conversación — pero solo si la IA logra extraerlo. Además, Twilio sí entrega el nombre de perfil de WhatsApp del remitente (`ProfileName`) en cada mensaje ([adapters/channels/twilio-whatsapp.js:79](adapters/channels/twilio-whatsapp.js#L79)) — y **hoy se descarta por completo**, nunca se guarda ni se usa como respaldo. Es información verificable (el propio contacto la puso en su perfil de WhatsApp) que no estamos aprovechando.

### Propuesta — flujo nuevo, sin inventar nada

**Para clientes nuevos (de aquí en adelante):**
- Usar `ProfileName` de WhatsApp como nombre inicial cuando `datos_extraidos.nombre` todavía no existe — mejor que el placeholder genérico "Sin nombre", y es un dato real que el contacto puso él mismo. Se sigue sobrescribiendo con el nombre real en cuanto la IA lo capture en conversación, igual que hoy.
- Nota: Meta (el otro canal) requiere revisar si entrega un campo equivalente — lo confirmo durante la implementación antes de tocar el adapter de Meta.

**Para los 5 clientes existentes con contexto real de solar:**
- Backfill cuidadoso: releer su conversación con el mismo motor de extracción que ya usa el sistema en vivo, pero **nunca aplicar el cambio automáticamente** — se te presenta como sugerencia ("¿este cliente se llama X? → confirmar / descartar") para que tú decidas. Cero sobrescritura silenciosa.

**Para los 55 sin contexto de solar:**
- No recomiendo inventarles ni intentar extraerles un nombre — no hay información verificable de que sean prospectos reales. Propongo en su lugar un estado explícito en el CRM (ej. "no es un lead" o similar) para que dejen de aparecer como prospectos sin trabajar, sin borrarlos ni perder el registro — permaneces con el control de archivarlos o no.

### Archivos afectados
- `adapters/channels/twilio-whatsapp.js` — usar `ProfileName` como respaldo de nombre al crear el cliente (coordinando con `modules/crm.js`).
- `modules/crm.js` — aceptar el nombre de perfil como argumento opcional al crear cliente.
- Script nuevo, de un solo uso, para el backfill de los 5 clientes con contexto solar (no se ejecuta sin tu revisión cliente por cliente).
- Ningún cambio al esquema — no se necesita una migración para esto.

### Riesgo
Medio en el backfill si se aplicara sin revisión (podría asignar un nombre mencionado en la conversación que no sea el del contacto real) — por eso la propuesta es sugerencia, nunca aplicación automática. Riesgo bajo en el uso de `ProfileName` para clientes nuevos — es exactamente el mismo criterio de "nunca pisar un nombre real ya capturado" que ya usa `nombre-cliente.js`.

### Prueba de aceptación
Simular un mensaje nuevo con un `ProfileName` de prueba — confirmar que el cliente se crea con ese nombre en vez de "Sin nombre", y que un `datos_extraidos.nombre` posterior sí lo sobrescribe (igual que hoy). Para el backfill: mostrarte los 5 casos con su sugerencia antes de tocar cualquier dato real.

---

## 4. Integración operativa — ¿el proyecto administra todo correctamente?

Esto ya fue construido y probado en vivo con datos temporales durante esta sesión (ver `NORT_ENERGY_P1_ENTREGA.md` y la re-auditoría de permisos del 2026-10-14). Confirmo el estado actual, sin repetir el trabajo:

- `ProyectoDetalle.jsx` ya centraliza: cobranza, instalaciones, equipos/garantías, materiales (reservar/consumir inventario), trámites CFE, mantenimiento — todo en una sola pantalla, probado end-to-end con datos de prueba.
- El hallazgo de la re-auditoría (ciertos roles no veían ciertas secciones) ya fue corregido y desplegado (commits `d87dfb3`, `3f10532`).
- **Lo único que falta para que esto se vea con datos reales es que exista al menos un proyecto real** — que depende de los puntos 1 y 2 de arriba.

### Propuesta
Ningún cambio de código nuevo en este punto — es una confirmación, no una corrección. Se valida junto con la prueba integral (punto 6).

---

## 5. Compras e inventario — orden Growatt + Aluminext

### Estado actual (sin modificar nada, solo lectura)
La orden `a04a6641-20b8-4bae-ab04-f220f5c6c46e` existe, íntegra, con sus 2 líneas (1× inversor Growatt MIN 5000TL-X2, 8× estructura Aluminext), en estado `borrador`, `cantidad_recibida: 0` en ambas líneas. Es un dato real correctamente capturado — simplemente no se ha avanzado a "recibida".

### Qué debe ocurrir cuando se recibe una orden (ya construido, lo confirmo aquí sin tocarlo)
Al marcar una orden como recibida, el sistema ya está diseñado para generar un movimiento de tipo "entrada" en `inventario_movimientos` por cada línea recibida (vía la misma RPC atómica `registrar_movimiento_inventario`, migración 116, con bloqueo real — la misma que ya validé con concurrencia real para cobranza). Esto actualiza `inventario_saldos.existencia_fisica` de forma consistente.

### Separación de datos reales vs. demostración
- **Real:** la orden Growatt + Aluminext (hoy), y cualquier producto/orden que captures tú de aquí en adelante.
- **Demostración, no tocar sin tu autorización:** el producto "OSDA 710W" (su propia descripción dice *"datos de demostración para la primera plantilla premium"*) y su único movimiento huérfano de inventario (entrada de 10, saldo actual 0) — documentado en `NORT_ENERGY_AUDIT_V2.md` sección 2.6. Pendiente de tu decisión: lo dejo igual, o lo limpio cuando tú lo autorices explícitamente (fuera del alcance de "preparación" que autorizaste hoy).

### Propuesta
Ningún cambio de código — el mecanismo ya funciona correctamente. La única acción pendiente es que tú (o quien tú decidas) marque la orden real como recibida cuando el material llegue físicamente, para que el inventario real empiece a reflejar operación real.

---

## 6. Prueba integral — escenario de prueba aislado (diseño, no ejecución)

Seguiré exactamente tu especificación: cliente ficticio, 8 paneles, anticipo 50%/50%, con valores explícitos de prueba. **No se ejecuta todavía** — esto es el diseño del escenario para cuando autorices la implementación.

| Paso | Acción | Dato de prueba |
|---|---|---|
| 1 | Crear cliente | `PRUEBA INTEGRAL NORT ENERGY`, teléfono de prueba claramente marcado (ej. `+520000000000`) |
| 2 | Crear oportunidad | Vinculada al cliente de prueba |
| 3 | Cotizar | 8 paneles — usando el flujo corregido del punto 1 |
| 4 | Calcular + aplicar paquete/BOM | Confirmar que el total se genera (validación directa del punto 1) |
| 5 | Marcar aceptada | Total: **$67,377 MXN** — confirmar que crea UN solo proyecto (validación del punto 2) |
| 6 | Registrar anticipo | 50% = $33,688.50 — vía la RPC atómica de cobranza |
| 7 | Reservar material | Para el proyecto de prueba, sin tocar inventario real |
| 8 | Programar instalación | Fecha de prueba |
| 9 | Registrar evidencias | Archivo de prueba, claramente marcado |
| 10 | Registrar equipos + números de serie | Datos ficticios explícitos (ej. `SERIE-PRUEBA-001`) |
| 11 | Consumir material reservado | Mismo material de prueba del paso 7 |
| 12 | Iniciar trámite CFE | Estado inicial |
| 13 | Avanzar trámite CFE | Simular un avance de estado |
| 14 | Registrar liquidación | Saldo restante: $33,688.50 |
| 15 | Entregar proyecto | Cambiar estado a entregado |
| 16 | Generar garantías | Desde los equipos registrados en el paso 10 |
| 17 | Programar mantenimiento | Fecha de prueba futura |
| 18 | Consultar portal del cliente | Con la sesión de prueba del cliente ficticio — confirmar aislamiento (nunca ve otros proyectos) |
| 19 | Verificar dashboard | Confirmar que los KPIs operativos reflejan la operación de prueba |
| 20 | Verificar historial completo | `bitacora_decisiones` del proyecto de prueba, de principio a fin |

**Garantías explícitas, igual que pediste:** sin WhatsApp real, sin cargos reales, sin tocar inventario productivo (producto de prueba dedicado, no el catálogo real de Nort Energy), sin correos a clientes reales. Al terminar, limpieza completa de todo lo creado — mismo criterio que usé en cada validación en vivo de esta sesión.

---

## 7. Interfaz — ¿cada etapa es administrable desde el panel?

Confirmado para todo lo construido hasta ahora (sin SQL/Postman): CRM, Cotizaciones, Proyectos, Cobranza, Instalaciones, Inventario, Compras, CFE, Garantías, Mantenimiento, Tickets — cada uno tiene su pantalla y sus botones de acción. **La única etapa que hoy requiere entender algo no evidente en el panel es exactamente el punto 1 (el paso 2 del cálculo, "aplicar paquete/BOM") — que es precisamente lo que este plan propone corregir.**

---

## 8. Clasificación de conversaciones — agregado después del plan original

Investigué el sistema real antes de proponer nada. Hay más construido de lo que parecía, y el problema no es "falta un clasificador" — es que **existe, clasifica correctamente en cada turno, pero nunca se le hace caso**.

### Lo que ya existe (se reutiliza, no se reconstruye)

- **El catálogo de clasificación ya existe y ya cubre exactamente tus categorías** ([modules/clasificacion-contexto.js](modules/clasificacion-contexto.js)): `prospecto`, `cliente_existente`, `proveedor`, `conversacion_personal`, `numero_equivocado`, `spam`, `informacion_administrativa`, `contexto_insuficiente`. La IA clasifica **cada turno** con este catálogo antes de responder (ADR-010) — nunca asume "prospecto" por defecto.
- **El problema: esa clasificación se calcula y se registra en bitácora (`decision_logs`, vía `modules/audit-logger.js`), pero nunca se guarda en el cliente ni se usa para decidir nada.** Es un dato que ya pagamos por calcular (cada llamada a la IA lo incluye) y que hoy se tira después de loguearlo.
- **Atribución de campañas de Meta (Facebook/Instagram) ya existe y funciona** ([modules/lead-atribucion.js](modules/lead-atribucion.js)): detecta clics reales de anuncios "Click-to-WhatsApp" vía el objeto `referral` de Meta (`ctwa_clid`, URL de origen, texto del anuncio) — es metadata verificable, no una suposición. Hoy tiene **0 registros reales** para Nort Energy — no es que esté roto, es que (según la muestra que revisé) ninguno de los 69 contactos reales llegó por un anuncio de Meta todavía.
- **Atribución de campañas genérica (incluye Google) ya existe, vía un token determinístico** (`#tara_camp:token` en `campanas_landing`) — cualquier campaña, de cualquier plataforma (Google incluida), que dirija a un link de WhatsApp con ese token en el mensaje prellenado, ya queda atribuida sin código nuevo. Lo que falta no es construir esto — es configurar las campañas de Google para usarlo, una tarea operativa, no de desarrollo.

### Lo que SÍ falta (los 3 huecos reales)

1. **`requiereCrearOportunidad()`** ([modules/crm.js:117](modules/crm.js#L117)) decide si crear una oportunidad comercial usando únicamente palabras clave (`TRIGGERS_OPORTUNIDAD`) e `intenciones` — **nunca consulta `clasificacion_contexto`**. Esto significa que un mensaje ya correctamente clasificado como `conversacion_personal` o `numero_equivocado` podría, en teoría, todavía disparar una oportunidad si contiene una palabra como "necesito" o "información". Este es el hueco real detrás de tu punto 3.
2. **No existe ningún campo persistente en `clientes` que guarde la clasificación** — ni la de la IA, ni una manual tuya. Por eso hoy es imposible filtrar el dashboard/CRM por "esto es o no un contacto comercial" (tu punto 8), y por eso no existe una forma de clasificar manualmente (tu punto 6).
3. **El nombre se solicita/extrae igual para cualquier conversación**, sin importar si ya se sabe que es personal o spam — afecta tu punto 4.

### Propuesta

- Agregar una columna nueva a `clientes` (ej. `tipo_contacto`, con los mismos valores del catálogo ya existente + un estado manual explícito) — **reutilizando el catálogo que ya existe en `clasificacion-contexto.js`**, no uno nuevo. Se actualiza automáticamente con la clasificación de la IA en cada turno (la primera vez que dejamos de tirar ese dato), y **cualquier clasificación manual tuya desde el panel la congela** — la IA deja de sobrescribirla una vez que tú decidiste.
- Conectar `requiereCrearOportunidad()` para que **nunca** cree una oportunidad si `clasificacion_contexto` del turno es `conversacion_personal`, `numero_equivocado`, `spam` o `informacion_administrativa` — sin importar palabras clave o intenciones. Esto resuelve tu punto 3 directamente en la fuente, no con un parche posterior.
- Agregar un control manual en la ficha del cliente (`CrmClienteDetalle.jsx`) para reclasificar: prospecto / cliente / contacto personal / consulta no comercial — tu punto 6.
- Condicionar la solicitud/uso del nombre (punto 4 de este punto 8, y también relevante al punto 3 del plan original) a que el contacto esté clasificado como `prospecto` o `cliente_existente` — no tiene sentido pedirle el nombre a alguien cuya conversación ya se identificó como ajena al negocio.
- Condicionar `actualizarScoreInteres()` de la misma forma — un contacto personal o spam no debe subir su "score de interés" solo por escribir varias veces.
- Dashboard/CRM: filtrar por default a `prospecto` + `cliente_existente` en los conteos de leads/oportunidades — los demás tipos siguen existiendo y visibles (nunca se ocultan ni se borran), solo dejan de contar como "lead sin trabajar" en los indicadores.
- **No se toca `modules/lead-atribucion.js`** en su función de enrutamiento multiempresa (resolver `company_id` entre dos negocios) — eso sigue exactamente igual. Solo se reutiliza la extracción de `referral`/`ctwa_clid` que ya existe ahí, como una señal más de entrada hacia la nueva clasificación persistida, sin tocar su lógica de enrutamiento.

### Archivos afectados
- Migración nueva — columna `tipo_contacto` (y posiblemente `tipo_contacto_fuente`: 'ia' | 'manual', para saber si está congelada) en `clientes`.
- `modules/crm.js` — `requiereCrearOportunidad()` y `actualizarScoreInteres()` reciben la clasificación como parámetro y la respetan.
- `server.js` — persistir `ai_output.clasificacion_contexto` en el cliente (si no está congelado manualmente) en el mismo punto donde hoy solo se loguea.
- `frontend/src/pages/CrmClienteDetalle.jsx` — control manual de reclasificación.
- `modules/dashboard.js` — filtrar KPIs de leads/oportunidades por `tipo_contacto`.
- Nueva ruta + wrapper en `api.js` para la reclasificación manual.

### Riesgo
Bajo-medio. El riesgo principal es de alcance: clasificar mal un prospecto real como "no comercial" lo sacaría de los KPIs sin querer. Mitigación: la clasificación de la IA nunca es definitiva — siempre se puede corregir manualmente desde el panel (punto 6), y nada se oculta ni se borra (punto 7) — un contacto mal clasificado sigue existiendo y es visible en la lista completa, solo no cuenta en el resumen ejecutivo hasta que se corrija.

### Prueba de aceptación
Simular 3 mensajes de prueba: uno claramente comercial ("necesito paneles solares para mi casa"), uno personal ("oye paso por ti al rato"), uno de número equivocado ("¿es aquí la farmacia?"). Confirmar que solo el primero genera oportunidad y sube el score; los otros dos quedan clasificados pero sin oportunidad ni score. Confirmar que reclasificar manualmente cualquiera de los tres cambia su conteo en el dashboard de inmediato, y que ninguno desaparece de la lista de clientes.

---

## Resumen de archivos que se tocarían (si autorizas)

| Archivo | Punto | Tipo de cambio |
|---|---|---|
| `frontend/src/pages/NuevaCotizacion.jsx` | 1 | UX — flujo post-cálculo |
| `frontend/src/pages/CotizacionDetalle.jsx` | 1, 2 | UX — jerarquía visual, gate por total, resumen antes de confirmar |
| `adapters/channels/twilio-whatsapp.js` | 3 | Usar ProfileName como respaldo de nombre |
| `modules/crm.js` | 3, 8 | Nombre de perfil al crear cliente; `requiereCrearOportunidad()`/`actualizarScoreInteres()` respetan la clasificación |
| Script nuevo (uso único) | 3 | Backfill sugerido de 5 clientes, sin aplicar automáticamente |
| `server.js` | 8 | Persistir `clasificacion_contexto` en el cliente (si no está congelada manualmente) |
| `frontend/src/pages/CrmClienteDetalle.jsx` | 8 | Control manual de reclasificación |
| `modules/dashboard.js` | 8 | Filtrar KPIs de leads/oportunidades por tipo de contacto |
| `frontend/src/lib/api.js` | 8 | Wrapper para la reclasificación manual |
| Migración nueva | 8 | Columna `tipo_contacto` (+ `tipo_contacto_fuente`) en `clientes` |

**Nada en:** `modules/proyectos.js`, `modules/cotizaciones.js`, `modules/cotizacion-lineas.js`, `modules/cotizador.js`, `modules/inventario.js`, `modules/compras.js`, ni en la lógica de enrutamiento multiempresa de `modules/lead-atribucion.js` — toda esa lógica ya es correcta; el problema nunca fue el motor, fue la visibilidad y el camino hacia él.

**Una sola migración nueva en todo el plan** (la columna de clasificación del punto 8) — los puntos 1-7 no requieren ninguna.

**Arquitectura multiempresa:** ningún cambio propuesto toca código compartido de forma que afecte a Total Racks, Gondor ni ninguna otra empresa — todos los archivos son específicos del flujo comercial (cotizaciones/proyectos/CRM), ya usados por el patrón Motor Universal (dato por empresa, nunca rama de código por empresa).

---

Quedo a la espera de tu autorización, punto por punto o en bloque, antes de tocar cualquier archivo.
