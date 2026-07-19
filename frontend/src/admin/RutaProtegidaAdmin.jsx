import { Navigate } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext';

export default function RutaProtegidaAdmin({ children }) {
  const { admin, cargando } = useAdminAuth();

  if (cargando) return <div className="pantalla-cargando">Cargando…</div>;
  if (!admin) return <Navigate to="/admin/login" replace />;

  return children;
}
