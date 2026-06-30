# Constitución de TARA Matrix™

Este directorio contiene la constitución del sistema: los principios fundamentales que definen qué es TARA, cómo funciona y cuáles son las reglas que nunca deben romperse.

La constitución no es documentación técnica — es la intención del sistema. Cualquier decisión técnica que la contradiga es un error de diseño.

---

## Documento principal

El documento de la Constitución de TARA Matrix™ v3 fue definido por la fundadora Alina Navarro al inicio de FASE 3.

**18 principios que definen:**
- Qué es TARA Matrix™ (Sistema Operativo para Asistentes Empresariales)
- La jerarquía de entidades: Organization → Company → Workspace → Assistant
- La arquitectura del Kernel: Brain / Skills / Tools / Channels
- Las reglas para desarrolladores
- El modelo de multi-tenancy
- El roadmap de módulos M1–M9

> El documento completo de la Constitución v3 se encuentra en el historial de la conversación de inicio de FASE 3 (junio 2026) y debe ser transcrito aquí como `v3-constitution.md` en la próxima sesión de documentación.

---

## Principios irrenunciables (resumen)

1. **TARA es un OS, no un bot.** Cada empresa instancia su propio asistente encima del mismo Kernel.
2. **El Kernel no conoce canales ni proveedores de IA.** La hexagonalidad no es opcional.
3. **company_id es sagrado.** Todo dato en el sistema pertenece a exactamente una empresa.
4. **El aislamiento se prueba, no se asume.** Cada release valida vectores de contaminación.
5. **Estabilidad antes que velocidad.** Una fase completa y estable vale más que dos fases a medias.
