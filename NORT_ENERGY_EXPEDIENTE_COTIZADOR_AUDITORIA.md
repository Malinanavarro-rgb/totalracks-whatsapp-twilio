# Auditoría profunda — Expediente del Cliente + Cotizador Solar (Nort Energy)

**Fecha:** 2026-09-16. Auditoría únicamente — cero cambios de código, tal como pediste. Todo lo reportado aquí está verificado leyendo el código fuente real, migraciones reales y (donde se indica) consultas directas a Supabase — no hay nada inferido de la interfaz. Donde algo no existe, lo digo explícitamente como "NO EXISTE"; nunca lo doy por hecho.

---

## VEREDICTO EN UNA FRASE

**No hay que construir un ERP solar desde cero — ya existe uno real, con un motor de ingeniería sólido, folios, versionado, estados y hasta cierre automático por WhatsApp — pero está enterrado detrás de una UI que solo expone una fracción de lo que el backend ya sabe hacer, y el "expediente 360°"/"cotizador paso a paso" que pides es, en términos de arquitectura, principalmente trabajo de FRONTEND sobre datos y funciones que ya existen, más un número acotado de columnas/tablas nuevas genuinamente faltantes (datos técnicos del inmueble, documentos del cliente, descuentos con aprobación, BOM real).**

---

# A. MAPA ACTUAL — qué existe realmente

## A.1 Expediente del cliente

`frontend/src/pages/CrmClienteDetalle.jsx` tiene exactamente 6 secciones: **Pregúntale a TARA, Datos generales, Seguimientos, Citas, Oportunidades, Conversación.** Nada más — ninguna sección de consumo/CFE, datos técnicos del inmueble, cargas, documentos o score explicable existe hoy, aunque en varios casos el dato SÍ vive en la base y simplemente nunca se renderiza.

Tablas reales detrás: `clientes` (schema amplio pero fragmentado — ver E), `oportunidades` (con 20 columnas solares de la migración 103, casi ninguna visible en UI), `seguimientos`, `citas`, `hilos`/`mensajes` (Inbox) + `conversaciones`/`mensajes_humanos` (legado, ver F).

`obtenerFichaCliente` (`modules/crm-ui.js:158-178`) trae cliente completo + historial + citas + oportunidades completas — el backend YA trae casi todo lo que el expediente 360° necesitaría mostrar; el cuello de botella es el frontend, no los datos.

## A.2 Cotizador / motor de ingeniería

Existe un **ERP de cotización real**, construido en 3 fases documentadas dentro del propio código (comentarios "Fase 1/2/3" en `modules/cotizaciones.js`), con:

