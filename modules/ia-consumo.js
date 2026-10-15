/**
 * TARA Matrix™ — ia-consumo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Medición real de consumo de IA (Alina, 2026-10-16, Fase 1 de TARA AI
 * Engine, ver TARA_AI_ENGINE_ARCHITECTURE_V1.md sección 11). Hoy
 * AIProvider.calcularCosto() existe pero nunca se invoca ni se agrega en
 * ningún lado — este módulo cierra ese hueco, sin tocar ningún contrato
 * existente (Orchestrator, AIProvider, AIEngine, Modo Operador siguen
 * exactamente igual salvo por esta llamada adicional, opcional y null-safe).
 *
 * Cubre las 2 superficies reales de IA: el motor conversacional
 * (operacion='conversacion') y Modo Operador (operacion='modo_operador' /
 * 'modo_operador_respuesta_cliente', una fila POR ITERACIÓN de tool-calling
 * — cada una es una llamada real distinta al proveedor, nunca se agregan).
 *
 * Nunca registra contenido de conversación ni credenciales — solo metadata
 * de costo. Si el modelo/proveedor no permite calcular el costo con
 * confianza, se registra `costo_pendiente_estimacion=true` y
 * `costo_estimado_usd=null` — nunca se inventa un importe.
 *
 * @module modules/ia-consumo
 */

'use strict';

const { calcularCostoOpenAI, PRICING_PER_M } = require('../adapters/ai/openai-provider');

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string|null} [datos.companyId] - null en llamadas de alcance 'plataforma'
 * @param {string|null} [datos.organizationId]
 * @param {string} datos.proveedor - 'openai' | 'anthropic' | 'mock' | etc.
 * @param {string} datos.modelo
 * @param {string} datos.operacion - 'conversacion' | 'modo_operador' | 'modo_operador_respuesta_cliente'
 * @param {number|null|undefined} datos.tokensEntrada
 * @param {number|null|undefined} datos.tokensSalida
 * @param {string} datos.resultado - 'exito' | 'fallback' | 'error'
 * @param {number} [datos.latenciaMs]
 * @returns {Promise<void>} nunca lanza — fire-and-forget, mismo criterio que modules/audit-logger.js
 */
async function registrarConsumoIA(supabase, {
  companyId, organizationId, proveedor, modelo, operacion, tokensEntrada, tokensSalida, resultado, latenciaMs,
} = {}) {
  try {
    const tieneTokensValidos = Number.isFinite(tokensEntrada) && Number.isFinite(tokensSalida) && (tokensEntrada > 0 || tokensSalida > 0);
    const modeloConocido = proveedor === 'openai' && Object.prototype.hasOwnProperty.call(PRICING_PER_M, modelo);

    const puedeCalcularse = tieneTokensValidos && modeloConocido;
    const costoEstimadoUsd = puedeCalcularse ? calcularCostoOpenAI(tokensEntrada, tokensSalida, modelo) : null;

    await supabase.from('ia_consumo_logs').insert([{
      company_id: companyId || null,
      organization_id: organizationId || null,
      proveedor: proveedor || 'desconocido',
      modelo: modelo || 'desconocido',
      operacion,
      tokens_entrada: Number.isFinite(tokensEntrada) ? tokensEntrada : null,
      tokens_salida: Number.isFinite(tokensSalida) ? tokensSalida : null,
      costo_estimado_usd: costoEstimadoUsd,
      costo_pendiente_estimacion: !puedeCalcularse,
      resultado,
      latencia_ms: Number.isFinite(latenciaMs) ? latenciaMs : null,
    }]);
  } catch (e) {
    console.error('ia-consumo: error registrando consumo (no se interrumpe el turno):', e.message);
  }
}

module.exports = { registrarConsumoIA };
