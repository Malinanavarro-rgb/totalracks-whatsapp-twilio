import { Link } from 'react-router-dom';
import { useSuscripcion } from '../lib/useSuscripcion';
import { resumenSuscripcion } from '../lib/suscripcion-helpers';

// Banner de suscripción — Centro de Operaciones (rediseño de panel). Solo
// gerencial (owner/administrador, mismo criterio que /api/billing/* en
// server.js) ve esto; para el resto de roles no se pide ni se muestra
// nada. Estilo consistente con el resto del panel: sin sombras, tinte
// suave por urgencia con los mismos tokens semánticos ya usados en
// .alerta/.pill — nunca un color nuevo fuera de Brand Guidelines V1.0.
export default function SuscripcionBanner() {
  const { suscripcion, cargando, tieneAcceso } = useSuscripcion();
  if (!tieneAcceso || cargando) return null;

  const resumen = resumenSuscripcion(suscripcion);
  if (!resumen) return null;

  return (
    <Link to="/configuracion?tab=suscripcion" className={`suscripcion-banner suscripcion-banner--${resumen.urgencia}`}>
      <div className="suscripcion-banner-texto">
        <p className="suscripcion-banner-titulo">{resumen.titulo}</p>
        <p className="suscripcion-banner-mensaje">{resumen.mensaje}</p>
      </div>
      <span className="suscripcion-banner-cta">{resumen.cta} →</span>
    </Link>
  );
}