- **Motor puro** (`modules/motores-ingenieria/paneles-solares.js`, 544 líneas, sin tocar DB) que calcula: consumo anual (con o sin historial de 12 meses), potencia requerida (fórmula explícita con HSP/PR), número de paneles, selección de inversor **por compatibilidad técnica real** (potencia DC máxima, tipo de red, voltaje de salida, ratio DC/AC objetivo — nunca solo por potencia parecida), **validación de strings** (Voc corregido por temperatura, rango MPPT, corriente por MPPT — exactamente lo que pides en el Paso 6 de compatibilidad panel+inversor), área requerida, producción (mensual real si hay HSP mensual), cobertura, ahorro (con costo efectivo real del recibo), periodo simple de recuperación, ahorro acumulado a 5/10/20 años, reducción de CO₂, y un **sistema de alertas de bloqueo** (`generarAlertas()`) que es, en la práctica, exactamente tu "ALERTAS DE INGENIERÍA" del Paso 15 — solo que hoy no se muestra en ningún simulador interactivo, se calcula una vez y se guarda.
- **Capa de conexión a datos** (`modules/cotizaciones.js`, 849 líneas): resuelve HSP real (`irradiacion_regional`), parámetros configurables (`parametros_ingenieria`, con override por empresa), corre el motor y guarda cada corrida como fila **inmutable y versionada** en `calculos_ingenieria` (nunca UPDATE — exactamente tu regla de "nunca borrar el histórico"). Ya existe folio consecutivo atómico (`generarFolio`, vía RPC de Postgres, sin condición de carrera), dos estados de aprobación humana distintos (`predimensionamiento_revisado_por` vs `ingenieria_validada_para_cotizar_por`), creación manual de cotización (`crearCotizacionBorrador`/`correrCalculoCotizacionManual`, ya usada por `NuevaCotizacion.jsx`), y **cierre automático completo** cuando el cálculo sale limpio: valida ingeniería → convierte el paquete recomendado en línea con precio → genera PDF → envía por WhatsApp, todo encadenado (`correrCotizacionDesdeWorkflow` → `_cerrarYEnviarCotizacionAutomaticamente`).
- **Líneas/BOM simplificado** (`modules/cotizacion-lineas.js`): CRUD de líneas con cantidad/precio/descuento por línea, recalcula subtotal/IVA(16% fijo)/total automáticamente. Hoy, en la práctica, casi siempre es **una sola línea** = el paquete comercial completo (ver abajo), no un desglose panel/inversor/estructura/cable real.
- **Paquetes comerciales** (`modules/paquetes-solares.js`): exactamente tu modelo mental "PAQUETE = plantilla comercial rápida" — precio fijo por cantidad de paneles (4/6/8/10/12...), selección automática del "inmediato superior" a la cantidad técnica calculada, nunca redondea hacia abajo, nunca inventa un precio si ninguno alcanza.
- **PDF** (`modules/cotizacion-pdf.js`, 1276 líneas): DOS plantillas completas (editorial compacta y "premium corporativo"), y la premium ya tiene casi exactamente tus secciones pedidas del Paso 16 — portada, consumo actual, sistema recomendado, ficha de equipo (marca/modelo/potencia/tecnología/garantía, **sin costos internos**), "qué incluye" configurable con checklist + "no incluye", inversión, garantías por componente, proceso, condiciones comerciales, cierre, anexos.
- **Tabla `cotizaciones`**: ya tiene `folio`, `version`, `cotizacion_padre_id` (versionado real), `estado` CHECK (`borrador|enviada|vista|aceptada|rechazada|vencida`), `vista_en`/`aceptada_en`/`rechazada_en`, `vigencia_dias` (default 15), `anticipo_pct`, `descuento_pct`/`descuento_monto` (a nivel cotización, agregados en migración 102, sin flujo de aprobación todavía), `sucursal_id`, `precio_final_autorizado` (override manual del asesor, ya existe — tu "PRECIO MANUAL" del Paso 10).
- **Tabla `productos`**: ya separa `precio` (cliente) de `costo_proveedor`/`costo_interno_nort_energy`/`costo_instalacion`/`costo_materiales`/`margen` (nunca expuestos al cliente, saneados por `catalogo-tecnico.js::sanearProducto()`), `proveedor`, `fuente`, `fecha_fuente`, `ficha_tecnica_completa`, `specs` (jsonb libre por tipo).

## A.3 Frontend real del cotizador — mucho más angosto que el backend

- `NuevaCotizacion.jsx`: Paso 1 (cliente) + Paso 2 (formulario plano de datos técnicos: ubicación, consumo, importe, % cobertura, tipo alimentación, voltaje, área). Sin objetivo de diseño (Paso 3), sin selección visual de panel/inversor (Paso 5/6), sin baterías (Paso 7), sin estructura (Paso 8).
- `CotizacionDetalle.jsx`: muestra el resultado del cálculo YA CORRIDO (paneles, kWp, alertas, estado) — de solo lectura, sin simulador. Muestra líneas en tabla simple, permite agregar una línea manual libre. Botones reales: "Usar paquete recomendado", "Validar ingeniería", "Generar PDF", "Reenviar por WhatsApp". **No hay UI de descuentos, IVA, financiamiento, ni comparador de opciones.**
- `Cotizaciones.jsx`: tabla plana, sin filtros por estado, sin kanban.
- `Paquetes.jsx`: solo lectura (paquete + sus cotizaciones relacionadas) — **no hay UI para crear/editar paquetes**, aunque el backend sí lo soporta (`crearPaquete`/`actualizarPaquete` nunca se llaman desde el frontend).
- `Catalogo.jsx`: **usa la tabla genérica `servicios`, NO `productos`** — es el catálogo de "Total Racks"/salón de belleza reutilizado tal cual. **Confirmado con certeza (grep):** `api.productosPorTipo()` está definida en `api.js` pero **nunca se llama desde ningún componente** — no existe, en absoluto, ninguna pantalla que muestre visualmente el catálogo real de paneles/inversores con specs, marca, potencia, garantía, proveedor SOLES. Hoy el catálogo técnico real solo es "visible" vía conversación con Modo Operador (`consultar_catalogo_tecnico`) o el tab admin de fichas técnicas (`Configuración → Fichas Técnicas`).

