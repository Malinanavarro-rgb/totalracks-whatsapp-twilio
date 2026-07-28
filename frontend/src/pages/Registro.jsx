import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import LogoTara from '../components/LogoTara';

// Mismo copy canónico que Landing.jsx (docs/constitution/diferenciadores-
// producto-v1.md, TARA-CONST-002) — un subconjunto de 3, suficiente para
// un panel lateral sin competir con el formulario.
const DIFERENCIADORES = [
  { titulo: 'Un solo cerebro empresarial', texto: 'CRM, agenda, ventas y conversaciones — todo conectado, nunca duplicado.' },
  { titulo: 'TARA piensa, no solo responde', texto: 'Detecta oportunidades y riesgos en tu negocio sin que se lo pidas.' },
  { titulo: 'Memoria empresarial permanente', texto: 'Entre más tiempo la usas, mejor conoce tu negocio.' },
];

function IconoCheck() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--brand-teal)" strokeWidth="2.5">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

// Página pública — Portal de Cliente: registro de una empresa nueva sin
// que Alina intervenga (antes solo existía por invitación o script). El
// "giro" se detecta automáticamente a partir de la descripción del negocio
// (modules/plantillas-industria.js), igual que scripts/crear-empresa.js.
export default function Registro() {
  const navigate = useNavigate();
  const { rehidratar } = useAuth();

  const [form, setForm] = useState({
    nombreNegocio: '', descripcionNegocio: '', nombreUsuario: '', email: '', password: '',
  });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  function actualizar(campo, valor) {
    setForm(f => ({ ...f, [campo]: valor }));
  }

  async function manejarSubmit(e) {
    e.preventDefault();
    setError(null);

    if (form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    setEnviando(true);
    try {
      await api.registro(form);
      await rehidratar();
      navigate('/onboarding');
    } catch (e2) {
      setError(e2.message || 'No se pudo crear tu cuenta');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="auth-premium">
      <div className="auth-premium-marca">
        <div className="auth-premium-marca-logo">
          <LogoTara size={34} />
          <span>TARA-OS</span>
        </div>

        <h1 className="auth-premium-marca-titulo">TARA no es un chatbot.<br />Es el sistema operativo de tu empresa.</h1>

        <ul className="auth-premium-marca-lista">
          {DIFERENCIADORES.map(d => (
            <li key={d.titulo} className="auth-premium-marca-item">
              <span className="auth-premium-marca-check"><IconoCheck /></span>
              <div>
                <strong>{d.titulo}</strong>
                <p>{d.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="auth-premium-formulario">
        <form className="auth-premium-tarjeta" onSubmit={manejarSubmit}>
          <h1>Crea tu cuenta</h1>
          <p className="auth-premium-subtitulo">Sin invitaciones, sin llamadas — tu negocio queda listo en un minuto.</p>

          <div className="auth-premium-campo">
            <label htmlFor="nombreNegocio">Nombre de tu negocio</label>
            <input
              id="nombreNegocio" type="text" required
              value={form.nombreNegocio} onChange={(e) => actualizar('nombreNegocio', e.target.value)}
            />
          </div>

          <div className="auth-premium-campo">
            <label htmlFor="descripcionNegocio">Describe tu negocio brevemente</label>
            <input
              id="descripcionNegocio" type="text" placeholder="Ej. Salón de uñas y manicure en Monterrey"
              value={form.descripcionNegocio} onChange={(e) => actualizar('descripcionNegocio', e.target.value)}
            />
          </div>

          <div className="auth-premium-campo">
            <label htmlFor="nombreUsuario">Tu nombre</label>
            <input
              id="nombreUsuario" type="text"
              value={form.nombreUsuario} onChange={(e) => actualizar('nombreUsuario', e.target.value)}
            />
          </div>

          <div className="auth-premium-campo">
            <label htmlFor="email">Correo</label>
            <input
              id="email" type="email" required autoComplete="username"
              value={form.email} onChange={(e) => actualizar('email', e.target.value)}
            />
          </div>

          <div className="auth-premium-campo">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password" type="password" required minLength={8} autoComplete="new-password"
              value={form.password} onChange={(e) => actualizar('password', e.target.value)}
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="auth-premium-boton" disabled={enviando}>
            {enviando ? 'Creando tu cuenta…' : 'Crear cuenta'}
          </button>

          <p className="auth-premium-pie">¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
        </form>
      </div>
    </div>
  );
}
