import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

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
    <div className="login-pantalla">
      <div className="login-tarjeta" style={{ maxWidth: '460px' }}>
        <h1>¡Bienvenido a TARA, {empresa}!</h1>
        <p className="login-subtitulo">Ya configuramos lo básico automáticamente — revísalo y en un minuto quedas listo.</p>

        <h2 className="alertas-titulo alertas-titulo--secundario">Servicios detectados</h2>
        {!servicios ? (
          <p className="operaciones-nota">Cargando…</p>
        ) : servicios.length === 0 ? (
          <p className="operaciones-nota">No detectamos servicios automáticamente — puedes agregarlos después en Configuración.</p>
        ) : (
          <ul className="pregunta-tara-sugerencias" style={{ listStyle: 'none', padding: 0 }}>
            {servicios.map(s => (
              <li key={s.id} className="pregunta-tara-chip" style={{ cursor: 'default' }}>
                {s.nombre}{s.precio ? ` — $${s.precio}` : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="login-subtitulo">Puedes editarlos cuando quieras en Configuración → Servicios.</p>

        <h2 className="alertas-titulo alertas-titulo--secundario">Conecta tu primer canal</h2>
        <p className="login-subtitulo">
          Para que TARA empiece a atender por WhatsApp, conéctalo desde Configuración → Canales.
          No es obligatorio hacerlo ahora — puedes explorar el panel primero.
        </p>

        <button type="button" onClick={empezar} disabled={terminando} style={{ marginTop: '0.5rem' }}>
          {terminando ? 'Un momento…' : 'Empezar a usar TARA'}
        </button>

        <p className="login-subtitulo"><Link to="/configuracion">Prefiero configurar todo primero</Link></p>
      </div>
    </div>
  );
}