---

# B. QUÉ FUNCIONA — conservar tal cual

- El motor de ingeniería (`motores-ingenieria/paneles-solares.js`) — sólido, testeado, con disciplina anti-alucinación real (nunca inventa, todo lo incompleto se marca explícito).
- El patrón de versionado inmutable de `calculos_ingenieria` y folio atómico.
- Separación paquete comercial vs. resultado técnico vs. precio final autorizado (3 capas independientes, ninguna se pisa).
- El saneo de costos internos (`sanearProducto`) — ya resuelve tu regla "el cliente no ve costos SOLES/margen".
- El cierre automático WhatsApp → cálculo → paquete → PDF → envío cuando el cálculo sale limpio.
- Modo Operador / Centro de Conocimiento / Sales Coach / "Ayúdame a cerrar" (construidos en fases anteriores de esta sesión) — ya son el "TARA dentro del cotizador"/"TARA en el expediente" que pides, solo falta conectarlos a más contexto y darles más superficie de UI.
- El patrón multiempresa (`company_id` en cada query, `plantillas_industria` + `nav_labels` por empresa) — sólido, 17 empresas reales hoy, y ya probado extendiendo Nort Energy sin tocar GONDOR/Empresa Demo (que comparten el mismo `industria_slug`).

---

# C. QUÉ ESTÁ A MEDIAS — frontend sin backend, o backend sin frontend

| Backend YA EXISTE, sin UI | Frontend a medias / engañoso |
|---|---|
| Versionado de cotizaciones (`version`, `cotizacion_padre_id`) — cero UI de "ver V1/V2/V3" | `Catalogo.jsx` parece "el catálogo" pero muestra `servicios`, no `productos` — engañoso para Nort Energy |
| Descuento a nivel cotización (`descuento_pct`/`descuento_monto`) — sin formulario, sin aprobación, sin usuario que autorizó | `paquetes_solares` no tiene UI de administración (solo lectura) |
| `precio_final_autorizado` (override manual) — sin botón en ningún lado del panel de usuario | Selección de panel es automática y silenciosa (primer panel activo por antigüedad) — no hay tarjetas ni elección real |
| `razon_cierre` en `oportunidades` — columna y backend whitelisted, cero UI al marcar "Perdido" | `probabilidad`/`score` no se muestran donde el usuario esperaría verlos (ver E) |
| `sucursal_id` en `cotizaciones`/`hilos`/`usuarios_empresas` — sin ningún selector/filtro en frontend | "Ayúdame a cerrar" (oportunidad) descarta `probabilidad_compra` de su propia respuesta |
| Compatibilidad panel+inversor (`seleccionarInversor`, `calcularStrings`) — corre automático, nunca se explica al asesor con badges ✓/⚠/✕ | Menú de Nort Energy ya tiene Instalaciones/Trámites CFE/Cobranza/Inventario/Garantías — **todos deshabilitados, cero lógica detrás** |

---

# D. QUÉ NO EXISTE — confirmado, no asumido por la interfaz

**Expediente:**
- Datos técnicos del inmueble estructurados (tipo de techo con foto, pisos con orientación/sombras, área, centro de carga, alimentación eléctrica más allá de lo que ya captura el workflow).
- Cargas por equipo (refrigeradores, bombas, EV, alberca) — solo existe "cantidad de aires acondicionados" como único proxy.
- Cargas futuras.
- Documentos del cliente clasificados (foto techo/medidor/centro de carga/identificación/contrato/comprobantes) — solo hay adjuntos crudos de chat, sin clasificar, atados al hilo, no al cliente.
- Subida manual de recibo CFE desde el panel — hoy es 100% automático y solo funciona si hay una sesión activa del workflow "Cotización directa".
- Score explicable (por qué 87, qué acciones lo generaron).

