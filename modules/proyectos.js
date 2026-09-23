/**
 * TARA Matrix™ — proyectos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2A del bloque operativo post-venta (Alina, 2026-09-22, ver
 * NORT_ENERGY_PORTAL_PLAN.md): convierte una cotización aceptada en el
 * expediente operativo (`proyectos`, tipo='venta') que sostendrá todo lo que
 * pase después de la venta (2B-2I). Reutiliza `proyectos` (Modo Operador,
 * ya con `oportunidad_id`/`cotizacion_id` desde la migración 088) — nunca
 * crea una tabla `ventas` paralela.
 *
 * `marcarCotizacionAceptadaYCrearProyecto()` es UNA transición de negocio
 * completa, no un UPDATE suelto: valida pertenencia/estado, marca la
 * cotización, genera el folio, arma el snapshot inmutable de lo vendido,
 * crea el proyecto y dEja rastro en `bitacora_decisiones` — todo en una
 * sola llamada, pensada para un único botón "Marcar como aceptada" en la UI.
 *
 * Idempotencia real (punto 9 de la aprobación): un ÍNDICE ÚNICO en Postgres
 * (`idx_proyectos_cotizacion_venta_unico`, migración 113) es la garantía —
 * no una verificación de aplicación que puede perder una carrera. Un
 * segundo intento (doble clic, retry, dos pestañas) choca contra el índice
 * (23505) y esta función devuelve el proyecto que ya existe, nunca crea
 * uno nuevo — mismo patrón ya probado en cotizacion-adjuntos.js.
 *
 * @module modules/proyectos
 */

'use strict';

const { obtenerCotizacion } = require('./cotizaciones');

const ESTADOS_ORIGEN_VALIDOS_PARA_ACEPTAR = ['borrador', 'enviada', 'vista'];

/**
 * Folio humano del proyecto — MISMO mecanismo que generarFolio() de
 * cotizaciones (contador atómico por empresa vía UPDATE...RETURNING,
 * migración 097), con su propio contador (`siguiente_folio_proyecto`,
 * independiente del de cotizaciones) y un prefijo configurable por empresa
 * (`companies.prefijo_proyecto`, mismo patrón que nav_labels/color_acento —
 * nunca "NE" hardcodeado, esta tabla la puede usar cualquier empresa).
 */
async function generarFolioProyecto(supabase, companyId) {
  const { data: empresa } = await supabase.from('companies').select('prefijo_proyecto').eq('id', companyId).maybeSingle();
  const prefijo = empresa?.prefijo_proyecto || 'PRY';

  const { data: consecutivo, error } = await supabase.rpc('incrementar_folio_proyecto', { p_company_id: companyId });
  if (error) throw new Error(`proyectos.generarFolioProyecto: ${error.message}`);

  const anio = new Date().getFullYear();
  return `${prefijo}-${anio}-${String(consecutivo).padStart(4, '0')}`;
}

/**
 * Snapshot INMUTABLE de lo vendido — se copia una sola vez al crear el
 * proyecto. Cambios futuros a `productos`/`paquetes_solares`/precios NUNCA
 * alteran un proyecto ya creado (requisito explícito). 100% pura — recibe
 * el objeto ya armado por obtenerCotizacion() (calculo/lineas/paquete
 * incluidos), nunca vuelve a tocar la DB. Todo opcional con `?? null` —
 * nunca inventa un valor que la cotización no tenía.
 */
function construirSnapshotVendido(cotizacion) {
  const resultados = cotizacion.calculo?.resultados || {};
  const panel = cotizacion.calculo?.catalogo_usado?.panel || null;
  const inversor = resultados.inversor_seleccionado?.inversorSeleccionado || null;

  return {
    cotizacion_folio: cotizacion.folio ?? null,
    cotizacion_version: cotizacion.version ?? 1,
    paquete_recomendado: cotizacion.paquetes_solares?.nombre ?? null,
    panel: panel ? { marca: panel.marca ?? null, modelo: panel.modelo ?? null, cantidad: resultados.numero_paneles?.valor ?? null } : null,
    inversor: inversor ? { marca: inversor.marca ?? null, modelo: inversor.modelo ?? null } : null,
    potencia_instalada_kwp: resultados.potencia_instalada_kwp ?? null,
    cobertura_pct: resultados.cobertura_pct ?? null,
    produccion_anual_kwh: resultados.produccion?.anual ?? null,
    total: cotizacion.total ?? null,
    precio_final_autorizado: cotizacion.precio_final_autorizado ?? null,
    descuento_pct: cotizacion.descuento_pct ?? null,
    descuento_monto: cotizacion.descuento_monto ?? null,
    forma_pago: cotizacion.forma_pago ?? null,
    lineas: (cotizacion.lineas || []).map((l) => ({
      descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario, subtotal: l.subtotal,
    })),
  };
}

