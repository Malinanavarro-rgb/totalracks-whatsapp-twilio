import { Link } from 'react-router-dom';
import { useSuscripcion } from '../lib/useSuscripcion';
import { resumenSuscripcion, diasRestantes } from '../lib/suscripcion-helpers';

// Indicador compacto de suscripción — vive en el sidebar (Shell.jsx), visible
// sin importar en qué sección esté el usuario. Solo el título corto (no el
// mensaje largo del banner) para no competir con la navegación.
export default function SuscripcionIndicador() {
  const { suscripcion, cargando, tieneAcceso } = useSuscripcion();
  if (!tieneAcceso || cargando) return null;

  const resumen = resumenSuscripcion(suscripcion);
  if (!resumen) return null;

  const esTrial = suscripcion?.estado === 'trial';
  const dias = esTrial ? diasRestantes(suscripcion.fecha_prueba_fin) : null;

  return (
    <Link to="/configuracion?tab=suscripcion" className={`suscripcion-indicador suscripcion-indicador--${resumen.urgencia}`}>
      <span className="suscripcion-indicador-punto" />
      <span className="suscripcion-indicador-texto">
        {esTrial && dias != null ? `Prueba: ${dias} día${dias === 1 ? '' : 's'}` : resumen.titulo}
      </span>
    </Link>
  );
}
