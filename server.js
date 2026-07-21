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

const { supabase, supabaseServicio, crearClienteConSesion, twilioClient, stripe, openai } = require('./modules/clients');
const { obtenerConfigEmpresa }          = require('./modules/config');
const { crearOrchestrator }             = require('./modules/orchestrator');
const { TwilioWhatsAppAdapter }         = require('./adapters/channels/twilio-whatsapp');
const { MetaCloudWhatsAppAdapter }      = require('./adapters/channels/meta-cloud-whatsapp');
const { obtenerAdapterMetaParaEmpresa, conectarWhatsAppMeta } = require('./modules/meta-auth');
const { ChannelRouter }                 = require('./modules/channel-router');
const { generarUrlAutorizacion, manejarCallback } = require('./modules/google-auth');
const { iniciarSesion, obtenerEmpresasDeUsuario, solicitarRecuperacion, restablecerPassword, ErrorAuth } = require('./modules/auth');
const { registrarEmpresa, ErrorRegistro } = require('./modules/registro');
const { crearRequireAuth }              = require('./modules/auth-middleware');
const { obtenerMetricas }               = require('./modules/dashboard');
const {
  listarConversaciones, obtenerHistorial, tomarConversacion,
  regresarATara, enviarMensajeHumano, registrarMensajeEntranteHumano,
}                                        = require('./modules/conversaciones');
const { obtenerOCrearCliente }           = require('./modules/crm');
const {
  listarAsesores, listarAsesoresConfig, crearAsesor, actualizarAsesor, eliminarAsesor,
  listarCitas, consultarDisponibilidad, obtenerOCrearClienteManual,
  crearCita, reagendarCita, cancelarCita, marcarNoShow, vincularUsuarioAAsesor,
}                                        = require('./modules/agenda');
const { obtenerAgendaConfig, actualizarAgendaConfig } = require('./modules/agenda-config');
const { calcularEstadoDelDia }           = require('./modules/agenda-engine');
const { resolverEvento }                = require('./modules/agenda-engine/recomendaciones');
const { calcularCambiosNombreEmpresa }  = require('./modules/nombre-cliente');
const { preguntar: preguntarOperador }  = require('./modules/operador-engine');
const { resolverOCrearHilo, registrarMensaje, listarHilos, obtenerHilo, listarMensajesDeHilo, actualizarHilo } = require('./modules/inbox');
const { analizarHilo, programarAnalisis, obtenerAnalisisHilo } = require('./modules/inbox-analisis');
const { tipoContenidoDeMime, subirAdjunto, generarUrlFirmada } = require('./modules/inbox-adjuntos');
const { transcribirAudio, describirImagen } = require('./modules/adjuntos-ia');
const { esGerencial } = require('./modules/permisos');
const { interpretarComando, confirmarComando, cancelarComando } = require('./modules/agenda-comandos');
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

// Plataforma Comercial (Panel Maestro, Billing, Onboarding).
const { crearOrganizacionConCompany, listarOrganizaciones, obtenerOrganizacion } = require('./modules/organizaciones');
const { listarPlanes, crearPlan, actualizarPlan } = require('./modules/planes');
const {
  obtenerSuscripcionVigente, crearSuscripcionManual, suspenderOrganizacion, reactivarOrganizacion,
  extenderPrueba, regalarMeses, cancelarSuscripcion, aplicarDescuento,
  cambiarPlan, crearCheckoutSession, crearPortalSession, manejarWebhookStripe,
}                                        = require('./modules/plataforma-billing');
const { registrarMetodoPago, obtenerMetodoPagoVigente } = require('./modules/billing-engine/metodos-pago');
const { listarPagos }                    = require('./modules/billing-engine/pagos');
const { resumenPorOrganizacion }         = require('./modules/billing-engine/centro-cobro');
const { iniciarSesionAdmin, resolverSesionAdmin, ErrorAdminAuth } = require('./modules/admin-auth');
const { crearRequireAdmin }             = require('./modules/admin-auth-middleware');
const { iniciarImpersonacion, resolverSesionImpersonada, finalizarImpersonacion } = require('./modules/plataforma-impersonacion');
const { registrarEvento: registrarEventoAdmin, listarEventos: listarEventosAdmin } = require('./modules/plataforma-audit');
const { dashboardGlobal }                = require('./modules/plataforma-analitica');

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
const requireAuthDeTenant = crearRequireAuth(crearClienteConSesion);
const requireAdmin        = crearRequireAdmin(crearClienteConSesion);

// FASE 8.1: impersonation ("entrar como administrador a cualquier empresa
// para soporte") se resuelve ANTES que el flujo normal de sesión de
// tenant — cambio aditivo, no toca modules/auth-middleware.js ni el resto
// del camino ya congelado. Usa supabaseServicio porque no hay JWT propio
// de la empresa impersonada, solo el token de plataforma_impersonaciones.
async function requireAuth(req, res, next) {
  const tokenImpersonacion = req.cookies?.tara_impersonacion;
  if (tokenImpersonacion) {
    const usuarioImpersonado = await resolverSesionImpersonada(supabaseServicio, tokenImpersonacion);
    if (usuarioImpersonado) {
      req.usuario  = usuarioImpersonado;
      req.supabase = supabaseServicio;
      return next();
    }
  }
  return requireAuthDeTenant(req, res, next);
}

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
// Inbox Inteligente (v0.4) — Motor de Decisiones: se programa (con
// debounce) después de cada mensaje, nunca se corre en línea — no debe
// agregar latencia a la respuesta que ya recibió el cliente.
function _programarAnalisisSiHayHilo(hilo, cliente_id, company_id) {
  if (!hilo) return;
  programarAnalisis(hilo.id, () => analizarHilo({ supabase: supabaseServicio, openaiClient: openai, company_id, hilo_id: hilo.id, cliente_id, hilo }));
}

