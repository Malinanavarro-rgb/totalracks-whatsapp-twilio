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
const { esGerencial } = require('./permisos');
const { reatarAdjuntosACotizacion } = require('./cotizacion-adjuntos');
const { seleccionarPaqueteRecomendado } = require('./paquetes-solares');
const { aplicarCalculoALineas } = require('./cotizacion-lineas');
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
 * El nodo de workflow pregunta "¿qué % te gustaría cubrir? Si no estás
 * seguro, puedo proponerte 90%." — la respuesta natural es un entero tipo
 * "90", no un decimal "0.9". calcularPotenciaRequerida exige explícitamente
 * un decimal entre 0 y 1 (Fase 1: nunca adivina si venía en 0-100) — esta
 * conversión vive aquí, en el borde conversacional, no en el motor. Si el
 * cliente ya contestó con un decimal (ej. "0.9"), se respeta tal cual.
 *
 * Bug real de piloto (Alina, 2026-08-10): un cliente que responde "sí" o
 * "me gustaría" a esa pregunta (aceptando el 90% que el propio bot ofreció
 * como default) quedaba sin número — nunca 90%, nunca ningún valor — y
 * bloqueaba el cálculo (potencia_requerida_error). El bot ya ofreció 90%
 * explícitamente en la pregunta; una afirmación sin número es aceptar esa
 * oferta, confirmado explícitamente por Alina — no una adivinanza nueva.
 * Solo dispara con un "sí" claro al inicio de la respuesta — cualquier otra
 * cosa (un número, un "no", texto ambiguo) sigue devolviendo null como antes.
 */
// Sin \b después de vocales acentuadas — en JS, \w es solo [A-Za-z0-9_], así
// que "í"/"á" no cuentan como word-char y \b nunca matchea justo después de
// ellas (bug real detectado al probar: "sí" no matcheaba). Se usa un
// lookahead negativo explícito en su lugar.
const _REGEX_AFIRMACION_COBERTURA = /^\s*(s[ií]|me gustar[ií]a|est[aá] bien|de acuerdo|claro|perfecto|va|dale)(?![a-zA-ZáéíóúñÁÉÍÓÚÑ])/i;
const PCT_COBERTURA_DEFAULT_AFIRMACION = 0.9;

