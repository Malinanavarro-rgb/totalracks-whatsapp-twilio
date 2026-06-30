# FASE 4A — WorkflowEngine (M5)
## Plan Maestro · Aprobado · 29 de junio de 2026

---

## Contexto

FASE 3 convirtió TARA en una plataforma multi-tenant. Un servidor sirve a N empresas con aislamiento completo.

FASE 4A agrega la capacidad de guiar conversaciones por flujos estructurados configurables desde Supabase. Sin tocar código para agregar un flujo nuevo.

FASE 4B (ActionRunner) viene después, una vez validado que los workflows funcionan en producción.

---

## Decisiones de arquitectura aprobadas

### 1. Intenciones — catálogo controlado

`intenciones` pasa de ser un array libre a un catálogo cerrado de 6 valores. No se agrega ningún campo nuevo al AIOutput. El WorkflowEngine evalúa si algún valor del array coincide con el trigger del workflow.

**Catálogo:**

| Valor | Cuándo aplica |
|-------|--------------|
| `interes_compra` | El cliente expresa interés en adquirir |
| `solicitud_cotizacion` | Pide precio, cotización o presupuesto específico |
| `soporte` | Reporta problema o necesita ayuda técnica |
| `seguimiento` | Hace seguimiento de algo ya acordado |
| `cancelar_flujo` | Quiere salir de un flujo activo |
| `consulta_general` | Información sin intención comercial clara |

Si el mensaje contiene varias intenciones que coinciden con workflows distintos, el WorkflowEngine activa el de mayor `prioridad` (campo en tabla `workflows`, menor número = mayor prioridad).

### 2. Nombre del primer workflow

"Descubrimiento Comercial" — nombre genérico que funciona para cualquier industria. No "Calificación de Lead".

**Campos del Descubrimiento Comercial:**

| Campo | Requerido |
|-------|-----------|
| `nombre_contacto` | Sí |
| `empresa` | Sí |
| `tipo_proyecto` | Sí |
| `volumen_estimado` | Sí |
| `plazo_compra` | Sí |
| `presupuesto_aproximado` | **No** — flujo continúa si el cliente no lo proporciona |

### 3. workflow_sessions — tabla independiente

El estado operativo del workflow nunca vive en `conversaciones`. `workflow_sessions` es la única fuente de verdad del estado activo de un flujo.

### 4. Playbook — diferido a FASE 5

`playbook_id uuid nullable` reservado en tabla `workflows` para evitar migración posterior. No se implementa en FASE 4.

### 5. Métricas desde FASE 4A

Datos suficientes para medir sin dashboard. Todo en `workflow_sessions`:

| Métrica | Cómo se obtiene |
|---------|----------------|
| Workflows iniciados | `COUNT(*) WHERE company_id = ?` |
| Workflows completados | `COUNT(*) WHERE status = 'completado'` |
| Workflows cancelados | `COUNT(*) WHERE status = 'abandonado'` |
| Nodo de abandono más común | `GROUP BY nodo_abandono ORDER BY COUNT(*) DESC` |
| Duración promedio | `AVG(completed_at - started_at) WHERE status = 'completado'` |
| Porcentaje de finalización | completados / total |

---

## Schema de tablas nuevas

### `workflows`
```sql
CREATE TABLE workflows (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      uuid    NOT NULL REFERENCES companies(id),
  playbook_id     uuid,   -- nullable, reservado para FASE 5
  nombre          text    NOT NULL,
  descripcion     text,
  trigger         text    NOT NULL DEFAULT 'intent',
  -- valores: 'intent' | 'keyword' | 'always'
  trigger_value   text    NOT NULL,
  -- para intent: valor del catálogo ('interes_compra', etc.)
  -- para keyword: texto exacto a detectar
  prioridad       integer NOT NULL DEFAULT 10,
  -- menor número = mayor prioridad (para conflictos entre workflows)
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);
```

### `workflow_nodes`
```sql
CREATE TABLE workflow_nodes (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id     uuid    NOT NULL REFERENCES workflows(id),
  nombre          text    NOT NULL,  -- slug único dentro del workflow
  es_inicio       boolean NOT NULL DEFAULT false,
  es_fin          boolean NOT NULL DEFAULT false,
  pregunta        text,   -- lo que TARA pregunta al llegar al nodo
  campo           text,   -- nombre del campo a capturar en captured_fields
  tipo_campo      text    NOT NULL DEFAULT 'text',
  -- valores: 'text' | 'number' | 'phone' | 'email'
  es_opcional     boolean NOT NULL DEFAULT false,
  validacion      text,   -- regex simple o null
  siguiente_nodo  text,   -- nombre del nodo siguiente (null si es_fin = true)
  acciones        jsonb   NOT NULL DEFAULT '[]',
  -- acciones a ejecutar al COMPLETAR este nodo
  -- ej: [{"tipo": "crear_oportunidad"}]
  orden           integer NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);
```

### `workflow_sessions`
```sql
CREATE TABLE workflow_sessions (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      uuid        NOT NULL REFERENCES companies(id),
  cliente_id      uuid        NOT NULL REFERENCES clientes(id),
  conversation_id uuid        REFERENCES conversaciones(id),
  workflow_id     uuid        NOT NULL REFERENCES workflows(id),
  current_node    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'activo',
  -- valores: activo | completado | abandonado | error
  captured_fields jsonb       NOT NULL DEFAULT '{}',
  nodo_abandono   text,       -- nodo donde se abandonó (para métricas)
  total_turnos    integer     NOT NULL DEFAULT 0,
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz,
  updated_at      timestamptz DEFAULT now()
);
```

