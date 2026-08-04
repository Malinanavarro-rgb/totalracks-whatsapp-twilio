/**
 * TARA Matrix™ — cotizaciones.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Capa de conexión entre el motor de ingeniería (100% puro, sin DB — ver
 * modules/motores-ingenieria/) y Supabase. Resuelve HSP/parámetros/catálogo
 * reales, corre el motor correspondiente a la industria de la empresa, y
 * persiste cada corrida como una fila NUEVA e inmutable en
 * calculos_ingenieria (nunca UPDATE).
 *
 * Fase 1 (Alina, 2026-08-04): solo lo necesario para conectar el motor a
 * datos reales y validar los 3 casos contra la base de datos. CRUD
 * completo de cotizaciones/folio/envío queda para la siguiente fase —
 * PDF, correo y frontend explícitamente fuera de esta fase.
 *
 * @module modules/cotizaciones
 */

'use strict';

const { obtenerMotor } = require('./motores-ingenieria');

/**
 * Resuelve el HSP de una ubicación — por nombre exacto (Fase 1; matching
 * geográfico por cercanía queda para después) o por un id ya conocido.
 * Devuelve null si no hay ninguna fila — el motor lo trata como "falta
 * HSP" (alerta de bloqueo), nunca inventa un valor.
 */
async function resolverHSP(supabase, { nombreUbicacion, irradiacionId }) {
  let query = supabase.from('irradiacion_regional').select('*');
  query = irradiacionId ? query.eq('id', irradiacionId) : query.eq('nombre_ubicacion', nombreUbicacion);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;

  return {
    valor: data.hsp_promedio_anual,
    hsp_mensual: data.hsp_mensual || null,
    fuente: data.fuente,
    ubicacion: data.nombre_ubicacion,
    fecha_fuente: data.fecha_fuente,
  };
}

/**
 * Resuelve un parámetro configurable (performance_ratio, factor_emision_co2,
 * ratio_dc_ac_objetivo, factor_separacion_filas) — prioriza el override de
 * la empresa si existe, si no cae al default global (company_id IS NULL).
 * Devuelve {valor, fuente, anio, documento} — nunca solo el número, para
 * que el cálculo pueda guardar de dónde salió.
 */
async function resolverParametro(supabase, { companyId, industriaSlug, clave }) {
  const { data: propio } = await supabase
    .from('parametros_ingenieria').select('*')
    .eq('company_id', companyId).eq('industria_slug', industriaSlug).eq('clave', clave)
    .order('vigente_desde', { ascending: false }).limit(1).maybeSingle();

  const fila = propio || (await supabase
    .from('parametros_ingenieria').select('*')
    .is('company_id', null).eq('industria_slug', industriaSlug).eq('clave', clave)
    .order('vigente_desde', { ascending: false }).limit(1).maybeSingle()).data;

  if (!fila) return null;

  return {
    valor: Number(fila.valor),
    fuente: fila.organismo_fuente,
    anio: fila.anio_fuente,
    documento: fila.documento_fuente,
    unidad: fila.unidad,
    especifico_de_empresa: Boolean(propio),
  };
}

/** Resuelve los 4 parámetros que usa el motor de paneles solares en una sola llamada. */
async function resolverParametrosPanelesSolares(supabase, companyId) {
  const [performance_ratio, factor_emision_co2, ratio_dc_ac_objetivo, factor_separacion_filas] = await Promise.all([
    resolverParametro(supabase, { companyId, industriaSlug: 'paneles_solares', clave: 'performance_ratio' }),
    resolverParametro(supabase, { companyId, industriaSlug: 'paneles_solares', clave: 'factor_emision_co2' }),
    resolverParametro(supabase, { companyId, industriaSlug: 'paneles_solares', clave: 'ratio_dc_ac_objetivo' }),
    resolverParametro(supabase, { companyId, industriaSlug: 'paneles_solares', clave: 'factor_separacion_filas' }),
  ]);
  return { performance_ratio, factor_emision_co2, ratio_dc_ac_objetivo, factor_separacion_filas };
}

/** Productos activos de un tipo, con ficha técnica — candidatos para el motor. */
async function listarProductosPorTipo(supabase, companyId, tipo) {
  const { data, error } = await supabase.from('productos').select('*').eq('company_id', companyId).eq('tipo', tipo).eq('activo', true);
  return error ? [] : (data || []);
}

/**
 * Corre el motor de ingeniería de la industria de la empresa con datos
 * reales (HSP/parámetros/catálogo resueltos de la DB) y guarda el
 * resultado como una fila NUEVA en calculos_ingenieria — version = la
 * última versión de esa cotización + 1. Nunca hace UPDATE de una corrida
 * anterior (Alina, punto 12: inmutable y versionado).
 */
