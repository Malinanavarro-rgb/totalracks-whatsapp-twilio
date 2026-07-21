import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminAuthProvider } from './AdminAuthContext';
import RutaProtegidaAdmin from './RutaProtegidaAdmin';
import AdminShell from './AdminShell';
import AdminLogin from './AdminLogin';
import Dashboard from './pages/Dashboard';
import TaraOperador from './pages/TaraOperador';
import Organizaciones from './pages/Organizaciones';
import OrganizacionDetalle from './pages/OrganizacionDetalle';
import Planes from './pages/Planes';
import CentroCobro from './pages/CentroCobro';
import Auditoria from './pages/Auditoria';
import './admin.css';

// Primer punto de code-splitting real del proyecto: este árbol completo
// (AdminApp + todo lo que importa) solo se descarga cuando alguien navega
// a /admin/* — un usuario normal de empresa nunca lo carga. Ver App.jsx
// (React.lazy) y el plan de arquitectura de la Plataforma Comercial.
export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<AdminLogin />} />

        <Route
          element={
            <RutaProtegidaAdmin>
              <AdminShell />
            </RutaProtegidaAdmin>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="tara" element={<TaraOperador />} />
          <Route path="organizaciones" element={<Organizaciones />} />
          <Route path="organizaciones/:id" element={<OrganizacionDetalle />} />
          <Route path="planes" element={<Planes />} />
          <Route path="centro-cobro" element={<CentroCobro />} />
          <Route path="auditoria" element={<Auditoria />} />
        </Route>

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
