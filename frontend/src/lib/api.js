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

  clientesCrm:        () => pedir('/api/crm/clientes'),
  fichaCliente:       (clienteId) => pedir(`/api/crm/clientes/${clienteId}`),
  actualizarCliente:  (clienteId, cambios) =>
    pedir(`/api/crm/clientes/${clienteId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),
  seguimientos:       (clienteId) => pedir(`/api/crm/clientes/${clienteId}/seguimientos`),
  crearSeguimiento:   (clienteId, datos) =>
    pedir(`/api/crm/clientes/${clienteId}/seguimientos`, { method: 'POST', body: JSON.stringify(datos) }),
  actualizarSeguimiento: (seguimientoId, cambios) =>
    pedir(`/api/crm/seguimientos/${seguimientoId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),

  // Configuración de empresa (Fase 6)
  personalidad:            () => pedir('/api/config/personalidad'),
  actualizarPersonalidad:  (cambios) => pedir('/api/config/personalidad', { method: 'PATCH', body: JSON.stringify(cambios) }),

  knowledgeBase:           () => pedir('/api/config/knowledge-base'),
  crearKnowledgeBase:      (datos) => pedir('/api/config/knowledge-base', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarKnowledgeBase: (id, datos) => pedir(`/api/config/knowledge-base/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
  eliminarKnowledgeBase:   (id) => pedir(`/api/config/knowledge-base/${id}`, { method: 'DELETE' }),

  horariosConfig:          () => pedir('/api/config/horarios'),
  crearHorarioConfig:      (datos) => pedir('/api/config/horarios', { method: 'POST', body: JSON.stringify(datos) }),
  eliminarHorarioConfig:   (id) => pedir(`/api/config/horarios/${id}`, { method: 'DELETE' }),

  horarioAtencion:         () => pedir('/api/config/horario-atencion'),
  guardarHorarioAtencion:  (datos) => pedir('/api/config/horario-atencion', { method: 'POST', body: JSON.stringify(datos) }),
  eliminarHorarioAtencion: (id) => pedir(`/api/config/horario-atencion/${id}`, { method: 'DELETE' }),

  serviciosConfig:         () => pedir('/api/config/servicios'),
  crearServicioConfig:     (datos) => pedir('/api/config/servicios', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarServicioConfig: (id, datos) => pedir(`/api/config/servicios/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),

  canalesConfig:           () => pedir('/api/config/canales'),

  usuariosConfig:          () => pedir('/api/config/usuarios'),
  invitarUsuario:          (datos) => pedir('/api/config/usuarios/invitar', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarMiembro:       (usuarioId, cambios) => pedir(`/api/config/usuarios/${usuarioId}`, { method: 'PATCH', body: JSON.stringify(cambios) }),

  // Aceptar invitación (público, sin sesión)
  obtenerInvitacion:       (token) => pedir(`/api/invitaciones/${token}`),
  aceptarInvitacion:       (token, password) =>
    pedir(`/api/invitaciones/${token}/aceptar`, { method: 'POST', body: JSON.stringify({ password }) }),
};