/** Nombre/teléfono de cliente, nombre de sucursal, nombre de asesor — 3 consultas simples en vez de un embed de PostgREST (la relación asesor_id→asesores ya falló una vez por caché de esquema esta sesión, ver memoria). */
async function _enriquecerProyecto(supabase, companyId, proyecto) {
  if (!proyecto) return null;

  const [{ data: cliente }, sucursal, asesor] = await Promise.all([
    supabase.from('clientes').select('nombre, telefono').eq('id', proyecto.cliente_id).eq('company_id', companyId).maybeSingle(),
    proyecto.sucursal_id
      ? supabase.from('sucursales').select('nombre').eq('id', proyecto.sucursal_id).eq('company_id', companyId).maybeSingle().then((r) => r.data)
      : null,
    proyecto.asesor_id
      ? supabase.from('asesores').select('nombre').eq('id', proyecto.asesor_id).eq('company_id', companyId).maybeSingle().then((r) => r.data)
      : null,
  ]);

  return { ...proyecto, cliente_nombre: cliente?.nombre ?? null, cliente_telefono: cliente?.telefono ?? null, sucursal_nombre: sucursal?.nombre ?? null, asesor_nombre: asesor?.nombre ?? null };
}

/** Crea el proyecto de venta o recupera el que ya existe — nunca duplica (ver índice único, migración 113). */
async function _crearORecuperarProyectoDeVenta(supabase, { companyId, cotizacion, cliente, oportunidadDireccion, usuarioId }) {
  const { data: existente } = await supabase
    .from('proyectos').select('*').eq('company_id', companyId).eq('cotizacion_id', cotizacion.id).eq('tipo', 'venta').maybeSingle();
  if (existente) return { proyecto: await _enriquecerProyecto(supabase, companyId, existente), yaExistia: true };

  const numeroProyecto = await generarFolioProyecto(supabase, companyId);
  const configVendida = construirSnapshotVendido(cotizacion);
  // Ubicación de instalación: prioriza lo que capturó la calificación de la
  // oportunidad (más específico al sitio) sobre la dirección general del
  // cliente — nunca inventa una si ninguna de las dos existe.
  const ubicacionInstalacion = oportunidadDireccion || cliente?.direccion || null;

  const payload = {
    company_id: companyId, tipo: 'venta',
    nombre: `Proyecto solar — ${cliente?.nombre || 'cliente'}`,
    estado: 'activo', riesgo: 'bajo',
    cliente_id: cotizacion.cliente_id, oportunidad_id: cotizacion.oportunidad_id || null, cotizacion_id: cotizacion.id,
    sucursal_id: cotizacion.sucursal_id || null,
    asesor_id: cliente?.asesor_id || null,
    ubicacion_instalacion: ubicacionInstalacion,
    numero_proyecto: numeroProyecto,
    config_vendida: configVendida,
    fecha_inicio: new Date().toISOString().slice(0, 10),
  };

  const { data, error } = await supabase.from('proyectos').insert([payload]).select().single();

  if (error?.code === '23505') {
    // Carrera real: otro request creó el proyecto entre el SELECT de arriba
    // y este INSERT (dos pestañas, doble clic muy rápido). El índice único
    // es quien realmente lo impidió — aquí solo se recupera lo que ganó.
    const { data: creadoPorOtroRequest } = await supabase
      .from('proyectos').select('*').eq('company_id', companyId).eq('cotizacion_id', cotizacion.id).eq('tipo', 'venta').maybeSingle();
    return { proyecto: await _enriquecerProyecto(supabase, companyId, creadoPorOtroRequest), yaExistia: true };
  }
  if (error) throw new Error(`proyectos._crearORecuperarProyectoDeVenta: ${error.message}`);

  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId,
    texto: `Cotización ${cotizacion.folio || cotizacion.id} aceptada — proyecto ${numeroProyecto} creado.`,
    contexto: 'Aceptación de cotización', autor_id: usuarioId || null, cliente_id: cotizacion.cliente_id, proyecto_id: data.id,
  }]);

  return { proyecto: await _enriquecerProyecto(supabase, companyId, data), yaExistia: false };
}

