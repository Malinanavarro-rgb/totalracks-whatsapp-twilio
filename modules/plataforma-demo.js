/**
 * TARA Matrix™ — plataforma-demo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Modo Demo en Tiempo Real (Alina, 2026-07-30): el número oficial de TARA-OS
 * sigue atendiendo todo el tráfico normal — solo durante una ventana de
 * tiempo programada, y solo para teléfonos autorizados, ese mismo número
 * responde como si fuera una empresa demo pre-armada por giro (ej. "Empresa
 * Demo Paneles Solares", migración 082).
 *
 * Demo Live View (2026-07-30, misma tarde): una sesión demo ya no es "un
 * teléfono" — es un tablero (`sesiones_demo`) con N participantes
 * (`demo_session_participants`), cada uno una conversación completamente
 * independiente. El aislamiento entre participantes NO es código nuevo: ya
 * lo garantiza el sistema multi-tenant existente (`clientes.telefono`
 * único por `company_id`) — dos participantes de la misma empresa demo son,
 * para el resto del sistema, exactamente lo mismo que dos clientes reales
 * distintos. Lo único nuevo es "quién tiene permiso de activar esta empresa
 * demo ahora mismo" (`resolverParticipacionActiva`).
 *
 * Mismo molde que modules/plataforma-impersonacion.js ("entrar como admin a
 * cualquier empresa para soporte"): una ventana de tiempo
 * (iniciado_en/expira_en/finalizado_en) resuelta por la capa de plataforma
 * ANTES de invocar al Orchestrator — cero cambios al Core congelado
 * (ADR-005). resolverParticipacionActiva() es la única función que el
 * webhook de server.js necesita llamar; todo lo demás (cliente, workflow,
 * acciones) ya funciona igual para cualquier company_id, incluida una
 * empresa demo.
 *
 * @module modules/plataforma-demo
 */

'use strict';

const crypto = require('crypto');
const { registrarEvento } = require('./plataforma-audit');

// Caché en memoria de participaciones activas por teléfono — mismo
// patrón/TTL corto que ChannelRouter (modules/channel-router.js), para no
// pegarle a la DB en cada mensaje entrante. Un participante recién
// pausado/bloqueado puede tardar hasta este TTL en dejar de aplicar —
// trade-off aceptado, documentado.
const CACHE_TTL_MS = 30 * 1000;
const _cache = new Map();

const ESTADOS_PARTICIPANTE = ['autorizado', 'activo', 'pausado', 'bloqueado', 'finalizado'];
const ESTADOS_QUE_ATIENDEN = ['autorizado', 'activo'];

/**
 * Normaliza un teléfono mexicano al formato exacto en el que llega
 * message.from de un WhatsApp real ("+521" + 10 dígitos — confirmado
 * revisando clientes ya existentes en la base, ej. "+5218125418218").
 *
 * Bug real encontrado en producción (2026-07-30): un admin activó una demo
 * escribiendo el teléfono tal cual lo dicta ("8142850036", 10 dígitos) —
 * la resolución de participación compara por igualdad exacta, así que
 * nunca hizo match contra el "+521..." real del webhook. Se normaliza
 * aquí, en los únicos puntos de entrada manual (agregar participante) —
 * nunca en la resolución, que siempre recibe message.from ya normalizado
 * por el adapter real.
 */
function normalizarTelefonoMX(telefono) {
  const soloDigitos = String(telefono || '').replace(/[^\d]/g, '');
  if (soloDigitos.length === 13 && soloDigitos.startsWith('521')) return `+${soloDigitos}`;
  if (soloDigitos.length === 12 && soloDigitos.startsWith('52')) return `+521${soloDigitos.slice(2)}`;
  if (soloDigitos.length === 10) return `+521${soloDigitos}`;
  return telefono.startsWith('+') ? telefono : `+${soloDigitos}`;
}

/** Oculta la mayoría de los dígitos de un teléfono para la vista pública. */
function _enmascararTelefono(telefono) {
  if (!telefono || telefono.length < 8) return telefono || '';
  return `${telefono.slice(0, 6)}••••${telefono.slice(-2)}`;
}

// ── SESIÓN (el tablero) ──────────────────────────────────────────────────────

