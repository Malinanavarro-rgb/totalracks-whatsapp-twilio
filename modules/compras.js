/**
 * TARA Matrix™ — compras.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2G del bloque operativo post-venta (Alina, 2026-09-25, ver
 * NORT_ENERGY_PORTAL_PLAN.md). CORE genérico — reutiliza `productos` como
 * catálogo y `inventario_movimientos` (2F, modules/inventario.js) como
 * ÚNICO mecanismo para sumar existencia al recibir: `recibirOrdenCompra`
 * nunca toca `inventario_saldos` directamente.
 *
 * `recibirOrdenCompra` recibe la orden COMPLETA en un solo paso (todos los
 * ítems a la cantidad pedida) — mismo criterio de "recibir dos veces nunca
 * duplica la entrada" pedido explícitamente: el guardián es
 * `ordenes_compra.recibida_en` (nullable), reclamado con un
 * UPDATE...WHERE recibida_en IS NULL...RETURNING — actúa como mutex real
 * bajo concurrencia, mismo espíritu que los contadores de folio atómicos.
 *
 * El estado 'recibida' SOLO se alcanza a través de esta función —
 * `actualizarEstadoOrdenCompra` (cambio de etiqueta libre, sin efecto en
 * inventario) la rechaza explícitamente, para nunca dejar un botón que
 * "dice recibida" sin haber generado el movimiento real.
 *
 * @module modules/compras
 */

'use strict';

const { registrarMovimiento } = require('./inventario');

const ESTADOS_ORDEN_COMPRA = ['borrador', 'enviada', 'confirmada', 'recibida', 'cancelada'];

/** Folio de orden de compra — mismo mecanismo atómico que generarFolioProyecto (migración 113). */
async function generarFolioOrdenCompra(supabase, companyId) {
  const { data: empresa } = await supabase.from('companies').select('prefijo_orden_compra').eq('id', companyId).maybeSingle();
  const prefijo = empresa?.prefijo_orden_compra || 'OC';

  const { data: consecutivo, error } = await supabase.rpc('incrementar_folio_orden_compra', { p_company_id: companyId });
  if (error) throw new Error(`compras.generarFolioOrdenCompra: ${error.message}`);

  const anio = new Date().getFullYear();
  return `${prefijo}-${anio}-${String(consecutivo).padStart(4, '0')}`;
}

// ── Proveedores ────────────────────────────────────────────────────────────

async function crearProveedor(supabase, { companyId, nombre, contactoNombre, contactoTelefono, contactoEmail, notas }) {
  if (!nombre || !nombre.trim()) {
    const err = new Error('El nombre del proveedor es requerido.');
    err.status = 400;
    throw err;
  }
  const { data, error } = await supabase.from('proveedores').insert([{
    company_id: companyId, nombre: nombre.trim(), contacto_nombre: contactoNombre || null,
    contacto_telefono: contactoTelefono || null, contacto_email: contactoEmail || null, notas: notas || null,
  }]).select().single();
  if (error) throw new Error(`compras.crearProveedor: ${error.message}`);
  return data;
}

async function listarProveedores(supabase, companyId, { soloActivos = true } = {}) {
  let query = supabase.from('proveedores').select('*').eq('company_id', companyId).order('nombre', { ascending: true });
  if (soloActivos) query = query.eq('activo', true);
  const { data, error } = await query;
  return error ? [] : (data || []);
}

async function actualizarProveedor(supabase, { companyId, proveedorId, cambios }) {
  const payload = {};
  for (const campo of ['nombre', 'contacto_nombre', 'contacto_telefono', 'contacto_email', 'notas', 'activo']) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  const { data, error } = await supabase.from('proveedores').update(payload).eq('id', proveedorId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Proveedor no encontrado');
    err.status = 404;
    throw err;
  }
  return data;
}

// ── Órdenes de compra ────────────────────────────────────────────────────────

async function _enriquecerOrden(supabase, companyId, orden) {
  if (!orden) return null;
  const [{ data: proveedor }, sucursal, items] = await Promise.all([
    supabase.from('proveedores').select('nombre').eq('id', orden.proveedor_id).eq('company_id', companyId).maybeSingle(),
    orden.sucursal_id
      ? supabase.from('sucursales').select('nombre').eq('id', orden.sucursal_id).eq('company_id', companyId).maybeSingle().then((r) => r.data)
      : null,
    supabase.from('orden_compra_items').select('*, productos(marca, modelo, tipo, unidad)').eq('orden_id', orden.id),
  ]);
  const totalOrden = (items.data || []).reduce((acum, it) => acum + Number(it.cantidad) * Number(it.costo_unitario || 0), 0);
  return {
    ...orden, proveedor_nombre: proveedor?.nombre ?? null, sucursal_nombre: sucursal?.nombre ?? null,
    items: items.data || [], total: Math.round(totalOrden * 100) / 100,
  };
}

/**
 * Crea la orden y sus ítems. Valida que proveedor/sucursal/proyecto (si se
 * dio) y CADA producto pertenezcan a la empresa antes de insertar nada —
 * nunca una orden a medias con un producto ajeno colado.
 */
