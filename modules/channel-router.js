'use strict';

/**
 * TARA Matrix™ — ChannelRouter
 *
 * Resuelve incoming_endpoint → { company_id, company_slug }.
 * Es el único módulo que sabe que el routing viene de la tabla
 * channel_endpoints. El Kernel (Orchestrator y sus dependencias)
 * nunca llama a este módulo.
 *
 * Caché Map<endpoint, { company_id, company_slug, cachedAt }>
 * con TTL de 5 minutos. Devuelve null si el endpoint no está
 * registrado, está inactivo, o hay error de DB.
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

class ChannelRouter {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   */
  constructor(supabase) {
    this._db    = supabase;
    this._cache = new Map();
  }

  /**
   * Resuelve un endpoint al registro de empresa correspondiente.
   *
   * @param {string|null} endpoint - ej: "whatsapp:+14155238886"
   * @returns {Promise<{ company_id: string, company_slug: string }|null>}
   */
  async enrutar(endpoint) {
    if (!endpoint) return null;

    const cached = this._cache.get(endpoint);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
      return { company_id: cached.company_id, company_slug: cached.company_slug };
    }

    try {
      const { data, error } = await this._db
        .from('channel_endpoints')
        .select('company_id, companies(slug)')
        .eq('endpoint', endpoint)
        .eq('activo', true)
        .maybeSingle();

      if (error) {
        console.error('❌ ChannelRouter: error consultando channel_endpoints —', error.message);
        return null;
      }

      if (!data) {
        console.warn(`⚠️  ChannelRouter: endpoint sin empresa registrada — ${endpoint}`);
        return null;
      }

      const result = {
        company_id:   data.company_id,
        company_slug: data.companies?.slug || null,
      };

      this._cache.set(endpoint, { ...result, cachedAt: Date.now() });
      return result;

    } catch (e) {
      console.error('❌ ChannelRouter: excepción —', e.message);
      return null;
    }
  }

  /**
   * Invalida la entrada de caché para un endpoint específico.
   * Útil cuando se actualiza un endpoint en Supabase y se necesita
   * reflejar el cambio sin reiniciar el servidor.
   *
   * @param {string} endpoint
   */
  invalidarCache(endpoint) {
    this._cache.delete(endpoint);
  }
}

module.exports = { ChannelRouter };
