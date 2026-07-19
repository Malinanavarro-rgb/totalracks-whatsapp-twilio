import { NavLink, Outlet } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext';

const NAV = [
  { ruta: '/admin', etiqueta: 'Analítica global', icono: '◆', fin: true },
  { ruta: '/admin/organizaciones', etiqueta: 'Organizaciones', icono: '▦' },
  { ruta: '/admin/centro-cobro', etiqueta: 'Centro de Cobro', icono: '$' },
  { ruta: '/admin/planes', etiqueta: 'Planes', icono: '◈' },
  { ruta: '/admin/auditoria', etiqueta: 'Auditoría', icono: '≡' },
];

export default function AdminShell() {
  const { admin, cerrarSesion } = useAdminAuth();

  return (
    <div className="pm-root">
      <nav className="pm-rail">
        <div className="pm-rail-brand">
          <div className="pm-mark">T</div>
          <div><b>Panel Maestro</b><span>TARA Matrix</span></div>
        </div>
        <div className="pm-rail-nav">
          {NAV.map(n => (
            <NavLink
              key={n.ruta} to={n.ruta} end={n.fin}
              className={({ isActive }) => 'pm-rail-link' + (isActive ? ' pm-activo' : '')}
            >
              <span className="pm-ic">{n.icono}</span> {n.etiqueta}
            </NavLink>
          ))}
        </div>
        <div className="pm-rail-foot">
          <div className="pm-av">{(admin?.nombre || admin?.email || '?').charAt(0).toUpperCase()}</div>
          <div className="pm-who">
            <b>{admin?.nombre || admin?.email}</b>
            <span>Super Admin</span>
          </div>
          <button className="pm-salir" onClick={cerrarSesion} title="Cerrar sesión">⏻</button>
        </div>
      </nav>

      <main className="pm-main">
        <Outlet />
      </main>
    </div>
  );
}