async function crearSesionDemo(supabase, { adminId, companyId, duracionMinutos, maxParticipantes }) {
  if (!adminId || !companyId) {
    throw new Error('plataforma-demo.crearSesionDemo: adminId y companyId son obligatorios.');
  }

  const publicToken = crypto.randomBytes(24).toString('hex');
  const expiraEn = new Date(Date.now() + (duracionMinutos || 60) * 60 * 1000);

  const { data, error } = await supabase
    .from('sesiones_demo')
    .insert([{
      company_id: companyId, admin_id: adminId, public_token: publicToken,
      max_participantes: maxParticipantes || null, expira_en: expiraEn.toISOString(),
    }])
    .select()
    .single();

  if (error) throw new Error(`plataforma-demo.crearSesionDemo: ${error.message}`);

  const { data: company } = await supabase.from('companies').select('organization_id').eq('id', companyId).maybeSingle();
  await registrarEvento(supabase, {
    adminId, accion: 'demo_activar', companyId, organizationId: company?.organization_id,
    detalle: { expira_en: expiraEn.toISOString(), max_participantes: maxParticipantes || null },
  });

  return data;
}

async function finalizarSesionDemo(supabase, { sesionId, adminId }) {
  const { data: fila, error } = await supabase
    .from('sesiones_demo')
    .update({ finalizado_en: new Date().toISOString() })
    .eq('id', sesionId)
    .is('finalizado_en', null)
    .select()
    .maybeSingle();

  if (error || !fila) return null;

  const { data: participantes } = await supabase.from('demo_session_participants').select('phone').eq('demo_id', sesionId);
  for (const p of participantes || []) _cache.delete(p.phone);

  const resumen = await generarResumenSesion(supabase, fila);
  await supabase.from('sesiones_demo').update({ resumen }).eq('id', sesionId);

  const { data: company } = await supabase.from('companies').select('organization_id').eq('id', fila.company_id).maybeSingle();
  await registrarEvento(supabase, {
    adminId, accion: 'demo_finalizar', companyId: fila.company_id, organizationId: company?.organization_id,
    detalle: { sesion_id: sesionId },
  });

  return { ...fila, resumen };
}

async function listarSesionesActivas(supabase) {
  const { data, error } = await supabase
    .from('sesiones_demo')
    .select('*, companies(nombre), demo_session_participants(id, status)')
    .is('finalizado_en', null)
    .gt('expira_en', new Date().toISOString())
    .order('iniciado_en', { ascending: false });

  return error ? [] : (data || []);
}

/** Empresas demo pre-armadas (companies.es_demo=true) — para el selector de "Activar demo en tiempo real". */
async function listarEmpresasDemo(supabase) {
  const { data, error } = await supabase
    .from('companies')
    .select('id, nombre, industria_slug')
    .eq('es_demo', true)
    .order('nombre');

  return error ? [] : (data || []);
}

// ── PARTICIPANTES ────────────────────────────────────────────────────────────

async function agregarParticipante(supabase, { demoId, phone, displayName, scenario }) {
  if (!demoId || !phone) {
    throw new Error('plataforma-demo.agregarParticipante: demoId y phone son obligatorios.');
  }

  const phoneNormalizado = normalizarTelefonoMX(phone);

  const { data: sesion } = await supabase.from('sesiones_demo').select('id, max_participantes').eq('id', demoId).maybeSingle();
  if (!sesion) {
    const err = new Error('Sesión demo no encontrada.');
    err.status = 404;
    throw err;
  }

  if (sesion.max_participantes) {
    const { count } = await supabase
      .from('demo_session_participants')
      .select('id', { count: 'exact', head: true })
      .eq('demo_id', demoId)
      .neq('status', 'bloqueado');

    if ((count || 0) >= sesion.max_participantes) {
      const err = new Error(`Esta sesión ya alcanzó el máximo de ${sesion.max_participantes} participantes.`);
      err.status = 409;
      throw err;
    }
  }

  _cache.delete(phoneNormalizado);

  const { data, error } = await supabase
    .from('demo_session_participants')
    .insert([{ demo_id: demoId, phone: phoneNormalizado, display_name: displayName || null, scenario: scenario || null }])
    .select()
    .single();

  if (error) throw new Error(`plataforma-demo.agregarParticipante: ${error.message}`);
  return data;
}

