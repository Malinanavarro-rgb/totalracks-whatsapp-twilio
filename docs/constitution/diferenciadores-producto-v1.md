# TARA-OS — Diferenciadores de Producto v1

| Campo | Valor |
|-------|-------|
| Número de documento | TARA-CONST-002 |
| Versión | 1.0 |
| Estado | Definitivo |
| Fecha de aprobación | 21 de julio de 2026 |
| Autora | Alina Navarro — fundadora TARA Matrix™ |
| Relación con la Constitución | Complementa [`v3-constitution.md`](v3-constitution.md) (TARA-CONST-001). La Constitución define **qué es** TARA Matrix a nivel de arquitectura; este documento define **por qué gana en el mercado** — ambos son vinculantes, ninguno reemplaza al otro. |

---

> **Estas decisiones son obligatorias y deben reflejarse en la arquitectura, la UX, la IA y el desarrollo.**
> Cualquier función, pantalla o decisión de diseño que contradiga estos seis diferenciadores es un error de producto, aunque el código funcione correctamente.

---

## Premisa

Convertir las cinco (ahora seis) mayores debilidades del mercado de CRMs/ERPs/asistentes con IA en las seis mayores fortalezas de TARA-OS. No son aspiraciones — son restricciones de diseño, con el mismo rango que los Artículos de la Constitución.

---

## DIFERENCIADOR 1 — TARA piensa, no solo responde

**Problema de la competencia:** CRMs, ERPs y asistentes con IA únicamente reaccionan cuando el usuario pregunta algo. Esperan instrucciones. No analizan el negocio, no detectan problemas, no proponen mejoras.

**Fortaleza de TARA:** TARA debe comportarse como un **Director Operativo** — analizar continuamente conversaciones, agenda, ventas, clientes, productividad, tiempos, ingresos, inventario y campañas, y generar recomendaciones automáticas sin que nadie las pida.

Ejemplos:
- "Perdiste 12 clientes esta semana por responder tarde."
- "Los martes tu equipo vende 28% más."
- "Esta sucursal tiene capacidad ociosa."

No esperar órdenes. Buscar oportunidades.

## DIFERENCIADOR 2 — Un solo cerebro empresarial

**Problema de la competencia:** cada módulo vive separado (CRM, agenda, WhatsApp, ventas, inventario, reportes) y no se comunican entre sí.

**Fortaleza de TARA:** todo pertenece al mismo cerebro. Una conversación debe afectar automáticamente CRM, Agenda, Ventas, Inventario, Seguimientos, Reportes e IA. Nunca duplicar información. Nunca crear islas. Todo conectado.

## DIFERENCIADOR 3 — Memoria empresarial

**Problema de la competencia:** recuerdan únicamente conversaciones recientes. Olvidan todo lo demás.

**Fortaleza de TARA:** TARA debe recordar permanentemente clientes, hábitos, temporadas, vendedores, campañas, errores, preferencias, compras, productividad e historial completo. Cada interacción enriquece el conocimiento de la empresa. Mientras más tiempo pase, más inteligente debe ser.

## DIFERENCIADOR 4 — Explicar el porqué

**Problema de la competencia:** muestran números, pero no ayudan a entenderlos.

**Fortaleza de TARA:** cada recomendación debe incluir qué sucede, por qué sucede, qué evidencia encontró, qué riesgo existe y qué recomienda hacer.

Ejemplo:
> "No recomendamos contratar otra recepcionista. Analizamos 14 semanas. El problema no es personal insuficiente. El problema es la distribución de horarios."

La IA debe justificar sus decisiones, siempre.

## DIFERENCIADOR 5 — Obsesión por la simplicidad

**Problema de la competencia:** los sistemas empresariales parecen hechos para administradores — demasiadas tablas, demasiados botones, demasiados reportes.

**Fortaleza de TARA:** un dueño debe abrir el sistema y en menos de diez segundos saber cuánto ganó, qué está mal, qué debe hacer hoy, qué clientes están en riesgo y dónde está la mayor oportunidad. Toda pantalla debe responder esa pregunta. Eliminar cualquier elemento que no aporte valor.

## DIFERENCIADOR 6 — TARA aprende del negocio

*(la firma de TARA — la más difícil de copiar)*

No basta con tener memoria (Diferenciador 3); TARA debe **mejorar con el tiempo**. Si un salón descubre que los viernes por la tarde tiene muchas cancelaciones, TARA debe aprender ese patrón. Si una tienda vende mejor ciertos productos después de una campaña específica, TARA debe recordarlo y sugerir repetir esa estrategia. Con cada semana de uso, el sistema debe conocer mejor la empresa y ofrecer recomendaciones cada vez más precisas.

---

## REGLA OBLIGATORIA — Filtro antes de desarrollar cualquier función

Antes de desarrollar cualquier función, responder internamente:

1. ¿Hace ganar dinero al cliente?
2. ¿Hace ahorrar tiempo?
3. ¿Reduce errores?
4. ¿Ayuda a tomar mejores decisiones?
5. ¿Es más simple que la competencia?
6. ¿Es difícil de copiar?

**Si alguna respuesta es NO, la función debe rediseñarse antes de implementarse.**

---

## Relación con el roadmap y la arquitectura actual

Este documento no invalida nada ya construido — lo re-enmarca:

| Diferenciador | Dónde ya hay base construida | Dónde falta trabajo real |
|---|---|---|
| D1 (piensa, no solo responde) | `modules/inbox-analisis.js` (Motor de Decisiones del Inbox) ya genera resumen/urgencia/próxima acción por hilo — pero es reactivo (corre cuando hay actividad en un hilo), no proactivo a nivel negocio | Falta un motor que escanee **todo el negocio** sin que haya un mensaje disparador — candidato natural para v0.9 Business Intelligence |
| D2 (un solo cerebro) | ADR-005/ADR-006: `cliente` como entidad central, escritura doble Inbox↔CRM ya diseñada explícitamente para no crear islas | Sigue habiendo escritura doble (`conversaciones` + `mensajes`) por el freeze del Core — es deuda documentada, no resuelta |
| D3 (memoria empresarial) | Constitución Art. 13 (Memory Engine) ya define 3 capas; Capa 3 (resumen acumulado) marcada como pendiente desde v3 | Sigue pendiente — es el bloqueador técnico directo de D3 y D6 |
| D4 (explicar el porqué) | `analisis_hilo` ya guarda `riesgos`/`recomendaciones`/`proxima_accion` con contexto, no solo un número | Falta extenderlo a nivel negocio (no solo por hilo) cuando exista D1 a ese nivel |
| D5 (simplicidad) | Patrón ya usado en Operaciones.jsx / Panel Inteligente: resumen antes que detalle | Ninguna pantalla del sistema pasó todavía la prueba explícita de "10 segundos" — vale la pena auditar las existentes, no solo las nuevas |
| D6 (aprende del negocio) | Ninguna — no existe todavía un mecanismo que detecte patrones repetidos y los recuerde como reglas propias de la empresa | Requiere Memory Engine Capa 3 (D3) resuelta primero — D6 depende de D3 |

**Lectura operativa:** D3 (memoria empresarial, Capa 3 del Memory Engine) es la dependencia técnica común de D1, D4 y D6. Es razonable que sea la prioridad técnica antes de construir Business Intelligence (v0.9) a fondo — sin Capa 3, cualquier "TARA piensa" o "TARA aprende" se queda en análisis de una sola conversación, no del negocio completo.

---

*TARA-CONST-002 — Versión 1.0*
*Aprobada el 21 de julio de 2026 por Alina Navarro, fundadora de TARA Matrix™*
