/**
 * TARA Matrix™ — server.js
 * Rutas HTTP y arranque del servidor.
 * No contiene lógica de negocio ni de CRM.
 *
 * FASE 3: routing multi-tenant dinámico por channel_endpoints.
 * COMPANY_SLUG eliminado — el servidor ya no es single-tenant.
 */

require('dotenv').config();
const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');

const { supabase, supabaseServicio, crearClienteConSesion, twilioClient } = require('./modules/clients');
const { obtenerConfigEmpresa }          = require('./modules/config');
const { crearOrchestrator }             = require('./modules/orchestrator');
const { TwilioWhatsAppAdapter }         = require('./adapters/channels/twilio-whatsapp');
const { MetaCloudWhatsAppAdapter }      = require('./adapters/channels/meta-cloud-whatsapp');
const { obtenerAdapterMetaParaEmpresa } = require('./modules/meta-auth');
const { ChannelRouter }                 = require('./modules/channel-router');
const { generarUrlAutorizacion, manejarCallback } = require('./modules/google-auth');
const { iniciarSesion, obtenerEmpresasDeUsuario, ErrorAuth } = require('./modules/auth');
const { crearRequireAuth }              = require('./modules/auth-middleware');
const { obtenerMetricas }               = require('./modules/dashboard');
const {
  listarConversaciones, obtenerHistorial, tomarConversacion,
  regresarATara, enviarMensajeHumano, registrarMensajeEntranteHumano,
}                                        = require('./modules/conversaciones');
const { obtenerOCrearCliente }           = require('./modules/crm');
const {
  listarAsesores, listarCitas, consultarDisponibilidad, obtenerOCrearClienteManual,
  crearCita, reagendarCita, cancelarCita, vincularUsuarioAAsesor,
}                                        = require('./modules/agenda');
const {
  listarClientes, obtenerFichaCliente, actualizarCliente, eliminarCliente,
  listarSeguimientos, crearSeguimiento, actualizarSeguimiento,
  listarOportunidades, crearOportunidad, actualizarOportunidad, eliminarOportunidad,
}                                        = require('./modules/crm-ui');
const {
  obtenerPersonalidad, actualizarPersonalidad,
  listarKnowledgeBase, crearKnowledgeBase, actualizarKnowledgeBase, eliminarKnowledgeBase,
  listarHorarios, crearHorario, actualizarHorario, eliminarHorario,
  listarHorarioAtencionBot, guardarHorarioAtencionBot, eliminarHorarioAtencionBot,
  listarServicios, crearServicio, actualizarServicio, eliminarServicio,
  listarPipelineEtapas, crearPipelineEtapa, actualizarPipelineEtapa, eliminarPipelineEtapa,
  listarCanales, estaDentroDeHorarioAtencion, esPrimerContacto,
}                                        = require('./modules/configuracion');
const {
  listarMiembros, listarInvitacionesPendientes, crearInvitacion,
  obtenerInvitacionPorToken, aceptarInvitacion, actualizarMiembro, actualizarNombreMiembro,
}                                        = require('./modules/invitaciones');
const {
  listarWorkflows, crearWorkflow, actualizarWorkflow, eliminarWorkflow,
  listarNodos, crearNodo, actualizarNodo, eliminarNodo,
}                                        = require('./modules/workflow-admin');
const { responderSobreCliente }         = require('./modules/asistente-consultas');
const { calcularCotizacion }             = require('./modules/cotizador');

const app           = express();
const adapter       = new TwilioWhatsAppAdapter(twilioClient);
// Instancia sin credenciales — solo para parseIncoming/validateSignature/
// verificarWebhook, que usan META_APP_SECRET/META_VERIFY_TOKEN a nivel
// plataforma (modelo Tech Provider). El envío (enviarMensaje) SIEMPRE usa la
// instancia por-empresa resuelta vía obtenerAdapterMetaParaEmpresa(), porque
// el access_token es propio de cada empresa (ver modules/meta-auth.js).
const metaAdapterCompartido = new MetaCloudWhatsAppAdapter();
const orchestrator  = crearOrchestrator();
// RLS: ChannelRouter resuelve routing/envío de WhatsApp — es infraestructura
// de sistema (webhook + envío proactivo), no una consulta específica de un
// usuario del panel. Usa supabaseServicio siempre, sin importar desde qué
// ruta se invoque.
const channelRouter = new ChannelRouter(supabaseServicio);
const requireAuth   = crearRequireAuth(crearClienteConSesion);

