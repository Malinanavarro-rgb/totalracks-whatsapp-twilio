/**
 * TARA Matrix™ — consumo-electrico.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Prioridad 7 (Alina, 2026-10-17): interpretación determinista del consumo
 * eléctrico declarado por el cliente en conversación libre — distingue
 * importe monetario de energía (kWh), y periodo mensual de bimestral, SIN
 * dejar que el modelo haga la conversión en silencio.
 *
 * Diagnóstico (Fase A) que motiva este módulo: `modules/prompt-builder.js`
 * le pedía al modelo llenar `consumo_mensual_kwh` directamente, sin ninguna
 * guía de unidad/periodo — el modelo convertía "6000 bimestral" → "3000"
 * por su cuenta, sin ninguna verificación posterior (confirmado con el
 * incidente real de Roberto Gzz/Nort Energy). `modules/recibo-cfe.js` SÍ
 * ya resuelve esto correctamente para fotos de recibo (factor de
 * conversión real basado en periodo_inicio/periodo_fin, nunca "÷2" a
 * ciegas) — este módulo aplica el MISMO principio (nunca convertir sin una
 * regla explícita y documentada) a la conversación de texto, donde no hay
 * fechas reales disponibles, así que la única conversión permitida es la
 * división exacta a la mitad para un periodo EXPLÍCITAMENTE declarado como
 * bimestral — nunca asumida.
 *
 * El modelo (ver prompt-builder.js::bloque_schema_json, campo
 * "datos_consumo_declarado") reporta la cifra TAL CUAL el cliente la dijo
 * — valor, unidad y periodo crudos, sin convertir — este módulo hace toda
 * la interpretación en código, de forma 100% determinista y testeable.
 *
 * @module modules/consumo-electrico
 */

'use strict';

// Mismo umbral que _normalizarPctCobertura/_numeroOrNull (modules/cotizaciones.js)
// — nunca se inventa una conversión a partir de texto no numérico.
function _numeroOrNull(valor) {
  if (valor == null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza `frecuencia_recibo` (campo YA EXISTENTE en campos_requeridos de
 * Nort Energy — el modelo ya lo extrae hoy, ver auditoría Fase A; nadie lo
 * consume todavía) a un periodo controlado. Se usa como respaldo SOLO
 * cuando `datos_consumo_declarado.periodo` no vino — nunca lo sobreescribe.
 *
 * @param {string|null} texto
 * @returns {'mensual'|'bimestral'|'desconocido'|null}
 */
function normalizarFrecuenciaRecibo(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const t = texto.toLowerCase();
  if (/bimestral|cada\s*2\s*mes|cada\s*dos\s*mes|2\s*meses/.test(t)) return 'bimestral';
  if (/mensual|cada\s*mes|un\s*mes|al\s*mes/.test(t)) return 'mensual';
  return 'desconocido';
}

const PREGUNTA_ACLARACION_PERIODO_KWH = '¿ese consumo es mensual o de los últimos 2 meses (bimestral)?';
const PREGUNTA_ACLARACION_PERIODO_MXN = '¿ese importe es de un mes o de 2 meses (bimestral), como factura normalmente CFE?';
const PREGUNTA_ACLARACION_UNIDAD = '¿esa cifra es tu consumo en kWh, o el importe que pagas en pesos?';

/**
 * Interpreta de forma determinista lo que el cliente declaró sobre su
 * consumo/pago eléctrico — nunca convierte un importe a kWh (no hay datos
 * tarifarios verificables, Fase B explícita), y solo convierte bimestral a
 * mensual con la regla documentada (÷2) cuando el periodo fue declarado
 * EXPLÍCITAMENTE como bimestral — nunca lo asume.
 *
 * @param {Object} declarado - `aiOutput.datos_consumo_declarado`, tal cual
 *   lo reportó el modelo (valor/unidad/periodo crudos, sin convertir).
 * @param {Object} [opciones]
 * @param {string|null} [opciones.frecuenciaReciboRespaldo] - texto crudo de
 *   `datos_extraidos.frecuencia_recibo`, usado SOLO si `declarado.periodo`
 *   no vino — nunca lo sobreescribe.
 * @returns {{
 *   campo: 'consumo_mensual_kwh'|'importe_promedio_recibo'|null,
 *   valorMensualizado: number|null,
 *   requiereAclaracion: boolean,
 *   preguntaAclaracion: string|null,
 *   fuente: 'cliente_texto',
 *   confianza: 'alta'|'aproximada'|null,
 *   periodoUsado: 'mensual'|'bimestral'|null,
 * }}
 */
function interpretarConsumoDeclarado(declarado, opciones = {}) {
  const base = { campo: null, valorMensualizado: null, requiereAclaracion: false, preguntaAclaracion: null, fuente: 'cliente_texto', confianza: null, periodoUsado: null };

  const valor = _numeroOrNull(declarado?.valor);
  const unidad = declarado?.unidad === 'kwh' || declarado?.unidad === 'mxn' ? declarado.unidad : null;
  const aproximado = declarado?.aproximado === true;

  // Nada que interpretar — el cliente no dio ninguna cifra nueva este turno.
  if (valor == null || valor <= 0) return base;

  // Valor presente pero sin unidad clara — ni el cliente ni el modelo
  // distinguieron kWh de pesos. No se adivina (requisito explícito: "no
  // inventar valores ni sustituir información faltante silenciosamente").
  if (!unidad) {
    return { ...base, requiereAclaracion: true, preguntaAclaracion: PREGUNTA_ACLARACION_UNIDAD };
  }

  let periodo = declarado?.periodo === 'mensual' || declarado?.periodo === 'bimestral' ? declarado.periodo : null;
  if (!periodo) {
    // Respaldo: frecuencia_recibo ya existe como campo capturado por
    // separado — se usa SOLO si datos_consumo_declarado no trajo periodo.
    const respaldo = normalizarFrecuenciaRecibo(opciones.frecuenciaReciboRespaldo);
    if (respaldo === 'mensual' || respaldo === 'bimestral') periodo = respaldo;
  }

  const campo = unidad === 'kwh' ? 'consumo_mensual_kwh' : 'importe_promedio_recibo';

  if (!periodo) {
    return {
      ...base, campo, requiereAclaracion: true,
      preguntaAclaracion: unidad === 'kwh' ? PREGUNTA_ACLARACION_PERIODO_KWH : PREGUNTA_ACLARACION_PERIODO_MXN,
    };
  }

  // Única conversión permitida (Fase B): bimestral declarado explícitamente
  // → ÷2. Documentada aquí, nunca silenciosa — ver cabecera del módulo.
  const valorMensualizado = periodo === 'bimestral' ? valor / 2 : valor;

  return {
    ...base, campo, valorMensualizado, requiereAclaracion: false,
    confianza: aproximado ? 'aproximada' : 'alta', periodoUsado: periodo,
  };
}

module.exports = {
  interpretarConsumoDeclarado,
  normalizarFrecuenciaRecibo,
  PREGUNTA_ACLARACION_PERIODO_KWH, PREGUNTA_ACLARACION_PERIODO_MXN, PREGUNTA_ACLARACION_UNIDAD,
};
