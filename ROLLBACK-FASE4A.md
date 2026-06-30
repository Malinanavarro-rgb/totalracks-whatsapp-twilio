# ROLLBACK — FASE 4A (WorkflowEngine)

Instrucciones de rollback por tarea. Ejecutar en orden inverso al avance.

**Punto de retorno limpio:** tag `fase-4a-inicio`

```bash
git checkout fase-4a-inicio
git push origin main --force   # solo si es necesario revertir producción
```

---

## T4A.1 — Revertir catálogo de intenciones en prompt-builder.js

```bash
git revert <commit-T4A.1>
```

O manualmente restaurar `bloque_schema_json` al estado de FASE 3:
```js
"intenciones": ["consulta", "cotizacion", "precio", "agenda", "soporte"]
```

## T4A.2 — Revertir filtro de intenciones en openai-provider.js

```bash
git revert <commit-T4A.2>
```

## T4A.3 — Eliminar tabla workflows

```sql
DROP TABLE IF EXISTS workflows CASCADE;
```

## T4A.4 — Eliminar tabla workflow_nodes

```sql
DROP TABLE IF EXISTS workflow_nodes CASCADE;
```

## T4A.5 — Eliminar tabla workflow_sessions

```sql
DROP TABLE IF EXISTS workflow_sessions CASCADE;
```

## T4A.6 — Eliminar módulo workflow-engine.js

```bash
rm modules/workflow-engine.js
git revert <commit-T4A.6>
```

## T4A.7 — Revertir integración en orchestrator.js

```bash
git revert <commit-T4A.7>
```

## T4A.8 — Eliminar seed de Descubrimiento Comercial

```sql
DELETE FROM workflow_nodes WHERE workflow_id IN (
  SELECT id FROM workflows WHERE nombre = 'Descubrimiento Comercial'
);
DELETE FROM workflows WHERE nombre = 'Descubrimiento Comercial';
```

---

## Rollback completo FASE 4A (nuclear)

```bash
# 1. Código
git checkout fase-4a-inicio
git push origin main --force

# 2. DB — orden correcto (respetar foreign keys)
DROP TABLE IF EXISTS workflow_sessions CASCADE;
DROP TABLE IF EXISTS workflow_nodes    CASCADE;
DROP TABLE IF EXISTS workflows         CASCADE;
```

Después del rollback, `prompt-builder.js` y `openai-provider.js` vuelven al estado de FASE 3. Los módulos del Kernel de FASE 3 no se ven afectados.

**Verificación post-rollback:**
```bash
npm test   # debe pasar 349/349
```
