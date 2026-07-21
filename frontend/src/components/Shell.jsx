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
};

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
  { ruta: '/configuracion',  etiqueta: 'Configuración',         icono: 'configuracion',  habilitado: true },
  { ruta: '/reportes',       etiqueta: 'Reportes',              icono: 'catalogo',       habilitado: false },
];

// Fase Demo · Tienda Soccer: esta industria vende por cotización (no agenda
// citas) y su proceso comercial se navega en dos vistas separadas —
// "Ventas" (kanban del proceso) y "Clientes" (ficha por cliente) — en vez
// de una sola entrada "CRM". "Catálogo" reusa el CRUD de Servicios ya
// existente en Configuración, solo con otra etiqueta/ruta en el menú.
const MODULOS_UNIFORMES_DEPORTIVOS = [
  { ruta: '/operaciones',    etiqueta: 'Inicio',         icono: 'inicio',         habilitado: true },
  { ruta: '/conversaciones', etiqueta: 'Conversaciones', icono: 'conversaciones', habilitado: true },
  { ruta: '/inbox',          etiqueta: 'Inbox',          icono: 'inbox',          habilitado: true },
  { ruta: '/crm/pipeline',   etiqueta: 'Ventas',         icono: 'ventas',         habilitado: true },
  { ruta: '/crm',            etiqueta: 'Clientes',       icono: 'clientes',       habilitado: true },
  { ruta: '/catalogo',       etiqueta: 'Catálogo',       icono: 'catalogo',       habilitado: true },
  { ruta: '/configuracion',  etiqueta: 'Configuración',  icono: 'configuracion',  habilitado: true },
];

// Fase Premium · Salón de Belleza: negocio de citas, no de proceso
// comercial por días — Agenda vuelve a ser central (a diferencia de
// uniformes_deportivos, que no la usa) y "Ventas"/kanban no aplica.
const MODULOS_SALON_BELLEZA = [
  { ruta: '/operaciones',    etiqueta: 'Inicio',         icono: 'inicio',         habilitado: true },
  { ruta: '/conversaciones', etiqueta: 'Conversaciones', icono: 'conversaciones', habilitado: true },
  { ruta: '/inbox',          etiqueta: 'Inbox',          icono: 'inbox',          habilitado: true },
  { ruta: '/agenda',         etiqueta: 'Agenda',         icono: 'agenda',         habilitado: true },
  { ruta: '/crm',            etiqueta: 'Clientas',       icono: 'clientes',       habilitado: true },
  { ruta: '/catalogo',       etiqueta: 'Catálogo',       icono: 'catalogo',       habilitado: true },
  { ruta: '/configuracion',  etiqueta: 'Configuración',  icono: 'configuracion',  habilitado: true },
];

function modulosParaEmpresa(empresaActiva) {
  if (empresaActiva?.industria_slug === 'uniformes_deportivos') return MODULOS_UNIFORMES_DEPORTIVOS;
  if (empresaActiva?.industria_slug === 'salon_belleza') return MODULOS_SALON_BELLEZA;
  return MODULOS;
}

export default function Shell() {
  const { sesion, cerrarSesion } = useAuth();
  const modulos = modulosParaEmpresa(sesion?.empresaActiva);

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