async function crearOrdenCompra(supabase, { companyId, proveedorId, sucursalId, proyectoId, items, fechaSolicitada, fechaEsperada, notas, usuarioId }) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('La orden necesita al menos un ítem.');
    err.status = 400;
    throw err;
  }
  for (const item of items) {
    if (!item.productoId || !(Number.isFinite(item.cantidad) && item.cantidad > 0)) {
      const err = new Error('Cada ítem necesita productoId y una cantidad mayor a 0.');
      err.status = 400;
      throw err;
    }
  }

  const [{ data: proveedor }, { data: sucursal }, proyectoValido, productosValidos] = await Promise.all([
    supabase.from('proveedores').select('id').eq('id', proveedorId).eq('company_id', companyId).maybeSingle(),
    supabase.from('sucursales').select('id').eq('id', sucursalId).eq('company_id', companyId).maybeSingle(),
    proyectoId
      ? supabase.from('proyectos').select('id').eq('id', proyectoId).eq('company_id', companyId).maybeSingle().then((r) => Boolean(r.data))
      : Promise.resolve(true),
    supabase.from('productos').select('id').eq('company_id', companyId).in('id', items.map((it) => it.productoId)),
  ]);
  if (!proveedor) { const err = new Error('Proveedor no encontrado'); err.status = 404; throw err; }
  if (!sucursal) { const err = new Error('Sucursal no encontrada'); err.status = 404; throw err; }
  if (!proyectoValido) { const err = new Error('Proyecto no encontrado'); err.status = 404; throw err; }
  const idsValidos = new Set((productosValidos.data || []).map((p) => p.id));
  if (items.some((it) => !idsValidos.has(it.productoId))) {
    const err = new Error('Uno o más productos no pertenecen a esta empresa.');
    err.status = 404;
    throw err;
  }

  const numeroOrden = await generarFolioOrdenCompra(supabase, companyId);
  const { data: orden, error } = await supabase.from('ordenes_compra').insert([{
    company_id: companyId, proveedor_id: proveedorId, sucursal_id: sucursalId, proyecto_id: proyectoId || null,
    numero_orden: numeroOrden, estado: 'borrador', fecha_solicitada: fechaSolicitada || null, fecha_esperada: fechaEsperada || null,
    notas: notas || null, creado_por: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`compras.crearOrdenCompra: ${error.message}`);

  const { error: errorItems } = await supabase.from('orden_compra_items').insert(
    items.map((it) => ({ orden_id: orden.id, producto_id: it.productoId, cantidad: it.cantidad, costo_unitario: it.costoUnitario ?? null })),
  );
  if (errorItems) throw new Error(`compras.crearOrdenCompra (items): ${errorItems.message}`);

  return _enriquecerOrden(supabase, companyId, orden);
}

async function obtenerOrdenCompra(supabase, companyId, ordenId) {
  const { data, error } = await supabase.from('ordenes_compra').select('*').eq('id', ordenId).eq('company_id', companyId).maybeSingle();
  if (error || !data) return null;
  return _enriquecerOrden(supabase, companyId, data);
}

async function listarOrdenesCompra(supabase, companyId, { estado, proveedorId } = {}) {
  let query = supabase.from('ordenes_compra').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (estado) query = query.eq('estado', estado);
  if (proveedorId) query = query.eq('proveedor_id', proveedorId);
  const { data, error } = await query;
  if (error) return [];
  return Promise.all((data || []).map((o) => _enriquecerOrden(supabase, companyId, o)));
}

const CAMPOS_ORDEN_EDITABLES = ['proveedor_id', 'sucursal_id', 'fecha_solicitada', 'fecha_esperada', 'notas'];

async function actualizarOrdenCompra(supabase, { companyId, ordenId, cambios }) {
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_ORDEN_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }
  const { data, error } = await supabase.from('ordenes_compra').update(payload).eq('id', ordenId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Orden de compra no encontrada');
    err.status = 404;
    throw err;
  }
  return _enriquecerOrden(supabase, companyId, data);
}

/**
 * Cambia la ETIQUETA de estado — nunca toca inventario. Rechaza 'recibida'
 * explícitamente (esa transición solo la hace `recibirOrdenCompra`, que sí
 * genera los movimientos reales) — nunca un botón que "dice recibida" sin
 * haberlo hecho.
 */