async function procesarMensajeEntrante(message, enviar, proveedor = 'desconocido', descargarMedia = null) {
  // FASE 5 (Fase 3 — intervención humana): si un humano ya tomó esta
  // conversación, TARA no responde. Se resuelve el cliente aquí (capa de
  // plataforma) sin tocar el Orchestrator/WorkflowEngine (ADR-005).
  const cliente = await obtenerOCrearCliente(message.from, message.company_id);

  // Inbox Inteligente (v0.4) — escritura doble: además de lo que el Core ya
  // escribe en `conversaciones` (congelada), cada mensaje se refleja en
  // `hilos`/`mensajes` (multi-canal, con soporte de adjuntos). Nunca debe
  // tumbar la respuesta al cliente si algo aquí falla.
  let hilo = null;
  try {
    hilo = await resolverOCrearHilo(supabaseServicio, {
      company_id: message.company_id, cliente_id: cliente.id, canal: message.channel, proveedor,
    });

    // Adjuntos reales (v0.4): si el mensaje trae media, se descarga del
    // proveedor y se sube de inmediato a Storage — nunca se guarda la URL
    // de Meta/Twilio (expiran). Si algo falla aquí, el mensaje se guarda
    // igual como texto (el placeholder que ya generó el adapter) en vez de
    // perderse — la clienta siempre recibe su respuesta pase lo que pase.
    let adjunto = null;
    if (message.media && descargarMedia) {
      try {
        const { buffer, mimeType } = await descargarMedia(message.media);
        const path = await subirAdjunto(supabaseServicio, { company_id: message.company_id, hilo_id: hilo.id, buffer, mimeType });
        adjunto = { tipo_contenido: tipoContenidoDeMime(mimeType), adjunto_url: path, adjunto_mime: mimeType };

        // Comprensión real de adjuntos: TARA transcribe audio (Whisper) y
        // describe imágenes (visión) en vez del placeholder genérico — esto
        // reemplaza message.content ANTES de llamar al Orchestrator más
        // abajo, así que el Core recibe texto normal, como si la clienta lo
        // hubiera escrito. Cero cambios al Core (ADR-005). Si la IA falla
        // aquí, se conserva el placeholder — la clienta sigue recibiendo
        // alguna respuesta en vez de que el turno se caiga.
        try {
          if (adjunto.tipo_contenido === 'audio') {
            const transcripcion = await transcribirAudio(openai, buffer, mimeType);
            if (transcripcion) message.content = transcripcion;
          } else if (adjunto.tipo_contenido === 'imagen') {
            const descripcion = await describirImagen(openai, buffer, mimeType);
            if (descripcion) message.content = descripcion;
          }
        } catch (e) {
          console.error('Inbox: error interpretando adjunto con IA (se conserva el placeholder):', e.message);
        }
      } catch (e) {
        console.error('Inbox: error descargando/subiendo adjunto:', e.message);
      }
    }

    await registrarMensaje(supabaseServicio, {
      hilo_id: hilo.id, company_id: message.company_id, direccion: 'entrante', remitente_tipo: 'cliente',
      tipo_contenido: adjunto?.tipo_contenido || 'texto', contenido: message.content,
      adjunto_url: adjunto?.adjunto_url, adjunto_mime: adjunto?.adjunto_mime,
    });
    _programarAnalisisSiHayHilo(hilo, cliente.id, message.company_id);
  } catch (e) {
    console.error('Inbox: error en escritura doble (mensaje entrante):', e.message);
  }

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
    const textoFueraDeHorario = personality?.mensaje_fuera_horario || MENSAJE_FUERA_HORARIO_DEFAULT;
    await enviar(message.from, textoFueraDeHorario);
    if (hilo) {
      try {
        await registrarMensaje(supabaseServicio, {
          hilo_id: hilo.id, company_id: message.company_id, direccion: 'saliente', remitente_tipo: 'ia', contenido: textoFueraDeHorario,
        });
        _programarAnalisisSiHayHilo(hilo, cliente.id, message.company_id);
      } catch (e) {
        console.error('Inbox: error en escritura doble (mensaje saliente, fuera de horario):', e.message);
      }
    }
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
  if (cliente?.id && datosExtraidos) {
    const cambiosCliente = calcularCambiosNombreEmpresa(cliente, datosExtraidos);
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

          const rangoTotal = `$${(cotizacion.precioMin * cotizacion.cantidad).toLocaleString('es-MX')}–$${(cotizacion.precioMax * cotizacion.cantidad).toLocaleString('es-MX')}`;
          const envio = cotizacion.envioGratis ? ' 🚚 Envío gratis a todo México incluido.' : '';
          textoCotizacion = `\n\n📋 Cotización estimada: ${cotizacion.cantidad} uniformes × $${cotizacion.precioMin.toLocaleString('es-MX')}–$${cotizacion.precioMax.toLocaleString('es-MX')} c/u = ${rangoTotal} MXN, según diseño genérico o totalmente personalizado.${envio} Un asesor te confirma el total exacto.`;
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

  if (hilo) {
    try {
      await registrarMensaje(supabaseServicio, {
        hilo_id: hilo.id, company_id: message.company_id, direccion: 'saliente', remitente_tipo: 'ia', contenido: textoFinal,
      });
      _programarAnalisisSiHayHilo(hilo, cliente.id, message.company_id);
    } catch (e) {
      console.error('Inbox: error en escritura doble (mensaje saliente):', e.message);
    }
  }
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

    await procesarMensajeEntrante(
      message,
      (destinatario, texto) => adapter.enviarMensaje(destinatario, texto, numeroOrigen),
      'twilio',
      (media) => adapter.descargarMedia(media)
    );

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

    await procesarMensajeEntrante(
      message,
      (destinatario, texto) => metaAdapterEmpresa.enviarMensaje(destinatario, texto),
      'meta',
      (media) => metaAdapterEmpresa.descargarMedia(media)
    );

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
    const textoLimpio = texto.trim();

    // Fix real: antes esto siempre mandaba por Twilio, sin importar el
    // proveedor real de la empresa — "responder" quedaba roto en silencio
    // para cualquier empresa conectada a Meta (ej. Salud y Belleza). Resuelve
    // el mismo par adapter/proveedor que ya usan los webhooks entrantes.
    const metaAdapterEmpresa = await obtenerAdapterMetaParaEmpresa(supabaseServicio, req.usuario.company_id);
    const proveedor = metaAdapterEmpresa ? 'meta' : 'twilio';
    const enviarProactivo = metaAdapterEmpresa
      ? (destino, txt) => metaAdapterEmpresa.sendProactive(txt, destino)
      : async (destino, txt) => {
          const numeroOrigen = await channelRouter.resolverEndpointDeEmpresa(req.usuario.company_id);
          return adapter.sendProactive(txt, destino, numeroOrigen);
        };

    const cliente = await enviarMensajeHumano(
      req.supabase, enviarProactivo, req.usuario.company_id, req.params.clienteId, req.usuario.id, textoLimpio
    );

    // Inbox Inteligente (v0.4) — escritura doble, mismo criterio que
    // procesarMensajeEntrante: nunca debe tumbar la respuesta si falla.
    try {
      const hilo = await resolverOCrearHilo(supabaseServicio, {
        company_id: req.usuario.company_id, cliente_id: req.params.clienteId, canal: 'whatsapp', proveedor,
      });
      await registrarMensaje(supabaseServicio, {
        hilo_id: hilo.id, company_id: req.usuario.company_id, direccion: 'saliente', remitente_tipo: 'humano', contenido: textoLimpio,
      });
      _programarAnalisisSiHayHilo(hilo, req.params.clienteId, req.usuario.company_id);
    } catch (e) {
      console.error('Inbox: error en escritura doble (mensaje humano saliente):', e.message);
    }

    res.status(201).json({ ok: true, cliente });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── INBOX INTELIGENTE (v0.4) ──────────────────────────────────────────────────
// Lógica real en modules/inbox.js. Convive con /api/conversaciones (arriba,
// sin cambios) — el Inbox es la evolución, no un reemplazo inmediato.

app.get('/api/inbox/hilos', requireAuth, async (req, res) => {
  try {
    const { canal, sucursalId, asesorId, estado, prioridad, etiqueta, cursor } = req.query;
    const hilos = await listarHilos(req.supabase, req.usuario.company_id, {
      usuario: req.usuario, canal, sucursal_id: sucursalId, asesor_id: asesorId, estado, prioridad, etiqueta, cursor,
    });
    res.json(hilos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/inbox/hilos/:hiloId', requireAuth, async (req, res) => {
  try {
    const hilo = await obtenerHilo(req.supabase, req.usuario.company_id, req.params.hiloId);
    if (!hilo) return res.status(404).json({ error: 'Hilo no encontrado' });
    res.json(hilo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/inbox/hilos/:hiloId/analisis', requireAuth, async (req, res) => {
  try {
    const analisis = await obtenerAnalisisHilo(req.supabase, req.params.hiloId);
    res.json(analisis); // null si todavía no se ha analizado — el frontend lo maneja
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// "Analizar ahora" — corre el Motor de Decisiones de inmediato, sin esperar
// el debounce normal (útil justo después de tomar una conversación).
app.post('/api/inbox/hilos/:hiloId/analisis', requireAuth, async (req, res) => {
  try {
    const hilo = await obtenerHilo(req.supabase, req.usuario.company_id, req.params.hiloId);
    if (!hilo) return res.status(404).json({ error: 'Hilo no encontrado' });

    const analisis = await analizarHilo({
      supabase: supabaseServicio, openaiClient: openai, company_id: req.usuario.company_id,
      hilo_id: hilo.id, cliente_id: hilo.cliente_id, hilo,
    });
    res.json(analisis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/inbox/hilos/:hiloId/mensajes', requireAuth, async (req, res) => {
  try {
    const mensajes = await listarMensajesDeHilo(req.supabase, req.params.hiloId);
    res.json(mensajes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Adjuntos reales (v0.4): nunca se guarda una URL de Storage en la base de
// datos (ni firmada) — `mensajes.adjunto_url` solo tiene el path dentro del
// bucket privado. Esta ruta confirma que el mensaje es de la empresa del
// usuario autenticado y recién ahí genera una URL firmada de 60s y
// redirige — el navegador la sigue de forma transparente (mismo origen,
// <img>/<audio>/<video> con la cookie de sesión ya incluida).
app.get('/api/inbox/mensajes/:mensajeId/adjunto', requireAuth, async (req, res) => {
  try {
    const { data: mensaje, error } = await req.supabase
      .from('mensajes')
      .select('adjunto_url')
      .eq('id', req.params.mensajeId)
      .eq('company_id', req.usuario.company_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!mensaje?.adjunto_url) return res.status(404).json({ error: 'Adjunto no encontrado' });

    const url = await generarUrlFirmada(supabaseServicio, mensaje.adjunto_url);
    res.redirect(url);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/inbox/hilos/:hiloId', requireAuth, async (req, res) => {
  try {
    const { estado, prioridad, etiquetas, asesorId } = req.body || {};
    // Reasignar a otro asesor (distinto de uno mismo) es solo gerencial —
    // mismo criterio que "transferir" en soporte tradicional.
    if (asesorId !== undefined && asesorId !== req.usuario.id && !esGerencial(req.usuario.rol)) {
      return res.status(403).json({ error: 'Solo un rol gerencial puede reasignar a otro asesor' });
    }
    const hilo = await actualizarHilo(req.supabase, req.usuario.company_id, req.params.hiloId, {
      estado, prioridad, etiquetas, asesor_id: asesorId,
    });
    res.json(hilo);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const { clienteId, asesorId, inicio, fin, servicioId, precioCobrado } = req.body;
    const cita = await crearCita(req.supabase, req.usuario.company_id, req.usuario, {
      clienteId, asesorId, inicio: new Date(inicio), fin: new Date(fin),
      servicioId, precioCobrado: precioCobrado != null ? Number(precioCobrado) : null,
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

app.post('/api/agenda/citas/:id/no-show', requireAuth, async (req, res) => {
  try {
    const cita = await marcarNoShow(req.supabase, req.usuario.company_id, req.usuario, req.params.id);
    res.json(cita);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── MOTOR DE AGENDA UNIVERSAL (Fase 1) ────────────────────────────────────────
// GET /api/agenda/config devuelve null cuando la empresa no tiene fila —
// esa es la señal que usa Agenda.jsx para decidir entre la vista clásica
// (Tienda Soccer, Total Racks, cualquiera sin configurar todavía) y la
// experiencia de Agenda Viva (por ahora, solo Sugar Salon).

app.get('/api/agenda/config', requireAuth, async (req, res) => {
  try {
    const config = await obtenerAgendaConfig(req.supabase, req.usuario.company_id);
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/agenda/config', requireAuth, soloGerencial, async (req, res) => {
  try {
    const config = await actualizarAgendaConfig(req.supabase, req.usuario.company_id, req.body);
    res.json(config);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

app.get('/api/agenda/estado-del-dia', requireAuth, async (req, res) => {
  try {
    const fecha = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const estado = await calcularEstadoDelDia(req.supabase, req.usuario.company_id, fecha);
    res.json(estado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agenda/eventos/:id/resolver', requireAuth, async (req, res) => {
  try {
    const { estado, accion_tomada, resultado } = req.body;
    const evento = await resolverEvento(req.supabase, req.usuario.company_id, req.params.id, { estado, accion_tomada, resultado });
    res.json(evento);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ⌘K con lenguaje natural — patrón "interpretar → confirmar → ejecutar"
// (ver modules/agenda-comandos.js). Interpretar NUNCA muta datos; solo
// /confirmar ejecuta, y solo lo que ya se le mostró a la usuaria.

app.post('/api/agenda/comando', requireAuth, async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto || !texto.trim()) return res.status(400).json({ error: 'texto requerido' });
    const resultado = await interpretarComando(req.supabase, req.usuario.company_id, req.usuario, texto.trim());
    res.json(resultado);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/agenda/comando/:id/confirmar', requireAuth, async (req, res) => {
  try {
    const comando = await confirmarComando(req.supabase, req.usuario.company_id, req.usuario, req.params.id);
    res.json(comando);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/agenda/comando/:id/cancelar', requireAuth, async (req, res) => {
  try {
    const comando = await cancelarComando(req.supabase, req.usuario.company_id, req.params.id);
    res.json(comando);
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

// Modo Operador — Nivel 3 (Empresa). El alcance SIEMPRE se calcula aquí, a
// partir de la sesión ya autenticada — nunca viene del body de la petición.
// Ver modules/operador-engine.js / modules/operador-tools.js. Gateado a
// roles gerenciales, mismo criterio que Suscripción y Facturación.
app.post('/api/operador/preguntar', requireAuth, async (req, res) => {
  try {
    if (!esGerencial(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes acceso a Modo Operador' });
    }

    const { pregunta } = req.body || {};
    if (!pregunta || !pregunta.trim()) return res.status(400).json({ error: 'pregunta requerida' });

    const alcance = { nivel: 'empresa', company_id: req.usuario.company_id };
    const resultado = await preguntarOperador({ supabase: req.supabase, openaiClient: openai, pregunta: pregunta.trim(), alcance });
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ error: e.message });
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

// Portal de Cliente — wizard corto de onboarding: marca la empresa activa
// como lista, para que no se le vuelva a mostrar el wizard en el próximo login.
app.post('/api/config/onboarding-completado', requireAuth, async (req, res) => {
  try {
    const { error } = await req.supabase.from('companies').update({ onboarding_completado: true }).eq('id', req.usuario.company_id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
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

// ── Equipo (asesores/técnicas) ────────────────────────────────────────────
// A diferencia de /api/agenda/asesores (solo activos, para agendar),
// listarAsesoresConfig() trae también inactivos — la dueña necesita verlos
// para poder reactivarlos.

app.get('/api/config/asesores', requireAuth, async (req, res) => {
  try {
    res.json(await listarAsesoresConfig(req.supabase, req.usuario.company_id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config/asesores', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.status(201).json(await crearAsesor(req.supabase, req.usuario.company_id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.patch('/api/config/asesores/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    res.json(await actualizarAsesor(req.supabase, req.usuario.company_id, req.params.id, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/config/asesores/:id', requireAuth, soloGerencial, async (req, res) => {
  try {
    await eliminarAsesor(req.supabase, req.usuario.company_id, req.params.id);
    res.status(204).send();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
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

// Portal de Cliente — Centro de Conexiones: reemplaza el paso de terminal
// (scripts/conectar-empresa-meta.js) por un formulario dentro del panel.
// El dueño de la empresa sigue teniendo que sacar estos valores de Meta
// Business Manager a mano (sin Embedded Signup todavía) — esto solo evita
// que Alina tenga que correr el script por cada empresa.
app.post('/api/config/canales/whatsapp-meta', requireAuth, soloGerencial, async (req, res) => {
  try {
    const { whatsappBusinessAccountId, phoneNumberId, metaBusinessId, accessToken } = req.body || {};
    if (!whatsappBusinessAccountId || !phoneNumberId || !accessToken) {
      return res.status(400).json({ error: 'whatsappBusinessAccountId, phoneNumberId y accessToken son requeridos' });
    }

    await conectarWhatsAppMeta(supabaseServicio, req.usuario.company_id, {
      whatsappBusinessAccountId, phoneNumberId, metaBusinessId, accessToken,
    });
    res.json({ ok: true });
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

// Registro público (Portal de Cliente) — único punto de entrada de
// autoservicio: antes solo Alina (script) o un Super Admin (Panel Maestro)
// podían dar de alta una empresa. El rol de quien se registra es SIEMPRE
// 'owner', decidido en modules/registro.js — nunca leído de req.body.
app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nombreNegocio, descripcionNegocio, nombreUsuario, email, password } = req.body || {};
    const { email: emailCreado } = await registrarEmpresa(supabaseServicio, {
      nombreNegocio, descripcionNegocio, nombreUsuario, email, password,
    });

    // Cuenta y empresa creadas — inicia sesión automáticamente, mismo
    // patrón que /api/invitaciones/:token/aceptar.
    const { token, usuario, empresaActiva, empresas } = await iniciarSesion(supabase, emailCreado, password);
    res.cookie('tara_session', token, COOKIE_OPTS);
    res.cookie('tara_company', empresaActiva.company_id, COOKIE_OPTS);
    res.status(201).json({ usuario, empresaActiva, empresas });
  } catch (e) {
    const status = e instanceof ErrorRegistro || e instanceof ErrorAuth ? e.status : 500;
    res.status(status).json({ error: e.message });
  }
});

// Recuperación de contraseña — usa el envío de correo ya integrado de
// Supabase Auth, sin infraestructura de correo propia. Respuesta siempre
// idéntica exista o no la cuenta (evita enumeración de emails).
app.post('/api/auth/recuperar-password', async (req, res) => {
  const { email } = req.body || {};
  if (email && email.trim()) {
    const redirectTo = `${req.protocol}://${req.get('host')}/restablecer-password`;
    try { await solicitarRecuperacion(supabase, email.trim(), redirectTo); } catch { /* nunca se revela al cliente */ }
  }
  res.json({ ok: true, mensaje: 'Si el correo existe, te enviamos un link para restablecer tu contraseña.' });
});

// El frontend nunca habla con Supabase directo (ver modules/auth.js) — solo
// lee access_token del fragmento de la URL de recuperación y lo manda aquí.
app.post('/api/auth/restablecer-password', async (req, res) => {
  try {
    const { accessToken, password } = req.body || {};
    if (!accessToken || !password) return res.status(400).json({ error: 'accessToken y password son requeridos' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    await restablecerPassword(supabase, supabaseServicio, accessToken, password);
    res.json({ ok: true });
  } catch (e) {
    const status = e instanceof ErrorAuth ? e.status : 500;
    res.status(status).json({ error: e.message });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    // Sesión impersonada (Panel Maestro → "entrar como administrador"):
    // req.usuario.id es el Super Admin, no un miembro real de esta empresa
    // — obtenerEmpresasDeUsuario() no aplica aquí. Se resuelve la empresa
    // impersonada directo, y se marca es_impersonacion para que Shell.jsx
    // muestre el banner de soporte.
    if (req.usuario.es_impersonacion) {
      const { data: company } = await req.supabase
        .from('companies')
        .select('nombre, logo_url, color_acento, industria_slug, nav_labels')
        .eq('id', req.usuario.company_id)
        .maybeSingle();

      return res.json({
        usuario: { id: req.usuario.id, nombre: req.usuario.nombre, email: req.usuario.email },
        empresaActiva: {
          company_id: req.usuario.company_id,
          rol: req.usuario.rol,
          nombre: company?.nombre || null,
          logo_url: company?.logo_url || null,
          color_acento: company?.color_acento || null,
          industria_slug: company?.industria_slug || null,
          nav_labels: company?.nav_labels || null,
          onboarding_completado: true, // nunca mostrar el wizard durante impersonación
          es_impersonacion: true,
        },
        empresas: [],
      });
    }

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

// ── PLATAFORMA COMERCIAL — Panel Maestro (FASE 8.1) ───────────────────────────
// Rutas /api/admin/* — protegidas por requireAdmin, NUNCA por requireAuth.
// Cookie separada (tara_admin_session) de la sesión normal de tenant.

const ADMIN_COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,
};

app.post('/api/admin/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email y password son requeridos' });

    const { token, admin } = await iniciarSesionAdmin(supabase, email, password);
    res.cookie('tara_admin_session', token, ADMIN_COOKIE_OPTS);
    res.json({ admin });
  } catch (e) {
    const status = e instanceof ErrorAdminAuth ? e.status : 500;
    res.status(status).json({ error: e.message });
  }
});

app.get('/api/admin/auth/me', requireAdmin, (req, res) => res.json({ admin: req.admin }));

app.post('/api/admin/auth/logout', (req, res) => {
  res.clearCookie('tara_admin_session', ADMIN_COOKIE_OPTS);
  res.json({ ok: true });
});

// Modo Operador — Nivel 1 (TARA-OS / Panel Maestro). Alcance 'plataforma':
// ve todo el ecosistema autorizado, sin filtro de company_id/organization_id
// (mismo motor que Nivel 3 — modules/operador-engine.js — el alcance es lo
// único que cambia, calculado aquí a partir de requireAdmin, nunca del body).
app.post('/api/admin/operador/preguntar', requireAdmin, async (req, res) => {
  try {
    const { pregunta } = req.body || {};
    if (!pregunta || !pregunta.trim()) return res.status(400).json({ error: 'pregunta requerida' });

    const alcance = { nivel: 'plataforma' };
    const resultado = await preguntarOperador({ supabase: supabaseServicio, openaiClient: openai, pregunta: pregunta.trim(), alcance });
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/organizaciones', requireAdmin, async (req, res) => {
  try {
    res.json(await listarOrganizaciones(supabaseServicio));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/organizaciones/:id', requireAdmin, async (req, res) => {
  try {
    const org = await obtenerOrganizacion(supabaseServicio, req.params.id);
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    const suscripcion = await obtenerSuscripcionVigente(supabaseServicio, req.params.id);
    res.json({ ...org, suscripcionVigente: suscripcion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/organizaciones', requireAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, slug, industriaSlug } = req.body || {};
    if (!nombre || !slug) return res.status(400).json({ error: 'nombre y slug son requeridos' });

    const resultado = await crearOrganizacionConCompany(supabaseServicio, {
      nombre, descripcion, slug, industriaSlug, creadoPor: req.admin.id,
    });
    await registrarEventoAdmin(supabaseServicio, {
      adminId: req.admin.id, accion: 'crear_organizacion',
      organizationId: resultado.organization.id, companyId: resultado.company.id,
    });
    res.status(201).json(resultado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/organizaciones/:id/suspender', requireAdmin, async (req, res) => {
  try {
    await suspenderOrganizacion(supabaseServicio, req.params.id);
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'suspender_empresa', organizationId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/organizaciones/:id/reactivar', requireAdmin, async (req, res) => {
  try {
    await reactivarOrganizacion(supabaseServicio, req.params.id);
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'reactivar_empresa', organizationId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Impersonation: "entrar como administrador a cualquier empresa para
// soporte". Cookie tara_impersonacion, separada de tara_session — la
// resuelve requireAuth (ver arriba) antes que el flujo normal de tenant.
app.post('/api/admin/companies/:id/impersonar', requireAdmin, async (req, res) => {
  try {
    const fila = await iniciarImpersonacion(supabaseServicio, {
      adminId: req.admin.id, companyId: req.params.id, motivo: req.body?.motivo,
    });
    res.cookie('tara_impersonacion', fila.token, { ...ADMIN_COOKIE_OPTS, maxAge: 2 * 60 * 60 * 1000 });
    res.json({ ok: true, expiraEn: fila.expira_en });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/impersonar/salir', requireAdmin, async (req, res) => {
  try {
    const token = req.cookies?.tara_impersonacion;
    if (token) await finalizarImpersonacion(supabaseServicio, { token, adminId: req.admin.id });
    res.clearCookie('tara_impersonacion', ADMIN_COOKIE_OPTS);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/planes', requireAdmin, async (req, res) => {
  try {
    res.json(await listarPlanes(supabaseServicio));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/planes', requireAdmin, async (req, res) => {
  try {
    const { clave, nombre, precioCentavos, moneda, periodo, esAutoservicio, diasPrueba, perks, limites, orden } = req.body || {};
    if (!clave || !nombre) {
      return res.status(400).json({ error: 'clave y nombre son requeridos' }); // precioCentavos puede ser null (plan tipo Enterprise)
    }
    res.status(201).json(await crearPlan(supabaseServicio, {
      clave, nombre, precioCentavos, moneda, periodo, esAutoservicio, diasPrueba, perks, limites, orden,
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/planes/:id', requireAdmin, async (req, res) => {
  try {
    res.json(await actualizarPlan(supabaseServicio, req.params.id, req.body || {}));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Suscripciones — alta manual (sin Stripe todavía) y acciones de "licencias".
app.post('/api/admin/suscripciones', requireAdmin, async (req, res) => {
  try {
    const { organizationId, planId, mesesRegalo, notasPromocion } = req.body || {};
    if (!organizationId || !planId) return res.status(400).json({ error: 'organizationId y planId son requeridos' });

    const suscripcion = await crearSuscripcionManual(supabaseServicio, { organizationId, planId, mesesRegalo, notasPromocion });
    await registrarEventoAdmin(supabaseServicio, {
      adminId: req.admin.id, accion: 'cambiar_plan', organizationId, detalle: { planId, alta: true },
    });
    res.status(201).json(suscripcion);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/suscripciones/:id/plan', requireAdmin, async (req, res) => {
  try {
    const { planId } = req.body || {};
    if (!planId) return res.status(400).json({ error: 'planId es requerido' });
    const data = await cambiarPlan(supabaseServicio, req.params.id, planId);
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'cambiar_plan', detalle: { suscripcionId: req.params.id, planId } });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/suscripciones/:id/extender-prueba', requireAdmin, async (req, res) => {
  try {
    const dias = Number(req.body?.dias);
    if (!dias) return res.status(400).json({ error: 'dias es requerido' });
    const data = await extenderPrueba(supabaseServicio, req.params.id, dias);
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'extender_prueba', detalle: { suscripcionId: req.params.id, dias } });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/suscripciones/:id/regalar-meses', requireAdmin, async (req, res) => {
  try {
    const meses = Number(req.body?.meses);
    if (!meses) return res.status(400).json({ error: 'meses es requerido' });
    const data = await regalarMeses(supabaseServicio, req.params.id, meses);
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'regalar_meses', detalle: { suscripcionId: req.params.id, meses } });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cancelar es definitivo (a diferencia de suspender, que es reversible) —
// requiere confirmación explícita del lado del frontend antes de llamar aquí.
app.post('/api/admin/suscripciones/:id/cancelar', requireAdmin, async (req, res) => {
  try {
    const data = await cancelarSuscripcion(supabaseServicio, req.params.id);
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'cancelar_suscripcion', organizationId: data.organization_id, detalle: { suscripcionId: req.params.id } });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/suscripciones/:id/descuento', requireAdmin, async (req, res) => {
  try {
    const descuentoPct = Number(req.body?.descuentoPct);
    if (Number.isNaN(descuentoPct)) return res.status(400).json({ error: 'descuentoPct es requerido' });
    const data = await aplicarDescuento(supabaseServicio, req.params.id, descuentoPct);
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'aplicar_descuento', detalle: { suscripcionId: req.params.id, descuentoPct } });
    res.json(data);
  } catch (e) {
    res.status(e.message?.includes('entre 0 y 100') ? 400 : 500).json({ error: e.message });
  }
});

// Método de pago — sin gateway real todavía: guarda lo que se le mande tal
// cual (mismo criterio "manual" que las suscripciones). El botón
// "Actualizar método de pago" del Panel Maestro pega aquí.
app.patch('/api/admin/organizaciones/:id/metodo-pago', requireAdmin, async (req, res) => {
  try {
    const { proveedor, token, ultimos4, marca, fechaExpiracion } = req.body || {};
    if (!proveedor || !token) return res.status(400).json({ error: 'proveedor y token son requeridos' });

    const metodo = await registrarMetodoPago(supabaseServicio, { organizationId: req.params.id, proveedor, token, ultimos4, marca, fechaExpiracion });
    await registrarEventoAdmin(supabaseServicio, { adminId: req.admin.id, accion: 'actualizar_metodo_pago', organizationId: req.params.id });
    res.json(metodo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/organizaciones/:id/metodo-pago', requireAdmin, async (req, res) => {
  try {
    res.json(await obtenerMetodoPagoVigente(supabaseServicio, req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/organizaciones/:id/pagos', requireAdmin, async (req, res) => {
  try {
    res.json(await listarPagos(supabaseServicio, req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Centro de Cobro: plan/vencimiento/ingreso/costo de IA/margen, por organización.
app.get('/api/admin/centro-cobro', requireAdmin, async (req, res) => {
  try {
    const hasta = req.query.hasta || new Date().toISOString();
    const desde = req.query.desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    res.json(await resumenPorOrganizacion(supabaseServicio, { desde, hasta }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/analitica', requireAdmin, async (req, res) => {
  try {
    res.json(await dashboardGlobal(supabaseServicio, req.query));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    res.json(await listarEventosAdmin(supabaseServicio, { organizationId: req.query.organizationId }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PLATAFORMA COMERCIAL — Billing de tenant (Onboarding / Portal del Cliente) ─
// Sesión normal de tenant (requireAuth), no de Super Admin.

app.post('/api/billing/checkout-session', requireAuth, soloGerencial, async (req, res) => {
  try {
    const { data: company } = await req.supabase.from('companies').select('organization_id').eq('id', req.usuario.company_id).maybeSingle();
    const planes = await listarPlanes(supabaseServicio, { soloActivos: true });
    const plan = planes.find(p => p.id === req.body?.planId);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const session = await crearCheckoutSession(stripe, {
      organizationId: company.organization_id, plan,
      urlExito: req.body?.urlExito, urlCancelacion: req.body?.urlCancelacion,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/billing/portal-session', requireAuth, soloGerencial, async (req, res) => {
  try {
    const { data: company } = await req.supabase.from('companies').select('organization_id').eq('id', req.usuario.company_id).maybeSingle();
    const suscripcion = await obtenerSuscripcionVigente(supabaseServicio, company.organization_id);
    if (!suscripcion?.proveedor_customer_id) return res.status(400).json({ error: 'Esta empresa no tiene un cliente de Stripe todavía' });

    const session = await crearPortalSession(stripe, { stripeCustomerId: suscripcion.proveedor_customer_id, urlRetorno: req.body?.urlRetorno });
    res.json({ url: session.url });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Portal del Cliente — "Suscripción y Facturación" (Configuración): la
// propia empresa viendo su propio plan/factura/método de pago. Todas
// resuelven organization_id desde companies.organization_id del usuario en
// sesión, mismo patrón que checkout-session/portal-session arriba.
async function _organizationIdDeUsuario(req) {
  const { data: company } = await req.supabase.from('companies').select('organization_id').eq('id', req.usuario.company_id).maybeSingle();
  return company?.organization_id || null;
}

app.get('/api/billing/suscripcion', requireAuth, soloGerencial, async (req, res) => {
  try {
    const organizationId = await _organizationIdDeUsuario(req);
    res.json(await obtenerSuscripcionVigente(supabaseServicio, organizationId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/billing/metodo-pago', requireAuth, soloGerencial, async (req, res) => {
  try {
    const organizationId = await _organizationIdDeUsuario(req);
    res.json(await obtenerMetodoPagoVigente(supabaseServicio, organizationId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/billing/metodo-pago', requireAuth, soloGerencial, async (req, res) => {
  try {
    const organizationId = await _organizationIdDeUsuario(req);
    const { proveedor, token, ultimos4, marca, fechaExpiracion } = req.body || {};
    if (!proveedor || !token) return res.status(400).json({ error: 'proveedor y token son requeridos' });
    res.json(await registrarMetodoPago(supabaseServicio, { organizationId, proveedor, token, ultimos4, marca, fechaExpiracion }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/billing/pagos', requireAuth, soloGerencial, async (req, res) => {
  try {
    const organizationId = await _organizationIdDeUsuario(req);
    res.json(await listarPagos(supabaseServicio, organizationId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Placeholder honesto: sin proveedor de pagos conectado no existe ningún
// pago real que reintentar — nunca simula un éxito falso.
app.post('/api/billing/reintentar-pago', requireAuth, soloGerencial, async (req, res) => {
  res.status(501).json({ error: 'Disponible cuando se conecte un proveedor de pagos' });
});

// Webhook de Stripe: SIN cookie/sesión — autenticado por firma. Reusa
// req.rawBody, ya capturado globalmente para la firma de Meta (línea ~92).
app.post('/api/webhooks/stripe', async (req, res) => {
  if (!stripe) return res.status(501).json({ error: 'Stripe no está configurado todavía' });
  try {
    const firma = req.headers['stripe-signature'];
    const evento = stripe.webhooks.constructEvent(req.rawBody, firma, process.env.STRIPE_WEBHOOK_SECRET);
    await manejarWebhookStripe(supabaseServicio, evento);
    res.json({ received: true });
  } catch (e) {
    console.error('❌ Webhook de Stripe rechazado:', e.message);
    res.status(400).json({ error: `Webhook error: ${e.message}` });
  }
});

// ── STATUS ────────────────────────────────────────────────────────────────────
// Antes vivía en '/' — interceptaba la raíz del dominio antes de que
// express.static/el catch-all pudieran servir el frontend (tara-os.com
// mostraba este JSON en vez del login). Se movió a /api/status; la raíz
// ahora cae al SPA como cualquier otra ruta.

app.get('/api/status', (req, res) => res.json({
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
