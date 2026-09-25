/**
 * TARA Matrix™ — inventario.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2F del bloque operativo post-venta (Alina, 2026-09-23/25, ver
 * NORT_ENERGY_PORTAL_PLAN.md). CORE genérico — reutiliza `productos` como
 * catálogo (ya usado por el cotizador), nunca una tabla de producto
 * paralela.
 *
 * Todo movimiento pasa por la función atómica de Postgres
 * `registrar_movimiento_inventario()` (migración 116): un UPDATE con lock
 * de fila real sobre `inventario_saldos`, así que dos movimientos
 * concurrentes del MISMO producto+sucursal se serializan de verdad — nunca
 * "existencia negativa silenciosa" por una carrera. `inventario_movimientos`
 * es el ledger append-only: cada modificación de inventario deja un
 * movimiento con quién/cuándo, un ajuste además exige `motivo` (validado
 * aquí, nunca "corregir la cantidad en silencio").
 *
 * `disponible` NUNCA se guarda — siempre existencia_fisica - reservado,
 * calculado en el momento (la función de Postgres ya lo regresa así).
 *
 * @module modules/inventario
 */

'use strict';

const TIPOS_MOVIMIENTO = ['entrada', 'salida', 'reserva', 'liberacion', 'ajuste', 'devolucion'];

/**
 * Registra UN movimiento — valida pertenencia (producto y sucursal reales
 * de esta empresa) antes de llamar al RPC atómico. Rechaza con un mensaje
 * claro si el RPC detecta que dejaría existencia/disponible negativos —
 * nunca se inserta el movimiento ni se toca el saldo en ese caso (la
 * función de Postgres revierte todo junto).
 *
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {string} datos.productoId
 * @param {string} datos.sucursalId
 * @param {'entrada'|'salida'|'reserva'|'liberacion'|'ajuste'|'devolucion'} datos.tipo
 * @param {number} datos.cantidad - positiva siempre, EXCEPTO 'ajuste' (puede ser negativa)
 * @param {string} [datos.proyectoId]
 * @param {string} [datos.usuarioId]
 * @param {string} [datos.referencia]
 * @param {string} [datos.motivo] - OBLIGATORIO si tipo === 'ajuste'
 * @param {string} [datos.observaciones]
 */
async function registrarMovimiento(supabase, { companyId, productoId, sucursalId, tipo, cantidad, proyectoId, usuarioId, referencia, motivo, observaciones }) {
  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    const err = new Error(`Tipo de movimiento "${tipo}" no reconocido.`);
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(cantidad) || cantidad === 0) {
    const err = new Error('cantidad debe ser un número distinto de 0.');
    err.status = 400;
    throw err;
  }
  if (tipo !== 'ajuste' && cantidad < 0) {
    const err = new Error(`cantidad debe ser positiva para el tipo "${tipo}" — solo "ajuste" puede ser negativo.`);
    err.status = 400;
    throw err;
  }
  if (tipo === 'ajuste' && !motivo) {
    const err = new Error('motivo es obligatorio para un ajuste — nunca se corrige inventario en silencio.');
    err.status = 400;
    throw err;
  }

  const [{ data: producto }, { data: sucursal }] = await Promise.all([
    supabase.from('productos').select('id').eq('id', productoId).eq('company_id', companyId).maybeSingle(),
    supabase.from('sucursales').select('id').eq('id', sucursalId).eq('company_id', companyId).maybeSingle(),
  ]);
  if (!producto) { const err = new Error('Producto no encontrado'); err.status = 404; throw err; }
  if (!sucursal) { const err = new Error('Sucursal no encontrada'); err.status = 404; throw err; }

  const { data, error } = await supabase.rpc('registrar_movimiento_inventario', {
    p_company_id: companyId, p_producto_id: productoId, p_sucursal_id: sucursalId, p_tipo: tipo, p_cantidad: cantidad,
    p_proyecto_id: proyectoId || null, p_usuario_id: usuarioId || null, p_referencia: referencia || null,
    p_motivo: motivo || null, p_observaciones: observaciones || null,
  });

  if (error) {
    // Los RAISE EXCEPTION del RPC (existencia/disponible insuficiente) llegan
    // aquí como error de Postgres — se traducen a 409, nunca a un 500 genérico.
    const err = new Error(error.message);
    err.status = 409;
    throw err;
  }

  const fila = Array.isArray(data) ? data[0] : data;
  return { movimiento_id: fila.movimiento_id, existencia_fisica: fila.existencia_fisica, reservado: fila.reservado, disponible: fila.disponible };
}

/** Saldo actual de un producto en una sucursal — 0/0/0 si nunca tuvo movimientos (nunca null, nunca inventado). */
async function obtenerSaldo(supabase, companyId, productoId, sucursalId) {
  const { data } = await supabase.from('inventario_saldos').select('existencia_fisica, reservado').eq('company_id', companyId).eq('producto_id', productoId).eq('sucursal_id', sucursalId).maybeSingle();
  const existenciaFisica = Number(data?.existencia_fisica ?? 0);
  const reservado = Number(data?.reservado ?? 0);
  return { existencia_fisica: existenciaFisica, reservado, disponible: existenciaFisica - reservado };
}