async function correrYGuardarCalculo(supabase, { companyId, cotizacionId, industriaSlug, infoTecnica, panelSeleccionadoId, temperaturaMinSitio, inversionNeta, calculadoPor }) {
  const motor = obtenerMotor(industriaSlug);
  if (!motor) throw new Error(`No hay motor de ingeniería registrado para la industria "${industriaSlug}".`);

  const hsp = await resolverHSP(supabase, { nombreUbicacion: infoTecnica.ubicacion, irradiacionId: infoTecnica.irradiacionId });
  const parametros = await resolverParametrosPanelesSolares(supabase, companyId);

  const [panelSeleccionadoRaw, catalogoInversores] = await Promise.all([
    panelSeleccionadoId ? supabase.from('productos').select('*').eq('id', panelSeleccionadoId).maybeSingle() : Promise.resolve({ data: null }),
    listarProductosPorTipo(supabase, companyId, 'inversor'),
  ]);
  const panelSeleccionado = panelSeleccionadoRaw.data || null;

  const resultado = motor.calcularPredimensionamiento({
    infoTecnica, hsp, parametros, panelSeleccionado, catalogoInversores, temperaturaMinSitio, inversionNeta,
  });

  const { data: ultimaVersion } = await supabase
    .from('calculos_ingenieria').select('version').eq('cotizacion_id', cotizacionId)
    .order('version', { ascending: false }).limit(1).maybeSingle();

  const nuevaVersion = (ultimaVersion?.version || 0) + 1;

  const { data, error } = await supabase
    .from('calculos_ingenieria')
    .insert([{
      company_id: companyId,
      cotizacion_id: cotizacionId,
      version: nuevaVersion,
      motor: resultado.motor,
      motor_version: resultado.motor_version,
      datos_entrada: infoTecnica,
      parametros_usados: parametros,
      catalogo_usado: { panel: panelSeleccionado, inversores_candidatos: catalogoInversores },
      resultados: resultado.resultados,
      alertas: resultado.alertas,
      estado_calculo: resultado.estado_calculo,
      calculado_por: calculadoPor || null,
    }])
    .select()
    .single();

  if (error) throw new Error(`cotizaciones.correrYGuardarCalculo: ${error.message}`);

  await supabase.from('cotizaciones').update({ calculo_ingenieria_id: data.id }).eq('id', cotizacionId);

  return data;
}

/**
 * Marca ingenieria_validada_para_cotizar — RECHAZA si el cálculo vigente
 * tiene alguna alerta de severidad 'bloqueo' (Alina, punto 9: nunca se
 * puede validar una ingeniería con un bloqueo activo). Es un estado
 * DISTINTO de predimensionamiento_revisado_por (punto 13) — revisar el
 * cálculo automático no es lo mismo que validarlo para cotizar.
 */
async function marcarIngenieriaValidada(supabase, { cotizacionId, usuarioId }) {
  const { data: cotizacion } = await supabase.from('cotizaciones').select('calculo_ingenieria_id').eq('id', cotizacionId).maybeSingle();
  if (!cotizacion?.calculo_ingenieria_id) {
    const err = new Error('Esta cotización todavía no tiene ningún cálculo de ingeniería corrido.');
    err.status = 409;
    throw err;
  }

  const { data: calculo } = await supabase.from('calculos_ingenieria').select('alertas, estado_calculo').eq('id', cotizacion.calculo_ingenieria_id).maybeSingle();
  const alertasDeBloqueo = (calculo?.alertas || []).filter(a => a.severidad === 'bloqueo');

  if (alertasDeBloqueo.length > 0) {
    const err = new Error(`No se puede validar la ingeniería: hay ${alertasDeBloqueo.length} alerta(s) de bloqueo activa(s) — ${alertasDeBloqueo.map(a => a.mensaje).join('; ')}`);
    err.status = 409;
    throw err;
  }

  const { data, error } = await supabase
    .from('cotizaciones')
    .update({ ingenieria_validada_para_cotizar_por: usuarioId, ingenieria_validada_para_cotizar_en: new Date().toISOString() })
    .eq('id', cotizacionId)
    .select()
    .single();

  if (error) throw new Error(`cotizaciones.marcarIngenieriaValidada: ${error.message}`);
  return data;
}

/** Revisar el predimensionamiento (punto 13) — distinto de validar la ingeniería para cotizar. */
async function marcarPredimensionamientoRevisado(supabase, { cotizacionId, usuarioId }) {
  const { data, error } = await supabase
    .from('cotizaciones')
    .update({ predimensionamiento_revisado_por: usuarioId, predimensionamiento_revisado_en: new Date().toISOString() })
    .eq('id', cotizacionId)
    .select()
    .single();

  if (error) throw new Error(`cotizaciones.marcarPredimensionamientoRevisado: ${error.message}`);
  return data;
}

module.exports = {
  resolverHSP, resolverParametro, resolverParametrosPanelesSolares, listarProductosPorTipo,
  correrYGuardarCalculo, marcarIngenieriaValidada, marcarPredimensionamientoRevisado,
};