function _normalizarPctCobertura(valor) {
  const n = _numeroOrNull(valor);
  if (n != null) return n > 1 ? n / 100 : n;
  return _REGEX_AFIRMACION_COBERTURA.test(String(valor || '')) ? PCT_COBERTURA_DEFAULT_AFIRMACION : null;
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
// Bug real de piloto (Alina, 2026-08-10): "no lo sé" al voltaje bloqueaba el
// cálculo (red_desconocida) aunque el propio bot ya había sugerido "220V es
// lo más común en casas" en la misma pregunta. Confirmado explícitamente por
// Alina: si ya se sabe que es monofásica (casa) y el cliente no sabe su
// voltaje, se usa 220V — el mismo default que el bot ya le ofreció, nunca un
// número que el bot no haya mencionado. Trifásica/bifásica sin voltaje
// explícito se queda en null — ahí sí varía demasiado para asumir un default.
const VOLTAJE_DEFAULT_MONOFASICA = 220;

/**
 * Bug real de piloto (Alina, 2026-08-10): el cliente escribe "estoy en
 * monterrey" y resolverHSP() busca coincidencia EXACTA contra
 * irradiacion_regional.nombre_ubicacion ("Monterrey, Nuevo León") — la
 * frase completa nunca matchea, así que el cálculo se bloqueaba
 * (hsp_faltante) aunque la ciudad sí existiera en el catálogo.
 *
 * Compara contra el catálogo REAL (nunca una lista de ciudades hardcodeada
 * que se desincroniza) — si el nombre de la ciudad (la palabra antes de la
 * coma en nombre_ubicacion) aparece en el texto libre, usa el nombre exacto
 * del catálogo. Sin match, devuelve el texto tal cual — resolverHSP() ya
 * maneja "ubicación no encontrada" sin inventar un HSP.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|null} textoLibre
 * @returns {Promise<string|null>}
 */
async function _normalizarUbicacion(supabase, textoLibre) {
  if (!textoLibre) return textoLibre;

  const { data: ubicaciones } = await supabase.from('irradiacion_regional').select('nombre_ubicacion');
  const texto = textoLibre.toLowerCase();

  const match = (ubicaciones || []).find(u =>
    texto.includes(u.nombre_ubicacion.split(',')[0].trim().toLowerCase())
  );

  return match ? match.nombre_ubicacion : textoLibre;
}

/**
 * `historial_consumo_kwh` (Alina, 2026-08-10 — extracción de recibo CFE,
 * ver modules/recibo-cfe.js) — array ya expandido a 12 valores mensuales.
 * calcularConsumoAnual() (motor) exige exactamente >=12 para usar el método
 * más preciso (historial_12_meses); con menos, se ignora — el motor cae
 * solo a la estimación simple (mensual × 12), nunca se le manda un
 * historial parcial que interprete como completo.
 */
function _historialConsumoOrNull(valor) {
  if (!Array.isArray(valor) || valor.length < 12) return null;
  const limpio = valor.filter(v => typeof v === 'number' && Number.isFinite(v));
  return limpio.length >= 12 ? limpio.map(kwh => ({ kwh })) : null;
}

function mapearCapturedFieldsAInfoTecnica(capturedFields = {}) {
  const tipoAlimentacion = _normalizarTipoAlimentacion(capturedFields.tipo_alimentacion);
  const voltajeCapturado = _numeroOrNull(capturedFields.voltaje_sitio);

  const infoTecnica = {
    ubicacion: capturedFields.ubicacion || null,
    consumoMensualKwh: _numeroOrNull(capturedFields.consumo_mensual_kwh),
    historialConsumo: _historialConsumoOrNull(capturedFields.historial_consumo_kwh),
    importePromedioRecibo: _numeroOrNull(capturedFields.importe_promedio_recibo),
    pctCoberturaDeseado: _normalizarPctCobertura(capturedFields.pct_cobertura_deseado),
    tipoAlimentacion,
    voltajeSitio: voltajeCapturado ?? (tipoAlimentacion === 'monofasica' ? VOLTAJE_DEFAULT_MONOFASICA : null),
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
 * Folio consecutivo por empresa — SIEMPRE vía la función atómica de
 * Postgres `incrementar_folio_cotizacion` (migración 097), nunca
 * MAX(folio)+1 (condición de carrera real bajo concurrencia, ver comentario
 * de la migración 088 que ya advertía esto pero nunca se implementó).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @returns {Promise<string>} ej. "COT-2026-0001"
 */
async function generarFolio(supabase, companyId) {
  const { data: consecutivo, error } = await supabase.rpc('incrementar_folio_cotizacion', { p_company_id: companyId });
  if (error) throw new Error(`cotizaciones.generarFolio: ${error.message}`);
  const anio = new Date().getFullYear();
  return `COT-${anio}-${String(consecutivo).padStart(4, '0')}`;
}

/**
 * Oportunidad abierta más reciente del cliente (mismo criterio que
 * modules/crm.js::crearOportunidadSiCorresponde: cualquier estado que no
 * sea 'Perdido') — null si no hay ninguna, nunca se inventa una.
 */
async function _resolverOportunidadAbierta(supabase, companyId, clienteId) {
  const { data } = await supabase
    .from('oportunidades')
    .select('id')
    .eq('company_id', companyId)
    .eq('cliente_id', clienteId)
    .neq('estado', 'Perdido')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

/**
 * Hilo (Inbox Inteligente) más reciente del cliente, por actividad real
 * (`ultimo_mensaje_at`) — es la "conversación relacionada" de la cotización.
 * null si el cliente no tiene ningún hilo (ej. datos de prueba creados por
 * script, nunca por una conversación real).
 */
async function _resolverHiloReciente(supabase, companyId, clienteId) {
  const { data } = await supabase
    .from('hilos')
    .select('id')
    .eq('company_id', companyId)
    .eq('cliente_id', clienteId)
    .order('ultimo_mensaje_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

/**
 * Crea una cotización en borrador SIN correr el motor todavía (Alina,
 * 2026-09-15 — "necesito que haya una opción manual"): un asesor arma la
 * cotización con clics en vez de esperar a que un cliente termine el
 * workflow de WhatsApp. Reusa el mismo insert que ya usaba
 * correrCotizacionDesdeWorkflow (folio/oportunidad/hilo resueltos igual),
 * separado a propósito en su propia función para que el formulario manual
 * pueda crear la cotización primero y capturar los datos técnicos después,
 * en vez de recibirlos todos de golpe como en el workflow de chat.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{companyId: string, clienteId: number, ejecutivoId: string, descripcion?: string}} datos
 * @returns {Promise<Object>} la cotización creada
 */
async function crearCotizacionBorrador(supabase, { companyId, clienteId, ejecutivoId, descripcion }) {
  if (!companyId || !clienteId) {
    throw new Error('cotizaciones.crearCotizacionBorrador: companyId y clienteId son requeridos');
  }

  const [folio, oportunidadId, hiloId] = await Promise.all([
    generarFolio(supabase, companyId),
    _resolverOportunidadAbierta(supabase, companyId, clienteId),
    _resolverHiloReciente(supabase, companyId, clienteId),
  ]);

  const { data: cotizacion, error } = await supabase
    .from('cotizaciones')
    .insert([{
      company_id: companyId, cliente_id: clienteId, ejecutivo_id: ejecutivoId || null,
      estado: 'borrador', folio, oportunidad_id: oportunidadId, hilo_id: hiloId,
      descripcion: descripcion || 'Cotización creada manualmente por el asesor.',
    }])
    .select()
    .single();
  if (error) throw new Error(`cotizaciones.crearCotizacionBorrador: ${error.message}`);
  return cotizacion;
}

/**
 * Corre el motor de ingeniería sobre una cotización YA creada y, si el
 * número técnico de paneles resultante cae dentro de algún paquete del
 * catálogo, lo asocia como recomendado — misma lógica que ya usaba
 * correrCotizacionDesdeWorkflow (líneas 605-621), extraída aquí para que el
 * formulario manual y el workflow de WhatsApp compartan una sola fuente de
 * verdad sin que el manual dependa de `destinatario`/WhatsApp para nada.
 * A propósito NO auto-valida ni genera PDF — a diferencia del cierre
 * automático del workflow, aquí SIEMPRE decide un humano (marcarIngenieria
 * Validada / generarPdfCotizacion se llaman aparte, con usuarioId real).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {string} datos.companyId
 * @param {number} datos.cotizacionId
 * @param {Object} datos.infoTecnica - mismo shape que mapearCapturedFieldsAInfoTecnica() produce
 * @param {string} [datos.panelSeleccionadoId] - si se omite, el motor no puede dimensionar (quedará incompleto)
 * @param {number} [datos.temperaturaMinSitio] - default 5°C (mismo criterio conservador que el workflow)
 * @param {number} [datos.inversionNeta] - normalmente null hasta que haya un precio de paquete/líneas
 * @param {string} [datos.calculadoPor]
 * @returns {Promise<{calculo: Object, paquete: Object|null}>}
 */
async function correrCalculoCotizacionManual(supabase, { companyId, cotizacionId, infoTecnica, panelSeleccionadoId, temperaturaMinSitio, inversionNeta, calculadoPor }) {
  const calculo = await correrYGuardarCalculo(supabase, {
    companyId, cotizacionId, industriaSlug: 'paneles_solares', infoTecnica,
    panelSeleccionadoId: panelSeleccionadoId || null,
    temperaturaMinSitio: temperaturaMinSitio ?? 5,
    inversionNeta: inversionNeta ?? null,
    calculadoPor: calculadoPor || null,
  });

  const numeroPanelesTecnico = calculo.resultados?.numero_paneles?.valor;
  let paquete = null;
  if (numeroPanelesTecnico) {
    paquete = await seleccionarPaqueteRecomendado(supabase, { companyId, numeroPanelesTecnico });
    if (paquete) {
      await supabase.from('cotizaciones').update({
        paquete_recomendado_id: paquete.id,
        precio_paquete_recomendado: paquete.precio_contado,
      }).eq('id', cotizacionId);
    }
  }

  return { calculo, paquete };
}

/**
 * Listado de cotizaciones del panel de usuario — Fase Panel de Cotizaciones
 * (Alina, 2026-08-10). "Producto" es el nombre del paquete recomendado si
 * existe; si no, la descripción de la primera línea (mismo criterio que ya
 * usa el PDF para el nombre del paquete — nunca un campo nuevo redundante).
 *
 * Reemplaza la query inline que vivía en server.js (GET /api/cotizaciones,
 * "bandeja de revisión" — Alina 2026-08-04): mismo alcance por rol
 * (gerencial ve todas, un asesor solo las suyas o sin ejecutivo asignado),
 * movido al módulo porque es lógica de negocio, no de ruteo — "rutas
 * delgadas" (server.js) — y porque el panel de usuario necesita la misma
 * regla de alcance que la bandeja de revisión, no una paralela.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {{id: string, rol: string}} [usuario] - si se omite, no aplica alcance por rol (ej. llamadas internas/tests)
 * @param {{clienteId?: number|string}} [filtros] - Expediente Solar 360° (2026-09-17): filtra por cliente, para el tab "Cotizaciones" del expediente
 * @returns {Promise<Array>}
 */
async function listarCotizaciones(supabase, companyId, usuario, filtros = {}) {
  let query = supabase
    .from('cotizaciones')
    .select('id, folio, estado, total, created_at, pdf_url, cliente_id, hilo_id, oportunidad_id, ejecutivo_id, paquete_recomendado_id, clientes(nombre, telefono), paquetes_solares:paquete_recomendado_id(nombre)')
    .eq('company_id', companyId);

  if (filtros.clienteId) {
    query = query.eq('cliente_id', filtros.clienteId);
  }

  if (usuario && !esGerencial(usuario.rol)) {
    query = query.or(`ejecutivo_id.eq.${usuario.id},ejecutivo_id.is.null`);
  }

  const { data: cotizaciones, error } = await query.order('created_at', { ascending: false });

  if (error || !cotizaciones) return [];

  const sinPaquete = cotizaciones.filter(c => !c.paquete_recomendado_id).map(c => c.id);
  let primeraLineaPorCotizacion = {};
  if (sinPaquete.length > 0) {
    const { data: lineas } = await supabase
      .from('cotizacion_lineas')
      .select('cotizacion_id, descripcion, concepto_libre, orden')
      .in('cotizacion_id', sinPaquete)
      .order('orden', { ascending: true });
    for (const l of lineas || []) {
      if (!primeraLineaPorCotizacion[l.cotizacion_id]) {
        primeraLineaPorCotizacion[l.cotizacion_id] = l.concepto_libre || l.descripcion;
      }
    }
  }

  return cotizaciones.map(c => ({
    ...c,
    producto: c.paquetes_solares?.nombre || primeraLineaPorCotizacion[c.id] || null,
  }));
}

/**
 * Detalle completo de una cotización, ya con líneas e historial de envíos —
 * todo lo que necesita la vista de detalle del panel (punto 4). Verifica
 * company_id explícitamente (nunca confía solo en el id) — mismo criterio
 * de aislamiento que el resto del sistema.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {number} cotizacionId
 * @returns {Promise<Object|null>} null si no existe o es de otra empresa
 */
async function obtenerCotizacion(supabase, companyId, cotizacionId) {
  const { data: cotizacion, error } = await supabase
    .from('cotizaciones')
    .select('*, clientes(nombre, telefono), paquetes_solares:paquete_recomendado_id(nombre, precio_contado)')
    .eq('company_id', companyId)
    .eq('id', cotizacionId)
    .maybeSingle();

  if (error || !cotizacion) return null;

  const [{ data: lineas }, { data: envios }, { data: calculo }] = await Promise.all([
    supabase.from('cotizacion_lineas').select('*').eq('cotizacion_id', cotizacionId).order('orden', { ascending: true }),
    supabase.from('envios_documento').select('id, proveedor, estado, message_id, enviado_en, actualizado_en, error_proveedor')
      .eq('cotizacion_id', cotizacionId).order('enviado_en', { ascending: false }),
    supabase.from('calculos_ingenieria').select('*').eq('cotizacion_id', cotizacionId).order('version', { ascending: false }).limit(1).maybeSingle(),
  ]);

  return { ...cotizacion, lineas: lineas || [], envios: envios || [], calculo: calculo || null };
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

  const [{ data: sesion }, folio, oportunidadId, hiloId] = await Promise.all([
    supabase
      .from('workflow_sessions')
      .select('id')
      .eq('company_id', companyId)
      .eq('cliente_id', clienteId)
      .eq('status', 'completado')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    generarFolio(supabase, companyId),
    _resolverOportunidadAbierta(supabase, companyId, clienteId),
    _resolverHiloReciente(supabase, companyId, clienteId),
  ]);

  const { data: cotizacion, error: errCotizacion } = await supabase
    .from('cotizaciones')
    .insert([{
      company_id: companyId, cliente_id: clienteId, estado: 'borrador',
      folio, oportunidad_id: oportunidadId, hilo_id: hiloId,
      descripcion: 'Cotización generada desde conversación de WhatsApp — predimensionamiento de sistema solar.',
    }])
    .select()
    .single();
  if (errCotizacion) throw new Error(`cotizaciones.correrCotizacionDesdeWorkflow: ${errCotizacion.message}`);

  if (sesion?.id) {
    await reatarAdjuntosACotizacion(supabase, { workflowSessionId: sesion.id, cotizacionId: cotizacion.id });
  }

  const { infoTecnica, temperaturaMinSitio } = mapearCapturedFieldsAInfoTecnica(capturedFields);
  infoTecnica.ubicacion = await _normalizarUbicacion(supabase, infoTecnica.ubicacion);

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

  // Paquete comercial recomendado (Alina, 2026-08-04): capa separada del
  // resultado técnico — calculos_ingenieria.resultados nunca se toca aquí.
  // Si ningún paquete del catálogo alcanza la cantidad técnica, se deja
  // sin recomendación (nunca se "redondea hacia abajo" ni se inventa un
  // precio) — el asesor arma un paquete a la medida en la bandeja.
  const numeroPanelesTecnico = calculo.resultados?.numero_paneles?.valor;
  let paquete = null;
  if (numeroPanelesTecnico) {
    paquete = await seleccionarPaqueteRecomendado(supabase, { companyId, numeroPanelesTecnico });
    if (paquete) {
      await supabase.from('cotizaciones').update({
        paquete_recomendado_id: paquete.id,
        precio_paquete_recomendado: paquete.precio_contado,
      }).eq('id', cotizacion.id);
    }
  }

  // Cierre automático (Alina, 2026-08-10, punto 6-7 de la especificación de
  // recibo CFE: "debe pasar automáticamente al cálculo... y continuar con
  // el flujo que ya construimos para enviar el PDF"). Solo cuando el
  // cálculo salió LIMPIO (sin alertas de bloqueo) y hay un paquete
  // estándar del catálogo que alcanza — nunca para un cálculo bloqueado o
  // incompleto, ni para el caso de "necesita paquete a la medida" (ningún
  // paquete alcanza), que siguen requiriendo revisión humana en la bandeja.
  // Reutiliza tal cual marcarIngenieriaValidada() (ya rechaza si hay
  // bloqueos — aquí es redundante pero es la misma función que usa el
  // panel, una sola fuente de verdad), aplicarCalculoALineas() (Fase 3) y
  // generarYEnviarCotizacion() (Fase 3 PDF) — cero lógica nueva de negocio,
  // solo se encadenan en automático cuando aplica.
  let pdfEnviado = false;
  if (calculo.estado_calculo === 'completo' && paquete && destinatario) {
    try {
      pdfEnviado = await _cerrarYEnviarCotizacionAutomaticamente(supabase, { cotizacion, companyId, destinatario, enviar });
    } catch (e) {
      console.error('cotizaciones.correrCotizacionDesdeWorkflow: error en cierre automático de cotización:', e.message);
    }
  }

  if (destinatario && !pdfEnviado) {
    try {
      await enviar(supabase, companyId, destinatario, _textoSeguimientoIngenieria(calculo.estado_calculo));
    } catch (e) {
      console.error('cotizaciones.correrCotizacionDesdeWorkflow: error en seguimiento proactivo:', e.message);
    }
  }

  return calculo;
}

/**
 * Valida la ingeniería, convierte el paquete recomendado en línea(s) real(es)
 * con precio, y genera + envía el PDF — en ese orden, sin saltarse ninguno.
 * `usuarioId: null` en marcarIngenieriaValidada dice la verdad: nadie
 * humano lo validó, lo validó el sistema porque el cálculo no tuvo ninguna
 * alerta de bloqueo (la misma condición que un asesor verificaría a mano).
 *
 * @returns {Promise<boolean>} true si el PDF se envió con éxito
 */
async function _cerrarYEnviarCotizacionAutomaticamente(supabase, { cotizacion, companyId, destinatario, enviar }) {
  // Requiere lazy require — cotizacion-pdf.js ya importa cosas de este
  // archivo (puedeEnviarCotizacion); un require a nivel de módulo aquí
  // crearía un ciclo. Mismo patrón ya usado en la zona de wiring del
  // ActionRunner (modules/orchestrator.js).
  const { generarYEnviarCotizacion } = require('./cotizacion-pdf');

  await marcarIngenieriaValidada(supabase, { cotizacionId: cotizacion.id, usuarioId: null });
  await aplicarCalculoALineas(supabase, { companyId, cotizacionId: cotizacion.id });

  try {
    await enviar(supabase, companyId, destinatario, 'Con base en los datos de tu recibo, ya armé tu cotización preliminar — te la comparto en el PDF adjunto. Un asesor puede contactarte para afinar cualquier detalle.');
  } catch (e) {
    console.error('cotizaciones._cerrarYEnviarCotizacionAutomaticamente: error en mensaje previo al PDF (se intenta enviar el PDF de todas formas):', e.message);
  }

  const resultadoEnvio = await generarYEnviarCotizacion(supabase, { cotizacionId: cotizacion.id, destinatario });
  return resultadoEnvio?.estado === 'enviado';
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

/**
 * Decisión HUMANA del asesor sobre el precio final (Alina, 2026-08-04,
 * punto 5 del flujo: "el asesor revisa y puede ajustar el precio antes de
 * aprobar la cotización") — separada a propósito del paquete recomendado
 * automático. Si no se manda `precioFinal`, se acepta el precio del
 * paquete recomendado TAL CUAL (aprobar sin ajustar sigue siendo una
 * decisión explícita, con usuario y fecha, nunca implícita).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} datos
 * @param {number} datos.cotizacionId
 * @param {string} datos.usuarioId
 * @param {number} [datos.precioFinal] - si se omite, usa precio_paquete_recomendado
 * @returns {Promise<Object>} la cotización actualizada
 */
async function autorizarPrecioFinal(supabase, { cotizacionId, usuarioId, precioFinal }) {
  const { data: cotizacion, error: errCot } = await supabase
    .from('cotizaciones').select('precio_paquete_recomendado').eq('id', cotizacionId).maybeSingle();
  if (errCot || !cotizacion) {
    const err = new Error('Cotización no encontrada');
    err.status = 404;
    throw err;
  }

  const precio = precioFinal ?? cotizacion.precio_paquete_recomendado;
  if (precio == null) {
    const err = new Error('No hay precio de paquete recomendado ni precioFinal explícito — no se puede autorizar sin un monto.');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('cotizaciones')
    .update({ precio_final_autorizado: precio, precio_final_autorizado_por: usuarioId, precio_final_autorizado_en: new Date().toISOString() })
    .eq('id', cotizacionId)
    .select()
    .single();

  if (error) throw new Error(`cotizaciones.autorizarPrecioFinal: ${error.message}`);
  return data;
}

module.exports = {
  resolverHSP, resolverParametro, resolverParametrosPanelesSolares, listarProductosPorTipo,
  autorizarPrecioFinal,
  correrYGuardarCalculo, marcarIngenieriaValidada, marcarPredimensionamientoRevisado,
  mapearCapturedFieldsAInfoTecnica, correrCotizacionDesdeWorkflow, enviarProactivoWhatsApp,
  puedeEnviarCotizacion,
  generarFolio, listarCotizaciones, obtenerCotizacion,
  crearCotizacionBorrador, correrCalculoCotizacionManual,
};