**Cotizador:**
- BOM real desglosado (paneles/inversor/estructura/rieles/cable/protecciones como líneas separadas) — hoy es una línea de paquete + líneas manuales libres.
- Selección visual de panel/inversor con tarjetas comparables.
- Microinversores como opción real en el motor (el motor solo tiene `seleccionarInversor`, ni una función de microinversores ni comparador string-vs-micro).
- Baterías/respaldo (ninguna función de dimensionamiento).
- Estructura como paso propio (losa/lámina/teja/carport) con catálogo asociado.
- 3 propuestas automáticas (esencial/recomendada/premium).
- Simulador interactivo en tiempo real.
- Financiamiento configurable (contado/tarjeta/parcialidades) — no existe ningún campo ni lógica.
- Aprobación de descuentos por límite/rol.
- Distinción matemática explícita margen-sobre-venta vs. markup-sobre-costo — existe la columna `margen` (numeric libre) pero ninguna fórmula la define.
- Flujo posventa completo (anticipo → visita/validación → compra material → instalación → CFE → entrega → postventa) — nada de esto tiene tabla ni módulo.

**Negocio/operación (según los 3 agentes de investigación, confirmado con certeza):**
- Roles técnicos (instalador/técnico/postventa) — cero lógica real, solo un rol binario gerencial/no-gerencial (y hoy en producción solo existen `owner`/`administrador`, ni `supervisor` ni `asesor` tienen filas activas).
- Sucursales reales — la tabla existe pero solo tiene 1 fila (Ciudad Victoria; "Monterrey" no existe como sucursal), sin `sucursal_id` en `clientes`/`oportunidades`/`citas`, sin endpoint CRUD, sin ningún selector en frontend.
- Analítica comercial (leads por fuente, conversión por asesor, tiempo de primera respuesta, motivos de pérdida agregados) — el único motor de KPIs real es de conteos/sumas a nivel empresa, sin desglose.
- Bitácora automática de cambios de datos de negocio (precio, estado de venta, pagos) — existen 3 audit logs distintos (IA/decision_logs, memoria institucional manual/bitacora_decisiones, Super Admin/plataforma_audit_log) pero ninguno cubre esto.
- Instalaciones, Trámites CFE, Cobranza, Inventario, Garantías/Mantenimiento — cero tablas, cero módulos, solo ítems de menú deshabilitados.

---

# E. PROBLEMAS DE DATOS — causa raíz real, no asumida

**"Sin nombre":** el placeholder se crea siempre al primer contacto (`obtenerOCrearCliente`). **Existe un mecanismo genérico y automático de auto-captura de nombre por turno** (`modules/nombre-cliente.js` + `server.js:420-435`) que SÍ funciona para cualquier empresa cuya configuración incluya "nombre" en `campos_requeridos` — y Nort Energy sí lo tiene configurado. La causa raíz real, confirmada, es más específica: Nort Energy tiene DOS workflows — "Visita técnica" (sí pregunta el nombre como primer nodo) y "Cotización directa" (nunca pregunta el nombre, va directo a ubicación/consumo). Un cliente que entra por "Cotización directa" sin mencionar su nombre espontáneamente queda "Sin nombre" indefinidamente. **Fix real: agregar un nodo `preguntar_nombre` al workflow de Cotización directa — cambio de datos/script, no de código.**

**"Score 0" — no hay UN score, hay tres números distintos, ninguno mostrado donde se espera:**
1. `clientes.score_interes` — entero +10 por interacción (tope 100), visible **solo** en `Conversaciones.jsx`/`ConversacionDetalle.jsx` (legado) — invisible en Inbox, CrmPipeline y el expediente del cliente.
2. `oportunidades.probabilidad` — se fija en 45 (hardcodeado) al crear automáticamente, o cae al default 30 si se crea manual — **nunca se recalcula después de creada** y nunca se muestra en ningún componente.
3. `analisis_hilo.probabilidad_compra` — el único score realmente "explicable" (calculado por IA con razones), pero vive atado a un hilo, no a un cliente/oportunidad, y solo aparece en el Panel Inteligente de Inbox con la etiqueta "Probabilidad de compra", nunca como "Score".

