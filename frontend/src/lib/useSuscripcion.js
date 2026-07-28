import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from '../context/AuthContext';

// Debe calzar EXACTO con soloGerencial() de server.js (owner/administrador,
// sin supervisor) — es el mismo criterio que ya usa Configuracion.jsx para
// decidir si mostrar el tab de Suscripción, para no pedir un endpoint que
// va a responder 403.
const ROLES_CON_ACCESO_A_BILLING = ['owner', 'administrador'];

/**
 * Fuente única de la suscripción de la empresa activa, para el banner del
 * dashboard y el indicador del sidebar — cada uno decide cómo presentarla
 * (ver lib/suscripcion-helpers.js::resumenSuscripcion).
 */
export function useSuscripcion() {
  const { sesion } = useAuth();
  const tieneAcceso = ROLES_CON_ACCESO_A_BILLING.includes(sesion?.empresaActiva?.rol);
  const [suscripcion, setSuscripcion] = useState(null);
  const [cargando, setCargando] = useState(tieneAcceso);

  useEffect(() => {
    if (!tieneAcceso) { setCargando(false); return; }
    let activo = true;
    setCargando(true);
    api.suscripcionBilling()
      .then((s) => { if (activo) setSuscripcion(s); })
      .catch(() => { if (activo) setSuscripcion(null); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [tieneAcceso]);

  return { suscripcion, cargando, tieneAcceso };
}
