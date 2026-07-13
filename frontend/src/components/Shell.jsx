import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { iniciales, colorDesdeTexto } from '../lib/avatar';

// Los 7 módulos de la Plataforma SaaS (docs/roadmap — FASE 5). Solo
// "Centro de Operaciones" está habilitado en Fase 1 — el resto se muestra
// para no rediseñar la navegación en cada fase futura.
const MODULOS = [
  { ruta: '/operaciones',   etiqueta: 'Centro de Operaciones', habilitado: true },
  { ruta: '/conversaciones', etiqueta: 'Conversaciones',        habilitado: true },
  { ruta: '/agenda',         etiqueta: 'Agenda TARA',           habilitado: true },
  { ruta: '/crm',            etiqueta: 'CRM',                   habilitado: true },
  { ruta: '/configuracion',  etiqueta: 'Configuración',         habilitado: true },
  { ruta: '/reportes',       etiqueta: 'Reportes',              habilitado: false },
];

export default function Shell() {
  const { sesion, cerrarSesion } = useAuth();

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-logo">TARA Matrix™</div>
        <nav>
          {MODULOS.map(m => (
            m.habilitado ? (
              <NavLink key={m.ruta} to={m.ruta} className="shell-nav-item">
                {m.etiqueta}
              </NavLink>
            ) : (
              <span key={m.ruta} className="shell-nav-item shell-nav-item--deshabilitado">
                {m.etiqueta} <small>próximamente</small>
              </span>
            )
          ))}
        </nav>
      </aside>

      <div className="shell-contenido">
        <header className="shell-header">
          <SelectorEmpresa empresaActiva={sesion?.empresaActiva} empresas={sesion?.empresas} />
          <div className="shell-usuario">
            {sesion?.usuario?.nombre || sesion?.usuario?.email}
            <button onClick={cerrarSesion}>Cerrar sesión</button>
          </div>
        </header>

        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Avatar({ nombre, logo_url }) {
  if (logo_url) {
    return <img className="avatar-empresa" src={logo_url} alt={nombre} />;
  }
  return (
    <span className="avatar-empresa avatar-empresa--iniciales" style={{ background: colorDesdeTexto(nombre) }}>
      {iniciales(nombre)}
    </span>
  );
}

// Selector de empresa activa (multi-empresa por usuario) — al elegir otra
// empresa, se recarga la página entera a una ruta neutral: todas las
// pantallas del panel resuelven su company_id server-side a partir de la
// cookie tara_company, así que un reload completo basta para que Dashboard/
// CRM/Conversaciones/Agenda/Configuración se actualicen solos, sin tocar
// código de esas páginas.
function SelectorEmpresa({ empresaActiva, empresas }) {
  const [abierto, setAbierto] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function alClicAfuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', alClicAfuera);
    return () => document.removeEventListener('mousedown', alClicAfuera);
  }, []);

  async function elegir(company_id) {
    if (company_id === empresaActiva?.company_id) return setAbierto(false);
    setCambiando(true);
    setError(null);
    try {
      await api.cambiarEmpresa(company_id);
      window.location.href = '/operaciones';
    } catch (e) {
      setError(e.message);
      setCambiando(false);
    }
  }

  if (!empresaActiva) return <div><strong>Empresa</strong></div>;

  return (
    <div className="selector-empresa" ref={ref}>
      <button
        className="selector-empresa-boton"
        onClick={() => setAbierto(!abierto)}
        disabled={cambiando}
      >
        <Avatar nombre={empresaActiva.nombre} logo_url={empresaActiva.logo_url} />
        <span className="selector-empresa-texto">
          <strong>{empresaActiva.nombre}</strong>
          <span className="shell-rol">{empresaActiva.rol}</span>
        </span>
        {empresas?.length > 1 && <span className="selector-empresa-chevron">▾</span>}
      </button>

      {abierto && empresas?.length > 1 && (
        <ul className="selector-empresa-menu">
          {empresas.map((e) => (
            <li key={e.company_id}>
              <button
                className={e.company_id === empresaActiva.company_id ? 'selector-empresa-item selector-empresa-item--activa' : 'selector-empresa-item'}
                onClick={() => elegir(e.company_id)}
              >
                <Avatar nombre={e.nombre} logo_url={e.logo_url} />
                <span className="selector-empresa-texto">
                  <strong>{e.nombre}</strong>
                  <span className="shell-rol">{e.rol}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
