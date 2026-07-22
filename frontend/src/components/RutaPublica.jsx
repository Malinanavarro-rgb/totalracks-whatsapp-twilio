import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Inverso de RutaProtegida: si ya hay sesión, no tiene sentido mostrar el
// landing público — va directo a su panel, igual que cualquier SaaS
// (Slack, Notion, etc. no te muestran el marketing si ya iniciaste sesión).
export default function RutaPublica({ children }) {
  const { sesion, cargando } = useAuth();

  if (cargando) return <div className="pantalla-cargando">Cargando…</div>;
  if (sesion) return <Navigate to="/operaciones" replace />;

  return children;
}
