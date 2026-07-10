# ADR-006 — El cliente como entidad central: Ficha 360°

| Campo | Valor |
|-------|-------|
| Estado | Aceptada |
| Fecha | 9 de julio de 2026 |
| Autora | Alina Navarro |
| Relacionado | ADR-005 (Core baseline v1) |

---

## Contexto

Durante la construcción de Fase 3 (Conversaciones), Fase 4 (Agenda) y Fase 5 (CRM) de la Plataforma SaaS, se pidió explícitamente fijar un principio de arquitectura: **el cliente debe ser la entidad central de toda la plataforma**, no un dato fragmentado entre módulos. La visión de largo plazo es una **Ficha 360°** por cliente que concentre: datos generales, conversaciones de WhatsApp, agenda/citas, seguimientos manuales, asesor asignado, estado comercial, cotizaciones, pedidos, facturas, archivos, notas internas y resumen generado por IA — sin que agregar un módulo nuevo obligue a rediseñar los anteriores.

## Decisión

### 1. `clientes` es la tabla raíz; todo módulo nuevo cuelga de `cliente_id` + `company_id`

Ya es el patrón seguido, sin excepción, en las 5 tablas construidas hasta hoy:

| Tabla | cliente_id | company_id | Módulo/Fase |
|---|:---:|:---:|---|
| `conversaciones` | ✅ | ✅ | Motor (Anexo A) |
| `oportunidades` | ✅ | ✅ | Motor (Anexo A) |
| `citas` | ✅ | ✅ | Motor (Anexo A) |
| `mensajes_humanos` | ✅ | ✅ | Fase 3 |
| `seguimientos` | ✅ | ✅ | Fase 5 |

**Regla vigente hacia adelante:** cualquier módulo nuevo (Cotizaciones, Pedidos, Facturas, Archivos, o lo que surja) se construye con esta misma forma — `cliente_id` + `company_id` en la tabla, nunca un silo aparte identificado solo por su propio ID. `company_id` se mantiene denormalizado en cada tabla hija (en vez de resolverse solo vía join a `clientes`) por la misma razón ya establecida en el motor: aislamiento multiempresa verificable en cada query sin depender de un join.

### 2. Un único agregador de lectura: `crm-ui.obtenerFichaCliente()`

`modules/crm-ui.js` ya implementa el primer corte de la Ficha 360° — junta en una sola respuesta: datos del cliente, historial de conversaciones (reusando `conversaciones.obtenerHistorial()`, Fase 3), historial completo de citas (Fase 4) y oportunidades. **Este es el punto de extensión permanente:** cuando se construya Cotizaciones/Pedidos/Facturas/Archivos, se agregan como una rama más de ese mismo `Promise.all`, no como pantallas que reinventan su propio join contra `clientes`. Ninguna pantalla nueva debe volver a ensamblar por su cuenta "todo lo de un cliente" — llama a este agregador.

### 3. Dos conceptos de "asesor" — intencionalmente distintos, no fragmentación

- `clientes.asesor_id` (→ `usuarios.id`): quién **atiende la conversación/relación con el cliente ahora mismo** (Fase 3 — cambia con "Tomar conversación"/"Regresar a TARA").
- `asesores.usuario_id` (→ `usuarios.id`): a qué **login corresponde un recurso de agenda** (Fase 4 — ej. la estilista "Ana" puede no tener login propio; un Owner puede agendar por varios asesores sin ser él mismo un recurso de agenda).

Responden preguntas distintas (relación comercial vs. recurso agendable) y pueden apuntar a usuarios distintos del mismo cliente en el mismo momento. No se unifican — unificarlos sería forzar dos conceptos de negocio reales a compartir una sola columna.

### 4. `clientes.notas` (campo único) vs. futura "Notas internas" (bitácora)

`clientes.notas` (Fase 4) es una descripción corta capturada en el alta manual — un campo, no una bitácora. Cuando se construya "Notas internas" como funcionalidad propia (varias notas, por usuario, con fecha), será una tabla nueva con la misma forma que `seguimientos` (`cliente_id` + `company_id` + `usuario_id` + `texto` + `created_at`), no una expansión de `clientes.notas`. Ambas coexisten sin conflicto: una es snapshot, la otra es historial.

### 5. Pendiente de higiene menor (no bloqueante)

`mensajes_humanos.cliente_id` se creó como `integer` (migración 027) mientras el resto de las tablas usa `bigint` (mismo tipo que `clientes.id`). Postgres permite la FK cruzada sin error, así que no es un bug — pero se corrige por consistencia en migración 030.

### 6. Módulos futuros con forma técnica distinta — no bloquean hoy, sí necesitan diseño propio cuando lleguen

- **Archivos**: además de una tabla de metadatos (mismo patrón `cliente_id`/`company_id`), requiere almacenamiento de blobs (Supabase Storage) — diseño propio cuando se construya, sin impacto en lo ya construido.
- **Facturas**: probablemente requiera cumplimiento fiscal (folios, CFDI si aplica México) — merece su propio diseño dedicado, no "una tabla más", cuando llegue el momento.
- **Resumen generado por IA**: ya existe una primera pieza (`modules/summary.js`, hoy usado para comprimir contexto hacia OpenAI, no para mostrarse en UI). Es candidato natural para conectarse a la Ficha 360° cuando se construya esa vista, sin necesidad de rediseñarlo — mismo `cliente_id` como entrada.

## Consecuencia

Ninguna decisión tomada en Fase 3 (Conversaciones), Fase 4 (Agenda) o Fase 5 (CRM) requiere rediseño. El patrón `cliente_id`+`company_id` por tabla, más `obtenerFichaCliente()` como agregador único, es la base sobre la que Cotizaciones, Pedidos, Facturas, Archivos y Notas internas se conectan sin fricción cuando se construyan.

## Regla de cambio

Todo módulo nuevo que almacene información asociada a un cliente:
1. Su tabla incluye `cliente_id` (bigint, FK a `clientes`) y `company_id` (uuid, FK a `companies`).
2. Se expone como una rama nueva de `crm-ui.obtenerFichaCliente()`, no como una vista aislada.
3. Si tiene una forma técnica genuinamente distinta (archivos, facturación), se documenta como excepción explícita en este ADR antes de construirse.
