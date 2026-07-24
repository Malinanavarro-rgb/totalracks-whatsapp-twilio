/**
 * TARA Matrix™ — clasificacion-contexto
 * ─────────────────────────────────────────────────────────────────────────────
 * Única fuente de verdad del catálogo de clasificación de contexto (ADR-010):
 * TARA nunca asume que un mensaje es una oportunidad de venta — antes de
 * responder, clasifica el mensaje en una de estas categorías.
 *
 * Este catálogo lo consumen 2 módulos que de otra forma duplicarían la
 * misma lista (con riesgo real de desincronizarse si se agrega una
 * categoría en un lugar y se olvida en el otro):
 *   - modules/prompt-builder.js   → instrucciones + schema JSON para el modelo
 *   - adapters/ai/openai-provider.js → validación del valor que el modelo devuelve
 *
 * Agregar una categoría nueva: se agrega UNA vez aquí: ambos consumidores
 * quedan sincronizados automáticamente.
 *
 * @module modules/clasificacion-contexto
 */

'use strict';

const CATEGORIAS_CLASIFICACION_CONTEXTO = [
  { valor: 'prospecto', descripcion: 'pregunta por servicios, precios, cotizaciones, información de la empresa, o muestra interés real en lo que ofrece.' },
  { valor: 'cliente_existente', descripcion: 'ya es cliente y continúa una conversación normal sobre su cuenta, servicio o pedido.' },
  { valor: 'proveedor', descripcion: 'es un proveedor o socio de negocio de la empresa.' },
  { valor: 'conversacion_personal', descripcion: 'tema personal (familia, tráfico, planes, citas personales) sin relación con la empresa.' },
  { valor: 'numero_equivocado', descripcion: 'el mensaje deja claro que la persona no sabía a quién le escribía.' },
  { valor: 'spam', descripcion: 'publicidad no solicitada, cadenas o contenido irrelevante.' },
  { valor: 'informacion_administrativa', descripcion: 'avisos de escuelas, bancos, paqueterías u otras entidades que no son cliente ni prospecto.' },
  { valor: 'contexto_insuficiente', descripcion: 'no hay información suficiente todavía para clasificar con confianza.' },
];

/** Set de valores válidos — para validación rápida (O(1)). Nunca incluir 'prospecto' como default. */
const VALORES_CLASIFICACION_CONTEXTO = new Set(CATEGORIAS_CLASIFICACION_CONTEXTO.map(c => c.valor));

/** Valor de emergencia cuando el modelo no clasifica o clasifica fuera de catálogo. Nunca 'prospecto'. */
const CLASIFICACION_POR_DEFECTO = 'contexto_insuficiente';

module.exports = {
  CATEGORIAS_CLASIFICACION_CONTEXTO,
  VALORES_CLASIFICACION_CONTEXTO,
  CLASIFICACION_POR_DEFECTO,
};