/** Pausar / bloquear / reactivar / finalizar un participante individual — nunca afecta a los demás. */
async function actualizarParticipante(supabase, { participantId, status }) {
  if (!ESTADOS_PARTICIPANTE.includes(status)) {
    const err = new Error(`status debe ser uno de: ${ESTADOS_PARTICIPANTE.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const cambios = { status };
  if (status === 'bloqueado' || status === 'finalizado') cambios.disabled_at = new Date().toISOString();
  else cambios.disabled_at = null;

  const { data, error } = await supabase
    .from('demo_session_participants')
    .update(cambios)
    .eq('id', participantId)
    .select()
    .maybeSingle();

  if (error || !data) return null;
  _cache.delete(data.phone);
  return data;
}

/**
 * Borra todo lo que TARA haya creado para un participante (cliente,
 * conversaciones, oportunidad, cita, workflow_session, hilo/mensajes del
 * Inbox) — mismo procedimiento ya usado a mano para limpiar datos de
 * prueba, ahora reusable desde el panel. No toca el registro de
 * participante en sí (sigue autorizado, listo para un escenario nuevo).
 */
async function limpiarDatosParticipante(supabase, participantId) {
  const { data: participante } = await supabase
    .from('demo_session_participants').select('demo_id, phone').eq('id', participantId).maybeSingle();
  if (!participante) return null;

  const { data: sesion } = await supabase.from('sesiones_demo').select('company_id').eq('id', participante.demo_id).maybeSingle();
  if (!sesion) return null;

  const { data: cliente } = await supabase
    .from('clientes').select('id').eq('company_id', sesion.company_id).eq('telefono', participante.phone).maybeSingle();

  if (!cliente) return { limpiado: false, motivo: 'Este participante todavía no tiene datos — nadie ha escrito desde ese número.' };

  const { data: hilos } = await supabase.from('hilos').select('id').eq('cliente_id', cliente.id);
  for (const hilo of hilos || []) {
    await supabase.from('mensajes').delete().eq('hilo_id', hilo.id);
  }
  await supabase.from('hilos').delete().eq('cliente_id', cliente.id);
  await supabase.from('workflow_sessions').delete().eq('cliente_id', cliente.id);
  await supabase.from('oportunidades').delete().eq('cliente_id', cliente.id);
  await supabase.from('citas').delete().eq('cliente_id', cliente.id);
  await supabase.from('conversaciones').delete().eq('cliente_id', cliente.id);
  await supabase.from('clientes').delete().eq('id', cliente.id);

  await supabase.from('demo_session_participants')
    .update({ cliente_id: null, joined_at: null, last_message_at: null }).eq('id', participantId);

  return { limpiado: true };
}

/**
 * Resuelve si un teléfono tiene una participación demo vigente en este
 * momento (sesión activa + participante en estado 'autorizado'/'activo').
 * Devuelve null si no hay ninguna (caso normal — el llamador sigue el
 * flujo de TARA-OS sin cambios). Cacheado ~30s por teléfono.
 */
async function resolverParticipacionActiva(supabase, telefono) {
  if (!telefono) return null;

  const cacheado = _cache.get(telefono);
  if (cacheado && (Date.now() - cacheado.cachedAt) < CACHE_TTL_MS) {
    return cacheado.participacion;
  }

  const { data: participante } = await supabase
    .from('demo_session_participants')
    .select('id, demo_id, phone, status')
    .eq('phone', telefono)
    .in('status', ESTADOS_QUE_ATIENDEN)
    .maybeSingle();

  let participacion = null;
  if (participante) {
    const { data: sesion } = await supabase
      .from('sesiones_demo')
      .select('id, company_id')
      .eq('id', participante.demo_id)
      .is('finalizado_en', null)
      .gt('expira_en', new Date().toISOString())
      .maybeSingle();

    if (sesion) participacion = { participant_id: participante.id, demo_id: sesion.id, company_id: sesion.company_id };
  }

  _cache.set(telefono, { participacion, cachedAt: Date.now() });
  return participacion;
}

/**
 * Marca a un participante como 'activo' y registra su actividad — se llama
 * desde la capa de plataforma (server.js) justo después de que un mensaje
 * suyo se procesó, fire-and-forget (nunca bloquea ni rompe el turno).
 */
async function registrarActividadParticipante(supabase, participantId) {
  const { data: actual } = await supabase.from('demo_session_participants').select('joined_at, status').eq('id', participantId).maybeSingle();
  if (!actual) return;

  const cambios = { last_message_at: new Date().toISOString() };
  if (!actual.joined_at) cambios.joined_at = cambios.last_message_at;
  if (actual.status === 'autorizado') cambios.status = 'activo';

  await supabase.from('demo_session_participants').update(cambios).eq('id', participantId);
}

// ── ESTADO (lectura, reusado por resumen de cierre y por el tablero público) ─

async function _clientePorTelefono(supabase, companyId, telefono) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, nombre, telefono, estado, score_interes, created_at')
    .eq('company_id', companyId)
    .eq('telefono', telefono)
    .maybeSingle();
  return cliente || null;
}

/**
 * Estado de UN participante — cliente, oportunidad, cita, conversaciones,
 * datos capturados por el workflow. Siempre filtrado por (company_id,
 * telefono), nunca por company_id solo — así nunca se mezcla con otro
 * participante ni con los clientes sembrados de la misma empresa demo.
 */
async function obtenerEstadoParticipante(supabase, { companyId, telefono }) {
  const cliente = await _clientePorTelefono(supabase, companyId, telefono);

  const [oportunidades, citas, conversaciones, workflowSesion] = await Promise.all([
    cliente
      ? supabase.from('oportunidades').select('estado, descripcion, presupuesto_estimado, presupuesto_confirmado, updated_at').eq('cliente_id', cliente.id)
      : Promise.resolve({ data: [] }),
    cliente
      ? supabase.from('citas').select('inicio, fin, estado').eq('cliente_id', cliente.id)
      : Promise.resolve({ data: [] }),
    cliente
      ? supabase.from('conversaciones').select('mensaje_cliente, respuesta_tara, intenciones, sentimiento, created_at').eq('cliente_id', cliente.id).order('created_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
    cliente
      ? supabase.from('workflow_sessions').select('status, current_node, captured_fields, updated_at').eq('cliente_id', cliente.id).order('updated_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    cliente,
    oportunidades: oportunidades.data || [],
    citas: citas.data || [],
    conversaciones: (conversaciones.data || []).reverse(),
    datos_extraidos: workflowSesion.data?.captured_fields || {},
    nodo_actual: workflowSesion.data?.current_node || null,
  };
}

/**
 * Agrega, para todos los participantes de una sesión, todo lo que TARA
 * ejecutó de verdad — sin tabla de reporte nueva, se calcula una sola vez
 * al cierre (se llama desde finalizarSesionDemo).
 */
async function generarResumenSesion(supabase, sesion) {
  const desde = sesion.iniciado_en;
  const hasta = new Date().toISOString();

  const { data: participantes } = await supabase.from('demo_session_participants').select('*').eq('demo_id', sesion.id);
  const lista = participantes || [];

  const estados = await Promise.all(
    lista.map(p => obtenerEstadoParticipante(supabase, { companyId: sesion.company_id, telefono: p.phone }))
  );

  const { data: logs } = await supabase
    .from('decision_logs').select('tipo').eq('company_id', sesion.company_id).gte('created_at', desde).lte('created_at', hasta);

  const logsPorTipo = {};
  for (const registro of logs || []) {
    logsPorTipo[registro.tipo] = (logsPorTipo[registro.tipo] || 0) + 1;
  }

  return {
    duracion_ms: new Date(hasta).getTime() - new Date(desde).getTime(),
    participantes: lista.length,
    clientes_registrados: estados.filter(e => e.cliente).length,
    oportunidades: estados.flatMap(e => e.oportunidades),
    citas: estados.flatMap(e => e.citas),
    acciones_por_tipo: logsPorTipo,
    generado_en: hasta,
  };
}

// ── LÍNEA DE TIEMPO Y VISTA PÚBLICA ──────────────────────────────────────────

const ETIQUETAS_ACCION = {
  crear_oportunidad: 'Oportunidad creada',
  agendar_cita_con_horario_solicitado: 'Cita agendada',
  agendar_cita: 'Cita agendada',
  reagendar_cita: 'Cita reagendada',
  cancelar_cita: 'Cita cancelada',
  crear_ticket_soporte: 'Ticket de soporte creado',
};

/** Línea de tiempo de TODA la sesión, cada evento etiquetado con su participante — nunca mezcla contenido entre chats. */
async function obtenerLineaDeTiempoSesion(supabase, sesion, participantes) {
  const phones = (participantes || []).map(p => p.phone);
  if (phones.length === 0) return [];

  const { data: logs } = await supabase
    .from('decision_logs')
    .select('tipo, identificador, payload, created_at')
    .eq('company_id', sesion.company_id)
    .in('identificador', phones)
    .gte('created_at', sesion.iniciado_en)
    .order('created_at', { ascending: true });

  const nombrePorTelefono = {};
  for (const p of participantes) nombrePorTelefono[p.phone] = p.display_name || _enmascararTelefono(p.phone);

  return (logs || [])
    .map(log => {
      let texto = null;
      if (log.tipo === 'channel_event') {
        if (log.payload?.subtipo === 'mensaje_recibido') texto = `escribió: "${log.payload?.preview || ''}"`;
        else if (log.payload?.subtipo === 'mensaje_enviado') texto = 'TARA respondió';
      } else if (log.tipo === 'accion') {
        const etiqueta = ETIQUETAS_ACCION[log.payload?.tipo_accion] || log.payload?.tipo_accion;
        texto = log.payload?.exito ? etiqueta : `${etiqueta} (no se pudo completar)`;
      }
      if (!texto) return null;
      return { hora: log.created_at, participante: nombrePorTelefono[log.identificador] || 'Participante', texto };
    })
    .filter(Boolean);
}

/**
 * Estado público completo de una sesión demo, resuelto ÚNICAMENTE por
 * public_token (nunca por session_id/company_id explícito) — es lo que
 * consume la URL pública de Demo Live View. Response curada por allowlist
 * explícito: nunca se expone company_id/admin_id/cliente_id crudo, y los
 * teléfonos siempre van enmascarados.
 */
async function obtenerEstadoPublico(supabase, token) {
  if (!token) return null;

  const { data: sesion } = await supabase.from('sesiones_demo').select('*, companies(nombre)').eq('public_token', token).maybeSingle();
  if (!sesion) return null;

  const { data: participantesRaw } = await supabase
    .from('demo_session_participants').select('*').eq('demo_id', sesion.id).order('created_at');
  const participantes = participantesRaw || [];

  const { data: personalidad } = await supabase
    .from('personalities').select('campos_requeridos').eq('company_id', sesion.company_id).maybeSingle();
  const camposRequeridos = personalidad?.campos_requeridos || [];

  const estados = await Promise.all(participantes.map(async p => {
    const estado = await obtenerEstadoParticipante(supabase, { companyId: sesion.company_id, telefono: p.phone });
    return { participante: p, estado };
  }));

  const lineaTiempo = await obtenerLineaDeTiempoSesion(supabase, sesion, participantes);

  const latenciasAiCall = await supabase
    .from('decision_logs').select('latencia_ms').eq('company_id', sesion.company_id)
    .eq('tipo', 'ai_call').in('identificador', participantes.map(p => p.phone)).gte('created_at', sesion.iniciado_en);
  const latencias = (latenciasAiCall.data || []).map(l => l.latencia_ms).filter(n => typeof n === 'number');
  const tiempoPromedioRespuestaMs = latencias.length ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null;

  return {
    empresa_nombre: sesion.companies?.nombre || 'Empresa demo',
    estado: sesion.finalizado_en ? 'finalizada' : 'activa',
    expira_en: sesion.expira_en,
    finalizado_en: sesion.finalizado_en,
    metricas: {
      conversaciones_activas: participantes.filter(p => p.status === 'activo').length,
      clientes_registrados: estados.filter(e => e.estado.cliente).length,
      oportunidades_creadas: estados.reduce((acc, e) => acc + e.estado.oportunidades.length, 0),
      citas_agendadas: estados.reduce((acc, e) => acc + e.estado.citas.length, 0),
      tiempo_promedio_respuesta_ms: tiempoPromedioRespuestaMs,
      procesos_ejecutados: lineaTiempo.filter(e => e.texto.startsWith('escribió') === false && e.texto !== 'TARA respondió').length,
    },
    participantes: estados.map(({ participante, estado }) => ({
      id: participante.id,
      nombre: participante.display_name || estado.cliente?.nombre || 'Sin nombre',
      telefono_enmascarado: _enmascararTelefono(participante.phone),
      escenario: participante.scenario,
      estado_participante: participante.status,
      cliente: estado.cliente ? { nombre: estado.cliente.nombre, score_interes: estado.cliente.score_interes } : null,
      oportunidad: estado.oportunidades[0] || null,
      cita: estado.citas[0] || null,
      conversaciones: estado.conversaciones,
      datos_extraidos: estado.datos_extraidos,
      campos_pendientes: camposRequeridos.filter(c => !estado.datos_extraidos?.[c]),
      nodo_actual: estado.nodo_actual,
      ultima_actividad: participante.last_message_at,
    })),
    linea_tiempo: lineaTiempo,
    resumen: sesion.resumen,
  };
}

module.exports = {
  crearSesionDemo, finalizarSesionDemo, listarSesionesActivas, listarEmpresasDemo,
  agregarParticipante, actualizarParticipante, limpiarDatosParticipante,
  resolverParticipacionActiva, registrarActividadParticipante,
  obtenerEstadoParticipante, generarResumenSesion, obtenerLineaDeTiempoSesion, obtenerEstadoPublico,
  normalizarTelefonoMX,
};
