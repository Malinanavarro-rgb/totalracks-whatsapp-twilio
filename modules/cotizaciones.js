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
const { reatarAdjuntosACotizacion } = require('./cotizacion-adjuntos');
const { ChannelRouter } = require('./channel-router');
const { obtenerAdapterMetaParaEmpresa } = require('./meta-auth');
const { TwilioWhatsAppAdapter } = require('../adapters/channels/twilio-whatsapp');
const { supabaseServicio, twilioClient } = require('./clients');

// Mismas instancias ligeras que arma server.js (ver server.js:104, :853-856)
// — se reconstruyen aquí porque este módulo, igual que la zona de wiring de
// crearOrchestrator(), no depende de server.js ni de ninguna request HTTP.
const _channelRouter = new ChannelRouter(supabaseServicio);
const _twilioAdapter = new TwilioWhatsAppAdapter(twilioClient);

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

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Ingeniería y Cotización por WhatsApp (Alina, 2026-08-04)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Convierte texto capturado en conversación a número, o null si no se puede
 * — nunca NaN. Un NaN se propagaría silenciosamente por las fórmulas del
 * motor; null hace que generarAlertas() lo trate explícitamente como "dato
 * faltante" (mismo criterio que Fase 1: nunca adivinar).
 */
function _numeroOrNull(valor) {
  if (valor == null || valor === '') return null;
  const n = parseFloat(String(valor).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * El nodo de workflow pregunta "¿qué % te gustaría cubrir?" — la respuesta
 * natural es un entero tipo "90", no un decimal "0.9". calcularPotenciaRequerida
 * exige explícitamente un decimal entre 0 y 1 (Fase 1: nunca adivina si
 * venía en 0-100) — esta conversión vive aquí, en el borde conversacional,
 * no en el motor. Si el cliente ya contestó con un decimal (ej. "0.9"), se
 * respeta tal cual.
 */
function _normalizarPctCobertura(valor) {
  const n = _numeroOrNull(valor);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
}

/**
 * Normaliza la respuesta libre de "¿monofásica, bifásica o trifásica?" —
 * por palabra clave, nunca inventa un valor si el cliente no lo dijo con
 * claridad (devuelve null, y generarAlertas() lo marca como
 * red_desconocida — ver modules/motores-ingenieria/paneles-solares.js).
 */
function _normalizarTipoAlimentacion(texto) {
  const t = (texto || '').toLowerCase();
  if (/trif[aá]s/.test(t)) return 'trifasica';
  if (/bif[aá]s/.test(t)) return 'bifasica';
  if (/monof[aá]s|casa|residenc/.test(t)) return 'monofasica';
  return null;
}

/**
 * Traduce `workflow_sessions.captured_fields` (strings crudos de la
 * conversación, claves definidas en migrations/090) a `infoTecnica`, la
 * forma que espera modules/motores-ingenieria/paneles-solares.js. Función
 * pura — testable sin DB.
 *
 * `temperaturaMinSitio` usa un valor conservador fijo (5°C, referencia de
 * invierno del norte de México) hasta que exista una fuente real de
 * temperatura mínima por región — limitación documentada, no un dato
 * inventado en silencio: `irradiacion_regional` todavía no tiene esa
 * columna. `incluyeCargosFijos` se asume false — no se le pregunta al
 * cliente (demasiado técnico para captura conversacional).
 *
 * @param {Object} capturedFields
 * @returns {{infoTecnica: Object, temperaturaMinSitio: number}}
 */
function mapearCapturedFieldsAInfoTecnica(capturedFields = {}) {
  const infoTecnica = {
    ubicacion: capturedFields.ubicacion || null,
    consumoMensualKwh: _numeroOrNull(capturedFields.consumo_mensual_kwh),
    importePromedioRecibo: _numeroOrNull(capturedFields.importe_promedio_recibo),
    pctCoberturaDeseado: _normalizarPctCobertura(capturedFields.pct_cobertura_deseado),
    tipoAlimentacion: _normalizarTipoAlimentacion(capturedFields.tipo_alimentacion),
    voltajeSitio: _numeroOrNull(capturedFields.voltaje_sitio),
    areaDisponibleM2: _numeroOrNull(capturedFields.area_disponible_m2),
    incluyeCargosFijos: false,
  };

  return { infoTecnica, temperaturaMinSitio: 5 };
}

/**
 * Texto de seguimiento que el cliente recibe DESPUÉS del cierre genérico
 * del workflow (aiOutput.respuesta_texto) — nunca reemplaza ese cierre, es
 * un segundo mensaje proactivo. Vive fuera de _finalizarWorkflow (congelado,
 * ADR-005) a propósito: la ramificación bloqueado/completo ocurre aquí, en
 * la acción, no en el Core. Nunca menciona una cotización lista para
 * enviar — eso requiere ingenieria_validada_para_cotizar (Fase 3).
 *
 * @param {'completo'|'incompleto_faltan_datos'|'bloqueado'} estadoCalculo
 * @returns {string}
 */
function _textoSeguimientoIngenieria(estadoCalculo) {
  if (estadoCalculo === 'bloqueado') {
    return 'Con los datos que me diste, tu proyecto necesita revisión de un especialista antes de poder predimensionarlo con seguridad — puede deberse al espacio disponible, al tipo de instalación eléctrica, o a otro factor técnico. Un asesor te va a contactar en breve, y si hace falta podemos agendar una visita técnica gratuita para revisar el sitio a detalle.';
  }
  return 'Perfecto, ya tengo tu predimensionamiento inicial. Uno de nuestros asesores lo va a revisar y en breve te va a compartir tu cotización formal. Este es un cálculo preliminar, sujeto a validación técnica.';
}

/**
 * Envío proactivo por WhatsApp resolviendo Twilio/Meta igual que
 * server.js:853-856 (mismo criterio: metaAdapterEmpresa si la empresa tiene
 * Meta Cloud API conectado, si no cae a Twilio vía ChannelRouter). Se
 * expone por separado (no inline en correrCotizacionDesdeWorkflow) para
 * poder inyectar un mock en tests sin credenciales reales.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {string} destinatario
 * @param {string} texto
 */
async function enviarProactivoWhatsApp(supabase, companyId, destinatario, texto) {
  const metaAdapterEmpresa = await obtenerAdapterMetaParaEmpresa(supabase, companyId);
  if (metaAdapterEmpresa) {
    return metaAdapterEmpresa.sendProactive(texto, destinatario);
  }
  const numeroOrigen = await _channelRouter.resolverEndpointDeEmpresa(companyId);
  return _twilioAdapter.sendProactive(texto, destinatario, numeroOrigen);
}

/**
 * Handler de la acción `ejecutar_motor_ingenieria` (registrada en la zona
 * de wiring de crearOrchestrator() — ver orchestrator.js, excepción
 * documentada a ADR-005). Crea la cotización en borrador, mapea los campos
 * capturados por el workflow, corre el motor con datos reales, re-ata
 * cualquier adjunto (recibo CFE) que haya llegado a mitad de la captura, y
 * envía un mensaje de seguimiento diferenciado por resultado — nunca envía
 * una cotización ni un PDF (eso requiere ingenieria_validada_para_cotizar,
 * ver puedeEnviarCotizacion, Fase 3).
 *
 * Resuelve la sesión de workflow por (companyId, clienteId, status=
 * 'completado', más reciente) en vez de recibir el sessionId directo,
 * porque _ejecutarAcciones()/_finalizarWorkflow() (Core, congelados) no lo
 * incluyen en el ctx que le pasan al ActionRunner — evita tocar esas
 * funciones solo para exponer un id.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.clienteId
 * @param {Object} datos.capturedFields
 * @param {string} [datos.destinatario]     - teléfono del cliente, para el seguimiento proactivo
 * @param {string} [datos.calculadoPor]
 * @param {Function} [datos.enviarProactivo] - inyectable para tests; default enviarProactivoWhatsApp
 * @returns {Promise<Object>} el cálculo guardado (calculos_ingenieria)
 */
async function correrCotizacionDesdeWorkflow(supabase, { companyId, clienteId, capturedFields, destinatario, calculadoPor, enviarProactivo }) {
  const enviar = enviarProactivo || enviarProactivoWhatsApp;

  const { data: sesion } = await supabase
    .from('workflow_sessions')
    .select('id')
    .eq('company_id', companyId)
    .eq('cliente_id', clienteId)
    .eq('status', 'completado')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: cotizacion, error: errCotizacion } = await supabase
    .from('cotizaciones')
    .insert([{
      company_id: companyId, cliente_id: clienteId, estado: 'borrador',
      descripcion: 'Cotización generada desde conversación de WhatsApp — predimensionamiento de sistema solar.',
    }])
    .select()
    .single();
  if (errCotizacion) throw new Error(`cotizaciones.correrCotizacionDesdeWorkflow: ${errCotizacion.message}`);

  if (sesion?.id) {
    await reatarAdjuntosACotizacion(supabase, { workflowSessionId: sesion.id, cotizacionId: cotizacion.id });
  }

  const { infoTecnica, temperaturaMinSitio } = mapearCapturedFieldsAInfoTecnica(capturedFields);

  const { data: panelPorDefecto } = await supabase
    .from('productos')
    .select('id')
    .eq('company_id', companyId)
    .eq('tipo', 'panel_solar')
    .eq('activo', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const calculo = await correrYGuardarCalculo(supabase, {
    companyId, cotizacionId: cotizacion.id, industriaSlug: 'paneles_solares',
    infoTecnica, panelSeleccionadoId: panelPorDefecto?.id || null, temperaturaMinSitio,
    inversionNeta: null, // no existe hasta que el asesor arma la lista de materiales
    calculadoPor: calculadoPor || null,
  });

  if (destinatario) {
    try {
      await enviar(supabase, companyId, destinatario, _textoSeguimientoIngenieria(calculo.estado_calculo));
    } catch (e) {
      console.error('cotizaciones.correrCotizacionDesdeWorkflow: error en seguimiento proactivo:', e.message);
    }
  }

  return calculo;
}

/**
 * Guard obligatorio antes de enviar cualquier documento de una cotización
 * (PDF, Fase 3) — nunca se envía sin `ingenieria_validada_para_cotizar`, y
 * `marcarIngenieriaValidada` (arriba) ya rechaza esa marca si hay una
 * alerta de severidad 'bloqueo' activa, así que este guard cubre ambas
 * restricciones con una sola verificación.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} cotizacionId
 * @returns {Promise<{puede: boolean, motivo: string|null}>}
 */
async function puedeEnviarCotizacion(supabase, cotizacionId) {
  const { data: cotizacion, error } = await supabase
    .from('cotizaciones')
    .select('ingenieria_validada_para_cotizar_en')
    .eq('id', cotizacionId)
    .maybeSingle();

  if (error || !cotizacion) return { puede: false, motivo: 'Cotización no encontrada.' };
  if (!cotizacion.ingenieria_validada_para_cotizar_en) {
    return { puede: false, motivo: 'La ingeniería todavía no está validada para cotizar (ingenieria_validada_para_cotizar_en vacío).' };
  }
  return { puede: true, motivo: null };
}

module.exports = {
  resolverHSP, resolverParametro, resolverParametrosPanelesSolares, listarProductosPorTipo,
  correrYGuardarCalculo, marcarIngenieriaValidada, marcarPredimensionamientoRevisado,
  mapearCapturedFieldsAInfoTecnica, correrCotizacionDesdeWorkflow, enviarProactivoWhatsApp,
  puedeEnviarCotizacion,
};