async function actualizarEstadoOrdenCompra(supabase, { companyId, ordenId, estado, usuarioId }) {
  if (!ESTADOS_ORDEN_COMPRA.includes(estado)) {
    const err = new Error(`Estado "${estado}" no reconocido.`);
    err.status = 400;
    throw err;
  }
  if (estado === 'recibida') {
    const err = new Error('Para marcar una orden como recibida usa el endpoint de recepción (genera el movimiento de inventario real).');
    err.status = 409;
    throw err;
  }

  const { data: actual } = await supabase.from('ordenes_compra').select('id, estado').eq('id', ordenId).eq('company_id', companyId).maybeSingle();
  if (!actual) {
    const err = new Error('Orden de compra no encontrada');
    err.status = 404;
    throw err;
  }
  if (actual.estado === 'recibida') {
    const err = new Error('Esta orden ya fue recibida — su estado no se puede cambiar retroactivamente.');
    err.status = 409;
    throw err;
  }

  const { data, error } = await supabase.from('ordenes_compra').update({ estado, updated_at: new Date().toISOString() }).eq('id', ordenId).eq('company_id', companyId).select().single();
  if (error) throw new Error(`compras.actualizarEstadoOrdenCompra: ${error.message}`);

  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId, texto: `Orden de compra ${actual.id}: "${actual.estado}" → "${estado}".`,
    contexto: 'Compras', autor_id: usuarioId || null, proyecto_id: data.proyecto_id || null,
  }]);

  return _enriquecerOrden(supabase, companyId, data);
}

/**
 * Recibe la orden COMPLETA: un movimiento 'entrada' por ítem, a la
 * cantidad pedida. Idempotente — reclama `recibida_en` con un
 * UPDATE...WHERE recibida_en IS NULL antes de tocar inventario; si dos
 * llamadas llegan casi al mismo tiempo, solo una gana esa fila y la otra
 * recibe 409 sin duplicar ningún movimiento.
 *
 * Si un ítem falla a medio camino (raro — los productos ya se validaron al
 * crear la orden), revierte con 'salida' los que sí se alcanzaron a
 * registrar en este intento y libera `recibida_en` para permitir reintentar
 * — mismo criterio "todo o nada con reversión honesta" que
 * reservarMaterialInstalacion (2F).
 */
async function recibirOrdenCompra(supabase, { companyId, ordenId, usuarioId }) {
  const { data: orden } = await supabase.from('ordenes_compra').select('*').eq('id', ordenId).eq('company_id', companyId).maybeSingle();
  if (!orden) {
    const err = new Error('Orden de compra no encontrada');
    err.status = 404;
    throw err;
  }
  if (orden.estado === 'cancelada') {
    const err = new Error('Esta orden está cancelada — no se puede recibir.');
    err.status = 409;
    throw err;
  }

  const { data: items, error: errorItems } = await supabase.from('orden_compra_items').select('*').eq('orden_id', ordenId);
  if (errorItems || !items || items.length === 0) {
    const err = new Error('Esta orden no tiene ítems.');
    err.status = 409;
    throw err;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const { data: reclamada, error: errorClaim } = await supabase
    .from('ordenes_compra').update({ recibida_en: new Date().toISOString(), estado: 'recibida', fecha_recibida: hoy, updated_at: new Date().toISOString() })
    .eq('id', ordenId).eq('company_id', companyId).is('recibida_en', null).select().maybeSingle();
  if (errorClaim) throw new Error(`compras.recibirOrdenCompra: ${errorClaim.message}`);
  if (!reclamada) {
    const err = new Error('Esta orden ya fue recibida.');
    err.status = 409;
    throw err;
  }

  const movimientos = [];
  try {
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop -- todo-o-nada: si un ítem falla, los anteriores se revierten en el catch
      const mov = await registrarMovimiento(supabase, {
        companyId, productoId: item.producto_id, sucursalId: orden.sucursal_id, tipo: 'entrada', cantidad: Number(item.cantidad),
        proyectoId: orden.proyecto_id || null, usuarioId, referencia: `Orden de compra ${orden.numero_orden}`,
      });
      // eslint-disable-next-line no-await-in-loop
      await supabase.from('orden_compra_items').update({ cantidad_recibida: item.cantidad }).eq('id', item.id);
      movimientos.push({ productoId: item.producto_id, cantidad: Number(item.cantidad) });
    }
  } catch (e) {
    for (const previo of movimientos) {
      // eslint-disable-next-line no-await-in-loop
      await registrarMovimiento(supabase, {
        companyId, productoId: previo.productoId, sucursalId: orden.sucursal_id, tipo: 'salida', cantidad: previo.cantidad,
        proyectoId: orden.proyecto_id || null, usuarioId, referencia: `Reversión — falló recepción de la orden ${orden.numero_orden}`,
      }).catch(() => {}); // best-effort; el error original es el que importa reportar
    }
    // Libera el mutex para permitir reintentar una vez corregido el problema.
    await supabase.from('ordenes_compra').update({ recibida_en: null, estado: orden.estado, fecha_recibida: null }).eq('id', ordenId).eq('company_id', companyId).catch(() => {});
    throw e;
  }

  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId, texto: `Orden de compra ${orden.numero_orden} recibida — ${items.length} ítem(s), inventario actualizado.`,
    contexto: 'Compras', autor_id: usuarioId || null, proyecto_id: orden.proyecto_id || null,
  }]);

  return _enriquecerOrden(supabase, companyId, reclamada);
}

module.exports = {
  ESTADOS_ORDEN_COMPRA, generarFolioOrdenCompra,
  crearProveedor, listarProveedores, actualizarProveedor,
  crearOrdenCompra, obtenerOrdenCompra, listarOrdenesCompra, actualizarOrdenCompra, actualizarEstadoOrdenCompra, recibirOrdenCompra,
};