---

## Módulo WorkflowEngine (M5)

Ubicación: `modules/workflow-engine.js`

Interface pública:

```js
class WorkflowEngine {
  constructor(supabase) { }

  // Evalúa si alguna intención activa un workflow para esta empresa.
  // Retorna el workflow de mayor prioridad, o null.
  async evaluar(company_id, intenciones)

  // Retorna la sesión activa de un cliente, o null.
  async obtenerSesionActiva(company_id, cliente_id)

  // Obtiene el nodo actual de una sesión.
  async obtenerNodoActual(sesion)

  // Avanza la sesión al siguiente nodo, guarda el campo capturado.
  async avanzar(sesion_id, campo_capturado, valor)

  // Abandona el flujo activo. Registra el nodo de abandono.
  async abandonar(sesion_id)

  // Crea una nueva sesión de workflow.
  async iniciarSesion(company_id, cliente_id, conversation_id, workflow_id)
}
```

---

## Integración con Orchestrator

El WorkflowEngine se inserta en el Orchestrator **después** de que el AI procesa el mensaje. Flujo completo:

```
Mensaje entra
    │
    ▼
¿Hay sesión de workflow activa para este cliente?
    │
    ├── SÍ → WorkflowEngine.obtenerNodoActual()
    │          │
    │          ├── intent = 'cancelar_flujo' → abandonar() → conversación libre
    │          │
    │          └── campo válido → avanzar()
    │                              ├── ¿es_fin? → completar sesión + ejecutar acciones
    │                              └── siguiente nodo → TARA pregunta el campo siguiente
    │
    └── NO → AI procesa normalmente
               │
               └── WorkflowEngine.evaluar(company_id, aiOutput.intenciones)
                       ├── match → iniciarSesion() → TARA responde + pregunta nodo_inicio
                       └── no match → respuesta libre normal
```

---

## Tareas

| ID | Tarea | Tipo | DoD |
|----|-------|------|-----|
| [T4A.0](T4A.0-baseline.md) | Preparación: tag, ROLLBACK-FASE4A.md | Setup | Tag creado, rollback documentado |
| [T4A.1](T4A.1-intenciones-catalog.md) | `prompt-builder.js`: catálogo controlado en schema JSON | Código | Tests pasando, 6 valores exactos |
| [T4A.2](T4A.2-normalize-intenciones.md) | `openai-provider.js`: filtrar intenciones contra catálogo | Código | Valores inválidos → `consulta_general` |
| [T4A.3](T4A.3-migration-workflows.md) | Migration: tabla `workflows` | DB | Tabla creada en Supabase |
| [T4A.4](T4A.4-migration-nodes.md) | Migration: tabla `workflow_nodes` | DB | Tabla creada en Supabase |
| [T4A.5](T4A.5-migration-sessions.md) | Migration: tabla `workflow_sessions` | DB | Tabla creada con campos de métricas |
| [T4A.6](T4A.6-workflow-engine.md) | Módulo `workflow-engine.js` (M5) | Código | Tests unitarios pasando |
| [T4A.7](T4A.7-orchestrator-integration.md) | Integración M5 → Orchestrator | Código | Tests integración pasando |
| [T4A.8](T4A.8-seed-descubrimiento.md) | Seed: workflow Descubrimiento Comercial Total Racks | DB | 5 nodos + cierre en Supabase |
| [T4A.9](T4A.9-tests-unit.md) | Tests unitarios WorkflowEngine | Tests | Cobertura evaluar/avanzar/abandonar |
| [T4A.10](T4A.10-tests-integration.md) | Tests integración Orchestrator + M5 | Tests | Flujo completo mockeado |
| [T4A.11](T4A.11-deploy.md) | Deploy + validación producción | Validación | Descubrimiento Comercial activo en TR |
| [T4A.12](T4A.12-isolation.md) | Validación aislamiento entre empresas | Validación | Sesión de empresa A no afecta empresa B |

---

## Criterios de éxito FASE 4A

1. Intent `interes_compra` en el array de intenciones activa el Descubrimiento Comercial automáticamente
2. TARA guía 5 preguntas en secuencia sin código adicional — solo filas en Supabase
3. `presupuesto_aproximado` puede quedar `null` sin bloquear el flujo
4. `cancelar_flujo` en cualquier punto abandona el workflow y regresa a conversación libre
5. `workflow_sessions.captured_fields` contiene los 5-6 campos al completar
6. Métricas disponibles por SQL: iniciados, completados, abandonados, nodo de abandono, duración
7. 349+ tests pasando al cierre
8. Workflow de Total Racks no interfiere con clientes de SPAZIO u otras empresas

---

## Rollback

Ver [ROLLBACK-FASE4A.md](../../../ROLLBACK-FASE4A.md) en la raíz del proyecto.

## Bitácora

| Fecha | Evento |
|-------|--------|
| 2026-06-29 | Plan Maestro aprobado — inicio de implementación |
