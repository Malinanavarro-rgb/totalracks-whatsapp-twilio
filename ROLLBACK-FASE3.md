# ROLLBACK FASE 3 — Instrucciones de Emergencia

**Creado:** 2026-06-29  
**Aplica a:** Cualquier problema surgido durante la implementación de FASE 3

---

## Diagnóstico rápido antes de hacer rollback

```bash
# 1. Verificar estado del servidor
curl https://totalracks-whatsapp-twilio.onrender.com/api/diagnostics

# 2. Revisar logs recientes en Render
# Dashboard → tara-matrix → Logs → últimas 50 líneas

# 3. Verificar git
git log --oneline -5
git tag --list "fase-3*"
```

---

## Rollback de CÓDIGO (cualquier tarea T3.4 a T3.10)

```bash
# Opción A — revertir el último commit
git revert HEAD
git push origin main

# Opción B — volver exactamente al estado pre-FASE 3
git checkout fase-3-inicio
git checkout -b hotfix/rollback-fase3
git push origin hotfix/rollback-fase3
# En Render: cambiar el branch a hotfix/rollback-fase3 y hacer manual deploy
```

Render redeploya automáticamente en ~2 minutos.  
**Tiempo estimado de rollback de código: 3-5 minutos.**

---

## Rollback de BASE DE DATOS por tarea

### Deshacer T3.1 (tabla channel_endpoints)
```sql
DROP TABLE IF EXISTS channel_endpoints;
```
**Seguro:** no hay datos de producción aquí, la tabla es nueva.

### Deshacer T3.2 (seed número Total Racks)
```sql
DELETE FROM channel_endpoints WHERE canal = 'whatsapp';
-- O más específico:
DELETE FROM channel_endpoints WHERE company_id = '<UUID_TOTALRACKS>';
```

### Deshacer T3.3 (company_id en tablas CRM)
```sql
-- PRECAUCIÓN: ejecutar ANTES de que haya datos reales de múltiples empresas
ALTER TABLE clientes       DROP COLUMN IF EXISTS company_id;
ALTER TABLE conversaciones DROP COLUMN IF EXISTS company_id;
ALTER TABLE oportunidades  DROP COLUMN IF EXISTS company_id;
```
**Nota:** los datos existentes de clientes/conversaciones/oportunidades NO se pierden — solo se elimina la columna.

### Deshacer datos de empresas de prueba (T3.11, T3.12)
```sql
-- Reemplazar 'slug-empresa' por el slug real
DELETE FROM channel_endpoints WHERE company_id IN (SELECT id FROM companies WHERE slug NOT IN ('totalracks'));
DELETE FROM knowledge_base      WHERE company_id IN (SELECT id FROM companies WHERE slug NOT IN ('totalracks'));
DELETE FROM personalities       WHERE company_id IN (SELECT id FROM companies WHERE slug NOT IN ('totalracks'));
DELETE FROM clientes            WHERE company_id IN (SELECT id FROM companies WHERE slug NOT IN ('totalracks'));
DELETE FROM conversaciones      WHERE company_id IN (SELECT id FROM companies WHERE slug NOT IN ('totalracks'));
DELETE FROM oportunidades       WHERE company_id IN (SELECT id FROM companies WHERE slug NOT IN ('totalracks'));
DELETE FROM companies           WHERE slug NOT IN ('totalracks');
```

---

## Verificar que Total Racks funciona después del rollback

```bash
# 1. Diagnósticos deben retornar 7/7 OK
curl https://totalracks-whatsapp-twilio.onrender.com/api/diagnostics | python3 -m json.tool

# 2. Enviar mensaje de prueba por WhatsApp al número de Total Racks
# TARA debe responder con su personalidad normal

# 3. Verificar en Supabase
# SELECT COUNT(*) FROM clientes;   -- debe tener los registros previos intactos
# SELECT COUNT(*) FROM decision_logs ORDER BY created_at DESC LIMIT 5;  -- debe tener actividad reciente
```

---

## Contacto de emergencia

Si algo está completamente roto y los rollbacks anteriores no funcionan:

1. Abrir una nueva sesión con Claude
2. Compartir el output de `/api/diagnostics`
3. Compartir los últimos 20 líneas de logs de Render
4. Mencionar hasta qué tarea se había llegado (T3.X)

---

## Estado en el momento de crear este documento

- Último commit: `67eb258 fix: pasar twilioClient al TwilioWhatsAppAdapter`
- Tag de rollback: `fase-3-inicio`
- Tests: 349/349 pasando
- Diagnósticos: 7/7 OK (verificar en `/api/diagnostics` antes de empezar)
- Tablas en Supabase: companies, personalities, knowledge_base, decision_logs, clientes, conversaciones, oportunidades, cotizaciones
- `COMPANY_SLUG` activo: `totalracks`
