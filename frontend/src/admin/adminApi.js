// TARA Matrix™ — Panel Maestro: cliente de API para /api/admin/*
// Mismo criterio que frontend/src/lib/api.js (envoltura delgada sobre
// fetch, sesión en cookie httpOnly) — pero esta cookie es tara_admin_session,
// completamente separada de la sesión de tenant. Nunca se comparte código
// de fetch con lib/api.js a propósito: son dos superficies de autorización
// distintas.

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

export const adminApi = {
  login: (email, password) =>
    pedir('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  yo: () => pedir('/api/admin/auth/me'),
  logout: () => pedir('/api/admin/auth/logout', { method: 'POST' }),

  organizaciones: () => pedir('/api/admin/organizaciones'),
  organizacion: (id) => pedir(`/api/admin/organizaciones/${id}`),
  crearOrganizacion: (datos) => pedir('/api/admin/organizaciones', { method: 'POST', body: JSON.stringify(datos) }),
  suspenderOrganizacion: (id) => pedir(`/api/admin/organizaciones/${id}/suspender`, { method: 'POST' }),
  reactivarOrganizacion: (id) => pedir(`/api/admin/organizaciones/${id}/reactivar`, { method: 'POST' }),

  impersonar: (companyId, motivo) =>
    pedir(`/api/admin/companies/${companyId}/impersonar`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  salirImpersonacion: () => pedir('/api/admin/impersonar/salir', { method: 'POST' }),

  planes: () => pedir('/api/admin/planes'),
  crearPlan: (datos) => pedir('/api/admin/planes', { method: 'POST', body: JSON.stringify(datos) }),
  actualizarPlan: (id, cambios) => pedir(`/api/admin/planes/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) }),

  crearSuscripcion: (datos) => pedir('/api/admin/suscripciones', { method: 'POST', body: JSON.stringify(datos) }),
  cambiarPlanSuscripcion: (suscripcionId, planId) =>
    pedir(`/api/admin/suscripciones/${suscripcionId}/plan`, { method: 'PATCH', body: JSON.stringify({ planId }) }),
  extenderPrueba: (suscripcionId, dias) =>
    pedir(`/api/admin/suscripciones/${suscripcionId}/extender-prueba`, { method: 'PATCH', body: JSON.stringify({ dias }) }),
  regalarMeses: (suscripcionId, meses) =>
    pedir(`/api/admin/suscripciones/${suscripcionId}/regalar-meses`, { method: 'PATCH', body: JSON.stringify({ meses }) }),
  cancelarSuscripcion: (suscripcionId) =>
    pedir(`/api/admin/suscripciones/${suscripcionId}/cancelar`, { method: 'POST' }),
  aplicarDescuento: (suscripcionId, descuentoPct) =>
    pedir(`/api/admin/suscripciones/${suscripcionId}/descuento`, { method: 'PATCH', body: JSON.stringify({ descuentoPct }) }),

  metodoPago: (organizationId) => pedir(`/api/admin/organizaciones/${organizationId}/metodo-pago`),
  actualizarMetodoPago: (organizationId, datos) =>
    pedir(`/api/admin/organizaciones/${organizationId}/metodo-pago`, { method: 'PATCH', body: JSON.stringify(datos) }),
  pagos: (organizationId) => pedir(`/api/admin/organizaciones/${organizationId}/pagos`),

  preguntarOperador: (pregunta) =>
    pedir('/api/admin/operador/preguntar', { method: 'POST', body: JSON.stringify({ pregunta }) }),

  centroCobro: () => pedir('/api/admin/centro-cobro'),
  analitica: () => pedir('/api/admin/analitica'),
  auditLog: (organizationId) => pedir(`/api/admin/audit-log${organizationId ? `?organizationId=${organizationId}` : ''}`),
};
