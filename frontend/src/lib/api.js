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

  asesores:      () => pedir('/api/agenda/asesores'),
  citas:         (desde, hasta) => pedir(`/api/agenda/citas?desde=${desde}&hasta=${hasta}`),
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
  seguimientos:       (clienteId) => pedir(`/api/crm/clientes/${clienteId}/seguimientos`),
  preguntarSobreCliente: (clienteId, pregunta) =>
    pedir(`/api/crm/clientes/${clienteId}/preguntar`, { method: 'POST', body: JSON.stringify({ pregunta }) }),
  preguntarOperador: (pregunta) =>
    pedir('/api/operador/preguntar', { method: 'POST', body: JSON.stringify({ pregunta }) }),
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

  // Configuración de empresa (Fase 6)
  personalidad:            () => pedir('/api/config/personalidad'),
  actualizarPersonalidad:  (cambios) => pedir('/api/config/personalidad', { method: 'PATCH', body: JSON.stringify(cambios) }),

  knowledgeBase:           () => pedir('/api/config/knowledge-base'),
  crearKnowledgeBase:      (datos) => pedir('/api/config/knowledge-base', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarKnowledgeBase: (id, datos) => pedir(`/api/config/knowledge-base/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarKnowledgeBase:   (id) => pedir(`/api/config/knowledge-base/${id}`, { method: 'DELETE' }),

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
