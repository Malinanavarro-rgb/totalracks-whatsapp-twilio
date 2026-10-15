# Inventario universal de módulos — Nort Energy → TARA Module Engine

**Fecha:** 2026-10-16
**Alcance:** auditoría de los módulos ya construidos para Nort Energy, clasificados para preparar el mapeo hacia el Module Engine. Ninguna suscripción, permiso ni dato productivo se tocó para producir este documento — es lectura y clasificación, no implementación.

**Clave de clasificación:**
- **U (Universal)** — cualquier empresa de cualquier giro puede usarlo tal cual.
- **E (Especializado)** — el patrón es genérico, pero requiere que el negocio tenga el concepto base (ej. "instalación física", "proyecto con entrega") — reutilizable para industrias similares (Gondor), no para todas.
- **X (Exclusivo de Nort Energy)** — contenido o lógica específica de energía solar/México que no se reutiliza sin escribir una pieza nueva.

| Módulo | Clasif. | Endpoints reales | Tablas | Permiso (`roles_permisos`) | Dependencias | Estado operativo |
|---|---|---|---|---|---|---|
| CRM | **U** | 25 | `clientes`, `oportunidades`, `seguimientos`, `documentos_cliente` | `crm` | Ninguna (base) | Operativo y probado — usado por Nort Energy, Total Racks y otras empresas reales |
| Cotizaciones (estructura) | **U** | 25 | `cotizaciones`, `cotizacion_lineas`, `envios_documento` | `cotizaciones` | CRM | Operativo — hallazgo reciente: el paso "aplicar paquete/BOM" es poco visible (`NORT_ENERGY_LUCIA_DIAGNOSTICO.md`) |
| Motor de cálculo de cotización | **X** | — (interno) | `calculos_ingenieria` | — | Cotizaciones | Operativo, correctamente aislado detrás de `obtenerMotor(industriaSlug)` — otra industria registra su propio motor sin tocar este |
| Agenda / Scheduling | **U** | No auditado en esta pasada (fuera del bloque Nort Energy reciente) | `citas`, `servicios` | **Ninguno — hueco confirmado, nunca se conectó a `requirePermiso`** | Ninguna | Operativo, usado también por Salón de Belleza |
| Proyectos | **E** | 11 | `proyectos`, `bitacora_decisiones` | `proyectos` | Cotizaciones (cotización aceptada → proyecto) | Operativo, **0 proyectos reales** (ver `NORT_ENERGY_AUDIT_V2.md`, hallazgo central) |
| Cobranza | **E** | 3 | `pagos_cliente`, `pagos_cliente_abonos` | `cobranza` | Proyectos | Operativo, RPC atómica probada con concurrencia real, 0 datos reales |
| Instalaciones + Equipos | **E** | 14 | `instalaciones`, `equipos_instalados` | `instalaciones` | Proyectos | Operativo, 0 datos reales |
| Inventario | **U** | 3 (+ reserva/consumo vía Instalaciones) | `productos`, `inventario_saldos`, `inventario_movimientos`, `sucursales` | `inventario` | Ninguna dura (opcional: Proyectos, para reservar) | Operativo, RPC atómica probada con concurrencia real |
| Compras | **U** | 9 | `proveedores`, `ordenes_compra`, `orden_compra_items`, `documentos_proveedor` | `compras` | Inventario (recibir actualiza existencia) | Operativo — 1 orden real (Growatt+Aluminext), en borrador |
| Trámites CFE | **X** | 4 | `tramites_cfe` | `tramites_cfe` | Proyectos | Operativo, 0 datos reales — el PATRÓN (trámite con autoridad externa + seguimiento) es generalizable, el CONTENIDO (CFE específicamente) no |
| Garantías | **E** | 5 | `garantias`, `garantia_reclamaciones` | `garantias` | Equipos instalados | Operativo — fix de permisos reciente (re-auditoría 2026-10-14) |
| Mantenimiento | **E** | 5 | `mantenimientos` | `mantenimiento` | Proyectos | Operativo |
| Tickets | **U** | 6 | `tickets` | `tickets` | Clientes (no requiere proyecto) | Operativo |
| Portal del cliente | **E** | 7 | tablas de sesión de portal | — (cliente-facing, no empleado) | Proyectos (multi-proyecto por cliente) | Operativo, aislamiento cliente-por-cliente probado exhaustivamente (P1.4) |
| Configuración | **U** | 40 (el módulo más grande) | múltiples (horarios, servicios, asesores, pipeline_etapas, canales, usuarios, workflows) | `configuracion` (parcial) | Ninguna | Operativo — re-auditoría reciente dejó 11 lecturas deliberadamente abiertas (ver commit `06ea187`) |
| Dashboard (motor) | **U** | — | — (calcula sobre las tablas de arriba) | — | Todos los anteriores (lee de ellos) | Operativo |
| Dashboard (contenido KPI de Nort Energy) | **X** | — | `companies.nav_labels`/seed de KPIs | — | Proyectos/Instalaciones/Cobranza/etc. | Operativo (honesto, refleja que hay 0 proyectos reales) |
| Centro de Conocimiento / Modo Operador / BMC / KCE | **U** (motor) | ver `TARA_AI_ENGINE_ARCHITECTURE_V1.md` | `memoria_empresarial`, `kce_ejecuciones`, `decision_logs` | gerencial-only (`esGerencial`) | Ninguna dura | Operativo, maduro |
| Roles departamentales | **U** | — (middleware, no endpoints propios) | `roles_permisos` | — (es el propio sistema de permisos) | Ninguna | Construido esta sesión, 134 rutas reales gateadas |
| Clasificación de contacto | **U** | 1 (`PATCH /clasificacion`) | `clientes.tipo_contacto*` | `crm` | CRM | Construido 2026-10-14 |
| Medición de consumo de IA | **U** | — (interno) | `ia_consumo_logs` | — | Ninguna | Construido hoy (Fase 1), ver reporte de entrega |

## Lectura rápida — lo que esto significa para el Module Engine

- **12 de 19 piezas ya son Universales o Especializadas-reutilizables** (CRM, Cotizaciones-estructura, Agenda, Inventario, Compras, Tickets, Configuración, Dashboard-motor, BMC/KCE/Modo Operador, Roles, Clasificación, Medición de IA) — listas para ofrecerse a cualquier empresa sin desarrollo adicional, solo con la activación real que falta construir (Module Engine).
- **Proyectos/Cobranza/Instalaciones/Garantías/Mantenimiento/Portal del cliente son Especializados** — el código ya es genérico (ningún `if company===nort-energy`), pero conceptualmente asumen un negocio con entrega/instalación física. Gondor (servicios para el hogar, mencionado en tu visión) encajaría aquí casi sin cambios — "instalaciones" ya podría llamarse "órdenes de trabajo" solo cambiando la etiqueta visible (`nav_labels`), no el código.
- **Solo 2 piezas son genuinamente Exclusivas de Nort Energy**: el motor de cálculo de paneles solares (ya correctamente aislado) y Trámites CFE (contenido específico de México/energía, aunque el patrón de "trámite con autoridad externa" es reutilizable si otra empresa lo necesita).
- **El hueco más importante para el Module Engine, confirmado aquí:** Agenda nunca se conectó al sistema de permisos (`roles_permisos`) — si se activa/desactiva por plan en el futuro, hoy no hay forma de impedir su uso en backend, solo ocultar el link de navegación.

Ningún dato, suscripción ni permiso productivo se modificó para producir este inventario.