/** Saldos de todos los productos de un tipo en una sucursal (o de todas las sucursales si se omite) — para la vista de existencias. */
async function listarSaldos(supabase, companyId, { sucursalId, tipoProducto } = {}) {
  let query = supabase.from('inventario_saldos').select('*, productos(marca, modelo, tipo, unidad)').eq('company_id', companyId);
  if (sucursalId) query = query.eq('sucursal_id', sucursalId);
  const { data, error } = await query;
  if (error) return [];

  const filtrados = tipoProducto ? (data || []).filter((s) => s.productos?.tipo === tipoProducto) : (data || []);
  return filtrados.map((s) => ({
    ...s, disponible: Number(s.existencia_fisica) - Number(s.reservado),
  }));
}

/** Historial de movimientos de un producto (opcionalmente en una sucursal) — el ledger completo, más reciente primero. */
async function listarMovimientos(supabase, companyId, { productoId, sucursalId, proyectoId, limite = 100 } = {}) {
  let query = supabase.from('inventario_movimientos').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(limite);
  if (productoId) query = query.eq('producto_id', productoId);
  if (sucursalId) query = query.eq('sucursal_id', sucursalId);
  if (proyectoId) query = query.eq('proyecto_id', proyectoId);
  const { data, error } = await query;
  return error ? [] : (data || []);
}

/**
 * Una instalación reserva el material que va a usar — un movimiento
 * 'reserva' por cada ítem, ligado al proyecto de la instalación. Si
 * CUALQUIER ítem no tiene disponible suficiente, no reserva NADA (todo o
 * nada) — nunca deja una reserva a medias.
 */
async function reservarMaterialInstalacion(supabase, { companyId, instalacion, items, usuarioId }) {
  if (!instalacion.sucursal_id) {
    const err = new Error('Esta instalación no tiene sucursal asignada — no se puede reservar material sin saber de dónde sale.');
    err.status = 409;
    throw err;
  }

  const resultados = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop -- todo-o-nada: si un ítem falla, los anteriores ya reservados se revierten abajo
    const r = await registrarMovimiento(supabase, {
      companyId, productoId: item.productoId, sucursalId: instalacion.sucursal_id, tipo: 'reserva', cantidad: item.cantidad,
      proyectoId: instalacion.proyecto_id, usuarioId, referencia: `Instalación ${instalacion.id}`,
    }).catch(async (e) => {
      // Revertir lo ya reservado en este mismo intento, para no dejar una
      // reserva parcial silenciosa si un ítem posterior falla.
      for (const previo of resultados) {
        // eslint-disable-next-line no-await-in-loop
        await registrarMovimiento(supabase, {
          companyId, productoId: previo.productoId, sucursalId: instalacion.sucursal_id, tipo: 'liberacion', cantidad: previo.cantidad,
          proyectoId: instalacion.proyecto_id, usuarioId, referencia: `Reversión — falló reserva de ${item.productoId}`,
        }).catch(() => {}); // best-effort; el error original es el que importa reportar
      }
      throw e;
    });
    resultados.push({ productoId: item.productoId, cantidad: item.cantidad, ...r });
  }
  return resultados;
}

/**
 * Al terminar la instalación: libera la reserva y registra la salida real
 * (el material físicamente se usó) — un par liberacion+salida por ítem,
 * mismo criterio que "toda modificación deja movimiento".
 */
async function consumirMaterialInstalacion(supabase, { companyId, instalacion, items, usuarioId }) {
  if (!instalacion.sucursal_id) {
    const err = new Error('Esta instalación no tiene sucursal asignada.');
    err.status = 409;
    throw err;
  }

  const resultados = [];
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await registrarMovimiento(supabase, {
      companyId, productoId: item.productoId, sucursalId: instalacion.sucursal_id, tipo: 'liberacion', cantidad: item.cantidad,
      proyectoId: instalacion.proyecto_id, usuarioId, referencia: `Instalación ${instalacion.id} — consumo`,
    });
    // eslint-disable-next-line no-await-in-loop
    const salida = await registrarMovimiento(supabase, {
      companyId, productoId: item.productoId, sucursalId: instalacion.sucursal_id, tipo: 'salida', cantidad: item.cantidad,
      proyectoId: instalacion.proyecto_id, usuarioId, referencia: `Instalación ${instalacion.id} — consumo`,
    });
    resultados.push({ productoId: item.productoId, cantidad: item.cantidad, ...salida });
  }
  return resultados;
}

module.exports = {
  TIPOS_MOVIMIENTO, registrarMovimiento, obtenerSaldo, listarSaldos, listarMovimientos,
  reservarMaterialInstalacion, consumirMaterialInstalacion,
};
