/**
 * TARA Matrix™ — paquetes-solares.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Catálogo configurable de paquetes comerciales de paneles solares (Alina,
 * 2026-08-04) — el precio comercial ya NO se calcula sumando cada
 * componente de la lista de materiales; el cliente tiene una tabla de
 * precios estándar por paquete (4/6/8/10/12 paneles...) que cambia por
 * empresa, nunca vive codificada en el motor.
 *
 * Separación deliberada de responsabilidades (Alina): el resultado TÉCNICO
 * del motor (modules/motores-ingenieria/paneles-solares.js, cuántos
 * paneles hacen falta) es independiente del PAQUETE COMERCIAL recomendado
 * (este módulo, qué paquete estándar cubre esa cantidad) que a su vez es
 * independiente del PRECIO FINAL AUTORIZADO (decisión humana del asesor,
 * que puede ajustar el precio del paquete recomendado). Ninguna de las tres
 * capas sobreescribe a las otras.
 *
 * @module modules/paquetes-solares
 */

'use strict';

const CAMPOS_PAQUETE = [
  'nombre', 'cantidad_paneles', 'potencia_panel_wp', 'potencia_total_kwp',
  'marca_panel', 'modelo_panel', 'tipo_inversor', 'cantidad_inversores',
  'marca_inversor', 'modelo_inversor', 'entradas_por_inversor',
  'componentes_incluidos', 'garantias', 'precio_contado',
  'vigencia_desde', 'vigencia_hasta', 'activo',
];

async function listarPaquetes(supabase, companyId, { soloActivos = false } = {}) {
  let query = supabase.from('paquetes_solares').select('*').eq('company_id', companyId).order('cantidad_paneles');
  if (soloActivos) query = query.eq('activo', true);
  const { data, error } = await query;
  return error ? [] : (data || []);
}

async function crearPaquete(supabase, companyId, datos) {
  if (!datos.nombre || !datos.cantidad_paneles || datos.precio_contado == null) {
    const err = new Error('nombre, cantidad_paneles y precio_contado son requeridos');
    err.status = 400;
    throw err;
  }

  const payload = { company_id: companyId };
  for (const campo of CAMPOS_PAQUETE) {
    if (datos[campo] !== undefined) payload[campo] = datos[campo];
  }

  const { data, error } = await supabase.from('paquetes_solares').insert([payload]).select().single();
  if (error) throw new Error(`paquetes-solares.crearPaquete: ${error.message}`);
  return data;
}

async function actualizarPaquete(supabase, companyId, paqueteId, cambios) {
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_PAQUETE) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const { data, error } = await supabase
    .from('paquetes_solares').update(payload).eq('id', paqueteId).eq('company_id', companyId).select().maybeSingle();

  if (error || !data) {
    const err = new Error('Paquete no encontrado');
    err.status = 404;
    throw err;
  }
  return data;
}

/**
 * Nunca borra un paquete que ya se haya recomendado en alguna cotización
 * (rompería la trazabilidad histórica) — desactivar es la operación segura
 * por defecto; eliminarPaquete() solo debe usarse para paquetes creados por
 * error, nunca usados.
 */
async function desactivarPaquete(supabase, companyId, paqueteId) {
  return actualizarPaquete(supabase, companyId, paqueteId, { activo: false });
}

async function eliminarPaquete(supabase, companyId, paqueteId) {
  const { error } = await supabase.from('paquetes_solares').delete().eq('id', paqueteId).eq('company_id', companyId);
  if (error) throw new Error(`paquetes-solares.eliminarPaquete: ${error.message}`);
}

/**
 * Selecciona el paquete comercial "inmediato superior" a la cantidad
 * TÉCNICA de paneles que calculó el motor — nunca redondea hacia abajo
 * (eso subdimensionaría el sistema que se le vende al cliente). Considera
 * solo paquetes activos y vigentes (vigencia_desde ≤ hoy ≤ vigencia_hasta,
 * o vigencia_hasta null = indefinida).
 *
 * Si la cantidad técnica excede el paquete más grande disponible, NO
 * inventa un precio ni recomienda el más grande como si alcanzara —
 * devuelve null explícitamente; el caller debe tratarlo como un caso que
 * necesita un paquete a la medida (fuera del catálogo estándar).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.numeroPanelesTecnico
 * @returns {Promise<Object|null>} el paquete recomendado, o null si ninguno alcanza
 */
async function seleccionarPaqueteRecomendado(supabase, { companyId, numeroPanelesTecnico }) {
  if (!companyId || !numeroPanelesTecnico || numeroPanelesTecnico <= 0) return null;

  const hoy = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('paquetes_solares')
    .select('*')
    .eq('company_id', companyId)
    .eq('activo', true)
    .lte('vigencia_desde', hoy)
    .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`)
    .gte('cantidad_paneles', numeroPanelesTecnico)
    .order('cantidad_paneles', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('⚠️  paquetes-solares.seleccionarPaqueteRecomendado error:', error.message);
    return null;
  }

  return data || null;
}

/**
 * Panel de Cotizaciones (Alina, 2026-08-10) — Portafolio de Servicios:
 * cada paquete con sus cotizaciones relacionadas (folio, cliente, total,
 * estado). Reutiliza `paquetes_solares`/`cotizaciones.paquete_recomendado_id`
 * — que YA es la relación real de esta industria (confirmado en la
 * auditoría: `cotizacion_lineas.servicio_id` no se usa para paneles
 * solares, la tabla genérica `servicios` es de otra industria) — no crea
 * ninguna arquitectura paralela.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @returns {Promise<Array>} paquetes (todos, incluidos inactivos — un
 *   paquete descontinuado puede seguir teniendo cotizaciones históricas),
 *   cada uno con `cotizaciones: []`
 */
async function listarPaquetesConCotizaciones(supabase, companyId) {
  const { data: paquetes, error: errPaquetes } = await supabase
    .from('paquetes_solares')
    .select('*')
    .eq('company_id', companyId)
    .order('cantidad_paneles', { ascending: true });

  if (errPaquetes || !paquetes) return [];
  if (paquetes.length === 0) return [];

  const { data: cotizaciones } = await supabase
    .from('cotizaciones')
    .select('id, folio, estado, total, created_at, paquete_recomendado_id, clientes(nombre, telefono)')
    .eq('company_id', companyId)
    .in('paquete_recomendado_id', paquetes.map(p => p.id))
    .order('created_at', { ascending: false });

  const porPaquete = {};
  for (const c of cotizaciones || []) {
    (porPaquete[c.paquete_recomendado_id] ||= []).push(c);
  }

  return paquetes.map(p => ({ ...p, cotizaciones: porPaquete[p.id] || [] }));
}

module.exports = {
  listarPaquetes, crearPaquete, actualizarPaquete, desactivarPaquete, eliminarPaquete, seleccionarPaqueteRecomendado,
  listarPaquetesConCotizaciones,
};
