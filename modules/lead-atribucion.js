/**
 * TARA Matrix™ — lead-atribucion.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Enrutamiento de un mismo número de WhatsApp entre dos contextos de negocio
 * (ej. TARA-OS informativo vs. Nort Energy / venta de paneles solares),
 * decidiendo el company_id de cada conversación por metadata VERIFICABLE de
 * campaña — nunca solo por palabras del mensaje (Alina, 2026-08-14).
 *
 * Capa de plataforma — no toca ChannelRouter, Orchestrator, WorkflowEngine
 * ni los adapters congelados (adapters/channels/). server.js ya tiene acceso
 * al payload crudo del webhook antes/después de adapter.parseIncoming(); la
 * extracción de referral vive aquí, leyendo ese payload directamente, sin
 * modificar ningún adaptador.
 *
 * Jerarquía de resolución (se detiene en el primer nivel que resuelve):
 *   1. Contexto ya persistido — hilo NO cerrado existente para ese teléfono.
 *   2. referral/ctwa_clid verificable de Meta (Click-to-WhatsApp Ads real).
 *   3. Token determinístico de campaña, registrado en campanas_landing.
 *   4. Mención explícita e inequívoca del nombre de la empresa en el texto.
 *   5. Fallback — el company_id que ya resolvió ChannelRouter (sin cambios).
 *
 * Regla de seguridad: una palabra suelta ("paneles", "solar", "Alina") NUNCA
 * cambia el contexto por sí sola — el nivel 4 solo dispara con el NOMBRE
 * completo de la empresa objetivo, y solo se evalúa después de que los
 * niveles 1-3 (metadata verificable) ya fallaron.
 *
 * @module modules/lead-atribucion
 */

'use strict';

const TOKEN_CAMPANA_REGEX = /#tara_camp:([a-z0-9_-]+)/i;

