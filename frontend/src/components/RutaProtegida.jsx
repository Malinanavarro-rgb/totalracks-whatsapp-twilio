import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RutaProtegida({ children }) {
  const { sesion, cargando } = useAuth();

  if (cargando) return <div className="pantalla-cargando">Cargando…</div>;
  if (!sesion) return <Navigate to="/login" replace />;

  return children;
}