// Configuración de empresa y gestión de usuarios: solo Owner/Administrador
// (matriz de permisos aprobada, docs/anexos/plataforma-saas). Se usa como
// segundo middleware, después de requireAuth.
function soloGerencial(req, res, next) {
  if (!['owner', 'administrador'].includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}

app.use(express.urlencoded({ extended: false }));
// Migración Meta: se captura el body crudo en req.rawBody para TODA request
// JSON (barato, inofensivo para las demás rutas) — lo necesita
// MetaCloudWhatsAppAdapter.validateSignature() (X-Hub-Signature-256 se firma
// sobre el buffer sin parsear, no sobre el JSON ya parseado). Evita un
// segundo parser JSON a nivel de ruta, que chocaría con este (el stream del
// request ya estaría consumido).
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

// ── Cola por conversación ─────────────────────────────────────────────────────
// Serializa mensajes del mismo número para evitar race conditions cuando el
// cliente envía dos mensajes consecutivos antes de recibir respuesta al primero.
//
// MEJORA FUTURA: buffer/debounce de mensajes consecutivos
// Si el cliente envía varios mensajes rápidos (ej. "es para tubos" + "y son 30 piezas"),
// la cola actual los procesa en orden pero genera una respuesta por cada uno.
// Un buffer de ~1.5s que concatene mensajes del mismo número antes de enviarlos
// al Orchestrator reduciría el número de respuestas y daría contexto más completo al AI.
// Pendiente evaluar trade-off: +1.5s de latencia en todos los mensajes vs. mejor UX
// en conversaciones fragmentadas. Prioridad: post-piloto.

const processingQueue = new Map();

function enqueueForPhone(phone, fn) {
  const prev = processingQueue.get(phone) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(fn);
  let marker;
  marker = task.finally(() => {
    if (processingQueue.get(phone) === marker) processingQueue.delete(phone);
  });
  processingQueue.set(phone, marker);
  return task;
}

// Fase 1.3 (pivote a producto): defaults usados solo si la empresa no
// personalizó su propio mensaje en Configuración → Personalidad
// (personalities.mensaje_fuera_horario / mensaje_error_tecnico, migración
// 041) — mismo texto que antes era fijo para todas las empresas.
const MENSAJE_FUERA_HORARIO_DEFAULT = 'Gracias por tu mensaje. En este momento estamos fuera de horario de atención — te responderemos en cuanto sea posible.';
const MENSAJE_ERROR_TECNICO_DEFAULT = 'Error técnico. Intenta de nuevo.';

// ── PROCESAMIENTO COMÚN DE MENSAJES ENTRANTES (Twilio + Meta) ────────────────

// Migración Twilio→Meta Cloud API: modelo de envío unificado y asíncrono.
// Los guards de negocio (intervención humana, horario de atención) y el
// post-proceso (bienvenida/firma) son idénticos sin importar el proveedor —
// se comparten aquí para que ambos webhooks no puedan divergir entre sí.
// `enviar` es una closure que ya conoce cómo mandar el mensaje con el
// proveedor/credenciales correctos (número "from" para Twilio, o la
// instancia por-empresa ya autenticada para Meta) — este helper no sabe ni
// necesita saber cuál proveedor está detrás.
//
// @param {import('./adapters/channels/channel-adapter').Message} message - ya con company_id asignado
// @param {(destinatario: string, texto: string) => Promise<void>} enviar
async function procesarMensajeEntrante(message, enviar) {
  // FASE 5 (Fase 3 — intervención humana): si un humano ya tomó esta
  // conversación, TARA no responde. Se resuelve el cliente aquí (capa de
  // plataforma) sin tocar el Orchestrator/WorkflowEngine (ADR-005).
  const cliente = await obtenerOCrearCliente(message.from, message.company_id);
  if (cliente?.atendido_por === 'humano') {
    console.log(`📩 ${message.from} — atendido por humano, TARA no responde (cliente ${cliente.id})`);
    await registrarMensajeEntranteHumano(supabaseServicio, message.company_id, cliente.id, message.content);
    return;
  }

  const { personality } = await obtenerConfigEmpresa(message.company_id);

  // FASE 6 (Configuración — horario de atención del bot): fuera de horario,
  // TARA no invoca al motor de IA — responde un mensaje fijo (personalizable
  // por empresa, Fase 1.3 pivote a producto). Guard en la capa de
  // plataforma, igual que el de intervención humana (ADR-005).
  const dentroDeHorario = await estaDentroDeHorarioAtencion(supabaseServicio, message.company_id);
  if (!dentroDeHorario) {
    await enviar(message.from, personality?.mensaje_fuera_horario || MENSAJE_FUERA_HORARIO_DEFAULT);
    return;
  }

  // Fase Demo Comercial: fix — esto se evaluaba DESPUÉS de procesarMensaje(),
  // que ya guarda la conversación del turno actual (Paso 10 del Orchestrator).
  // Para entonces `conversaciones` ya tiene ≥1 fila para este cliente, así
  // que esPrimerContacto() siempre daba false y mensaje_bienvenida nunca se
  // anteponía, en ninguna empresa. Se evalúa antes de invocar al Orchestrator.
  const eraPrimerContacto = personality?.mensaje_bienvenida
    ? await esPrimerContacto(supabaseServicio, cliente.id)
    : false;

  const resultado = await enqueueForPhone(
    message.from,
    () => orchestrator.procesarMensaje(message)
  );

  // Fase Demo Comercial: si el cliente mencionó su nombre/empresa durante la
  // conversación (ya extraído por el Orchestrator en ai_output.datos_extraidos,
  // sin ningún cambio ahí), se registra en su ficha — capa de plataforma,
  // no toca el Orchestrator/CRM congelados (ADR-005). Nunca pisa un nombre
  // o empresa reales ya guardados.
  const datosExtraidos = resultado.ai_output?.datos_extraidos;
  if (cliente?.id && datosExtraidos && (datosExtraidos.nombre || datosExtraidos.empresa)) {
    const cambiosCliente = {};
    if (datosExtraidos.nombre && (!cliente.nombre || cliente.nombre === 'Sin nombre')) {
      cambiosCliente.nombre = datosExtraidos.nombre;
    }
    if (datosExtraidos.empresa && !cliente.empresa) {
      cambiosCliente.empresa = datosExtraidos.empresa;
    }
    if (Object.keys(cambiosCliente).length > 0) {
      try {
        await actualizarCliente(supabaseServicio, message.company_id, cliente.id, cambiosCliente);
      } catch (e) {
        console.error('Error registrando nombre/empresa del cliente:', e.message);
      }
    }
  }

  // Fase Demo Comercial: cotización automática — si el intake de la
  // industria acaba de completarse (workflow_sessions.status='completado')
  // y la oportunidad todavía no tiene un monto real, se calcula con los
  // precios del Catálogo (modules/cotizador.js) y se agrega a esta misma
  // respuesta. presupuesto_confirmado ya asignado es la señal de "ya se
  // cotizó" — evita recalcular/reenviar en turnos siguientes. También
  // avanza la etapa a "Cotización enviada" cuando existe esa etapa
  // configurada, en vez de quedarse en la etapa inicial genérica.
  let textoCotizacion = '';
  try {
    const { data: sesion } = await supabaseServicio
      .from('workflow_sessions')
      .select('status, captured_fields')
      .eq('cliente_id', cliente.id)
      .eq('company_id', message.company_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sesion?.status === 'completado') {
      const { data: oportunidad } = await supabaseServicio
        .from('oportunidades')
        .select('id, presupuesto_confirmado')
        .eq('cliente_id', cliente.id)
        .eq('company_id', message.company_id)
        .neq('estado', 'Perdido')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (oportunidad && oportunidad.presupuesto_confirmado == null) {
        const cotizacion = await calcularCotizacion(supabaseServicio, message.company_id, sesion.captured_fields);
        if (cotizacion) {
          const cambios = { presupuesto_confirmado: cotizacion.total };
          const { data: etapaCotizada } = await supabaseServicio
            .from('pipeline_etapas')
            .select('nombre')
            .eq('company_id', message.company_id)
            .ilike('nombre', '%cotización enviada%')
            .maybeSingle();
          if (etapaCotizada?.nombre) cambios.estado = etapaCotizada.nombre;

          await supabaseServicio.from('oportunidades').update(cambios).eq('id', oportunidad.id);

          textoCotizacion = `\n\n📋 Cotización: ${cotizacion.cantidad} x ${cotizacion.servicio} — $${cotizacion.precioUnitario.toLocaleString('es-MX')} c/u = $${cotizacion.total.toLocaleString('es-MX')} MXN. Un asesor confirmará el total final.`;
        }
      }
    }
  } catch (e) {
    console.error('Error calculando cotización automática:', e.message);
  }

  // FASE 6 (Configuración — mensaje de bienvenida y firma): se aplican en
  // la capa de plataforma, sobre el texto ya generado por el Orchestrator
  // — cero cambios al motor de IA/prompt.
  let textoFinal = resultado.respuesta_texto + textoCotizacion;

  if (personality?.mensaje_bienvenida && eraPrimerContacto) {
    // Fase Demo Comercial: si el cliente saluda ("Hola"), la IA suele
    // contestar también con un saludo propio — anteponer mensaje_bienvenida
    // tal cual sonaba como "dos hola seguidos". Se recorta el saludo
    // redundante de la respuesta de la IA, no el mensaje_bienvenida
    // configurado (que trae el nombre/rol del asesor, más valioso aquí).
    const SALUDO_INICIAL = /^¡?(hola|buen[oa]s?\s+(d[ií]as|tardes|noches)|qu[ée]\s+tal)[,.!¡\s]*/i;
    const sinSaludoRedundante = textoFinal.replace(SALUDO_INICIAL, '').trim();
    textoFinal = `${personality.mensaje_bienvenida}\n\n${sinSaludoRedundante || textoFinal}`;
  }
  if (personality?.firma) {
    textoFinal = `${textoFinal}\n\n${personality.firma}`;
  }

  await enviar(message.from, textoFinal);
  console.log(`✅ ${message.from} — respuesta enviada (empresa ${message.company_id})`);
}

// ── WEBHOOK TWILIO ────────────────────────────────────────────────────────────

app.post('/webhook/twilio', async (req, res) => {
  let message;
  try {
    if (!adapter.validateSignature(req)) {
      return res.status(403).type('text/plain').send('Firma inválida');
    }

    message = adapter.parseIncoming(req);

    // FASE 3 — routing dinámico: resolver empresa por número receptor
    const routeResult = await channelRouter.enrutar(message.incoming_endpoint);
    if (!routeResult) {
      console.warn('⚠️  Endpoint sin empresa registrada:', message.incoming_endpoint);
      return res.status(200).end();
    }
    message.company_id = routeResult.company_id;

    const numeroOrigen = await channelRouter.resolverEndpointDeEmpresa(message.company_id);

    await procesarMensajeEntrante(message, (destinatario, texto) => adapter.enviarMensaje(destinatario, texto, numeroOrigen));

    res.status(200).end();
  } catch (e) {
    console.error('❌ Error en webhook Twilio:', e);
    try {
      if (message?.from && message?.company_id) {
        const numeroOrigen = await channelRouter.resolverEndpointDeEmpresa(message.company_id);
        const { personality } = await obtenerConfigEmpresa(message.company_id);
        await adapter.enviarMensaje(message.from, personality?.mensaje_error_tecnico || MENSAJE_ERROR_TECNICO_DEFAULT, numeroOrigen);
      }
    } catch (e2) {
      console.error('❌ Error enviando mensaje de error:', e2);
    }
    res.status(200).end();
  }
});

// ── WEBHOOK META CLOUD API ────────────────────────────────────────────────────

// GET: handshake de verificación (una sola vez, al configurar la app en Meta).
app.get('/webhook/meta', (req, res) => {
  const challenge = metaAdapterCompartido.verificarWebhook(req);
  if (challenge !== null) {
    return res.status(200).type('text/plain').send(challenge);
  }
  res.sendStatus(403);
});

// POST: mensajes entrantes + estados de entrega. La firma se valida sobre
// req.rawBody (buffer sin parsear, capturado por el middleware global de
// express.json() más arriba) — a diferencia de Twilio, Meta firma el body
// crudo, no URL+parámetros.
app.post('/webhook/meta', async (req, res) => {
  let message;
  try {
    if (!metaAdapterCompartido.validateSignature(req)) {
      return res.status(403).type('text/plain').send('Firma inválida');
    }

    message = metaAdapterCompartido.parseIncoming(req);
    if (!message) {
      // Evento de solo-status (delivered/read/failed) — nada que procesar.
      return res.status(200).end();
    }

    const routeResult = await channelRouter.enrutar(message.incoming_endpoint);
    if (!routeResult) {
      console.warn('⚠️  Endpoint de Meta sin empresa registrada:', message.incoming_endpoint);
      return res.status(200).end();
    }
    message.company_id = routeResult.company_id;

    const metaAdapterEmpresa = await obtenerAdapterMetaParaEmpresa(supabaseServicio, message.company_id);
    if (!metaAdapterEmpresa) {
      console.error('❌ Webhook Meta: empresa sin credenciales activas —', message.company_id);
      return res.status(200).end();
    }

    await procesarMensajeEntrante(message, (destinatario, texto) => metaAdapterEmpresa.enviarMensaje(destinatario, texto));

    res.status(200).end();
  } catch (e) {
    console.error('❌ Error en webhook Meta:', e);
    try {
      if (message?.from && message?.company_id) {
        const metaAdapterEmpresa = await obtenerAdapterMetaParaEmpresa(supabaseServicio, message.company_id);
        const { personality } = await obtenerConfigEmpresa(message.company_id);
        if (metaAdapterEmpresa) await metaAdapterEmpresa.enviarMensaje(message.from, personality?.mensaje_error_tecnico || MENSAJE_ERROR_TECNICO_DEFAULT);
      }
    } catch (e2) {
      console.error('❌ Error enviando mensaje de error (Meta):', e2);
    }
    res.status(200).end();
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const { data } = await supabaseServicio
      .from('companies')
      .select('nombre')
      .eq('estado', 'activo')
      .limit(1)
      .maybeSingle();

    res.json({
      status:    'OK',
      empresa:   data?.nombre || 'multi-tenant',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: 'ERROR', error: e.message });
  }
});

// ── DIAGNÓSTICOS ──────────────────────────────────────────────────────────────

app.get('/api/diagnostics', async (req, res) => {
  const resultado = {
    timestamp: new Date().toISOString(),
    version:   '3.0.0',
    modo:      'multi-tenant',
    checks:    {},
    resumen:   { ok: 0, fallo: 0, advertencia: 0 },
  };

  function check(nombre, estado, detalle, extra = {}) {
    resultado.checks[nombre] = { estado, detalle, ...extra };
    resultado.resumen[estado === 'ok' ? 'ok' : estado === 'fallo' ? 'fallo' : 'advertencia']++;
  }

  // ── 1. Variables de entorno críticas ─────────────────────────────────────
  const envVars = {
    SUPABASE_URL:           !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY:      !!process.env.SUPABASE_ANON_KEY,
    OPENAI_API_KEY:         !!process.env.OPENAI_API_KEY,
    TWILIO_ACCOUNT_SID:     !!process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN:      !!process.env.TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_NUMBER: !!process.env.TWILIO_WHATSAPP_NUMBER,
    WEBHOOK_URL_WHATSAPP:   !!process.env.WEBHOOK_URL_WHATSAPP,
  };
  const faltantes = Object.entries(envVars).filter(([, v]) => !v).map(([k]) => k);
  const criticas  = faltantes.filter(k => !['TWILIO_WHATSAPP_NUMBER', 'WEBHOOK_URL_WHATSAPP'].includes(k));

  if (criticas.length > 0) {
    check('env_vars', 'fallo', `Faltan variables críticas: ${criticas.join(', ')}`, { faltantes });
  } else if (faltantes.length > 0) {
    check('env_vars', 'advertencia', `Opcionales no definidas: ${faltantes.join(', ')}`, { faltantes });
  } else {
    check('env_vars', 'ok', 'Todas las variables definidas');
  }

  // ── 2. Supabase — lectura ─────────────────────────────────────────────────
  try {
    const t = Date.now();
    const { error } = await supabaseServicio.from('clientes').select('id').limit(1);
    if (error) throw error;
    check('supabase_lectura', 'ok', 'Tabla clientes accesible', { latencia_ms: Date.now() - t });
  } catch (e) {
    check('supabase_lectura', 'fallo', e.message);
  }

  // ── 3. Supabase — decision_logs (INSERT real de prueba) ──────────────────
  try {
    const t      = Date.now();
    const testId = '00000000-0000-0000-0000-000000000000';
    const { error: insertError } = await supabaseServicio
      .from('decision_logs')
      .insert([{ company_id: testId, tipo: 'channel_event', canal: 'diagnostics',
                 identificador: 'test', payload: { subtipo: 'diagnostics_check' } }]);

    if (insertError) throw new Error(`INSERT falló: ${insertError.message}`);

    await supabaseServicio.from('decision_logs').delete()
      .eq('company_id', testId).eq('canal', 'diagnostics');

    check('supabase_decision_logs', 'ok', 'Tabla decision_logs operativa (INSERT confirmado)',
      { latencia_ms: Date.now() - t });
  } catch (e) {
    check('supabase_decision_logs', 'fallo', e.message);
  }

  // ── 4. channel_endpoints — routing multi-tenant ───────────────────────────
  try {
    const t = Date.now();
    const { data: endpoints, error } = await supabaseServicio
      .from('channel_endpoints')
      .select('endpoint, canal, activo, companies(nombre)')
      .eq('activo', true);

    if (error) throw error;
    if (!endpoints || endpoints.length === 0) {
      check('channel_routing', 'fallo', 'No hay endpoints activos en channel_endpoints');
    } else {
      check('channel_routing', 'ok',
        `${endpoints.length} endpoint(s) activo(s)`,
        { latencia_ms: Date.now() - t,
          endpoints: endpoints.map(e => `${e.canal}:${e.companies?.nombre || '?'}`) });
    }
  } catch (e) {
    check('channel_routing', 'fallo', e.message);
  }

  // ── 5. Config de empresa (primer endpoint activo) ─────────────────────────
  try {
    const t = Date.now();
    const { data: ep } = await supabaseServicio
      .from('channel_endpoints').select('company_id').eq('activo', true).limit(1).maybeSingle();

    if (!ep) throw new Error('No hay endpoints activos para probar config');

    const { company, personality, knowledge } = await obtenerConfigEmpresa(ep.company_id);
    check('config_empresa', 'ok',
      `${company.nombre} — ${knowledge.length} secciones de knowledge`,
      { latencia_ms: Date.now() - t, modelo_ia: personality?.modelo || 'no definido',
        knowledge_count: knowledge.length });
  } catch (e) {
    check('config_empresa', 'fallo', e.message);
  }

  // ── 6. Módulos del Core ───────────────────────────────────────────────────
  try {
    require('./modules/context-builder');
    require('./modules/prompt-builder');
    require('./modules/ai-engine');
    require('./modules/audit-logger');
    require('./modules/orchestrator');

    const proveedores = orchestrator._ai.listarProveedores()
      .map(p => ({ nombre: p.proveedor, es_fallback: p.es_fallback, modelos: p.modelos }));

    check('modulos_core', 'ok', 'Todos los módulos FASE 3 cargados', { proveedores });
  } catch (e) {
    check('modulos_core', 'fallo', e.message);
  }

  // ── 7. Pipeline ContextBuilder → PromptBuilder ───────────────────────────
  try {
    const { ContextBuilder } = require('./modules/context-builder');
    const { PromptBuilder }  = require('./modules/prompt-builder');

    const cb  = new ContextBuilder();
    const pb  = new PromptBuilder();
    const ctx = cb.construir({
      company_id: 'test-diag', canal: 'whatsapp',
      identificador_cliente: '+5210000000000',
      mensaje_actual: 'prueba de diagnóstico',
      empresa_config: {
        company_id: 'test-diag', nombre_empresa: 'Test',
        personalidad: 'Asistente de diagnóstico.', objetivo_principal: 'Validar pipeline.',
        modelo: 'gpt-4o-mini', temperatura: 0.5, max_tokens: 300,
        knowledge_base: '[TEST]\nContenido de prueba.',
        skills: [], campos_requeridos: [], reglas: [],
        ai_max_turnos_memoria: 4, kb_max_secciones: 2,
      },
      datos_cliente: null, historia_conversacion: [],
      resumen_cliente: null, workflow_state: null, capacidades: ['crear_oportunidad'],
    });

    const prompt   = pb.construir(ctx);
    const aiInput  = cb.prepararParaIA(ctx, prompt);
    const bloques  = (prompt.match(/^## /gm) || []).length;

    check('pipeline_context_prompt', 'ok', `Context + Prompt generados — ${bloques} bloques`, {
      tokens_estimados:  ctx.optimizacion?.tokens_estimados || 0,
      nivel_compresion:  ctx.optimizacion?.nivel_compresion || 'ninguna',
      bloques_en_prompt: bloques,
      aiinput_completo:  !!aiInput.mensaje_actual,
    });
  } catch (e) {
    check('pipeline_context_prompt', 'fallo', e.message);
  }

  // ── 8. AI Engine con MockProvider ────────────────────────────────────────
  try {
    const { AIEngine }        = require('./modules/ai-engine');
    const { MockProvider }    = require('./adapters/ai/mock-provider');
    const { ContextBuilder }  = require('./modules/context-builder');
    const { PromptBuilder }   = require('./modules/prompt-builder');

    const cb     = new ContextBuilder();
    const pb     = new PromptBuilder();
    const mock   = new MockProvider({ latencia_ms: 0 });
    const engine = new AIEngine(mock);

    const ctx = cb.construir({
      company_id: 'test-diag', canal: 'whatsapp',
      identificador_cliente: '+5210000000000', mensaje_actual: 'diagnóstico',
      empresa_config: {
        company_id: 'test-diag', nombre_empresa: 'Test',
        personalidad: 'Test.', objetivo_principal: 'Test.',
        modelo: 'mock', temperatura: 0.5, max_tokens: 100,
        knowledge_base: '', skills: [], campos_requeridos: [],
        reglas: [], ai_max_turnos_memoria: 2, kb_max_secciones: 1,
      },
      datos_cliente: null, historia_conversacion: [],
      resumen_cliente: null, workflow_state: null, capacidades: [],
    });

    const t       = Date.now();
    const aiInput  = cb.prepararParaIA(ctx, pb.construir(ctx));
    const aiOutput = await engine.procesar(aiInput);

    check('ai_engine_mock', 'ok', 'MockProvider responde correctamente', {
      latencia_ms:       Date.now() - t,
      modelo_utilizado:  aiOutput.modelo_utilizado,
      confianza:         aiOutput.confianza,
      respuesta_preview: aiOutput.respuesta_texto?.substring(0, 60),
    });
  } catch (e) {
    check('ai_engine_mock', 'fallo', e.message);
  }

  // ── Resumen final ─────────────────────────────────────────────────────────
  const todoOk = resultado.resumen.fallo === 0;
  resultado.estado_global = todoOk ? 'LISTO_PARA_PRODUCCION' : 'REQUIERE_ATENCION';

  res.status(todoOk ? 200 : 503).json(resultado);
});

// ── DASHBOARD (Plataforma SaaS, Fase 2 — Centro de Operaciones) ───────────────
// Requiere sesión — las métricas siempre se calculan sobre req.usuario.company_id,
// nunca sobre un company_id que mande el cliente. Lógica real en modules/dashboard.js.

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const metricas = await obtenerMetricas(req.supabase, req.usuario.company_id);
    res.json(metricas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CONVERSACIONES (Plataforma SaaS, Fase 3) ──────────────────────────────────
// Lógica real en modules/conversaciones.js. Cero cambios al Orchestrator —
// la intervención humana vive enteramente en esta capa (ver webhook arriba).

app.get('/api/conversaciones', requireAuth, async (req, res) => {
  try {
    const lista = await listarConversaciones(req.supabase, req.usuario.company_id, req.usuario);
    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/conversaciones/:clienteId', requireAuth, async (req, res) => {
  try {
    const historial = await obtenerHistorial(req.supabase, req.usuario.company_id, req.params.clienteId);
    res.json(historial);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/conversaciones/:clienteId/tomar', requireAuth, async (req, res) => {
  try {
    const cliente = await tomarConversacion(req.supabase, req.usuario.company_id, req.params.clienteId, req.usuario.id);
    res.json(cliente);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/conversaciones/:clienteId/regresar', requireAuth, async (req, res) => {
  try {
    const cliente = await regresarATara(req.supabase, req.usuario.company_id, req.params.clienteId);
    res.json(cliente);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/conversaciones/:clienteId/mensajes', requireAuth, async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto || !texto.trim()) return res.status(400).json({ error: 'texto requerido' });

    await enviarMensajeHumano(
      supabase, adapter, channelRouter, req.usuario.company_id, req.params.clienteId, req.usuario.id, texto.trim()
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── AGENDA (Plataforma SaaS, Fase 4) ──────────────────────────────────────────
// Lógica real en modules/agenda.js. Un solo camino de escritura para citas:
// reusa SchedulingEngine.agendarCita()/reagendarCita()/cancelarCita() — el
// mismo que usa el motor conversacional. Cero cambios al Core (ADR-005).

app.get('/api/agenda/asesores', requireAuth, async (req, res) => {
  try {
    const asesores = await listarAsesores(req.supabase, req.usuario.company_id);
    res.json(asesores);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/agenda/citas', requireAuth, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const citas = await listarCitas(req.supabase, req.usuario.company_id, req.usuario, { desde, hasta });
    res.json(citas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/agenda/disponibilidad', requireAuth, async (req, res) => {
  try {
    const { asesorId, fecha, duracionMinutos } = req.query;
    const slots = await consultarDisponibilidad(req.supabase, req.usuario.company_id, {
      asesorId,
      fecha: new Date(fecha),
      duracionMinutos: duracionMinutos ? Number(duracionMinutos) : undefined,
    });
    res.json(slots);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agenda/clientes', requireAuth, async (req, res) => {
  try {
    const { telefono, nombre, empresa, notas } = req.body;
    if (!telefono) return res.status(400).json({ error: 'telefono requerido' });

    const cliente = await obtenerOCrearClienteManual(req.supabase, req.usuario.company_id, { telefono, nombre, empresa, notas });
    res.status(201).json(cliente);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agenda/citas', requireAuth, async (req, res) => {
  try {
    const { clienteId, asesorId, inicio, fin } = req.body;
    const cita = await crearCita(req.supabase, req.usuario.company_id, req.usuario, {
      clienteId, asesorId, inicio: new Date(inicio), fin: new Date(fin),
    });
    res.status(201).json(cita);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/agenda/citas/:id', requireAuth, async (req, res) => {
  try {
    const { inicio, fin } = req.body;
    const cita = await reagendarCita(req.supabase, req.usuario.company_id, req.usuario, req.params.id, new Date(inicio), new Date(fin));
    res.json(cita);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/agenda/citas/:id/cancelar', requireAuth, async (req, res) => {
  try {
    const cita = await cancelarCita(req.supabase, req.usuario.company_id, req.usuario, req.params.id);
    res.json(cita);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/agenda/asesores/:id/vincular', requireAuth, async (req, res) => {
  try {
    if (!['owner', 'administrador'].includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const asesor = await vincularUsuarioAAsesor(req.supabase, req.usuario.company_id, req.params.id, req.body.usuario_id);
    res.json(asesor);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── CRM (Plataforma SaaS, Fase 5) ─────────────────────────────────────────────
// Lógica real en modules/crm-ui.js (distinto de modules/crm.js, el write path
// congelado del motor conversacional — ADR-005). Solo lectura/edición de UI.

app.get('/api/crm/clientes', requireAuth, async (req, res) => {
  try {
    const { nombre, estado, score_min } = req.query;
    const clientes = await listarClientes(req.supabase, req.usuario.company_id, req.usuario, { nombre, estado, score_min });
    res.json(clientes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/crm/oportunidades', requireAuth, async (req, res) => {
  try {
    const oportunidades = await listarOportunidades(req.supabase, req.usuario.company_id);
    res.json(oportunidades);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/crm/clientes/:id', requireAuth, async (req, res) => {
  try {
    const ficha = await obtenerFichaCliente(req.supabase, req.usuario.company_id, req.params.id);
    res.json(ficha);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/crm/clientes/:id', requireAuth, async (req, res) => {
  try {
    const cliente = await actualizarCliente(req.supabase, req.usuario.company_id, req.params.id, req.body);
    res.json(cliente);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/crm/clientes/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarCliente(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/crm/clientes/:id/seguimientos', requireAuth, async (req, res) => {
  try {
    const seguimientos = await listarSeguimientos(req.supabase, req.usuario.company_id, req.params.id);
    res.json(seguimientos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fase Demo Comercial: "Pregúntale a TARA" sobre un cliente específico —
// IA real (modules/asistente-consultas.js), de solo lectura, basada en la
// conversación que ya tuvo con ese cliente. No toca el motor conversacional.
app.post('/api/crm/clientes/:id/preguntar', requireAuth, async (req, res) => {
  try {
    const { pregunta } = req.body || {};
    if (!pregunta || !pregunta.trim()) return res.status(400).json({ error: 'pregunta requerida' });

    const respuesta = await responderSobreCliente(req.supabase, req.usuario.company_id, req.params.id, pregunta.trim());
    res.json({ respuesta });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/crm/clientes/:id/seguimientos', requireAuth, async (req, res) => {
  try {
    const { texto, fecha_programada, prioridad } = req.body;
    if (!texto || !texto.trim()) return res.status(400).json({ error: 'texto requerido' });

    const seguimiento = await crearSeguimiento(req.supabase, req.usuario.company_id, req.params.id, req.usuario.id, { texto, fecha_programada, prioridad });
    res.status(201).json(seguimiento);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/crm/seguimientos/:id', requireAuth, async (req, res) => {
  try {
    const seguimiento = await actualizarSeguimiento(req.supabase, req.usuario.company_id, req.params.id, req.body);
    res.json(seguimiento);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/crm/clientes/:id/oportunidades', requireAuth, async (req, res) => {
  try {
    const oportunidad = await crearOportunidad(req.supabase, req.usuario.company_id, req.params.id, req.body);
    res.status(201).json(oportunidad);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/crm/oportunidades/:id', requireAuth, async (req, res) => {
  try {
    const oportunidad = await actualizarOportunidad(req.supabase, req.usuario.company_id, req.params.id, req.body);
    res.json(oportunidad);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/crm/oportunidades/:id', requireAuth, async (req, res) => {
  try {
    await eliminarOportunidad(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CONFIGURACIÓN DE EMPRESA (Plataforma SaaS, Fase 6) ───────────────────────
// Lógica real en modules/configuracion.js. Solo campos de negocio — los
// parámetros técnicos del motor de IA nunca se exponen aquí (ver ADR-005).

app.get('/api/config/personalidad', requireAuth, async (req, res) => {
  try {
    res.json(await obtenerPersonalidad(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/config/personalidad', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarPersonalidad(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/config/knowledge-base', requireAuth, async (req, res) => {
  try {
    res.json(await listarKnowledgeBase(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/knowledge-base', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await crearKnowledgeBase(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/config/knowledge-base/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarKnowledgeBase(req.supabase, req.usuario.company_id, req.params.id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/config/knowledge-base/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarKnowledgeBase(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config/horarios', requireAuth, async (req, res) => {
  try {
    res.json(await listarHorarios(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/horarios', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await crearHorario(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/config/horarios/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarHorario(req.supabase, req.usuario.company_id, req.params.id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/config/horarios/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarHorario(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config/horario-atencion', requireAuth, async (req, res) => {
  try {
    res.json(await listarHorarioAtencionBot(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/horario-atencion', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await guardarHorarioAtencionBot(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/config/horario-atencion/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarHorarioAtencionBot(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config/servicios', requireAuth, async (req, res) => {
  try {
    res.json(await listarServicios(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/servicios', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await crearServicio(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/config/servicios/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarServicio(req.supabase, req.usuario.company_id, req.params.id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/config/servicios/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarServicio(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config/pipeline-etapas', requireAuth, async (req, res) => {
  try {
    res.json(await listarPipelineEtapas(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/pipeline-etapas', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await crearPipelineEtapa(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/config/pipeline-etapas/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarPipelineEtapa(req.supabase, req.usuario.company_id, req.params.id, req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/config/pipeline-etapas/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarPipelineEtapa(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config/canales', requireAuth, async (req, res) => {
  try {
    res.json(await listarCanales(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── USUARIOS / INVITACIONES (Plataforma SaaS, Fase 6) ─────────────────────────
// Alta sin depender de crear cuentas manualmente en Supabase Dashboard.
// Lógica real en modules/invitaciones.js.

app.get('/api/config/usuarios', requireAuth, soloGerencial, async (req, res) => {
  try {
    const [miembros, invitacionesPendientes] = await Promise.all([
      listarMiembros(req.supabase, req.usuario.company_id),
      listarInvitacionesPendientes(req.supabase, req.usuario.company_id),
    ]);
    res.json({ miembros, invitacionesPendientes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/usuarios/invitar', requireAuth, soloGerencial, async (req, res) => {
  try {
    const { nombre, email, rol } = req.body;
    if (!nombre || !email) return res.status(400).json({ error: 'nombre y email requeridos' });

    const invitacion = await crearInvitacion(req.supabase, req.usuario.company_id, { nombre, email, rol });
    res.status(201).json({ ...invitacion, link: `/aceptar-invitacion/${invitacion.token}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/config/usuarios/:usuarioId', requireAuth, soloGerencial, async (req, res) => {
  try {
    const { nombre, ...resto } = req.body;
    let resultado;
    if (nombre !== undefined) {
      resultado = await actualizarNombreMiembro(req.supabase, req.usuario.company_id, req.params.usuarioId, nombre);
    }
    if (Object.keys(resto).length > 0) {
      resultado = await actualizarMiembro(req.supabase, req.usuario.company_id, req.params.usuarioId, resto);
    }
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── WORKFLOWS (Pivote a producto, Fase 3) ────────────────────────────────────
// CRUD de administración sobre workflows/workflow_nodes (modules/workflow-admin.js).
// No toca modules/workflow-engine.js ni modules/orchestrator.js (ADR-005).

app.get('/api/config/workflows', requireAuth, async (req, res) => {
  try {
    res.json(await listarWorkflows(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/workflows', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await crearWorkflow(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/config/workflows/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarWorkflow(req.supabase, req.usuario.company_id, req.params.id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/config/workflows/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarWorkflow(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config/workflows/:workflowId/nodos', requireAuth, async (req, res) => {
  try {
    res.json(await listarNodos(req.supabase, req.usuario.company_id, req.params.workflowId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/config/workflows/:workflowId/nodos', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await crearNodo(req.supabase, req.usuario.company_id, req.params.workflowId, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/config/nodos/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarNodo(req.supabase, req.usuario.company_id, req.params.id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/config/nodos/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarNodo(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Públicas — sin requireAuth. El invitado todavía no tiene sesión.

app.get('/api/invitaciones/:token', async (req, res) => {
  try {
    const invitacion = await obtenerInvitacionPorToken(supabaseServicio, req.params.token);
    res.json({ nombre: invitacion.nombre, email: invitacion.email, empresa: invitacion.companies?.nombre });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/invitaciones/:token/aceptar', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const { email } = await aceptarInvitacion(supabaseServicio, req.params.token, password);

    // Cuenta y membresía creadas — se inicia sesión automáticamente para
    // que el invitado entre directo, sin tener que loguearse aparte.
    const { token, usuario, empresaActiva, empresas } = await iniciarSesion(supabase, email, password);
    res.cookie('tara_session', token, COOKIE_OPTS);
    res.cookie('tara_company', empresaActiva.company_id, COOKIE_OPTS);
    res.status(201).json({ usuario, empresaActiva, empresas });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── LEGAL (requerido por verificación OAuth de Google — Anexo A, TA.0.1) ──────

app.get('/privacidad', (req, res) => res.sendFile(path.join(__dirname, 'legal', 'privacidad.html')));
app.get('/terminos',   (req, res) => res.sendFile(path.join(__dirname, 'legal', 'terminos.html')));

// ── OAUTH GOOGLE CALENDAR (ANEXO A, TA.5) ─────────────────────────────────────
// Rutas delgadas — la lógica vive en modules/google-auth.js.

app.get('/oauth/google/iniciar', (req, res) => {
  try {
    const url = generarUrlAutorizacion(req.query.company_id);
    res.redirect(url);
  } catch (e) {
    res.status(400).send(`No se pudo iniciar la conexión con Google: ${e.message}`);
  }
});

app.get('/oauth/google/callback', async (req, res) => {
  try {
    await manejarCallback(supabaseServicio, req.query.code, req.query.state);
    res.send('Cuenta de Google conectada correctamente. Puedes cerrar esta ventana.');
  } catch (e) {
    console.error('❌ Error en /oauth/google/callback:', e);
    res.status(500).send(`No se pudo completar la conexión con Google: ${e.message}`);
  }
});

// ── AUTH (Plataforma SaaS, Fase 1) ────────────────────────────────────────────
// Login mediado por el backend — el frontend nunca habla con Supabase.
// Rutas delgadas, la lógica vive en modules/auth.js.

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 días
};

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email y password son requeridos' });
    }

    const { token, usuario, empresaActiva, empresas } = await iniciarSesion(supabase, email, password);

    res.cookie('tara_session', token, COOKIE_OPTS);
    res.cookie('tara_company', empresaActiva.company_id, COOKIE_OPTS);
    res.json({ usuario, empresaActiva, empresas });
  } catch (e) {
    const status = e instanceof ErrorAuth ? e.status : 500;
    res.status(status).json({ error: e.message });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const empresas = await obtenerEmpresasDeUsuario(req.supabase, req.usuario.id);
    const empresaActiva = empresas.find(e => e.company_id === req.usuario.company_id)
      || { company_id: req.usuario.company_id, rol: req.usuario.rol, nombre: null };

    res.json({
      usuario: { id: req.usuario.id, nombre: req.usuario.nombre, email: req.usuario.email },
      empresaActiva,
      empresas,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Selector de empresa activa (multi-empresa por usuario): revalida
// pertenencia contra usuarios_empresas antes de mover la cookie — mismo
// criterio de seguridad que resolverSesion(), nunca se confía en el
// company_id que manda el cliente sin verificar.
app.post('/api/auth/cambiar-empresa', requireAuth, async (req, res) => {
  try {
    const { company_id } = req.body || {};
    const empresas = await obtenerEmpresasDeUsuario(req.supabase, req.usuario.id);
    const nueva = empresas.find(e => e.company_id === company_id);

    if (!nueva) return res.status(403).json({ error: 'No perteneces a esa empresa' });

    res.cookie('tara_company', company_id, COOKIE_OPTS);
    res.json({ empresaActiva: nueva, empresas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('tara_session', COOKIE_OPTS);
  res.clearCookie('tara_company', COOKIE_OPTS);
  res.json({ ok: true });
});

// ── ROOT ──────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.json({
  sistema:   'TARA Matrix™',
  version:   '3.0.0',
  modo:      'multi-tenant',
  endpoints: {
    webhook:     'POST /webhook/twilio',
    health:      'GET  /health',
    diagnostics: 'GET  /api/diagnostics',
    dashboard:   'GET  /api/dashboard',
    privacidad:  'GET  /privacidad',
    terminos:    'GET  /terminos',
    google_oauth_iniciar: 'GET  /oauth/google/iniciar?company_id=...',
    google_oauth_callback: 'GET  /oauth/google/callback',
    auth_login:  'POST /api/auth/login',
    auth_me:     'GET  /api/auth/me',
    auth_logout: 'POST /api/auth/logout',
  },
}));

// ── FRONTEND (Plataforma SaaS) ─────────────────────────────────────────────────
// Sirve el build de React (frontend/dist). Cualquier ruta que no sea de la
// API/webhook/OAuth cae aquí y devuelve index.html — el ruteo real (/login,
// /operaciones, etc.) lo resuelve React Router en el cliente. Se sirve desde
// el mismo servicio Express — sin costo ni deploy adicional en Render.

const FRONTEND_DIST = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(FRONTEND_DIST));

app.get(/^(?!\/api|\/oauth|\/webhook|\/health|\/privacidad|\/terminos).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'), (err) => {
    if (err) res.status(404).send('Panel no disponible — ¿se corrió "npm run build" en frontend/?');
  });
});

// ── INICIO ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log('\n============================================================');
  console.log('🚀 TARA Matrix™ v3.0 — FASE 3 ACTIVA — Multi-tenant');
  console.log('============================================================');
  console.log(`Puerto: ${PORT}`);
  console.log('Routing: dinámico por channel_endpoints (no COMPANY_SLUG)');
  console.log('Core:');
  console.log('  M1  ChannelAdapter  — TwilioWhatsAppAdapter');
  console.log('  M2  AI Providers    — OpenAIProvider + MockProvider');
  console.log('  M3  AuditLogger     — fire-and-forget');
  console.log('  M4  ContextBuilder  — sync, puro');
  console.log('  M6  PromptBuilder   — 10 bloques');
  console.log('  M7  Orchestrator    — coordinador único');
  console.log('  RT  ChannelRouter   — enrutamiento multi-tenant');
  console.log('============================================================\n');

  try {
    const { data: endpoints } = await supabaseServicio
      .from('channel_endpoints').select('endpoint, companies(nombre)').eq('activo', true);
    if (endpoints?.length) {
      endpoints.forEach(e => console.log(`  ✅ ${e.endpoint} → ${e.companies?.nombre}`));
    } else {
      console.warn('  ⚠️  No hay channel_endpoints activos en Supabase');
    }
    console.log('');
  } catch (e) {
    console.error('  ⚠️  No se pudieron cargar channel_endpoints:', e.message);
  }
});

module.exports = app;