function _normalizar(texto) {
  return (texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Extrae el objeto `referral` de un payload crudo de Meta Cloud API
 * (Click-to-WhatsApp Ads). Null si el mensaje no vino de un anuncio.
 *
 * @param {Object} reqBody - req.body crudo del webhook de Meta
 * @returns {{sourceUrl, sourceType, sourceId, headline, body, ctwaClid, mediaType}|null}
 */
function extraerReferralMeta(reqBody) {
  const mensajeRaw = reqBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const referral = mensajeRaw?.referral;
  if (!referral) return null;

  return {
    sourceUrl:  referral.source_url  || null,
    sourceType: referral.source_type || null,
    sourceId:   referral.source_id   || null,
    headline:   referral.headline    || null,
    body:       referral.body        || null,
    ctwaClid:   referral.ctwa_clid   || null,
    mediaType:  referral.media_type  || null,
  };
}

/**
 * Extrae los campos `Referral*` de un payload crudo de Twilio (WhatsApp
 * Business API vía Twilio, Click-to-WhatsApp Ads). Null si no vienen.
 *
 * @param {Object} reqBody - req.body crudo del webhook de Twilio
 * @returns {{sourceUrl, sourceType, sourceId, headline, body, ctwaClid, mediaType}|null}
 */
function extraerReferralTwilio(reqBody) {
  if (!reqBody?.ReferralSourceUrl && !reqBody?.ReferralHeadline && !reqBody?.ReferralBody) return null;

  return {
    sourceUrl:  reqBody.ReferralSourceUrl  || null,
    sourceType: reqBody.ReferralSourceType || null,
    sourceId:   reqBody.ReferralSourceId   || null,
    headline:   reqBody.ReferralHeadline   || null,
    body:       reqBody.ReferralBody       || null,
    ctwaClid:   reqBody.ReferralCtwaClid   || null,
    mediaType:  reqBody.ReferralMediaType  || null,
  };
}

/**
 * Parseo determinístico de un token de campaña embebido por una landing
 * page externa en el texto pre-llenado de un enlace wa.me (ej.
 * "Hola, quiero info #tara_camp:nort-fb-ago26"). Nunca interpreta lenguaje
 * natural — solo reconoce este patrón exacto.
 *
 * @param {string} texto
 * @returns {string|null}
 */
function extraerTokenCampana(texto) {
  const match = String(texto || '').match(TOKEN_CAMPANA_REGEX);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Valida un token de campaña contra el registro — un token que no exista o
 * esté inactivo es tratado como inválido/manipulado, nunca como señal real.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} token
 * @returns {Promise<Object|null>} fila de campanas_landing, o null
 */
async function resolverTokenCampana(supabase, token) {
  if (!token) return null;
  const { data } = await supabase
    .from('campanas_landing')
    .select('*')
    .eq('token', token)
    .eq('activo', true)
    .maybeSingle();
  return data || null;
}

/**
 * Nivel 1 — ¿ya existe una conversación NO cerrada para este teléfono, en
 * cualquier empresa? Si sí, ese company_id continúa sin volver a clasificar
 * — es la garantía de "no reclasificar constantemente".
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} telefono
 * @returns {Promise<{companyId: string, hiloId: string, clienteId: number}|null>}
 */
async function buscarContextoPersistido(supabase, telefono) {
  const { data: clientes } = await supabase
    .from('clientes')
    .select('id, company_id')
    .eq('telefono', telefono);
  if (!clientes || clientes.length === 0) return null;

  const clienteIds = clientes.map(c => c.id);

  const { data: hilo } = await supabase
    .from('hilos')
    .select('id, company_id, cliente_id')
    .in('cliente_id', clienteIds)
    .neq('estado', 'cerrada')
    .order('ultimo_mensaje_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!hilo) return null;
  return { companyId: hilo.company_id, hiloId: hilo.id, clienteId: hilo.cliente_id };
}

/**
 * Nivel 2 — referral verificable de Meta, cotejado contra las palabras clave
 * REALES de la industria (plantillas_industria.palabras_clave) — no una
 * lista propia duplicada. Solo se evalúa si el referral existe (viene
 * firmado por Meta junto con el mensaje, no lo puede inventar el usuario).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{sourceUrl, headline, body}} referral
 * @returns {Promise<{companyId: string, businessContext: string}|null>}
 */
async function resolverReferralPanelesSolares(supabase, referral) {
  if (!referral) return null;

  const { data: plantilla } = await supabase
    .from('plantillas_industria')
    .select('palabras_clave')
    .eq('slug', 'paneles_solares')
    .maybeSingle();
  if (!plantilla?.palabras_clave?.length) return null;

  const texto = _normalizar([referral.headline, referral.body, referral.sourceUrl].filter(Boolean).join(' '));
  const coincide = plantilla.palabras_clave.some(p => texto.includes(_normalizar(p)));
  if (!coincide) return null;

  const { data: empresa } = await supabase
    .from('companies')
    .select('id')
    .eq('industria_slug', 'paneles_solares')
    .eq('es_demo', false)
    .limit(1)
    .maybeSingle();
  if (!empresa) return null;

  return { companyId: empresa.id, businessContext: 'paneles_solares' };
}

/**
 * Nivel 4 — mención explícita del NOMBRE de una empresa real distinta a la
 * dueña del número (nunca palabras genéricas del giro). Deliberadamente
 * restringido a empresas reales (es_demo=false) con industria reconocida —
 * "paneles", "solar", "energía" por sí solos NUNCA disparan este nivel.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} texto
 * @param {string} companyIdFallback - se excluye de la búsqueda
 * @returns {Promise<{companyId: string, businessContext: string}|null>}
 */
async function resolverContenidoExplicito(supabase, texto, companyIdFallback) {
  if (!texto) return null;

  const { data: candidatas } = await supabase
    .from('companies')
    .select('id, nombre, industria_slug')
    .eq('es_demo', false)
    .not('industria_slug', 'is', null)
    .neq('id', companyIdFallback);
  if (!candidatas || candidatas.length === 0) return null;

  const textoNorm = _normalizar(texto);
  const match = candidatas.find(c => c.nombre && textoNorm.includes(_normalizar(c.nombre)));
  if (!match) return null;

  return { companyId: match.id, businessContext: match.industria_slug };
}

/**
 * ¿Este teléfono ya tiene AL MENOS un evento de atribución previo (de
 * cualquier tipo)? Determina si vale la pena registrar una nueva fila
 * incluso cuando el nivel 5 (fallback) es el que resuelve — para no perder
 * la trazabilidad de un teléfono que ya es parte de la historia de
 * atribución (caso 7: dos conversaciones del mismo teléfono). Un teléfono
 * que NUNCA ha tenido ninguna señal de campaña no genera ruido en la tabla
 * solo por escribir "hola" a una empresa cualquiera.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} telefono
 * @returns {Promise<boolean>}
 */
async function _tieneAtribucionPrevia(supabase, telefono) {
  const { data } = await supabase
    .from('atribucion_leads')
    .select('id')
    .eq('telefono', telefono)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Orquesta la jerarquía completa. Se detiene en el primer nivel que
 * resuelve — nunca evalúa niveles inferiores una vez que uno superior dio
 * un resultado.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.telefono
 * @param {Object} datos.reqBody           - payload crudo del webhook
 * @param {'meta'|'twilio'} datos.proveedor
 * @param {string} datos.mensajeTexto
 * @param {string} datos.companyIdFallback - el company_id que ya resolvió ChannelRouter
 * @returns {Promise<{companyId: string, businessContext: string|null, leadSource: string, resueltoPor: string, esNuevaDecision: boolean, campaignData: Object|null}>}
 */
async function resolverContextoDeLead(supabase, { telefono, reqBody, proveedor, mensajeTexto, companyIdFallback }) {
  // Nivel 1 — contexto ya persistido
  const persistido = await buscarContextoPersistido(supabase, telefono);
  if (persistido) {
    return {
      companyId: persistido.companyId, businessContext: null, leadSource: null,
      resueltoPor: 'contexto_persistido', esNuevaDecision: false, campaignData: null,
    };
  }

  // Nivel 2 — referral verificable de Meta
  const referral = proveedor === 'meta' ? extraerReferralMeta(reqBody) : extraerReferralTwilio(reqBody);
  if (referral) {
    const resuelto = await resolverReferralPanelesSolares(supabase, referral);
    if (resuelto) {
      return {
        companyId: resuelto.companyId, businessContext: resuelto.businessContext, leadSource: 'meta_ads',
        resueltoPor: 'referral_meta', esNuevaDecision: true,
        campaignData: { campaignId: referral.sourceId, sourceUrl: referral.sourceUrl, sourceType: referral.sourceType, ctwaClid: referral.ctwaClid, referralMetadata: referral },
      };
    }
  }

  // Nivel 3 — token determinístico de campaña (landing page / Google Ads)
  const token = extraerTokenCampana(mensajeTexto);
  if (token) {
    const campana = await resolverTokenCampana(supabase, token);
    if (campana) {
      return {
        companyId: campana.company_id, businessContext: campana.business_context, leadSource: campana.fuente || 'landing',
        resueltoPor: 'token_campana', esNuevaDecision: true,
        campaignData: { campaignId: campana.id, campaignName: campana.campaign_name, tokenCampana: token },
      };
    }
  }

  // Nivel 4 — mención explícita e inequívoca del nombre de la empresa
  const explicito = await resolverContenidoExplicito(supabase, mensajeTexto, companyIdFallback);
  if (explicito) {
    return {
      companyId: explicito.companyId, businessContext: explicito.businessContext, leadSource: 'organico',
      resueltoPor: 'contenido_explicito', esNuevaDecision: true, campaignData: null,
    };
  }

  // Nivel 5 — fallback: el company_id que ya tenía el número. Si el
  // teléfono ya es parte de la historia de atribución (tuvo al menos una
  // señal real antes), esta conversación nueva también se registra — para
  // no perder la trazabilidad (caso 7). Un teléfono sin ninguna historia
  // previa no genera una fila solo por escribir "hola" sin ninguna señal.
  const yaAtribuido = await _tieneAtribucionPrevia(supabase, telefono);
  return {
    companyId: companyIdFallback, businessContext: null, leadSource: 'organico',
    resueltoPor: 'fallback_default', esNuevaDecision: yaAtribuido, campaignData: null,
  };
}

/**
 * Registra una fila de auditoría — solo se llama cuando resolverContextoDeLead
 * devolvió esNuevaDecision=true (nunca en cada mensaje, nunca al reutilizar
 * contexto persistido).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @returns {Promise<Object|null>} la fila insertada, o null si falla (nunca lanza — auditoría, no debe tumbar el turno)
 */
async function registrarAtribucion(supabase, datos) {
  const { data, error } = await supabase
    .from('atribucion_leads')
    .insert([{
      telefono:          datos.telefono,
      company_id:        datos.companyId,
      hilo_id:           datos.hiloId || null,
      cliente_id:        datos.clienteId || null,
      business_context:  datos.businessContext,
      lead_source:       datos.leadSource,
      resuelto_por:      datos.resueltoPor,
      campaign_id:       datos.campaignData?.campaignId || null,
      campaign_name:     datos.campaignData?.campaignName || null,
      source_url:        datos.campaignData?.sourceUrl || null,
      source_type:       datos.campaignData?.sourceType || null,
      ctwa_clid:         datos.campaignData?.ctwaClid || null,
      utm_source:        datos.utm?.utm_source || null,
      utm_medium:        datos.utm?.utm_medium || null,
      utm_campaign:      datos.utm?.utm_campaign || null,
      utm_content:       datos.utm?.utm_content || null,
      utm_term:          datos.utm?.utm_term || null,
      gclid:             datos.gclid || null,
      fbclid:            datos.fbclid || null,
      token_campana:     datos.campaignData?.tokenCampana || null,
      referral_metadata: datos.campaignData?.referralMetadata || null,
      mensaje_texto:     datos.mensajeTexto || null,
    }])
    .select()
    .maybeSingle();

  if (error) {
    console.error('lead-atribucion.registrarAtribucion:', error.message);
    return null;
  }
  return data;
}

module.exports = {
  extraerReferralMeta,
  extraerReferralTwilio,
  extraerTokenCampana,
  resolverTokenCampana,
  buscarContextoPersistido,
  resolverReferralPanelesSolares,
  resolverContenidoExplicito,
  resolverContextoDeLead,
  registrarAtribucion,
};
