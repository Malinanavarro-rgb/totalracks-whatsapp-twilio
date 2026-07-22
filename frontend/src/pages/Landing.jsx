import { Link } from 'react-router-dom';
import LogoTara from '../components/LogoTara';

// Panel de entrada público — lo primero que ve un prospecto al llegar a
// tara-os.com, antes de cualquier login. Los 6 diferenciadores vienen
// tal cual de docs/constitution/diferenciadores-producto-v1.md
// (TARA-CONST-002) — no es copy de marketing genérico, es la Constitución
// del producto convertida en pantalla.
const DIFERENCIADORES = [
  { titulo: 'TARA piensa, no solo responde', texto: 'Detecta oportunidades y riesgos en tu negocio sin que se lo pidas.' },
  { titulo: 'Un solo cerebro empresarial', texto: 'CRM, agenda, ventas y conversaciones — todo conectado, nunca duplicado.' },
  { titulo: 'Memoria empresarial permanente', texto: 'Entre más tiempo la usas, mejor conoce tu negocio.' },
  { titulo: 'Explica el porqué', texto: 'Nunca una recomendación sin la evidencia detrás.' },
  { titulo: 'Obsesión por la simplicidad', texto: 'Lo que importa hoy, en diez segundos.' },
  { titulo: 'Aprende de tu negocio', texto: 'Detecta patrones reales y los convierte en ventaja competitiva.' },
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <nav className="landing-nav">
          <div className="landing-marca">
            <LogoTara size={32} />
            <span>TARA</span>
          </div>
          <Link to="/login" className="landing-nav-login">Iniciar sesión</Link>
        </nav>

        <div className="landing-hero-contenido">
          <h1>TARA no es un chatbot.<br />Es el sistema operativo de tu empresa.</h1>
          <p className="landing-hero-subtitulo">
            Un solo cerebro que conecta WhatsApp, tu CRM, tu agenda y la memoria de tu negocio —
            para que cada conversación te haga ganar tiempo, no perderlo.
          </p>
          <div className="landing-hero-acciones">
            <Link to="/registro" className="landing-boton landing-boton--primario">Crear mi cuenta</Link>
            <Link to="/login" className="landing-boton landing-boton--secundario">Ya tengo cuenta</Link>
          </div>
        </div>
      </header>

      <main className="landing-diferenciadores">
        <h2>Seis cosas que ningún otro sistema hace</h2>
        <div className="landing-grid">
          {DIFERENCIADORES.map((d) => (
            <div key={d.titulo} className="landing-tarjeta">
              <h3>{d.titulo}</h3>
              <p>{d.texto}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} TARA Matrix™</span>
        <div className="landing-footer-links">
          <a href="/privacidad">Privacidad</a>
          <a href="/terminos">Términos</a>
        </div>
      </footer>
    </div>
  );
}
