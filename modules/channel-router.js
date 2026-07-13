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
   * @param {string|null} endpoint - ej: "whatsapp:+14155238886" (Twilio) o un
   *                                 phone_number_id de Meta (sin prefijo)
   * @returns {Promise<{ company_id: string, company_slug: string, proveedor: string }|null>}
   */
  async enrutar(endpoint) {
    if (!endpoint) return null;

    const cached = this._cache.get(endpoint);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
      return { company_id: cached.company_id, company_slug: cached.company_slug, proveedor: cached.proveedor };
    }

    try {
      const { data, error } = await this._db
        .from('channel_endpoints')
        .select('company_id, proveedor, companies(slug)')
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
        proveedor:    data.proveedor || 'twilio',
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

  /**
   * Dirección inversa de enrutar(): dado un company_id, resuelve el número
   * propio de esa empresa para ese canal (ej. su WhatsApp). Se usa para
   * envíos proactivos (recordatorios, intervención humana) — nunca debe
   * asumirse un único número global para todas las empresas.
   *
   * @param {string} company_id
   * @param {string} [canal='whatsapp']
   * @returns {Promise<string|null>} número sin el prefijo "whatsapp:"
   */
  async resolverEndpointDeEmpresa(company_id, canal = 'whatsapp') {
    if (!company_id) return null;

    const cacheKey = `empresa:${company_id}:${canal}`;
    const cached = this._cache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
      return cached.numero;
    }

    const { data, error } = await this._db
      .from('channel_endpoints')
      .select('endpoint')
      .eq('company_id', company_id)
      .eq('canal', canal)
      .eq('activo', true)
      .maybeSingle();

    if (error || !data) return null;

    const numero = data.endpoint.replace(`${canal}:`, '');
    this._cache.set(cacheKey, { numero, cachedAt: Date.now() });
    return numero;
  }
}

module.exports = { ChannelRouter };
