// Rediseño de panel — banner de suscripción (Operaciones) + indicador
// compacto (Shell). Misma fuente de datos (api.suscripcionBilling()) que
// ya usaba SuscripcionTab — solo se resume aquí para presentarlo en 2
// lugares sin duplicar la lógica de "qué tan urgente es esto".

export function diasRestantes(fechaISO) {
  if (!fechaISO) return null;
  const ms = new Date(fechaISO).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

/**
 * @param {object|null} suscripcion - respuesta cruda de api.suscripcionBilling()
 * @returns {{urgencia: 'baja'|'media'|'alta', titulo: string, mensaje: string, cta: string}|null}
 *   null si no hay suscripción todavía (caso raro — no se muestra nada).
 */
export function resumenSuscripcion(suscripcion) {
  if (!suscripcion) return null;

  const plan = suscripcion.planes?.nombre || 'tu plan actual';
  const estado = suscripcion.estado;

  if (estado === 'trial') {
    const dias = diasRestantes(suscripcion.fecha_prueba_fin);
    const urgente = dias != null && dias <= 7;
    return {
      urgencia: urgente ? 'alta' : 'media',
      titulo: dias != null ? `Prueba gratuita — ${dias} día${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}` : 'Periodo de prueba',
      mensaje: `Estás usando ${plan}. Mejora tu plan para no perder acceso cuando termine tu prueba.`,
      cta: 'Mejorar plan',
    };
  }

  if (estado === 'past_due') {
    return {
      urgencia: 'alta',
      titulo: 'Pago pendiente',
      mensaje: `Hay un problema con el cobro de ${plan}. Actualiza tu método de pago para evitar una interrupción.`,
      cta: 'Resolver pago',
    };
  }

  if (estado === 'suspended' || estado === 'expired' || estado === 'cancelled') {
    const titulos = { suspended: 'Cuenta suspendida', expired: 'Tu prueba venció', cancelled: 'Suscripción cancelada' };
    return {
      urgencia: 'alta',
      titulo: titulos[estado],
      mensaje: 'Activa un plan para seguir usando TARA-OS sin interrupciones.',
      cta: 'Activar plan',
    };
  }

  // 'active' — informativo, sin urgencia.
  return {
    urgencia: 'baja',
    titulo: `Plan ${plan}`,
    mensaje: 'Tu suscripción está activa.',
    cta: 'Ver detalles',
  };
}
