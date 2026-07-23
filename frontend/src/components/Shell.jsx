import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { iniciales, colorDesdeTexto } from '../lib/avatar';
import LogoTara from './LogoTara';

// Íconos de línea, mismo trazo (stroke-width 1.6) para todo el menú —
// Brand Guidelines V1.0: el menú existe para navegar, no para llamar la
// atención, por eso son minimalistas y heredan color del texto del link.
const ICONOS = {
  inicio:        <path d="M4 11l8-7 8 7M6 10v10h12V10"/>,
  conversaciones: <path d="M4 4h16v12H8l-4 4V4z"/>,
  inbox:         <><path d="M4 4h16v16H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
  agenda:        <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
  ventas:        <><path d="M20 12l-8 8-9-9V4h7l10 8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></>,
  clientes:      <><circle cx="9" cy="8" r="3"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M16 8a3 3 0 100-6M17 14c3 0 5 2 5 6"/></>,
  catalogo:      <path d="M3 8l9-5 9 5-9 5-9-5zm0 0v8l9 5 9-5V8"/>,
  configuracion: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.2-1.6l2-1.5-2-3.4-2.3.9a7 7 0 00-2.7-1.6L13.4 2h-2.8l-.4 2.8a7 7 0 00-2.7 1.6l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .5 0 1.1.2 1.6l-2 1.5 2 3.4 2.3-.9c.8.7 1.7 1.3 2.7 1.6l.4 2.8h2.8l.4-2.8c1-.3 1.9-.9 2.7-1.6l2.3.9 2-3.4-2-1.5c.1-.5.2-1 .2-1.6z"/></>,
  panelAccion:   <><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z"/></>,
};

// Panel de Acción Inteligente (Business Memory Core + KCE) — información y
// acciones a nivel empresa, no personal. Mismo criterio de acceso que Modo
// Operador en el backend (esGerencial: owner/administrador/supervisor) —
// se replica aquí para no mostrar un link que el backend rechazaría con 403.
const ROLES_GERENCIALES = ['owner', 'administrador', 'supervisor'];

function Icono({ nombre }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
      {ICONOS[nombre]}
    </svg>
  );
}

// Los 7 módulos de la Plataforma SaaS (docs/roadmap — FASE 5). Solo
// "Centro de Operaciones" está habilitado en Fase 1 — el resto se muestra
// para no rediseñar la navegación en cada fase futura.
const MODULOS = [
  { ruta: '/operaciones',   etiqueta: 'Centro de Operaciones', icono: 'inicio',         habilitado: true },
  { ruta: '/conversaciones', etiqueta: 'Conversaciones',        icono: 'conversaciones', habilitado: true },
  { ruta: '/inbox',          etiqueta: 'Inbox',                 icono: 'inbox',          habilitado: true },
  { ruta: '/agenda',         etiqueta: 'Agenda TARA',           icono: 'agenda',         habilitado: true },
  { ruta: '/crm',            etiqueta: 'Ventas',                icono: 'ventas',         habilitado: true },
  { ruta: '/panel-accion',   etiqueta: 'Panel de Acción',       icono: 'panelAccion',    habilitado: true, soloGerencial: true },
  { ruta: '/configuracion',  etiqueta: 'Configuración',         icono: 'configuracion',  habilitado: true },
  { ruta: '/reportes',       etiqueta: 'Reportes',              icono: 'catalogo',       habilitado: false },
];

// Motor Universal para Empresas de Servicios: el menú por industria ya no
// vive en código — cada plantilla de industria (plantillas_industria.ui_config
// → empresaActiva.ui_config, resuelto en modules/auth.js) trae su propio
// arreglo `modulos` completo. Sin esto (empresa sin industria configurada,
// ej. TARA-OS o una empresa nueva) se usa el menú genérico de arriba.
function modulosParaEmpresa(empresaActiva) {
  return empresaActiva?.ui_config?.modulos || MODULOS;
}

export default function Shell() {
  const { sesion, cerrarSesion } = useAuth();
  const esGerencial = ROLES_GERENCIALES.includes(sesion?.empresaActiva?.rol);
  const modulos = modulosParaEmpresa(sesion?.empresaActiva).filter(m => !m.soloGerencial || esGerencial);

  async function salirDelModoSoporte() {
    await api.salirImpersonacion().catch(() => {});
    window.location.href = '/admin';
  }

  return (
    <div className="shell-raiz" style={{ '--acento': sesion?.empresaActiva?.color_acento || '#1a1a2e' }}>
      {sesion?.empresaActiva?.es_impersonacion && (
        <div className="shell-banner-soporte">
          ⚠ Estás viendo el panel como <b>{sesion.empresaActiva.nombre}</b> — modo soporte de Super Admin
          <button onClick={salirDelModoSoporte}>Salir del modo soporte</button>
        </div>
      )}
      <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-logo">
          <LogoTara size={40} className="shell-logo-icono" />
          <div>
            <div className="shell-logo-marca">TARA</div>
            <p className="shell-logo-tagline">Business, made easy.</p>
          </div>
        </div>
        <nav>
          {modulos.map(m => (
            m.habilitado ? (
              <NavLink key={m.ruta} to={m.ruta} className="shell-nav-item">
                <Icono nombre={m.icono} />
                {m.etiqueta}
              </NavLink>
            ) : (
              <span key={m.ruta} className="shell-nav-item shell-nav-item--deshabilitado">
                <Icono nombre={m.icono} />
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
            {sesion?.empresaActiva?.nombre}
            <button onClick={cerrarSesion}>Cerrar sesión</button>
          </div>
        </header>

        <main className="shell-main">
          <Outlet />
        </main>
      </div>
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
