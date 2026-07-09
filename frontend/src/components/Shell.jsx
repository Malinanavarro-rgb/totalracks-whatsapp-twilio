import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Los 7 módulos de la Plataforma SaaS (docs/roadmap — FASE 5). Solo
// "Centro de Operaciones" está habilitado en Fase 1 — el resto se muestra
// para no rediseñar la navegación en cada fase futura.
const MODULOS = [
  { ruta: '/operaciones',   etiqueta: 'Centro de Operaciones', habilitado: true },
  { ruta: '/conversaciones', etiqueta: 'Conversaciones',        habilitado: true },
  { ruta: '/agenda',         etiqueta: 'Agenda TARA',           habilitado: true },
  { ruta: '/crm',            etiqueta: 'CRM',                   habilitado: false },
  { ruta: '/configuracion',  etiqueta: 'Configuración',         habilitado: false },
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
          <div>
            <strong>{sesion?.empresaActiva?.nombre || 'Empresa'}</strong>
            <span className="shell-rol"> · {sesion?.empresaActiva?.rol}</span>
          </div>
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
