// TARA Matrix™ — cliente de API
// Envoltura delgada sobre fetch. Sin lógica de negocio: solo llama al
// backend y devuelve JSON. La sesión viaja en una cookie httpOnly que el
// navegador maneja solo — este archivo nunca lee ni guarda el token.

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
    ...opciones,
  });

  const cuerpo = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = new Error(cuerpo.error || `Error ${respuesta.status}`);
    error.status = respuesta.status;
    throw error;
  }

  return cuerpo;
}

export const api = {
  login: (email, password) =>
    pedir('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  yo: () => pedir('/api/auth/me'),

  logout: () => pedir('/api/auth/logout', { method: 'POST' }),

  cambiarEmpresa: (company_id) => pedir('/api/auth/cambiar-empresa', { method: 'POST', body: JSON.stringify({ company_id }) }),

  registro: (datos) => pedir('/api/auth/registro', { method: 'POST', body: JSON.stringify(datos) }),

  recuperarPassword: (email) => pedir('/api/auth/recuperar-password', { method: 'POST', body: JSON.stringify({ email }) }),
  restablecerPassword: (accessToken, password) =>
    pedir('/api/auth/restablecer-password', { method: 'POST', body: JSON.stringify({ accessToken, password }) }),

  // Panel Maestro — "entrar como administrador": el botón para SALIR vive
  // en el panel de tenant (Shell.jsx muestra el banner mientras dura),
  // aunque la ruta sea de administración — la cookie es la que autoriza,
  // no qué módulo del frontend hizo el fetch.
  salirImpersonacion: () => pedir('/api/admin/impersonar/salir', { method: 'POST' }),

  dashboard: () => pedir('/api/dashboard'),

  conversaciones:          () => pedir('/api/conversaciones'),
  historialConversacion:   (clienteId) => pedir(`/api/conversaciones/${clienteId}`),
  tomarConversacion:       (clienteId) => pedir(`/api/conversaciones/${clienteId}/tomar`, { method: 'POST' }),
  regresarATara:           (clienteId) => pedir(`/api/conversaciones/${clienteId}/regresar`, { method: 'POST' }),
  enviarMensaje:           (clienteId, texto) =>
    pedir(`/api/conversaciones/${clienteId}/mensajes`, { method: 'POST', body: JSON.stringify({ texto }) }),

  // Inbox Inteligente (v0.4) — convive con /api/conversaciones de arriba.
  hilosInbox: (filtros = {}) => {
    const params = new URLSearchParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)));
    const qs = params.toString();
    return pedir(`/api/inbox/hilos${qs ? `?${qs}` : ''}`);
  },
  hiloInbox: (hiloId) => pedir(`/api/inbox/hilos/${hiloId}`),
  mensajesDeHilo: (hiloId) => pedir(`/api/inbox/hilos/${hiloId}/mensajes`),
  actualizarHilo: (hiloId, cambios) => pedir(`/api/inbox/hilos/${hiloId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),
  analisisDeHilo: (hiloId) => pedir(`/api/inbox/hilos/${hiloId}/analisis`),
  analizarHiloAhora: (hiloId) => pedir(`/api/inbox/hilos/${hiloId}/analisis`, { method: 'POST' }),
  // No es un pedir() — se usa directo como src/href de <img>/<audio>/<video>/<a>.
  // El navegador sigue el 302 a la URL firmada y manda la cookie de sesión sola (mismo origen).
  urlAdjunto: (mensajeId) => `/api/inbox/mensajes/${mensajeId}/adjunto`,

  asesores:      () => pedir('/api/agenda/asesores'),
  citas:         (desde, hasta) => pedir(`/api/agenda/citas?desde=${desde}&hasta=${hasta}`),
  citaDetalle:   (citaId) => pedir(`/api/agenda/citas/${citaId}`),
  crearClienteManual: (datos) => pedir('/api/agenda/clientes', { method: 'POST', body: JSON.stringify(datos) }),
  crearCita:     (datos) => pedir('/api/agenda/citas', { method: 'POST', body: JSON.stringify(datos) }),
  reagendarCita: (citaId, inicio, fin) =>
    pedir(`/api/agenda/citas/${citaId}`, { method: 'PATCH', body: JSON.stringify({ inicio, fin }) }),
  cancelarCita:  (citaId) => pedir(`/api/agenda/citas/${citaId}/cancelar`, { method: 'POST' }),
  marcarNoShow:  (citaId) => pedir(`/api/agenda/citas/${citaId}/no-show`, { method: 'POST' }),

  // Motor de Agenda Universal (Fase 1) — agendaConfig() devuelve null si la
  // empresa no tiene experiencia configurada (Agenda.jsx usa eso para
  // decidir entre la vista clásica y AgendaViva).
  agendaConfig:          () => pedir('/api/agenda/config'),
  actualizarAgendaConfig: (config) => pedir('/api/agenda/config', { method: 'PATCH', body: JSON.stringify(config) }),
  estadoDelDiaAgenda:    (fecha) => pedir(`/api/agenda/estado-del-dia${fecha ? `?fecha=${fecha}` : ''}`),
  resolverEventoAgenda:  (eventoId, datos) => pedir(`/api/agenda/eventos/${eventoId}/resolver`, { method: 'POST', body: JSON.stringify(datos) }),

  // ⌘K con lenguaje natural — interpretar nunca ejecuta, solo /confirmar lo hace.
  enviarComandoAgenda:    (texto) => pedir('/api/agenda/comando', { method: 'POST', body: JSON.stringify({ texto }) }),
  confirmarComandoAgenda: (comandoId) => pedir(`/api/agenda/comando/${comandoId}/confirmar`, { method: 'POST' }),
  cancelarComandoAgenda:  (comandoId) => pedir(`/api/agenda/comando/${comandoId}/cancelar`, { method: 'POST' }),

  clientesCrm:        (filtros = {}) => {
    const params = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== '' && v != null));
    const qs = params.toString();
    return pedir(`/api/crm/clientes${qs ? `?${qs}` : ''}`);
  },
  fichaCliente:       (clienteId) => pedir(`/api/crm/clientes/${clienteId}`),
  actualizarCliente:  (clienteId, cambios) =>
    pedir(`/api/crm/clientes/${clienteId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),
  eliminarClienteCrm: (clienteId) => pedir(`/api/crm/clientes/${clienteId}`, { method: 'DELETE' }),
  // Borrado completo (cliente + todo su historial) — solo empresas demo.
  eliminarClienteCompleto: (clienteId) => pedir(`/api/crm/clientes/${clienteId}/completo`, { method: 'DELETE' }),
  seguimientos:       (clienteId) => pedir(`/api/crm/clientes/${clienteId}/seguimientos`),
  preguntarSobreCliente: (clienteId, pregunta) =>
    pedir(`/api/crm/clientes/${clienteId}/preguntar`, { method: 'POST', body: JSON.stringify({ pregunta }) }),
  // No es un pedir(): mismo criterio que subirDocumentoProveedor — FormData
  // necesita que el navegador ponga su propio Content-Type con boundary.
  subirReciboCFE: async (clienteId, archivo) => {
    const formData = new FormData();
    formData.append('archivo', archivo);
    const respuesta = await fetch(`/api/crm/clientes/${clienteId}/recibo-cfe`, { method: 'POST', credentials: 'include', body: formData });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      const error = new Error(cuerpo.error || `Error ${respuesta.status}`);
      error.status = respuesta.status;
      throw error;
    }
    return cuerpo;
  },
  preguntarOperador: (pregunta) =>
    pedir('/api/operador/preguntar', { method: 'POST', body: JSON.stringify({ pregunta }) }),
  convertirParaCliente: (texto) =>
    pedir('/api/operador/convertir-para-cliente', { method: 'POST', body: JSON.stringify({ texto }) }),
  ayudameACerrar: (oportunidadId) =>
    pedir(`/api/crm/oportunidades/${oportunidadId}/ayudame-a-cerrar`, { method: 'POST' }),

  // Centro de Conocimiento, Fase 5 — aprendizaje del equipo
  crearSolicitudConocimiento: (datos) => pedir('/api/knowledge-requests', { method: 'POST', body: JSON.stringify(datos) }),
  solicitudesConocimiento: (estado) => pedir(`/api/knowledge-requests${estado ? `?estado=${estado}` : ''}`),
  responderSolicitudConocimiento: (id, respuesta_validada) =>
    pedir(`/api/knowledge-requests/${id}/responder`, { method: 'PATCH', body: JSON.stringify({ respuesta_validada }) }),
  rechazarSolicitudConocimiento: (id, razon) =>
    pedir(`/api/knowledge-requests/${id}/rechazar`, { method: 'PATCH', body: JSON.stringify({ razon }) }),

  // Especialista Solar, Fase 6 — documentos de proveedor (fichas técnicas)
  documentosProveedor: (filtros = {}) => {
    const params = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== '' && v != null));
    const qs = params.toString();
    return pedir(`/api/documentos-proveedor${qs ? `?${qs}` : ''}`);
  },
  // No es un pedir(): FormData necesita que el navegador ponga su propio
  // Content-Type con el boundary del multipart — nunca forzar JSON aquí.
  subirDocumentoProveedor: async (archivo, { proveedor, tipo_documento } = {}) => {
    const formData = new FormData();
    formData.append('archivo', archivo);
    if (proveedor) formData.append('proveedor', proveedor);
    if (tipo_documento) formData.append('tipo_documento', tipo_documento);
    const respuesta = await fetch('/api/documentos-proveedor', { method: 'POST', credentials: 'include', body: formData });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      const error = new Error(cuerpo.error || `Error ${respuesta.status}`);
      error.status = respuesta.status;
      throw error;
    }
    return cuerpo;
  },
  procesarDocumentoProveedor: (id) => pedir(`/api/documentos-proveedor/${id}/procesar`, { method: 'POST' }),
  confirmarDocumentoProveedor: (id, datos) => pedir(`/api/documentos-proveedor/${id}/confirmar`, { method: 'POST', body: JSON.stringify(datos) }),
  urlArchivoDocumentoProveedor: (id) => `/api/documentos-proveedor/${id}/archivo`,

  // Panel de Acción Inteligente (Business Memory Core + KCE)
  resumenBmc:            () => pedir('/api/bmc/resumen'),
  aprendizajesPendientes: () => pedir('/api/bmc/aprendizajes?estado=propuesto'),
  aprendizajesConfirmados: () => pedir('/api/bmc/aprendizajes?estado=confirmado'),
  confirmarAprendizajeBmc: (id) => pedir(`/api/bmc/aprendizajes/${id}/confirmar`, { method: 'POST' }),
  rechazarAprendizajeBmc:  (id, razon) => pedir(`/api/bmc/aprendizajes/${id}/rechazar`, { method: 'POST', body: JSON.stringify({ razon }) }),
  marcarObsoletoBmc:       (id, razon) => pedir(`/api/bmc/aprendizajes/${id}/marcar-obsoleto`, { method: 'POST', body: JSON.stringify({ razon }) }),

  alertasKce:      () => pedir('/api/kce/alertas'),
  ejecutarKce:     () => pedir('/api/kce/ejecutar', { method: 'POST' }),
  aplicarRefuerzoKce: (alertaId) => pedir(`/api/kce/alertas/${alertaId}/aplicar-refuerzo`, { method: 'POST' }),
  fusionarAprendizajesKce: (alertaId, datos) => pedir(`/api/kce/alertas/${alertaId}/fusionar`, { method: 'POST', body: JSON.stringify(datos) }),
  resolverAlertaKce: (alertaId, accion_tomada, razon) =>
    pedir(`/api/kce/alertas/${alertaId}/resolver`, { method: 'POST', body: JSON.stringify({ accion_tomada, razon }) }),
  crearSeguimiento:   (clienteId, datos) =>
    pedir(`/api/crm/clientes/${clienteId}/seguimientos`, { method: 'POST', body: JSON.stringify(datos) }),
  actualizarSeguimiento: (seguimientoId, cambios) =>
    pedir(`/api/crm/seguimientos/${seguimientoId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),
  crearOportunidad:   (clienteId, datos) =>
    pedir(`/api/crm/clientes/${clienteId}/oportunidades`, { method: 'POST', body: JSON.stringify(datos) }),
  actualizarOportunidad: (oportunidadId, cambios) =>
    pedir(`/api/crm/oportunidades/${oportunidadId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),
  eliminarOportunidad: (oportunidadId) => pedir(`/api/crm/oportunidades/${oportunidadId}`, { method: 'DELETE' }),
  oportunidades:      () => pedir('/api/crm/oportunidades'),

  // Panel de Cotizaciones (Fase Panel de Cotizaciones)
  cotizaciones:        (clienteId) => pedir(`/api/cotizaciones${clienteId ? `?clienteId=${clienteId}` : ''}`),
  cotizacion:          (id) => pedir(`/api/cotizaciones/${id}`),
  reenviarCotizacion:  (id) => pedir(`/api/cotizaciones/${id}/enviar`, { method: 'POST' }),
  // No es un pedir() — mismo criterio que urlAdjunto(): el navegador sigue
  // el redirect a la URL firmada directo, sin pasar por fetch/JSON.
  urlPdfCotizacion:    (id) => `/api/cotizaciones/${id}/pdf`,

  // Creación manual (Alina, 2026-09-15) — el asesor arma la cotización con
  // clics en vez de esperar al workflow de WhatsApp.
  crearCotizacion:         (datos) => pedir('/api/cotizaciones', { method: 'POST', body: JSON.stringify(datos) }),
  calcularCotizacion:      (id, datos) => pedir(`/api/cotizaciones/${id}/calcular`, { method: 'POST', body: JSON.stringify(datos) }),
  revisarPredimensionamiento: (id) => pedir(`/api/cotizaciones/${id}/revisar-predimensionamiento`, { method: 'POST' }),
  validarIngenieria:       (id) => pedir(`/api/cotizaciones/${id}/validar-ingenieria`, { method: 'POST' }),
  puedeEnviarCotizacion:   (id) => pedir(`/api/cotizaciones/${id}/puede-enviar`),
  propuestasCotizacion:    (id) => pedir(`/api/cotizaciones/${id}/propuestas`),
  autorizarPrecioCotizacion: (id, precioFinal) => pedir(`/api/cotizaciones/${id}/autorizar-precio`, { method: 'POST', body: JSON.stringify({ precioFinal }) }),
  lineasCotizacion:        (id) => pedir(`/api/cotizaciones/${id}/lineas`),
  agregarLineaCotizacion:  (id, datos) => pedir(`/api/cotizaciones/${id}/lineas`, { method: 'POST', body: JSON.stringify(datos) }),
  actualizarLineaCotizacion: (lineaId, cambios) => pedir(`/api/cotizaciones/lineas/${lineaId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),
  eliminarLineaCotizacion: (lineaId) => pedir(`/api/cotizaciones/lineas/${lineaId}`, { method: 'DELETE' }),
  aplicarCalculoALineasCotizacion: (id) => pedir(`/api/cotizaciones/${id}/lineas/aplicar-calculo`, { method: 'POST' }),
  generarPdfCotizacionManual: (id) => pedir(`/api/cotizaciones/${id}/generar-pdf`, { method: 'POST' }),

  // Catálogo de productos por tipo (panel_solar/inversor/microinversor/...)
  productosPorTipo:    (tipo) => pedir(`/api/productos?tipo=${encodeURIComponent(tipo)}`),
  paquetesSolares:     () => pedir('/api/paquetes-solares?activos=true'),

  // Portafolio de Servicios → Paquetes y sus cotizaciones relacionadas
  paquetesConCotizaciones: () => pedir('/api/paquetes-solares/con-cotizaciones'),

  // Configuración de empresa (Fase 6)
  personalidad:            () => pedir('/api/config/personalidad'),
  actualizarPersonalidad:  (cambios) => pedir('/api/config/personalidad', { method: 'PATCH', body: JSON.stringify(cambios) }),

  knowledgeBase:           () => pedir('/api/config/knowledge-base'),
  crearKnowledgeBase:      (datos) => pedir('/api/config/knowledge-base', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarKnowledgeBase: (id, datos) => pedir(`/api/config/knowledge-base/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarKnowledgeBase:   (id) => pedir(`/api/config/knowledge-base/${id}`, { method: 'DELETE' }),

  marcarOnboardingCompletado: () => pedir('/api/config/onboarding-completado', { method: 'POST' }),

  horariosConfig:          () => pedir('/api/config/horarios'),
  crearHorarioConfig:      (datos) => pedir('/api/config/horarios', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarHorarioConfig: (id, datos) => pedir(`/api/config/horarios/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarHorarioConfig:   (id) => pedir(`/api/config/horarios/${id}`, { method: 'DELETE' }),

  horarioAtencion:         () => pedir('/api/config/horario-atencion'),
  guardarHorarioAtencion:  (datos) => pedir('/api/config/horario-atencion', { method: 'POST', body: JSON.stringify(datos) }),
  eliminarHorarioAtencion: (id) => pedir(`/api/config/horario-atencion/${id}`, { method: 'DELETE' }),

  serviciosConfig:         () => pedir('/api/config/servicios'),
  crearServicioConfig:     (datos) => pedir('/api/config/servicios', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarServicioConfig: (id, datos) => pedir(`/api/config/servicios/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarServicioConfig:  (id) => pedir(`/api/config/servicios/${id}`, { method: 'DELETE' }),

  asesoresConfig:          () => pedir('/api/config/asesores'),
  crearAsesorConfig:       (datos) => pedir('/api/config/asesores', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarAsesorConfig:  (id, datos) => pedir(`/api/config/asesores/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarAsesorConfig:    (id) => pedir(`/api/config/asesores/${id}`, { method: 'DELETE' }),

  pipelineEtapas:          () => pedir('/api/config/pipeline-etapas'),
  crearPipelineEtapa:      (datos) => pedir('/api/config/pipeline-etapas', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarPipelineEtapa: (id, datos) => pedir(`/api/config/pipeline-etapas/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarPipelineEtapa:   (id) => pedir(`/api/config/pipeline-etapas/${id}`, { method: 'DELETE' }),

  workflows:               () => pedir('/api/config/workflows'),
  crearWorkflow:           (datos) => pedir('/api/config/workflows', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarWorkflow:      (id, datos) => pedir(`/api/config/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarWorkflow:        (id) => pedir(`/api/config/workflows/${id}`, { method: 'DELETE' }),
  nodosWorkflow:           (workflowId) => pedir(`/api/config/workflows/${workflowId}/nodos`),
  crearNodo:               (workflowId, datos) => pedir(`/api/config/workflows/${workflowId}/nodos`, { method: 'POST', body: JSON.stringify(datos) }),
  actualizarNodo:          (id, datos) => pedir(`/api/config/nodos/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarNodo:            (id) => pedir(`/api/config/nodos/${id}`, { method: 'DELETE' }),

  canalesConfig:           () => pedir('/api/config/canales'),
  conectarWhatsAppMeta:    (datos) => pedir('/api/config/canales/whatsapp-meta', { method: 'POST', body: JSON.stringify(datos) }),
  conectarWhatsAppMetaEmbeddedSignup: (datos) => pedir('/api/config/canales/whatsapp-meta/embedded-signup', { method: 'POST', body: JSON.stringify(datos) }),

  usuariosConfig:          () => pedir('/api/config/usuarios'),
  invitarUsuario:          (datos) => pedir('/api/config/usuarios/invitar', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarMiembro:       (usuarioId, cambios) => pedir(`/api/config/usuarios/${usuarioId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),

  // Aceptar invitación (público, sin sesión)
  obtenerInvitacion:       (token) => pedir(`/api/invitaciones/${token}`),
  aceptarInvitacion:       (token, password) =>
    pedir(`/api/invitaciones/${token}/aceptar`, { method: 'POST', body: JSON.stringify({ password }) }),

  // Portal del Cliente — Suscripción y Facturación (Configuración)
  suscripcionBilling:      () => pedir('/api/billing/suscripcion'),
  metodoPagoBilling:       () => pedir('/api/billing/metodo-pago'),
  actualizarMetodoPagoBilling: (datos) => pedir('/api/billing/metodo-pago', { method: 'PATCH', body: JSON.stringify(datos) }),
  pagosBilling:            () => pedir('/api/billing/pagos'),
  checkoutSession:         (datos) => pedir('/api/billing/checkout-session', { method: 'POST', body: JSON.stringify(datos) }),
  portalSession:           (datos) => pedir('/api/billing/portal-session', { method: 'POST', body: JSON.stringify(datos) }),
  reintentarPago:          () => pedir('/api/billing/reintentar-pago', { method: 'POST' }),
};