**"$0 pipeline" / "cotizaciones generadas pero no enviadas":** con `probabilidad` fija en 30-45 y nunca recalculada, y con `presupuesto_estimado` nunca poblado automáticamente desde el cálculo de ingeniería (el kWp/paneles calculados no se traducen a un `presupuesto_estimado` en la oportunidad hasta que hay un paquete recomendado con precio), es esperable ver oportunidades "activas" con presupuesto vacío mostrando $0 en vez de "—". Confirmado como patrón real del proyecto (ver `dashboard-engine.js::tasa_conversion_oportunidades`, que ya devuelve `'—'` en vez de 0% cuando no hay datos — el criterio correcto existe, simplemente no se aplicó en todos lados).

---

# F. DUPLICIDADES — Inbox vs Conversaciones, confirmado real

No son dos productos — son un modelo viejo (`clientes`/`conversaciones`/`mensajes_humanos`, sin adjuntos ni IA) y un modelo nuevo (`hilos`/`mensajes`, con estado/prioridad/etiquetas/adjuntos/análisis IA) que **reciben el mismo mensaje humano por escritura doble en cada envío** (`server.js:1049-1058`, comentario explícito del propio código: "escritura doble deliberada"). Ambas UIs comparten "tomar conversación"/"responder" contra el mismo endpoint. La única exclusividad real: Inbox tiene TODO lo operativo nuevo (filtros, estado, prioridad, adjuntos, Panel Inteligente IA); Conversaciones solo conserva visible el `score_interes` que Inbox ya trae en su query pero nunca renderiza.

**Recomendación concreta:** Inbox = bandeja de trabajo (ya lo es). Conversaciones puede deprecarse mostrando únicamente `score_interes` dentro de Inbox (una columna nueva, no una tabla nueva) — variante de "quick win", ver N.

---

# G. MOTOR SOLAR — qué reutilizar exactamente

**Reutilizar tal cual, sin tocar:**
- `modules/motores-ingenieria/paneles-solares.js` completo — es el motor. 544 líneas de cálculo puro, ya cubre consumo/potencia/paneles/inversor/strings/área/producción/ahorro/retorno/CO₂/alertas.
- `modules/cotizaciones.js::correrYGuardarCalculo` — la capa de conexión a DB, versionado, HSP, parámetros.
- `modules/cotizacion-lineas.js` — CRUD de líneas + recálculo de totales.
- `modules/paquetes-solares.js::seleccionarPaqueteRecomendado` — selección de paquete comercial.
- `modules/cotizacion-pdf.js` (plantilla `premium_corporativo`) — ya tiene la estructura de secciones que pides.
- `modules/catalogo-tecnico.js::sanearProducto` — separación costos internos/cliente.

**Extender (nunca duplicar):**
- Agregar `seleccionarMicroinversor()` y una función de comparación string-vs-micro al MISMO archivo del motor, como funciones nuevas junto a `seleccionarInversor()` — mismo patrón, mismo archivo.
- Agregar una función de dimensionamiento de respaldo (baterías) al motor, nueva, aditiva.
- El "simulador en tiempo real" (Paso 15) es 100% viable **sin tocar el motor**: es una UI que llama a `calcularPredimensionamiento()` (ya expuesta indirectamente vía `correrCalculoCotizacionManual`) con distintos parámetros y muestra el resultado — el motor ya es puro y rápido (sin DB), diseñado para esto.

---

# H. ARQUITECTURA — cómo extender sin romper multiempresa

