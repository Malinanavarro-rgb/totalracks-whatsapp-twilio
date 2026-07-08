# ROLLBACK — ANEXO A (Motor de Agenda)

Instrucciones de rollback por tarea. Ejecutar en orden inverso al avance.

**Punto de retorno limpio:** tag `anexo-a-inicio`

```bash
git checkout anexo-a-inicio
git push origin main --force   # solo si es necesario revertir producción
```

---

## TA.1 — Eliminar puerto CalendarProvider + MockCalendarProvider

```bash
rm -rf adapters/calendar/
rm __tests__/calendar-provider.test.js
git revert <commit-TA.1>
```

## TA.2 — Eliminar tablas de agenda

```sql
DROP TABLE IF EXISTS citas               CASCADE;
DROP TABLE IF EXISTS horarios_laborales  CASCADE;
DROP TABLE IF EXISTS asesores            CASCADE;
DROP TABLE IF EXISTS calendar_credentials CASCADE;
```

(Orden inverso a la creación, respetando foreign keys: `citas` referencia `asesores`; `horarios_laborales` referencia `asesores`.)

## TA.3 — Eliminar módulo scheduling-engine.js

```bash
rm modules/scheduling-engine.js
rm __tests__/scheduling-engine.test.js
git revert <commit-TA.3>
```

## TA.4 — Revertir extracción de ActionRunner

```bash
rm modules/action-runner.js
rm __tests__/action-runner.test.js
git revert <commit-TA.4>
```

Restaura el `if (accion.tipo === 'crear_oportunidad')` hardcodeado dentro de `Orchestrator._ejecutarAcciones()` (comportamiento de FASE 4B).

---

## Rollback completo ANEXO A — TA.0 a TA.4 (nuclear)

```bash
# 1. Código
git checkout anexo-a-inicio
git push origin main --force

# 2. DB — orden correcto (respetar foreign keys)
DROP TABLE IF EXISTS citas                CASCADE;
DROP TABLE IF EXISTS horarios_laborales   CASCADE;
DROP TABLE IF EXISTS asesores             CASCADE;
DROP TABLE IF EXISTS calendar_credentials CASCADE;
```

Después del rollback, `orchestrator.js` vuelve al stub de FASE 4B (`crear_oportunidad` hardcodeado) y no existen `CalendarProvider`, `SchedulingEngine` ni `ActionRunner`. Los módulos de FASE 4B y anteriores no se ven afectados.

**Verificación post-rollback:**
```bash
npm test   # debe pasar 384/384
```

---

## Nota — TA.0.1 (Google Cloud / OAuth) no tiene rollback de código

La creación del proyecto de Google Cloud y la pantalla de consentimiento OAuth se gestionan directamente en Google Cloud Console (fuera del repositorio). Un rollback de ese paso es administrativo (eliminar o despausar el proyecto en la consola), no requiere ninguna acción en este repositorio.
