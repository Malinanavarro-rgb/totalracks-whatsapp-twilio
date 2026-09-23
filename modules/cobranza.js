/**
 * TARA Matrix™ — cobranza.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2B del bloque operativo post-venta (Alina, 2026-09-22/23, ver
 * NORT_ENERGY_PORTAL_PLAN.md). Control OPERATIVO de cobranza por proyecto
 * — no contabilidad: total vendido (snapshot), anticipo requerido
 * (opcional — confirmado en vivo que ninguna cotización real de Nort
 * Energy tiene `anticipo_pct` capturado hoy, nunca se inventa un default),
 * y una bitácora de abonos. El ESTADO siempre se deriva de los abonos —
 * nunca se guarda a mano, mismo criterio que cotizacion_lineas.
 *
 * `pagos_cliente` es una tabla nueva, deliberadamente distinta de `pagos`
 * (facturación de TARA a la organización) — nunca confundir las dos.
 *
 * Comprobantes reutilizan `documentos_cliente` (categoría 'comprobante_pago',
 * ya existente) — cero campo de archivo nuevo.
 *
 * @module modules/cobranza
 */

'use strict';

const ESTADOS_COBRANZA = ['pendiente_anticipo', 'anticipo_recibido', 'pago_parcial', 'liquidado', 'vencido'];

/**
 * Deriva el estado y los montos de cobranza — 100% puro, sin DB. Nunca
 * inventa: sin total_vendido válido, todo queda en null con un motivo.
 *
 * @param {Object} datos
 * @param {number} datos.totalVendido
 * @param {number|null} datos.anticipoRequerido - monto, no %; null = no se ha definido
 * @param {number} datos.totalPagado - suma de abonos
 * @param {string|null} [datos.fechaLimitePago] - 'YYYY-MM-DD'; sin esto "vencido" nunca se activa
 * @param {Date} [datos.hoy]
 */
function calcularEstadoCobranza({ totalVendido, anticipoRequerido, totalPagado, fechaLimitePago, hoy = new Date() }) {
  if (!(Number.isFinite(totalVendido) && totalVendido > 0)) {
    return { saldo: null, pct_pagado: null, estado: null, motivo: 'Sin un total vendido válido para calcular la cobranza.' };
  }

  const pagado = Number.isFinite(totalPagado) ? totalPagado : 0;
  const redondear = (n) => Math.round(n * 100) / 100;
  const saldo = redondear(Math.max(0, totalVendido - pagado));
  const pctPagado = redondear(Math.min(100, (pagado / totalVendido) * 100));

  const hoyFecha = hoy.toISOString().slice(0, 10);
  const venceHoyOAntes = fechaLimitePago && saldo > 0 && fechaLimitePago < hoyFecha;

  let estado;
  if (saldo <= 0) {
    estado = 'liquidado';
  } else if (venceHoyOAntes) {
    estado = 'vencido';
  } else if (pagado <= 0) {
    estado = 'pendiente_anticipo';
  } else if (Number.isFinite(anticipoRequerido) && pagado < anticipoRequerido) {
    estado = 'pendiente_anticipo';
  } else if (Number.isFinite(anticipoRequerido) && pagado === anticipoRequerido) {
    estado = 'anticipo_recibido';
  } else {
    // pagado > 0, y ya sea que no hay anticipo definido o ya se superó el
    // anticipo — en ambos casos es "pago parcial" sobre el total.
    estado = 'pago_parcial';
  }

  return { saldo, pct_pagado: pctPagado, estado, motivo: null };
}

/**
 * Registro de cobranza de un proyecto — se crea la PRIMERA vez que se
 * consulta o se registra un abono (get-or-create idempotente, mismo patrón
 * de índice único + 23505 que proyectos.js — nunca dos registros de
 * cobranza para el mismo proyecto, ni siquiera bajo una carrera real).
 */
async function _obtenerOCrearPagosCliente(supabase, { companyId, proyectoId }) {
  const { data: existente } = await supabase.from('pagos_cliente').select('*').eq('company_id', companyId).eq('proyecto_id', proyectoId).maybeSingle();
  if (existente) return existente;

  const { data: proyecto } = await supabase
    .from('proyectos').select('id, cotizacion_id, cliente_id, config_vendida').eq('id', proyectoId).eq('company_id', companyId).maybeSingle();
  if (!proyecto) {
    const err = new Error('Proyecto no encontrado');
    err.status = 404;
    throw err;
  }

  const totalVendido = proyecto.config_vendida?.precio_final_autorizado ?? proyecto.config_vendida?.total ?? null;
  if (!(Number.isFinite(totalVendido) && totalVendido > 0)) {
    const err = new Error('Este proyecto no tiene un total vendido válido en su snapshot — no se puede iniciar la cobranza todavía.');
    err.status = 409;
    throw err;
  }

  let anticipoPct = null;
  if (proyecto.cotizacion_id) {
    const { data: cot } = await supabase.from('cotizaciones').select('anticipo_pct').eq('id', proyecto.cotizacion_id).eq('company_id', companyId).maybeSingle();
    anticipoPct = cot?.anticipo_pct ?? null;
  }
  const anticipoMonto = Number.isFinite(anticipoPct) ? Math.round(totalVendido * (anticipoPct / 100) * 100) / 100 : null;

  const { data, error } = await supabase.from('pagos_cliente').insert([{
    company_id: companyId, proyecto_id: proyectoId, cotizacion_id: proyecto.cotizacion_id || null, cliente_id: proyecto.cliente_id || null,
    total_vendido: totalVendido, anticipo_requerido_pct: anticipoPct, anticipo_requerido_monto: anticipoMonto,
  }]).select().single();

  if (error?.code === '23505') {
    const { data: creadoPorOtroRequest } = await supabase.from('pagos_cliente').select('*').eq('company_id', companyId).eq('proyecto_id', proyectoId).maybeSingle();
    return creadoPorOtroRequest;
  }
  if (error) throw new Error(`cobranza._obtenerOCrearPagosCliente: ${error.message}`);
  return data;
}