/**
 * La transición completa: acepta la cotización (si no lo estaba ya) y
 * crea/recupera su proyecto de venta. Pensada para UN solo botón en la UI.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.cotizacionId
 * @param {string} datos.usuarioId - quién ejecuta la acción (aceptada_por, autor de bitácora)
 * @returns {Promise<{proyecto: Object, proyectoYaExistia: boolean, cotizacionYaEstabaAceptada: boolean}>}
 */
async function marcarCotizacionAceptadaYCrearProyecto(supabase, { companyId, cotizacionId, usuarioId }) {
  const cotizacion = await obtenerCotizacion(supabase, companyId, cotizacionId);
  if (!cotizacion) {
    const err = new Error('Cotización no encontrada');
    err.status = 404;
    throw err;
  }

  const cotizacionYaEstabaAceptada = cotizacion.estado === 'aceptada';
  if (!cotizacionYaEstabaAceptada && !ESTADOS_ORIGEN_VALIDOS_PARA_ACEPTAR.includes(cotizacion.estado)) {
    const err = new Error(`No se puede aceptar una cotización en estado "${cotizacion.estado}" — solo desde borrador, enviada o vista.`);
    err.status = 409;
    throw err;
  }

  if (!cotizacionYaEstabaAceptada) {
    const { error } = await supabase
      .from('cotizaciones')
      .update({ estado: 'aceptada', aceptada_en: new Date().toISOString(), aceptada_por: usuarioId || null })
      .eq('id', cotizacionId)
      .eq('company_id', companyId);
    if (error) throw new Error(`proyectos.marcarCotizacionAceptadaYCrearProyecto: ${error.message}`);
  }

  const [{ data: cliente }, oportunidadDireccion] = await Promise.all([
    supabase.from('clientes').select('nombre, telefono, direccion, asesor_id').eq('id', cotizacion.cliente_id).eq('company_id', companyId).maybeSingle(),
    cotizacion.oportunidad_id
      ? supabase.from('oportunidades').select('direccion, colonia, ciudad').eq('id', cotizacion.oportunidad_id).eq('company_id', companyId).maybeSingle()
        .then((r) => [r.data?.direccion, r.data?.colonia, r.data?.ciudad].filter(Boolean).join(', ') || null)
      : Promise.resolve(null),
  ]);

  const { proyecto, yaExistia } = await _crearORecuperarProyectoDeVenta(supabase, { companyId, cotizacion, cliente, oportunidadDireccion, usuarioId });

  return { proyecto, proyectoYaExistia: yaExistia, cotizacionYaEstabaAceptada };
}

/** Expediente del proyecto, con nombres resueltos — para la pantalla de detalle. */
async function obtenerProyecto(supabase, companyId, proyectoId) {
  const { data, error } = await supabase.from('proyectos').select('*').eq('id', proyectoId).eq('company_id', companyId).maybeSingle();
  if (error || !data) return null;
  return _enriquecerProyecto(supabase, companyId, data);
}

/** El proyecto de venta de un cliente (si tiene uno) — para el link "Ver proyecto" desde el expediente del cliente. */
async function obtenerProyectoDeCliente(supabase, companyId, clienteId) {
  const { data } = await supabase
    .from('proyectos').select('id, numero_proyecto').eq('company_id', companyId).eq('cliente_id', clienteId).eq('tipo', 'venta')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

/** El proyecto de venta de una cotización (si ya se convirtió) — para el link "Ver proyecto" desde el detalle de la cotización. */
async function obtenerProyectoDeCotizacion(supabase, companyId, cotizacionId) {
  const { data } = await supabase
    .from('proyectos').select('id, numero_proyecto').eq('company_id', companyId).eq('cotizacion_id', cotizacionId).eq('tipo', 'venta').maybeSingle();
  return data || null;
}

module.exports = {
  generarFolioProyecto, construirSnapshotVendido, marcarCotizacionAceptadaYCrearProyecto,
  obtenerProyecto, obtenerProyectoDeCliente, obtenerProyectoDeCotizacion,
};
