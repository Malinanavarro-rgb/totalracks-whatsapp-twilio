/**
 * TARA Matrix™ — equipos-instalados.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subfase 2D del bloque operativo post-venta (Alina, 2026-09-25, ver
 * NORT_ENERGY_PORTAL_PLAN.md). CORE genérico: número de serie + garantía +
 * marca/modelo es universal, no específico de energía solar.
 *
 * Nace SIEMPRE de una instalación real (2C) — nunca un registro suelto. Es
 * la fuente de "mis paneles/productos" en el futuro portal del cliente, por
 * eso toda lectura filtra por `proyecto_id`, nunca un listado global.
 *
 * Si se liga a un producto del catálogo, la garantía se prellena desde
 * `productos.garantia_meses` — solo si el catálogo la trae; nunca se
 * inventa un plazo. Siempre editable después.
 *
 * @module modules/equipos-instalados
 */

'use strict';

const CAMPOS_EQUIPO_EDITABLES = [
  'marca', 'modelo', 'numero_serie', 'potencia_capacidad', 'proveedor',
  'fecha_instalacion', 'garantia_meses', 'documento_evidencia_id', 'notas',
];

/**
 * Registra un equipo — verifica la CADENA completa antes de escribir
 * (instalación pertenece al proyecto indicado Y a esta empresa), mismo
 * patrón obligatorio de la sección 7 del plan para tocar una fila hija de
 * otra.
 */
async function crearEquipoInstalado(supabase, {
  companyId, proyectoId, instalacionId, tipoEquipo, marca, modelo, numeroSerie,
  potenciaCapacidad, proveedor, fechaInstalacion, garantiaMeses, productoId,
  documentoEvidenciaId, notas, usuarioId,
}) {
  if (!tipoEquipo) {
    const err = new Error('tipoEquipo es requerido');
    err.status = 400;
    throw err;
  }

  const { data: instalacion } = await supabase
    .from('instalaciones').select('id, proyecto_id').eq('id', instalacionId).eq('company_id', companyId).eq('proyecto_id', proyectoId).maybeSingle();
  if (!instalacion) {
    const err = new Error('Instalación no encontrada para este proyecto');
    err.status = 404;
    throw err;
  }

  let garantiaFinal = garantiaMeses ?? null;
  if (garantiaFinal == null && productoId) {
    const { data: producto } = await supabase.from('productos').select('garantia_meses').eq('id', productoId).eq('company_id', companyId).maybeSingle();
    garantiaFinal = producto?.garantia_meses ?? null;
  }

  const { data, error } = await supabase.from('equipos_instalados').insert([{
    company_id: companyId, proyecto_id: proyectoId, instalacion_id: instalacionId, tipo_equipo: tipoEquipo,
    marca: marca || null, modelo: modelo || null, numero_serie: numeroSerie || null,
    potencia_capacidad: potenciaCapacidad || null, proveedor: proveedor || null,
    fecha_instalacion: fechaInstalacion || null, garantia_meses: garantiaFinal, producto_id: productoId || null,
    documento_evidencia_id: documentoEvidenciaId || null, notas: notas || null, registrado_por: usuarioId || null,
  }]).select().single();
  if (error) throw new Error(`equipos-instalados.crearEquipoInstalado: ${error.message}`);

  const etiqueta = [tipoEquipo, marca, modelo].filter(Boolean).join(' ');
  await supabase.from('bitacora_decisiones').insert([{
    company_id: companyId, texto: `Equipo registrado: ${etiqueta}${numeroSerie ? ` (S/N ${numeroSerie})` : ''}.`,
    contexto: 'Equipo instalado', autor_id: usuarioId || null, proyecto_id: proyectoId,
  }]);

  return data;
}

async function obtenerEquipoInstalado(supabase, companyId, equipoId) {
  const { data, error } = await supabase.from('equipos_instalados').select('*').eq('id', equipoId).eq('company_id', companyId).maybeSingle();
  if (error || !data) return null;
  return data;
}

/** Lista de "mis paneles/productos" de un proyecto — misma función para el panel de empleados y, más adelante, el portal del cliente. */
async function listarEquiposDeProyecto(supabase, companyId, proyectoId) {
  const { data, error } = await supabase.from('equipos_instalados').select('*').eq('company_id', companyId).eq('proyecto_id', proyectoId).order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}

async function listarEquiposDeInstalacion(supabase, companyId, instalacionId) {
  const { data, error } = await supabase.from('equipos_instalados').select('*').eq('company_id', companyId).eq('instalacion_id', instalacionId).order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}

async function actualizarEquipoInstalado(supabase, { companyId, equipoId, cambios }) {
  const payload = { updated_at: new Date().toISOString() };
  for (const campo of CAMPOS_EQUIPO_EDITABLES) {
    if (cambios[campo] !== undefined) payload[campo] = cambios[campo];
  }

  const { data, error } = await supabase.from('equipos_instalados').update(payload).eq('id', equipoId).eq('company_id', companyId).select().maybeSingle();
  if (error || !data) {
    const err = new Error('Equipo no encontrado');
    err.status = 404;
    throw err;
  }
  return data;
}

module.exports = {
  crearEquipoInstalado, obtenerEquipoInstalado, listarEquiposDeProyecto, listarEquiposDeInstalacion, actualizarEquipoInstalado,
};