/** Resumen completo de cobranza de un proyecto — lo que pinta la pantalla. */
async function obtenerResumenCobranza(supabase, companyId, proyectoId) {
  const pagosCliente = await _obtenerOCrearPagosCliente(supabase, { companyId, proyectoId });

  const { data: abonos } = await supabase
    .from('pagos_cliente_abonos').select('*').eq('company_id', companyId).eq('pagos_cliente_id', pagosCliente.id).order('fecha', { ascending: false });
  const totalPagado = (abonos || []).reduce((acumulado, a) => acumulado + Number(a.monto), 0);

  const derivado = calcularEstadoCobranza({
    totalVendido: Number(pagosCliente.total_vendido), anticipoRequerido: pagosCliente.anticipo_requerido_monto != null ? Number(pagosCliente.anticipo_requerido_monto) : null,
    totalPagado, fechaLimitePago: pagosCliente.fecha_limite_pago,
  });

  return { ...pagosCliente, abonos: abonos || [], total_pagado: Math.round(totalPagado * 100) / 100, ...derivado };
}

/**
 * Registra un abono — nunca deja que el total pagado exceda el total
 * vendido (rechaza el abono con un mensaje claro en vez de dejar un saldo
 * negativo silencioso, mismo criterio que "nunca stock negativo" de
 * inventario).
 */
async function registrarAbono(supabase, { companyId, proyectoId, monto, formaPago, referencia, fecha, comprobanteDocumentoId, notas, usuarioId }) {
  if (!(Number.isFinite(monto) && monto > 0)) {
    const err = new Error('El monto del abono debe ser mayor a 0.');
    err.status = 400;
    throw err;
  }

  const pagosCliente = await _obtenerOCrearPagosCliente(supabase, { companyId, proyectoId });

  const { data: abonosPrevios } = await supabase.from('pagos_cliente_abonos').select('monto').eq('company_id', companyId).eq('pagos_cliente_id', pagosCliente.id);
  const totalPagadoPrevio = (abonosPrevios || []).reduce((acumulado, a) => acumulado + Number(a.monto), 0);
  const saldoPrevio = Number(pagosCliente.total_vendido) - totalPagadoPrevio;

  if (monto > saldoPrevio + 0.01) { // tolerancia de centavo por redondeo
    const err = new Error(`El abono ($${monto.toLocaleString('es-MX')}) excede el saldo pendiente ($${saldoPrevio.toLocaleString('es-MX')}).`);
    err.status = 409;
    throw err;
  }

  const { data, error } = await supabase.from('pagos_cliente_abonos').insert([{
    company_id: companyId, pagos_cliente_id: pagosCliente.id, monto,
    forma_pago: formaPago || null, referencia: referencia || null, fecha: fecha || new Date().toISOString().slice(0, 10),
    comprobante_documento_id: comprobanteDocumentoId || null, notas: notas || null, registrado_por: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`cobranza.registrarAbono: ${error.message}`);

  return { abono: data, resumen: await obtenerResumenCobranza(supabase, companyId, proyectoId) };
}

/** Confirma/corrige el % de anticipo requerido — separado del alta automática porque hoy ninguna cotización real lo trae capturado. */
async function actualizarAnticipoRequerido(supabase, { companyId, proyectoId, anticipoPct, usuarioId }) {
  const pagosCliente = await _obtenerOCrearPagosCliente(supabase, { companyId, proyectoId });
  const monto = Number.isFinite(anticipoPct) ? Math.round(Number(pagosCliente.total_vendido) * (anticipoPct / 100) * 100) / 100 : null;

  const { data, error } = await supabase
    .from('pagos_cliente')
    .update({ anticipo_requerido_pct: anticipoPct ?? null, anticipo_requerido_monto: monto, updated_at: new Date().toISOString() })
    .eq('id', pagosCliente.id).eq('company_id', companyId).select().single();
  if (error) throw new Error(`cobranza.actualizarAnticipoRequerido: ${error.message}`);

  void usuarioId; // reservado para bitácora si se decide registrar este cambio explícitamente (ver deuda técnica del cierre de 2B)
  return data;
}

module.exports = { ESTADOS_COBRANZA, calcularEstadoCobranza, obtenerResumenCobranza, registrarAbono, actualizarAnticipoRequerido };
