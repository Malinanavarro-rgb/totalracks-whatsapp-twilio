/**
 * TARA Matrix™ — cotizacion-descuento.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Aprobación de descuentos (auditoría 2026-09-16, Parte B punto 11 —
 * Alina, 2026-09-22): `cotizaciones.descuento_pct`/`descuento_monto` ya
 * existían desde la migración 102 pero sin ningún flujo de aprobación —
 * cualquiera podía escribirlos directo. Primera vez que se construye este
 * patrón en todo el repo (confirmado en la auditoría, sección G): un
 * descuento por encima de un límite configurable queda PENDIENTE hasta que
 * un gerencial lo autorice explícitamente.
 *
 * El límite es configurable por empresa (`parametros_ingenieria`, mismo
 * mecanismo ya usado por el motor de ingeniería — override de empresa con
 * fallback a un default global, ver resolverParametro() en
 * modules/cotizaciones.js) con industria_slug='comercial', desacoplado de
 * cualquier motor técnico.
 *
 * Un gerencial que APLICA el descuento se autoriza a sí mismo en el mismo
 * acto — mismo criterio que ya usa autorizarPrecioFinal (una decisión
 * humana registrada con quién/cuándo, nunca implícita). Solo un asesor sin
 * rol gerencial deja el descuento pendiente de que alguien más lo autorice.
 *
 * `puedeEnviarCotizacion()` (modules/cotizaciones.js) es quien bloquea el
 * envío mientras el descuento siga pendiente — un solo lugar gobierna "se
 * puede enviar esta cotización", igual que ya hace con la ingeniería
 * validada.
 *
 * @module modules/cotizacion-descuento
 */

'use strict';

const { resolverParametro } = require('./cotizaciones');
const { esGerencial } = require('./permisos');

const INDUSTRIA_SLUG_COMERCIAL = 'comercial';
const CLAVE_LIMITE = 'limite_descuento_sin_autorizacion_pct';
// Solo se usa si ni el override de empresa ni el default global (migración
// 109, ya sembrado) existieran todavía — nunca deja el sistema sin regla,
// pero en operación normal esta constante nunca debería activarse.
const LIMITE_DEFAULT_SIN_CONFIGURAR = 10;

/** Límite de descuento (%) que un asesor puede aplicar sin autorización de un gerencial. */
async function resolverLimiteDescuento(supabase, companyId) {
  const parametro = await resolverParametro(supabase, { companyId, industriaSlug: INDUSTRIA_SLUG_COMERCIAL, clave: CLAVE_LIMITE });
  return parametro ? parametro.valor : LIMITE_DEFAULT_SIN_CONFIGURAR;
}

/**
 * % equivalente del descuento sobre el total actual — para comparar contra
 * el límite sin importar si se capturó como % o como monto fijo. Sin total
 * conocido (cotización sin líneas todavía) un monto fijo no se puede
 * traducir a % → null, y aplicarDescuento lo trata como "no se pudo
 * verificar" (requiere autorización), nunca como "está dentro del límite".
 */
function _pctEquivalente({ descuentoPct, descuentoMonto, totalActual }) {
  if (descuentoPct != null) return descuentoPct;
  if (descuentoMonto != null && totalActual > 0) return (descuentoMonto / totalActual) * 100;
  return null;
}

/**
 * Propone (y, si está dentro del límite o quien lo pide ya es gerencial,
 * aplica de una vez) un descuento sobre el total de la cotización.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.cotizacionId
 * @param {string} datos.usuarioId
 * @param {string} datos.rolUsuario
 * @param {number} [datos.descuentoPct] - exactamente uno de descuentoPct/descuentoMonto
 * @param {number} [datos.descuentoMonto]
 * @param {string} [datos.motivo]
 * @returns {Promise<{cotizacion: Object, limite_pct: number, requiere_autorizacion: boolean}>}
 */
async function aplicarDescuento(supabase, { companyId, cotizacionId, usuarioId, rolUsuario, descuentoPct, descuentoMonto, motivo }) {
  if (descuentoPct == null && descuentoMonto == null) {
    const err = new Error('Especifica descuentoPct o descuentoMonto.');
    err.status = 400;
    throw err;
  }
  if (descuentoPct != null && descuentoMonto != null) {
    const err = new Error('Da descuentoPct o descuentoMonto, no ambos a la vez.');
    err.status = 400;
    throw err;
  }

  const { data: cotizacion, error: errCot } = await supabase
    .from('cotizaciones').select('id, total').eq('id', cotizacionId).eq('company_id', companyId).maybeSingle();
  if (errCot || !cotizacion) {
    const err = new Error('Cotización no encontrada');
    err.status = 404;
    throw err;
  }

  const limite = await resolverLimiteDescuento(supabase, companyId);
  const pctEquivalente = _pctEquivalente({ descuentoPct, descuentoMonto, totalActual: Number(cotizacion.total) || 0 });
  const excedeLimite = pctEquivalente == null ? true : pctEquivalente > limite;
  const quienAplicaEsGerencial = esGerencial(rolUsuario);
  const ahora = new Date().toISOString();

  const payload = {
    descuento_pct: descuentoPct ?? null,
    descuento_monto: descuentoMonto ?? null,
    descuento_motivo: motivo || null,
    descuento_solicitado_por: usuarioId,
    descuento_solicitado_en: ahora,
    limite_descuento_excedido: excedeLimite,
    descuento_autorizado_por: (!excedeLimite || quienAplicaEsGerencial) ? usuarioId : null,
    descuento_autorizado_en: (!excedeLimite || quienAplicaEsGerencial) ? ahora : null,
  };

  const { data, error } = await supabase.from('cotizaciones').update(payload).eq('id', cotizacionId).select().single();
  if (error) throw new Error(`cotizacion-descuento.aplicarDescuento: ${error.message}`);

  return { cotizacion: data, limite_pct: limite, requiere_autorizacion: excedeLimite && !quienAplicaEsGerencial };
}

/** Un gerencial autoriza un descuento que había quedado pendiente. */
async function autorizarDescuento(supabase, { companyId, cotizacionId, usuarioId, rolUsuario }) {
  if (!esGerencial(rolUsuario)) {
    const err = new Error('Solo un gerencial puede autorizar un descuento por encima del límite.');
    err.status = 403;
    throw err;
  }

  const { data: cotizacion, error: errCot } = await supabase
    .from('cotizaciones').select('id, limite_descuento_excedido, descuento_autorizado_por')
    .eq('id', cotizacionId).eq('company_id', companyId).maybeSingle();
  if (errCot || !cotizacion) {
    const err = new Error('Cotización no encontrada');
    err.status = 404;
    throw err;
  }
  if (!cotizacion.limite_descuento_excedido) {
    const err = new Error('Esta cotización no tiene ningún descuento pendiente de autorización.');
    err.status = 409;
    throw err;
  }
  if (cotizacion.descuento_autorizado_por) {
    const err = new Error('Este descuento ya fue autorizado.');
    err.status = 409;
    throw err;
  }

  const { data, error } = await supabase
    .from('cotizaciones')
    .update({ descuento_autorizado_por: usuarioId, descuento_autorizado_en: new Date().toISOString() })
    .eq('id', cotizacionId).select().single();
  if (error) throw new Error(`cotizacion-descuento.autorizarDescuento: ${error.message}`);
  return data;
}

module.exports = { resolverLimiteDescuento, aplicarDescuento, autorizarDescuento, INDUSTRIA_SLUG_COMERCIAL, CLAVE_LIMITE };
