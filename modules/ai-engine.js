/**
 * TARA Matrix™ — AIEngine
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestador de proveedores de IA.
 *
 * Responsabilidades:
 *   - Mantener el registro de proveedores disponibles
 *   - Seleccionar el proveedor correcto para cada modelo
 *   - Ejecutar con fallback automático si el proveedor falla
 *   - Garantizar que TARA nunca se detenga por fallo de un proveedor
 *
 * El Core solo llama a AIEngine.procesar(). Nunca a un proveedor directamente.
 *
 * Garantía de disponibilidad:
 *   Proveedor primario falla → intenta proveedor de fallback configurado
 *   Proveedor de fallback falla → usa MockProvider como último recurso
 *   TARA siempre responde, aunque sea una respuesta de emergencia.
 *
 * @module modules/ai-engine
 */

'use strict';

const { FALLBACK_OUTPUT } = require('../adapters/ai/ai-provider');

class AIEngine {
  /**
   * @param {import('../adapters/ai/mock-provider').MockProvider} mockProvider
   *   Proveedor de emergencia — siempre disponible, nunca falla
   */
  constructor(mockProvider) {
    if (!mockProvider) throw new Error('AIEngine requiere un MockProvider como seguro de emergencia');

    /** @type {Map<string, import('../adapters/ai/ai-provider').AIProvider>} */
    this._registry = new Map();

    /** @type {import('../adapters/ai/ai-provider').AIProvider} */
    this._mock = mockProvider;

    /** @type {import('../adapters/ai/ai-provider').AIProvider|null} */
    this._fallback = null;

    // Registrar mock para que sea resoluble por nombre de modelo
    for (const modelo of mockProvider.modelos) {
      this._registry.set(modelo, mockProvider);
    }
  }

  /**
   * Registra un proveedor de IA.
   * El primer proveedor no-mock registrado se convierte en el fallback global.
   *
   * @param {import('../adapters/ai/ai-provider').AIProvider} provider
   */
  registerProvider(provider) {
    for (const modelo of provider.modelos) {
      this._registry.set(modelo, provider);
    }

    // El primer proveedor real (no mock) es el fallback global
    if (provider.nombre !== 'mock' && !this._fallback) {
      this._fallback = provider;
      console.log(`✅ AIEngine: fallback global → ${provider.nombre}`);
    }

    console.log(`✅ AIEngine: registrado ${provider.nombre} [${provider.modelos.join(', ')}]`);
  }

  /**
   * Resuelve el proveedor correcto para un modelo dado.
   * @param {string} modelo
   * @returns {import('../adapters/ai/ai-provider').AIProvider}
   */
  resolverProveedor(modelo) {
    return this._registry.get(modelo) || this._fallback || this._mock;
  }

  /**
   * Procesa un AIInput y devuelve un AIOutput.
   * Garantiza respuesta aunque todos los proveedores fallen.
   *
   * @param {import('../adapters/ai/ai-provider').AIInput} input
   * @returns {Promise<import('../adapters/ai/ai-provider').AIOutput>}
   */
  async procesar(input) {
    const proveedor = this.resolverProveedor(input.modelo);

    // Intento 1 — proveedor seleccionado
    try {
      return await proveedor.procesar(input);
    } catch (err1) {
      console.error(`❌ ${proveedor.nombre} falló: ${err1.message}`);
    }

    // Intento 2 — fallback global (si es diferente al que ya falló)
    if (this._fallback && this._fallback !== proveedor) {
      try {
        console.warn(`⚠️  AIEngine: intentando fallback → ${this._fallback.nombre}`);
        return await this._fallback.procesar(input);
      } catch (err2) {
        console.error(`❌ ${this._fallback.nombre} también falló: ${err2.message}`);
      }
    }

    // Intento 3 — MockProvider (último recurso, siempre disponible)
    if (this._mock !== proveedor && this._mock !== this._fallback) {
      try {
        console.warn('⚠️  AIEngine: usando MockProvider como emergencia');
        return await this._mock.procesar(input);
      } catch (err3) {
        console.error(`❌ MockProvider falló (inesperado): ${err3.message}`);
      }
    }

    // Respuesta de seguridad absoluta — el Core nunca se cae
    console.error('❌ Todos los proveedores fallaron. Devolviendo FALLBACK_OUTPUT.');
    return {
      ...FALLBACK_OUTPUT,
      latencia_ms: 0,
    };
  }

  /**
   * Lista los proveedores registrados (para health check y debug).
   * @returns {Array<{proveedor: string, modelos: string[]}>}
   */
  listarProveedores() {
    const vistos = new Set();
    const lista  = [];

    for (const [modelo, provider] of this._registry.entries()) {
      if (!vistos.has(provider.nombre)) {
        vistos.add(provider.nombre);
        lista.push({
          proveedor:   provider.nombre,
          modelos:     provider.modelos,
          es_fallback: provider.nombre === this._fallback?.nombre,
        });
      }
    }
    return lista;
  }
}

module.exports = { AIEngine };
