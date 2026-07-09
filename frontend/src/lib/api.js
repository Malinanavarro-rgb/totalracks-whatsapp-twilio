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
};
