import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import LogoTara from '../components/LogoTara';

function IconoCheck() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function IconoWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4h16v12H8l-4 4V4z" />
    </svg>
  );
}

// Portal de Cliente — wizard corto de primeros pasos, deliberadamente
// simple (una sola pantalla, no un flujo de varios pasos): confirma lo que
// la plantilla de industria ya sembró al registrarte (modules/plantillas-
// industria.js) e invita a conectar el primer canal — sin bloquear si
// todavía no quiere hacerlo.
export default function Onboarding() {
  const { sesion, rehidratar } = useAuth();
  const navigate = useNavigate();
  const [servicios, setServicios] = useState(null);
  const [terminando, setTerminando] = useState(false);

  useEffect(() => {
    api.serviciosConfig().then(setServicios).catch(() => setServicios([]));
  }, []);

  async function empezar() {
    setTerminando(true);
    try {
      await api.marcarOnboardingCompletado();
      await rehidratar();
      navigate('/operaciones');
    } finally {
      setTerminando(false);
    }
  }

  const empresa = sesion?.empresaActiva?.nombre || 'tu negocio';

  return (
    <div className="onboarding-premium">
      <div className="onboarding-premium-tarjeta">
        <div className="onboarding-premium-logo"><LogoTara size={48} /></div>
        <h1 className="onboarding-premium-titulo">¡Bienvenido a TARA-OS, {empresa}!</h1>
        <p className="onboarding-premium-subtitulo">Ya configuramos lo básico automáticamente — revísalo y en un minuto quedas listo.</p>

        <div className="onboarding-paso">
          <span className="onboarding-paso-icono"><IconoCheck /></span>
          <div className="onboarding-paso-cuerpo">
            <h2>Tu asistente ya está configurado</h2>
            <p>TARA ya tiene una personalidad lista para atender a tus clientes — puedes ajustarla cuando quieras en Configuración → Personalidad.</p>
          </div>
        </div>

        <div className="onboarding-paso">
          <span className="onboarding-paso-icono"><IconoCheck /></span>
          <div className="onboarding-paso-cuerpo">
            <h2>Servicios detectados</h2>
            {!servicios ? (
              <p>Cargando…</p>
            ) : servicios.length === 0 ? (
              <p>No detectamos servicios automáticamente — puedes agregarlos después en Configuración.</p>
            ) : (
              <>
                <p>Encontramos {servicios.length} servicio{servicios.length === 1 ? '' : 's'} para empezar:</p>
                <ul className="onboarding-servicios-lista">
                  {servicios.map(s => (
                    <li key={s.id} className="onboarding-servicio-pill">
                      {s.nombre}{s.precio ? ` — $${s.precio}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p style={{ marginTop: '0.5rem' }}>Puedes editarlos cuando quieras en Configuración → Servicios.</p>
          </div>
        </div>

        <div className="onboarding-paso">
          <span className="onboarding-paso-icono onboarding-paso-icono--pendiente"><IconoWhatsApp /></span>
          <div className="onboarding-paso-cuerpo">
            <h2>Conecta tu primer canal</h2>
            <p>Para que TARA empiece a atender por WhatsApp, conéctalo desde Configuración → Canales. No es obligatorio hacerlo ahora — puedes explorar el panel primero.</p>
          </div>
        </div>

        <div className="onboarding-premium-acciones">
          <button type="button" className="auth-premium-boton" onClick={empezar} disabled={terminando} style={{ maxWidth: '320px' }}>
            {terminando ? 'Un momento…' : 'Empezar a usar TARA-OS'}
          </button>
          <Link to="/configuracion" className="auth-premium-pie">Prefiero configurar todo primero</Link>
        </div>
      </div>
    </div>
  );
}