- Nort Energy comparte `industria_slug='paneles_solares'` con **GONDOR** y **Empresa Demo Paneles Solares** — cualquier cambio a `plantillas_industria.ui_config` para ese slug afecta a las tres. La personalización segura de Nort Energy pasa por `companies.nav_labels` (override por empresa, ya usado y probado en esta sesión), nunca por tocar la plantilla compartida.
- Todo query real filtra por `req.usuario.company_id` resuelto por sesión (nunca del body/params) — patrón a mantener sin excepción en cualquier tabla nueva.
- 17 empresas reales existen hoy — cualquier columna nueva debe ser aditiva/nullable (patrón ya usado consistentemente en las migraciones 088-108).
- El sistema de roles es binario (`esGerencial`) con una inconsistencia real ya detectada: `esGerencial()` incluye `supervisor`, pero el middleware `soloGerencial` de `server.js` y varios checks inline NO lo incluyen — **cualquier extensión de permisos para Nort Energy (roles técnicos) debe decidir primero si resuelve esta inconsistencia o la hereda**.

---

# I. MODELO DE DATOS — tablas reutilizables vs. migraciones necesarias

**Reutilizar sin cambios:** `productos`, `cotizaciones`, `cotizacion_lineas`, `calculos_ingenieria`, `paquetes_solares`, `parametros_ingenieria`, `irradiacion_regional`, `oportunidades` (ya tiene las 20 columnas solares), `documentos_proveedor`, `solar_faq`, `knowledge_requests`.

**Migraciones nuevas necesarias (propuesta, ninguna implementada todavía):**
1. `clientes_inmueble` o extender `oportunidades`: tipo de techo (con foto), pisos, orientación, sombras, área m², centro de carga, cargas por equipo (jsonb), cargas futuras (jsonb).
2. `documentos_cliente`: mismo patrón que `documentos_proveedor` pero con `cliente_id` en vez de `producto_id`, y `categoria` (recibo_cfe|identificacion|foto_techo|foto_medidor|foto_centro_carga|cotizacion|contrato|comprobante|garantia|foto_instalacion).
3. `cotizacion_lineas`: agregar `es_interno` (boolean) si se quiere BOM real desglosado con vista interna vs. cliente a nivel de línea, no solo a nivel de producto.
4. `cotizaciones`: agregar `usuario_autorizo_descuento_id`, `limite_descuento_excedido` (boolean) para trazabilidad de aprobación.
5. `oportunidades`: nada nuevo — ya tiene `razon_cierre`, solo falta conectarlo al frontend.
6. `sucursales`: si de verdad se van a usar como filtro real, agregar `sucursal_id` a `clientes`/`oportunidades`/`citas` — hoy no existe.
7. Tabla nueva `bitacora_cambios_cotizacion` si se quiere auditoría real de precio/estado (no existe ningún mecanismo hoy que lo cubra).
8. Motor: sin migración, solo funciones nuevas en el archivo existente del motor (microinversores, baterías).

---

# J. UX PROPUESTA (resumen — el detalle de menú/dashboard que pides en los puntos 2-38 de tu mensaje es coherente con lo ya construido; no se repite aquí por espacio, pero ninguna pantalla nueva propuesta requiere romper la navegación actual — todo es aditivo vía `nav_labels`)

- **Expediente 360°:** encabezado resumen (nombre, score real, etapa, asesor, último contacto, próxima acción, checklist recibo/cotización/visita/anticipo/instalación/CFE) + tabs (Resumen/Consumo/Proyecto Solar/Cotizaciones/Conversación/Documentos/Operación/Historial) — arquitectónicamente es reorganizar `CrmClienteDetalle.jsx` en tabs y AGREGAR las secciones de D (datos técnicos, documentos), no reconstruir lo existente.
- **Cotizador wizard:** los Pasos 1-4 (cliente, consumo, objetivo, dimensionamiento) ya tienen backend completo — es una UI nueva sobre `crearCotizacionBorrador`/`correrCalculoCotizacionManual`. Los Pasos 5-8 (selección panel/inversor/batería/estructura) necesitan UI nueva de tarjetas sobre `productos` (que hoy no se consume en ningún lado del frontend, ver A.3) + extender el motor (G). Los Pasos 9-16 (BOM/costeo/descuentos/financiamiento/3 propuestas/simulador/PDF) son la parte con más brecha real de backend.

---

# K. SEGURIDAD Y PERMISOS

- Costos/márgenes: ya restringidos a nivel de dato (`sanearProducto`) — falta restringir a nivel de UI en cualquier pantalla nueva de cotizador (vista interna vs. cliente, estricta, como ya pides).
- Roles técnicos (instalador/técnico) NO existen — cualquier feature de instalación/checklist que dependa de un rol "installer" requiere decidir primero: ¿se agregan valores nuevos a `usuarios_empresas.rol` (texto libre, sin migración de esquema) o se construye un sistema de permisos granular nuevo (mayor esfuerzo, no recomendado para el tamaño actual del equipo)?
- Aprobación de descuentos por encima de un límite: no existe ningún mecanismo de aprobación en todo el repo — sería la primera vez que se construye este patrón.

---

# L. PLAN POR FASES (propuesta, para tu autorización — nada de esto está implementado)

**Fase 1 — Vender mejor (expediente + cotizador básico), menor riesgo, mayor impacto:**
- Encabezado resumen + tabs en el expediente (reorganización de lo existente).
- Conectar `razon_cierre` al marcar "Perdido" (cero backend nuevo).
- Mostrar `score_interes`/`probabilidad_compra` donde falta (Inbox, expediente, pipeline).
- Agregar nodo "preguntar_nombre" al workflow de Cotización directa (dato/script).
- Pantalla real de catálogo de `productos` con tarjetas (Paso 5) — hoy no existe ninguna.
- Botón "Subir recibo CFE" manual en el expediente.

**Fase 2 — Cotizador completo:**
- Wizard completo (objetivo, cobertura, selección panel/inversor con badges de compatibilidad ya calculados por el motor).
- Descuentos con aprobación, IVA configurable, financiamiento.
- Simulador en tiempo real sobre el motor ya existente.
- 3 propuestas automáticas.

**Fase 3 — Datos técnicos + documentos:**
- Datos del inmueble, cargas, cargas futuras.
- Documentos del cliente clasificados.

**Fase 4 — Operación (instalaciones/CFE/cobranza):** construcción real desde cero, hoy es solo menú deshabilitado.

**Fase 5 — Analítica/postventa/garantías:** igual, desde cero.

---

# M. RIESGOS

- Tocar `plantillas_industria.ui_config` del slug `paneles_solares` sin aislar por `nav_labels` rompería GONDOR y Empresa Demo simultáneamente.
- Agregar roles técnicos sin resolver primero la inconsistencia `esGerencial()` vs. `soloGerencial` puede crear un tercer criterio de "quién es gerencial", empeorando la deuda ya detectada.
- Reescribir Inbox/Conversaciones sin plan de migración de datos rompería la escritura doble actual (`mensajes_humanos` + `hilos`/`mensajes`) de la que Conversaciones sigue dependiendo.
- Cualquier BOM real (líneas desglosadas panel/inversor/estructura) que reemplace el modelo de "un paquete = una línea" debe decidir primero qué pasa con las cotizaciones históricas ya cerradas con el modelo viejo.

---

# N. QUICK WINS (sin migraciones grandes)

1. Mostrar `score_interes` en Inbox y en el expediente (dato ya disponible en el query, solo falta renderizarlo).
2. Conectar `razon_cierre` al select de "Perdido" en `CrmClienteDetalle.jsx`/`CrmPipeline.jsx` (cero backend nuevo, ya está en la whitelist).
3. Agregar nodo "nombre" al workflow de Cotización directa (script, no código).
4. Botones ya construidos en backend sin botón en frontend: usar `precio_final_autorizado`, mostrar versión de cotización, mostrar `descuento_pct`/`descuento_monto` ya guardados.
5. Cambiar `0`/`$0` por `—` donde el dato realmente no existe (ya hay precedente real en `dashboard-engine.js::tasa_conversion_oportunidades`).
6. Pantalla mínima de catálogo real (`productos`) — ya existe `api.productosPorTipo()` sin usar, solo falta una página.

---

**Quedo a la espera de tu autorización antes de programar cualquier fase — como pediste, DETENGO aquí.**
